import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TileController, WORKSPACE_MODE_CONFIG_KEY } from "../src/controller";
import {
    Harness,
    OUTPUT,
    RECT,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";
import { countEvent, invokeShortcut } from "./controller-fixture-scenarios";

describe("TileController global-unique workspaces (Unit 06)", () => {
    const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
    const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
    const DESKTOP_1 = { id: "desktop-1" };
    const DESKTOP_3 = { id: "desktop-3" };
    const DESKTOP_4 = { id: "desktop-4" };
    const DESKTOP_5 = { id: "desktop-5" };
    const DESKTOP_7 = { id: "desktop-7" };
    const DESKTOP_8 = { id: "desktop-8" };

    // Two-output global-unique session. Startup reconciliation assigns every
    // pre-existing desktop to the session primary output (E); with no
    // replenish there is no automatic per-output trailing empty. The spec
    // H.12 exact example (E owns [1,2,4], L owns [3,5,6]) is constructed
    // through the deterministic session seeding seam. Per-output current
    // desktops are modeled through the harness override so the
    // visible-target swap detection sees independent per-output currents.
    function globalUniqueSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly keyE: string;
        readonly keyL: string;
        readonly wE: TestWindow;
        readonly wL: TestWindow;
    } {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
            { id: "desktop-4", x11DesktopNumber: 4 },
            { id: "desktop-5", x11DesktopNumber: 5 },
            { id: "desktop-6", x11DesktopNumber: 6 },
            // desktop-7 and desktop-8 stand in for E's and L's owned trailing
            // empty (no replenish exists, so nothing auto-creates these; they
            // are seeded directly as the deterministic baseline the tests
            // below build on).
            { id: "desktop-7", x11DesktopNumber: 7 },
            { id: "desktop-8", x11DesktopNumber: 8 },
        ];
        harness.nextDesktopNumber = 8;
        // Null currents at startup so no window is in scope and no dwindle
        // reconstruction is armed (the same pattern as the Unit 05 two-output
        // setup); per-output currents are modeled after startup.
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        harness.windows = [wE, wL];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const inspectable = controller as unknown as { ownedDesktopIds: Set<string> };
        inspectable.ownedDesktopIds.add("desktop-7");
        inspectable.ownedDesktopIds.add("desktop-8");
        controller.seedGlobalUniqueAssignment({
            [keyE]: ["desktop-1", "desktop-2", "desktop-4", "desktop-7"],
            [keyL]: ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        });
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_3);
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        return { harness, controller, keyE, keyL, wE, wL };
    }

    it("selects the nth member of the active output's assigned subset via per-output writes (E 3rd = 4, L 2nd = 5)", () => {
        // Spec H.12: E owns [1,2,4], L owns [3,5,6] (plus owned trailing
        // empties). Meta+3 on E selects global 4; Meta+2 on L selects global 5.
        const onE = globalUniqueSetup();
        onE.harness.active = onE.wE;
        onE.harness.currentDesktopByOutput.delete(OUTPUT_L);
        invokeShortcut(onE.harness, "plasma-auto-tiler-workspace-3");
        assert.equal((onE.harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-4");
        assert.equal(onE.harness.currentDesktopByOutput.has(OUTPUT_L), false);
        const lastE = onE.harness.currentDesktopForScreenWrites[
            onE.harness.currentDesktopForScreenWrites.length - 1
        ];
        assert.equal((lastE?.desktop as { id: string }).id, "desktop-4");
        assert.equal(lastE?.output, OUTPUT_E);

        const onL = globalUniqueSetup();
        onL.harness.active = onL.wL;
        onL.harness.currentDesktopByOutput.delete(OUTPUT_E);
        invokeShortcut(onL.harness, "plasma-auto-tiler-workspace-2");
        assert.equal((onL.harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-5");
        assert.equal(onL.harness.currentDesktopByOutput.has(OUTPUT_E), false);
        const lastL = onL.harness.currentDesktopForScreenWrites[
            onL.harness.currentDesktopForScreenWrites.length - 1
        ];
        assert.equal((lastL?.desktop as { id: string }).id, "desktop-5");
        assert.equal(lastL?.output, OUTPUT_L);
    });

    it("selects the active screen's assigned subset member with no focused window (activeScreen = L)", () => {
        // Spec D common: with no focused window the active output is
        // `workspace.activeScreen`. L's assigned subset is [3,5,6,8] ordered by
        // x11DesktopNumber, so Meta+2 selects global desktop-5 via the
        // per-output write only; E's subset is never used as a substitute and E
        // stays unchanged.
        const { harness } = globalUniqueSetup();
        harness.active = null;
        harness.activeScreenValue = OUTPUT_L;
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        const writesBefore = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-5");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_E), false);
        assert.equal(harness.currentDesktopForScreenWrites.length, writesBefore + 1);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-5");
        assert.equal(last?.output, OUTPUT_L);
    });

    it("no-ops with a diagnostic when neither a focused window nor activeScreen is available (global-unique)", () => {
        const { harness } = globalUniqueSetup();
        harness.active = null;
        harness.activeScreenValue = null;
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-active-screen-unavailable"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
    });

    it("an absent subset index is a specific no-op with no write", () => {
        const { harness, wE } = globalUniqueSetup();
        harness.active = wE;
        const writes = harness.currentDesktopForScreenWrites.length;
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-9");
        assert.equal(countEvent(harness.logs, "workspace-navigate-absent:9"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, createsBefore);
    });

    it("applies the visible-target swap before navigation: target moves to the active output, prior current to the other, assignments follow", () => {
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        // L already shows global desktop-4 (E's 3rd subset member).
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_4);
        harness.active = wE;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-3");
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 1);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-4");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-1");
        // One assigned current desktop per affected output; the swap moved
        // desktop-1 to L and left desktop-4 assigned to E.
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(snapshot[keyE]?.slice().sort(), ["desktop-2", "desktop-4", "desktop-7"]);
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-1", "desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        );
        // The swap writes come first (target to the active output, prior
        // current to the other output); the navigation follow write re-asserts
        // the target on the active output last.
        const writes = harness.currentDesktopForScreenWrites;
        const swapWrites = writes.slice(-3);
        assert.equal((swapWrites[0]?.desktop as { id: string }).id, "desktop-4");
        assert.equal(swapWrites[0]?.output, OUTPUT_E);
        assert.equal((swapWrites[1]?.desktop as { id: string }).id, "desktop-1");
        assert.equal(swapWrites[1]?.output, OUTPUT_L);
        assert.equal((swapWrites[2]?.desktop as { id: string }).id, "desktop-4");
        assert.equal(swapWrites[2]?.output, OUTPUT_E);
    });

    it("move-follow applies the visible-target swap before the membership write and follow", () => {
        const { harness, controller, keyE, keyL, wL } = globalUniqueSetup();
        // E already shows global desktop-5 (L's 2nd subset member).
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_5);
        harness.active = wL;
        wL.desktops = [DESKTOP_3];
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 1);
        assert.deepEqual((wL.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-5"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-5");
        // L's prior current desktop-3 moved to E, so the swap preserves one
        // assigned current per affected output.
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-3");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyE]?.slice().sort(),
            ["desktop-1", "desktop-2", "desktop-3", "desktop-4", "desktop-7"],
        );
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-5", "desktop-6", "desktop-8"]);
    });

    it("Meta+Shift+0 reuses the active output's own trailing empty instead of creating a new desktop", () => {
        // Meta+Shift+0 reuses the structurally-identified trailing empty of
        // the active output's own assignment group (desktop-8, L's highest
        // x11DesktopNumber member, currently empty) rather than always
        // creating.
        const { harness, controller, keyL, wL } = globalUniqueSetup();
        harness.active = wL;
        wL.desktops = [DESKTOP_3];
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_3);
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, createsBefore);
        assert.deepEqual((wL.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-8"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-8");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        );
    });

    it("Meta+Shift+0 creates and assigns exactly one desktop only when the active output's own domain lacks a trailing empty", () => {
        // Each output's domain is its own assignment group ordered by
        // x11DesktopNumber - occupying desktop-8 (the structurally-last
        // member of L's own group) is what removes L's trailing empty; E's
        // group and trailing empty are untouched.
        const { harness, controller, keyL, wL } = globalUniqueSetup();
        const occupant = window({ output: OUTPUT_L, desktops: [DESKTOP_8] });
        harness.windows = [...(harness.windows as unknown[]), occupant];
        harness.active = wL;
        wL.desktops = [DESKTOP_3];
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_3);
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.deepEqual((wL.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-9"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-9");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-3", "desktop-5", "desktop-6", "desktop-8", "desktop-9"],
        );
    });

    it("refuses sticky, fullscreen, and maximized moves before any write or create", () => {
        const sticky = globalUniqueSetup();
        sticky.harness.active = sticky.wE;
        sticky.harness.currentDesktop = DESKTOP_1;
        sticky.harness.currentDesktopValue = DESKTOP_1;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-sticky-toggle");
        const createsBefore = sticky.harness.createDesktopCalls.length;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(sticky.harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(sticky.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(sticky.harness.createDesktopCalls.length, createsBefore);

        const fullscreen = globalUniqueSetup();
        fullscreen.harness.active = fullscreen.wE;
        fullscreen.wE.fullScreen = true;
        const createsFs = fullscreen.harness.createDesktopCalls.length;
        invokeShortcut(fullscreen.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(fullscreen.harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(fullscreen.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(fullscreen.harness.createDesktopCalls.length, createsFs);

        // A tiled window so the maximize action can record it.
        const maximized = new Harness();
        maximized.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        maximized.screensList = [OUTPUT_E, OUTPUT_L];
        maximized.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
            { id: "desktop-4", x11DesktopNumber: 4 },
            { id: "desktop-5", x11DesktopNumber: 5 },
            { id: "desktop-6", x11DesktopNumber: 6 },
        ];
        maximized.nextDesktopNumber = 6;
        maximized.currentDesktop = DESKTOP_1;
        maximized.currentDesktopValue = DESKTOP_1;
        maximized.currentDesktopForOutputOverride = (output) =>
            maximized.currentDesktopByOutput.get(output) ?? maximized.currentDesktop;
        const maxRoot = tile(RECT, true);
        const maxTarget = tile();
        const maxWE = window({ tile: maxTarget, output: OUTPUT_E });
        maxTarget.windows = [maxWE];
        maxRoot.tiles = [maxTarget];
        maximized.root = maxRoot;
        maximized.windows = [maxWE];
        maximized.active = maxWE;
        maximized.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        const maxController = new TileController(maximized.environment());
        maxController.start();
        const createsMax = maximized.createDesktopCalls.length;
        invokeShortcut(maximized, "plasma-auto-tiler-maximize");
        invokeShortcut(maximized, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(maximized.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(maximized.currentDesktopForScreenWrites.length, 0);
        assert.equal(maximized.createDesktopCalls.length, createsMax);
    });

    it("cleanup removes every empty, invisible desktop after a disconnect, including the disconnected output's former trailing empty, but reserves the surviving output's own trailing empty", () => {
        const { harness, controller, keyL, wL } = globalUniqueSetup();
        // wE and wL both stay floating on desktop-1 and desktop-3 protects the
        // other current desktop, so the screens change arms no reconstruction
        // and cleanup runs immediately (the Unit 05 hotplug pattern).
        wL.desktops = [DESKTOP_3];
        harness.removedDesktops.length = 0;
        // Disconnect E: rebuildGlobalUniqueMapping folds E's now-unassigned
        // desktops (including its former trailing empty, desktop-7) into L's
        // group since L is the sole remaining connected output. desktop-7 is
        // NOT adopted/protected as L's trailing - L's own group already had
        // desktop-8 as its structurally-last member, so desktop-7 is
        // immediately cleanup-eligible. desktop-1 (occupied) and desktop-3
        // (current on L) also survive; every other empty invisible desktop is
        // removed regardless of ownership.
        harness.screensList = [OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        harness.screensChanged?.();
        // The scope change on L can arm a reconstruction (its floating window
        // becomes the current scope's candidate), which defers cleanup until
        // it settles.
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-4", "desktop-5", "desktop-6", "desktop-7"],
        );
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(snapshot), [keyL]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-1", "desktop-3", "desktop-8"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-8"]);
    });

    it("cleanup never removes a current or visible desktop, regardless of ownership", () => {
        const { harness, controller } = globalUniqueSetup();
        // L shows its owned trailing desktop-8 (current + visible), so it
        // survives; every other empty invisible desktop is removed.
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_8);
        harness.removedDesktops.length = 0;
        harness.screensList = [OUTPUT_L];
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-3", "desktop-4", "desktop-5", "desktop-6", "desktop-7"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-8"]);
    });

    it("Meta+0 reuses the active output's own trailing empty and focuses it, leaving the other output's assignment and current desktop unchanged", () => {
        // Meta+0 reuses the structurally-identified trailing empty of the
        // active output's own assignment group (E's own group's highest
        // x11DesktopNumber member, desktop-7) - never a different output's
        // trailing, and never applying globalUniqueSwapIfVisibleElsewhere on
        // this path. L's assignment and current desktop are untouched.
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        harness.active = wE;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-7");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 0);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-7");
        assert.equal(last?.output, OUTPUT_E);
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyE]?.slice().sort(),
            ["desktop-1", "desktop-2", "desktop-4", "desktop-7"],
        );
        assert.deepEqual(
            snapshot[keyL]?.slice().sort(),
            ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
        );
    });

    it("Meta+0 creates and assigns exactly one desktop when the active output's own domain lacks a trailing empty (global-unique)", () => {
        // Occupying desktop-7 (the structurally-last member of E's own
        // group) is what removes E's own trailing empty - each output's
        // domain is its own assignment group, not a shared global one.
        // Meta+0 then creates exactly one owned desktop, assigns it to E,
        // focuses it, and leaves L unchanged.
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        const occupant = window({ output: OUTPUT_E, desktops: [DESKTOP_7] });
        harness.windows = [...(harness.windows as unknown[]), occupant];
        harness.active = wE;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-9");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            snapshot[keyE]?.slice().sort(),
            ["desktop-1", "desktop-2", "desktop-4", "desktop-7", "desktop-9"],
        );
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-3", "desktop-5", "desktop-6", "desktop-8"]);
    });

    it("cleanupDesktops-equivalent dispatch is idempotent against unchanged global-unique state (no net creates/removes)", () => {
        // Two consecutive dispatches against unchanged state produce zero net
        // creates/removes - the single-pass ensureTrailingEmptyDesktop-backed
        // enforcement (unit-03) is structural and re-reads live state on every
        // call rather than looping or debouncing.
        const { harness } = globalUniqueSetup();
        // Settle the fixture's initial empty/invisible desktops first (they
        // are removed on the first dispatch), then assert the second and
        // third dispatches against the now-settled state are pure no-ops.
        harness.emitDesktopsChanged();
        const creates = harness.createDesktopCalls.length;
        harness.removedDesktops.length = 0;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("Meta+0 never applies the cross-output swap on the trailing-empty reuse path, even when the target happens to be currently shown on a different output", () => {
        // E's own trailing empty (desktop-7) happens to currently be shown as
        // L's current desktop. The trailing-empty reuse path must reuse it
        // directly on E without ever calling globalUniqueSwapIfVisibleElsewhere
        // - no cross-output swap, and L's current desktop and assignment are
        // left completely untouched (unlike ordinary swap-eligible navigation).
        const { harness, controller, keyE, keyL, wE } = globalUniqueSetup();
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_7);
        harness.active = wE;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(countEvent(harness.logs, "workspace-navigate-swap"), 0);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-7");
        // L's current desktop is untouched - not swapped to E's prior current.
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-7");
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(snapshot[keyE]?.slice().sort(), ["desktop-1", "desktop-2", "desktop-4", "desktop-7"]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-3", "desktop-5", "desktop-6", "desktop-8"]);
    });

    it("each connected output ends up with exactly one trailing empty in its own domain, not one shared global one", () => {
        const { harness, controller, keyE, keyL } = globalUniqueSetup();
        harness.emitDesktopsChanged();
        // After settling, only the current desktop and each output's own
        // structurally-last (trailing) member survive per domain - E keeps
        // desktop-1 (current) and desktop-7 (E's own trailing); L keeps
        // desktop-3 (current) and desktop-8 (L's own trailing). They are
        // distinct, per-output trailing empties, not one shared global one.
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(snapshot[keyE]?.slice().sort(), ["desktop-1", "desktop-7"]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-3", "desktop-8"]);
    });

    it("a newly connected output gets a freshly created trailing empty, never an adopted spare desktop", () => {
        const { harness, controller } = globalUniqueSetup();
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const wN = window({ output: OUTPUT_N });
        harness.windows = [...(harness.windows as unknown[]), wN];
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        const creates = harness.createDesktopCalls.length;
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        const keyN = controller.outputKeyFor(OUTPUT_N) as string;
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.equal(snapshot[keyN]?.length, 1);
        assert.equal(harness.createDesktopCalls[harness.createDesktopCalls.length - 1] !== undefined, true);
    });

    it("literal-last-wins: a disconnect can protect a higher-numbered folded-in trailing empty over the survivor's own lower-numbered trailing empty, and self-heals once occupied (accepted adversarial ordering, not a bug)", () => {
        const { harness, controller, keyE, keyL, wL } = globalUniqueSetup();
        // Inverse of the existing disconnect test's ordering: give E the
        // *higher*-numbered trailing empty (desktop-8) and L the *lower*-
        // numbered one (desktop-7), so once E's group folds into L's after
        // disconnect, L's own former trailing (desktop-7) is no longer the
        // structurally-last member of the merged group.
        controller.seedGlobalUniqueAssignment({
            [keyE]: ["desktop-1", "desktop-2", "desktop-4", "desktop-8"],
            [keyL]: ["desktop-3", "desktop-5", "desktop-6", "desktop-7"],
        });
        wL.desktops = [DESKTOP_3];
        harness.removedDesktops.length = 0;
        // Disconnect E: rebuildGlobalUniqueMapping folds E's now-unassigned
        // desktops (including its former trailing, desktop-8) into L's
        // group. Per globalUniqueOrdered's x11-ascending sort, desktop-8 -
        // not L's own former trailing desktop-7 - is now the structurally-
        // last member of the merged group and is protected; desktop-7
        // becomes an ordinary non-trailing empty and is removed like any
        // other (Q-Manual, ownership-independent). This is the deliberately
        // accepted inverse of "cleanup removes every empty ... reserves the
        // surviving output's own trailing empty": here the folded-in
        // desktop wins protection over the survivor's own true trailing.
        // The last-remaining-global-desktop floor is not implicated (many
        // live desktops remain throughout).
        harness.screensList = [OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-4", "desktop-5", "desktop-6", "desktop-7"],
        );
        const snapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(snapshot), [keyL]);
        assert.deepEqual(snapshot[keyL]?.slice().sort(), ["desktop-1", "desktop-3", "desktop-8"]);

        // Self-heal: once a window lands on the protected-but-"wrong"
        // trailing empty (desktop-8), L's group's last position is occupied,
        // so the next cleanup dispatch appends exactly one new trailing
        // empty (desktop-9, the next increasing x11 number) - convergence
        // back to the single-trailing invariant, confirming this is a
        // temporary, self-correcting property, not a lasting defect.
        const occupant = window({ output: OUTPUT_L, desktops: [DESKTOP_8] });
        harness.windows = [...(harness.windows as unknown[]), occupant];
        const createsBefore = harness.createDesktopCalls.length;
        harness.removedDesktops.length = 0;
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.equal(harness.removedDesktops.length, 0);
        const healedSnapshot = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(
            healedSnapshot[keyL]?.slice().sort(),
            ["desktop-1", "desktop-3", "desktop-8", "desktop-9"],
        );

        // A further dispatch against this now-converged state is a pure
        // no-op - no extra creates/removes.
        const createsAfterHeal = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, createsAfterHeal);
        assert.equal(harness.removedDesktops.length, 0);

        // No ownership Set reintroduced beyond the fixture's own seeding -
        // every surviving/created desktop is reachable purely through the
        // structural globalUniqueOrdered domain.
        assert.deepEqual(
            [...controller.ownedDesktopIdSnapshot()].sort(),
            ["desktop-8", "desktop-9"],
        );
    });

    it("a third simultaneously connected output develops its own distinct trailing empty, and disconnecting it folds only its own desktops into the primary output's group, leaving the other survivor's own group and current desktop completely unaffected (global-unique)", () => {
        // Generalizes globalUniqueSetup to three outputs connected at once
        // (Q-Domain: one trailing empty per connected output, not per
        // output-pair). N's own desktops are seeded with deliberately low
        // x11DesktopNumbers so folding them into E (the primary) on
        // disconnect never displaces E's own trailing desktop-7 as the
        // merged group's structurally-last member - that adversarial
        // ordering interaction is already covered by the "literal-last-wins"
        // test above; this test isolates the plain multi-output case.
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
            { id: "desktop-3", x11DesktopNumber: 3 },
            { id: "desktop-4", x11DesktopNumber: 4 },
            { id: "desktop-5", x11DesktopNumber: 5 },
            { id: "desktop-6", x11DesktopNumber: 6 },
            { id: "desktop-7", x11DesktopNumber: 7 },
            { id: "desktop-8", x11DesktopNumber: 8 },
            { id: "desktop-9", x11DesktopNumber: -2 },
            { id: "desktop-10", x11DesktopNumber: -1 },
        ];
        harness.nextDesktopNumber = 10;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N, desktops: [{ id: "desktop-9" }] });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const keyN = controller.outputKeyFor(OUTPUT_N) as string;
        assert.equal(new Set([keyE, keyL, keyN]).size, 3);
        controller.seedGlobalUniqueAssignment({
            [keyE]: ["desktop-1", "desktop-2", "desktop-4", "desktop-7"],
            [keyL]: ["desktop-3", "desktop-5", "desktop-6", "desktop-8"],
            [keyN]: ["desktop-9", "desktop-10"],
        });
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-1", x11DesktopNumber: 1 });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3", x11DesktopNumber: 3 });
        harness.currentDesktopByOutput.set(OUTPUT_N, { id: "desktop-9", x11DesktopNumber: -2 });
        harness.currentDesktop = { id: "desktop-1", x11DesktopNumber: 1 };
        harness.currentDesktopValue = { id: "desktop-1", x11DesktopNumber: 1 };

        // Settle the freshly seeded fixture once (sweeps its own dangling,
        // never-occupied spare desktops down to current+trailing per
        // domain) so the disconnect assertions below measure only the
        // delta caused by N leaving, not the fixture's own first-ever
        // reconciliation sweep.
        harness.emitDesktopsChanged();

        // The three domains are structurally distinct: no desktop id is a
        // member of more than one output's own assignment group.
        const before = controller.globalUniqueAssignmentSnapshot();
        const allIds = [...(before[keyE] ?? []), ...(before[keyL] ?? []), ...(before[keyN] ?? [])];
        assert.equal(new Set(allIds).size, allIds.length);
        const lBefore = [...(before[keyL] ?? [])].sort();
        const currentLBefore = harness.currentDesktopByOutput.get(OUTPUT_L);

        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        // Disconnect N: its occupied desktop-9 (holding wN) is not empty
        // and is folded into E's group rather than dropped; its empty
        // desktop-10 folds in too but, being lower-numbered than E's own
        // desktop-7, never becomes the merged group's trailing position, so
        // it is removed like any other ordinary empty invisible desktop
        // (Q-Manual). No desktop is created purely as a result of the
        // disconnect (disconnect never replenishes). L's own group and
        // current desktop are completely untouched.
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_N);
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-10"],
        );
        assert.equal(harness.createDesktopCalls.length, creates);
        const after = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(after).sort(), [keyE, keyL].sort());
        assert.deepEqual([...(after[keyE] ?? [])].sort(), ["desktop-1", "desktop-7", "desktop-9"]);
        assert.deepEqual([...(after[keyL] ?? [])].sort(), lBefore);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_L), currentLBefore);
    });

    it("output replug (disconnect then reconnect the identical output) creates a fresh trailing empty for the returning output, never adopting a spare desktop left over from before it disconnected (global-unique)", () => {
        const { harness, controller, keyE, keyL } = globalUniqueSetup();
        const formerLIds = ["desktop-3", "desktop-5", "desktop-6", "desktop-8"];
        harness.removedDesktops.length = 0;
        // Disconnect L: its group folds into E, the primary.
        harness.screensList = [OUTPUT_E];
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        const afterDisconnect = controller.globalUniqueAssignmentSnapshot();
        assert.deepEqual(Object.keys(afterDisconnect), [keyE]);
        // Reconnect the identical output tuple: matched by first-seen order,
        // it gets its own session key back (spec E), but with no adopted
        // spare - reconciliation creates exactly one brand-new desktop as
        // its trailing empty, distinct from every one of its former ids
        // (all of which were either removed or folded permanently into E).
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        const creates = harness.createDesktopCalls.length;
        harness.screensChanged?.();
        settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();
        assert.equal(controller.outputKeyFor(OUTPUT_L), keyL);
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        const replugged = controller.globalUniqueAssignmentSnapshot();
        assert.equal(replugged[keyL]?.length, 1);
        const newTrailingId = (replugged[keyL] as readonly string[])[0] as string;
        assert.equal(formerLIds.includes(newTrailingId), false);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-1");
    });
});
