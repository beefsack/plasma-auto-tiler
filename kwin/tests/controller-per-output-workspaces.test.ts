import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TileController } from "../src/controller";
import {
    Harness,
    OUTPUT,
    RECT,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";
import { countEvent, invokeShortcut, setup } from "./controller-fixture-scenarios";

describe("TileController per-output-local workspaces (Unit 05)", () => {
    const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
    const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
    const DESKTOP_1 = { id: "desktop-1", x11DesktopNumber: 1 };
    const DESKTOP_2 = { id: "desktop-2", x11DesktopNumber: 2 };

    // Two-output session where every window starts untiled on desktop-1 and the
    // global current desktop is null so no scope is owned and no tiling
    // reconstruction is armed. All moves below are floating moves: membership
    // write + follow only, never a tile-tree mutation. There is no replenish,
    // ever: startup reconciliation creates nothing. desktop-1 is the sole
    // pre-existing desktop and resolves into E's list (session primary); L
    // starts with no desktops and gets its own local list purely from
    // move/navigate actions below.
    function twoOutputSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly wE: TestWindow;
        readonly wL1: TestWindow;
        readonly wL2: TestWindow;
        readonly wL3: TestWindow;
    } {
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wE = window({ output: OUTPUT_E });
        const wL1 = window({ output: OUTPUT_L });
        const wL2 = window({ output: OUTPUT_L });
        const wL3 = window({ output: OUTPUT_L });
        harness.windows = [wE, wL1, wL2, wL3];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        return { harness, controller, wE, wL1, wL2, wL3 };
    }

    // Float a window through the sticky toggle (floating on the desktop it
    // belongs to) and then clear the all-desktops pin: the window stays
    // floating and movable, with no tile tree involved.
    function makeFloating(harness: Harness, win: TestWindow): void {
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.active = win;
        const enabledBaseline = countEvent(harness.logs, "sticky-enabled");
        const disabledBaseline = countEvent(harness.logs, "sticky-disabled");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-enabled"), enabledBaseline + 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), disabledBaseline + 1);
    }

    function moveToTrailing(harness: Harness, win: TestWindow): void {
        harness.currentDesktop = DESKTOP_1;
        harness.active = win;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
    }

    function twoLocalLists(
        controller: TileController,
    ): [readonly string[], readonly string[]] {
        const snapshot = controller.localWorkspaceSnapshot();
        const lists = Object.values(snapshot);
        return [lists[0] ?? [], lists[1] ?? []];
    }

    it("creates no automatic trailing empty at startup (no replenish, ever); every pre-existing desktop resolves to the session primary output", () => {
        // No replenish exists any more: a fresh two-output startup creates
        // nothing. Every pre-existing desktop is unassigned, so it resolves
        // into the session primary output's list (spec E hotplug), never the
        // other output's.
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        harness.nextDesktopNumber = 2;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.removedDesktops.length, 0);
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2"]);
        assert.deepEqual([...lIds], []);
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        const [eAgain, lAgain] = twoLocalLists(controller);
        assert.deepEqual([...eAgain], ["desktop-1", "desktop-2"]);
        assert.deepEqual([...lAgain], []);
    });

    it("reconciles a one-desktop two-output startup with no automatic trailing empty on either output", () => {
        // Regression coverage retargeted: the singleton global-desktop guard
        // used to skip per-output-local reconciliation entirely; it must
        // still run the mapping rebuild even for a single pre-existing
        // desktop across multiple outputs, but with no replenish it creates
        // nothing and never removes the pre-existing desktop.
        const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
        const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [{ id: "desktop-1", x11DesktopNumber: 1 }];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(harness.removedDesktops.length, 0);
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.deepEqual(
            (harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id),
            ["desktop-1"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], []);
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1"]);
        assert.deepEqual([...lIds], []);
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("keeps two-output local sets distinct and navigates only the active output's list", () => {
        // Every default test window starts occupying desktop-1 (the shared
        // test fixture default), so under the trailing-empty reuse model
        // each Shift+0 below either reuses the target output's existing
        // empty trailing desktop or creates one when none exists yet, and
        // each move that vacates a domain's current trailing empty
        // immediately replenishes it. wE's own move ends up reusing E's own
        // still-empty desktop-3 (created by an earlier cross-output
        // replenish) rather than creating a fifth desktop.
        const { harness, controller, wE, wL1, wL2, wL3 } = twoOutputSetup();
        for (const win of [wE, wL1, wL2, wL3]) {
            makeFloating(harness, win);
        }
        moveToTrailing(harness, wL1);
        moveToTrailing(harness, wL2);
        moveToTrailing(harness, wL3);
        moveToTrailing(harness, wE);
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-3", "desktop-7"]);
        assert.deepEqual([...lIds], ["desktop-2", "desktop-4", "desktop-5", "desktop-6"]);
        assert.equal(new Set([...eIds, ...lIds]).size, eIds.length + lIds.length);

        // Selection on E changes only E's current desktop.
        harness.active = wE;
        harness.currentDesktopByOutput.delete(OUTPUT_L);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-3");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        assert.equal(
            (harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1]?.output as {
                name: string;
            }).name,
            "screen-e",
        );

        // Selection on L changes only L's current desktop.
        harness.active = wL1;
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-4");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_E), false);
    });

    it("reconciliation is stable across repeated triggers and creates or removes nothing extra", () => {
        // Every default test window starts occupying desktop-1, so wE's move
        // creates desktop-2 (occupied) and its replenishment desktop-3
        // (E's trailing empty); L has no desktops yet, so the same cleanup
        // dispatch also seeds its own initial trailing empty desktop-4
        // (Q-Domain: one trailing empty per connected output). wL1's later
        // move reuses desktop-4 and replenishes desktop-5 as L's trailing.
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        let [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lIds], ["desktop-4", "desktop-5"]);
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lIds], ["desktop-4", "desktop-5"]);
    });

    it("Meta+Shift+0 creates a new desktop on the active output's list and moves into it, and cleanup seeds L's own trailing empty", () => {
        // desktop-1 starts occupied by every default test window (wE, wL1,
        // wL2, wL3), so E's domain has no reusable trailing empty and
        // Shift+0 creates desktop-2, moves wE in, and the same cleanup
        // dispatch replenishes desktop-3 as E's new trailing empty and seeds
        // L's own initial trailing empty desktop-4 (Q-Domain: one trailing
        // empty per connected output, maintained even for an output with no
        // moves of its own yet).
        const { harness, controller, wE } = twoOutputSetup();
        makeFloating(harness, wE);
        harness.currentDesktopByOutput.clear();
        moveToTrailing(harness, wE);
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-2");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        for (const write of harness.currentDesktopForScreenWrites) {
            assert.equal(write.output, OUTPUT_E);
        }
        const [eIds, lIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lIds], ["desktop-4"]);
    });

    it("refuses sticky, fullscreen, and maximized per-output moves before any mutation", () => {
        const sticky = twoOutputSetup();
        makeFloating(sticky.harness, sticky.wE);
        const enabledBaseline = countEvent(sticky.harness.logs, "sticky-enabled");
        invokeShortcut(sticky.harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(sticky.harness.logs, "sticky-enabled"), enabledBaseline + 1);
        const createsBefore = sticky.harness.createDesktopCalls.length;
        sticky.harness.active = sticky.wE;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(sticky.harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(sticky.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(sticky.harness.createDesktopCalls.length, createsBefore);

        const fullscreen = twoOutputSetup();
        makeFloating(fullscreen.harness, fullscreen.wE);
        const createsFs = fullscreen.harness.createDesktopCalls.length;
        fullscreen.wE.fullScreen = true;
        fullscreen.harness.active = fullscreen.wE;
        invokeShortcut(fullscreen.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(fullscreen.harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(fullscreen.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(fullscreen.harness.createDesktopCalls.length, createsFs);

        const maximized = setup();
        maximized.harness.screensList = [OUTPUT_E, OUTPUT_L];
        maximized.harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        const createsMax = maximized.harness.createDesktopCalls.length;
        invokeShortcut(maximized.harness, "plasma-auto-tiler-maximize");
        invokeShortcut(maximized.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(maximized.harness.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(maximized.harness.currentDesktopWrites.length, 0);
        assert.equal(maximized.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(maximized.harness.createDesktopCalls.length, createsMax);
    });

    it("marks a removed output's owned empties as cleanup candidates once it disconnects, and a replug creates nothing (no replenish)", () => {
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        // Under the trailing-empty reuse model wE's move replenishes E's
        // list to [desktop-1, desktop-2, desktop-3] (desktop-2 occupied by
        // wE, desktop-3 the fresh trailing empty) and wL1's move replenishes
        // L's list to [desktop-4, desktop-5]. Protect desktop-2 (E's owned,
        // occupied, non-trailing desktop) as E's own distinct current
        // desktop so it survives while E stays connected, then vacate it
        // externally (as if the window moved without going through the
        // controller) so it is empty but still shown current on E. L's own
        // real current desktop (desktop-4, where wL1 actually sits) is
        // preserved unchanged through the override so nothing artificially
        // protects an unrelated desktop.
        const survivorRealCurrent = harness.currentDesktopByOutput.get(OUTPUT_L);
        harness.currentDesktopForOutputOverride = (output) =>
            output === OUTPUT_E
                ? { id: "desktop-2", x11DesktopNumber: 2 }
                : (survivorRealCurrent as { id: string; x11DesktopNumber: number });
        harness.currentDesktopValue = survivorRealCurrent as { id: string; x11DesktopNumber: number };
        wE.desktops = [DESKTOP_1];
        const survivorCurrent = harness.currentDesktopByOutput.get(OUTPUT_L);
        const [, survivorList] = twoLocalLists(controller);
        harness.removedDesktops.length = 0;
        // Disconnect E: its still-empty owned desktop-2 is no longer visible
        // (E is dropped from screens()) and becomes a cleanup candidate; E's
        // trailing desktop-3 is also orphaned (its domain is dropped from
        // the mapping) but stays invisible-empty too, so both are removed;
        // L's mapping and current desktop are unchanged and the pre-existing
        // desktop-1 is never removed.
        harness.screensList = [OUTPUT_L];
        harness.screensChanged?.();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-2", "desktop-3"],
        );
        const after = controller.localWorkspaceSnapshot();
        const afterLists = Object.values(after);
        assert.deepEqual(afterLists[0] ?? [], survivorList);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_L), survivorCurrent);
        // Replug the identical tuple: matched by first-seen order, it gets its
        // key back. With no replenish beyond the trailing-empty invariant,
        // the pre-existing, unassigned desktop-1 resolves back to E (the
        // session primary), then E's cleanup dispatch replenishes its own
        // trailing empty since desktop-1 is occupied (by wL2/wL3, never
        // moved); L is untouched.
        harness.screensList = [OUTPUT_L, OUTPUT_E];
        harness.screensChanged?.();
        assert.equal(controller.outputKeyFor(OUTPUT_E), "output-0");
        assert.equal(controller.outputKeyFor(OUTPUT_L), "output-1");
        const replug = controller.localWorkspaceSnapshot();
        assert.deepEqual(
            Object.values(replug).map((list) => [...list]).sort(),
            [["desktop-1", "desktop-6"], ["desktop-4", "desktop-5"]],
        );
        assert.deepEqual(
            [...controller.ownedDesktopIdSnapshot()].sort(),
            ["desktop-4", "desktop-5", "desktop-6"],
        );
    });

    it("removes a non-owned pre-existing desktop left orphaned after its primary output disconnects", () => {
        // desktop-1 and desktop-2 both pre-exist the controller (never
        // plugin-created, so never in ownedDesktopIds) and both resolve into
        // E's list (session primary); neither holds any window. currentDesktop
        // is null through startup so visibility is unreadable and the startup
        // cleanup dispatch defers (no create/replenish), matching
        // twoOutputSetup's own pattern.
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        harness.nextDesktopNumber = 2;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.windows = [];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const [eIds] = twoLocalLists(controller);
        assert.deepEqual([...eIds], ["desktop-1", "desktop-2"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], []);
        // Make current-desktop state readable (desktop-2 current on every
        // output), then disconnect E (the primary): its whole local list,
        // including the non-owned desktop-1, is dropped from the mapping
        // (rebuildLocalMapping). L, the sole remaining connected output,
        // reports desktop-2 current (matching the global current), so
        // desktop-1 is empty and invisible on every connected output and
        // must be removed even though it was never in ownedDesktopIds - the
        // structural, ownership-independent sweep this fix adds.
        harness.currentDesktop = DESKTOP_2;
        harness.currentDesktopValue = DESKTOP_2;
        harness.removedDesktops.length = 0;
        harness.screensList = [OUTPUT_L];
        harness.screensChanged?.();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-1"],
        );
    });

    it("keeps per-output local lists id-keyed across a desktop rename/reorder", () => {
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        harness.removedDesktops.length = 0;
        const before = controller.localWorkspaceSnapshot();
        // Under the trailing-empty reuse model each move's cleanup dispatch
        // replenishes a fresh trailing empty, so E ends up owning
        // [desktop-1, desktop-2, desktop-3] and L owning [desktop-4,
        // desktop-5] before the rename. Simulate a rename/reorder: the same
        // desktop ids, all still present, with new numbers in a different
        // global order. Identity is the id string, so the mapping is
        // unchanged and no owned desktop is removed.
        harness.desktopsList = [
            { id: "desktop-3", x11DesktopNumber: 30 },
            { id: "desktop-5", x11DesktopNumber: 50 },
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-4", x11DesktopNumber: 40 },
            { id: "desktop-2", x11DesktopNumber: 20 },
        ];
        harness.emitDesktopsChanged();
        assert.deepEqual(controller.localWorkspaceSnapshot(), before);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("disambiguates same-tuple outputs by first-seen order and navigates independently", () => {
        // Two outputs with an identical tuple are indistinguishable by the
        // scriptable API (spec E collision): deterministic fallback is
        // first-seen assignment order, stable within a session but not across
        // a plug/replug reorder. This is a documented limitation, not an error.
        const sameA = { ...OUTPUT };
        const sameB = { ...OUTPUT };
        const harness = new Harness();
        harness.screensList = [sameA, sameB];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        harness.nextDesktopNumber = 2;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wA = window({ output: sameA });
        const wB = window({ output: sameB });
        harness.windows = [wA, wB];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        const keyA = controller.outputKeyFor(sameA);
        const keyB = controller.outputKeyFor(sameB);
        assert.notEqual(keyA, keyB);
        assert.equal(controller.outputKeyFor(sameA), keyA);
        // Both outputs still select independently through the same-tuple keys.
        harness.currentDesktop = DESKTOP_1;
        harness.active = wA;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(harness.currentDesktopForScreenWrites.length, 1);
        assert.equal(harness.currentDesktopForScreenWrites[0]?.output, sameA);
        assert.equal((harness.currentDesktopByOutput.get(sameA) as { id: string }).id, "desktop-2");
    });

    it("selects the active screen's local target with no focused window (activeScreen = L)", () => {
        // Spec D common: with no focused window the active output is
        // `workspace.activeScreen`. Under the trailing-empty reuse model
        // each of L's three moves (wL1, wL2, wL3) occupies L's current
        // trailing empty and the same cleanup dispatch replenishes a fresh
        // one, leaving L owning locals [desktop-2, desktop-4, desktop-5,
        // desktop-6], so Meta+2 selects L's local 2nd (desktop-4) through
        // the per-output write only; E is never resolved positionally and
        // stays unchanged.
        const { harness, wE, wL1, wL2, wL3 } = twoOutputSetup();
        for (const win of [wE, wL1, wL2, wL3]) {
            makeFloating(harness, win);
        }
        moveToTrailing(harness, wL1);
        moveToTrailing(harness, wL2);
        moveToTrailing(harness, wL3);
        moveToTrailing(harness, wE);
        harness.active = null;
        harness.activeScreenValue = OUTPUT_L;
        harness.currentDesktopByOutput.delete(OUTPUT_E);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id, "desktop-4");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_E), false);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-4");
        assert.equal(last?.output, OUTPUT_L);
    });

    it("Meta+0 creates a new desktop on the active output only when none exists yet, leaving the other output unchanged", () => {
        // E has no trailing empty yet at this point in the scenario, so
        // Meta+0 must create one; it acts through the per-output seam on E
        // only, and L's current desktop is untouched.
        const { harness, wE } = twoOutputSetup();
        const creates = harness.createDesktopCalls.length;
        harness.active = wE;
        harness.currentDesktopByOutput.clear();
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-2");
        assert.equal(harness.currentDesktopByOutput.has(OUTPUT_L), false);
        assert.equal(harness.createDesktopCalls.length, creates + 1);
        const last = harness.currentDesktopForScreenWrites[harness.currentDesktopForScreenWrites.length - 1];
        assert.equal((last?.desktop as { id: string }).id, "desktop-2");
        assert.equal(last?.output, OUTPUT_E);
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
    });

    it("Meta+0 reuses the owned trailing empty already appended at startup for the sole occupied desktop", () => {
        // setup()'s focused window occupies the sole startup desktop, so the
        // fix now appends and owns its own replacement trailing empty
        // (desktop-2) during start() itself; Meta+0 must reuse it rather
        // than create a second one, and never removes a pre-existing
        // desktop.
        const { harness, controller, focused } = setup();
        const creates = harness.createDesktopCalls.length;
        assert.equal(creates, 1);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.desktopsList as unknown[]).map((entry) => (entry as { id: string }).id).includes("desktop-1"), true);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
        assert.deepEqual((focused.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-1"]);
        assert.equal(harness.removedDesktops.length, 0);
        // Meta+0 again reuses the still-unoccupied trailing empty rather
        // than creating a second one (Q-Domain: exactly one trailing empty
        // per domain).
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), ["desktop-2"]);
        assert.equal((harness.currentDesktopValue as { id: string }).id, "desktop-2");
    });

    it("occupying an owned empty desktop replenishes its trailing empty once, and repeated cleanup creates or removes nothing further", () => {
        // Q-Domain: occupying E's trailing desktop-2 replenishes a fresh
        // trailing empty desktop-3 synchronously as part of the same move
        // (matching "reconciliation is stable" above); the same cleanup
        // dispatch also seeds L's own initial trailing empty desktop-4,
        // since L is a connected output with no desktops of its own yet.
        // Repeated cleanup dispatches afterward are idempotent: nothing
        // further is created or removed and both lists are unchanged.
        const { harness, controller, wE } = twoOutputSetup();
        makeFloating(harness, wE);
        harness.currentDesktopByOutput.clear();
        moveToTrailing(harness, wE);
        const [eBefore, lBefore] = twoLocalLists(controller);
        assert.deepEqual([...eBefore], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lBefore], ["desktop-4"]);
        const creates = harness.createDesktopCalls.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 0);
        const [eAfter, lAfter] = twoLocalLists(controller);
        assert.deepEqual([...eAfter], [...eBefore]);
        assert.deepEqual([...lAfter], [...lBefore]);
    });

    it("Meta+0 creation failure is non-destructive and reason-logged (per-output-local)", () => {
        // The sole desktop is occupied (matching setup()'s fixture), so the
        // fix means start() itself already attempts, and fails, its own
        // replacement-trailing-empty append; createDesktopThrows must be set
        // before start() (a bare Harness, not setup()) so that first attempt
        // is the one that fails, and the shortcut's own attempt afterward is
        // measured as a delta against that baseline.
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.createDesktopThrows = new Error("create-failed");
        const controller = new TileController(harness.environment());
        controller.start();
        const failuresBeforeShortcut = countEvent(harness.logs, "workspace-append-create-failed:create-failed");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(
            countEvent(harness.logs, "workspace-append-create-failed:create-failed"),
            failuresBeforeShortcut + 1,
        );
        assert.equal(harness.createDesktopCalls.length, 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        assert.deepEqual(controller.ownedDesktopIdSnapshot(), []);
        assert.equal(controller.isEnabled, true);
    });

    it("removes E's mid-list empty without disturbing E's own trailing empty or L's independent trailing empty (Q-MultiOutput non-confusability)", () => {
        // Build E: [desktop-1(occupied by wL2/wL3, never moved), desktop-2
        // (occupied by wE), desktop-3(E's trailing empty)] and L: [desktop-4
        // (occupied by wL1), desktop-5(L's trailing empty)], exactly matching
        // "reconciliation is stable across repeated triggers" above.
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        makeFloating(harness, wL1);
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL1);
        const [eBefore, lBefore] = twoLocalLists(controller);
        assert.deepEqual([...eBefore], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...lBefore], ["desktop-4", "desktop-5"]);

        // Vacate wE from desktop-2 externally (as if moved outside the
        // controller, mirroring "marks a removed output's owned empties..."
        // above), leaving desktop-2 empty but mid-list on E's domain (not
        // E's own trailing desktop-3), and make it invisible on every
        // connected output by pointing each output's current desktop at its
        // own domain's trailing empty (Q-Manual: a non-trailing empty stays
        // cleanup-eligible only when empty and invisible everywhere).
        wE.desktops = [];
        harness.currentDesktopForOutputOverride = (output) =>
            output === OUTPUT_E
                ? { id: "desktop-3", x11DesktopNumber: 3 }
                : { id: "desktop-5", x11DesktopNumber: 5 };
        harness.currentDesktopValue = { id: "desktop-5", x11DesktopNumber: 5 };
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;

        // Trigger cleanup via a non-switch dispatcher (Q7: cleanup fires on
        // every dispatch trigger, not only a completed desktop switch) - an
        // unrelated window add, never emitCurrentDesktopChanged.
        const extra = window({ output: OUTPUT_L });
        harness.windows = [...(harness.windows as TestWindow[]), extra];
        harness.emitAdded(extra);

        // Only E's mid-list empty (desktop-2) is removed: an ordinary
        // non-trailing cleanup-eligible desktop. Nothing is created (nothing
        // was occupied that needed replenishing).
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-2"],
        );
        assert.equal(harness.createDesktopCalls.length, creates);

        // E's own trailing empty (desktop-3) and L's own trailing empty
        // (desktop-5) both survive, structurally protected as the last
        // entry of their own independent per-output domain - the exact
        // Q-MultiOutput property: E's mid-list removal never touches L's
        // domain, and the two protections never become adjacent/confusable.
        const [eAfter, lAfter] = twoLocalLists(controller);
        assert.deepEqual([...eAfter], ["desktop-1", "desktop-3"]);
        assert.deepEqual([...lAfter], ["desktop-4", "desktop-5"]);

        // A repeated non-switch dispatch afterward is idempotent: no further
        // creates or removes, confirming no oscillation from the
        // multi-output interaction.
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, 1);
        const [eFinal, lFinal] = twoLocalLists(controller);
        assert.deepEqual([...eFinal], ["desktop-1", "desktop-3"]);
        assert.deepEqual([...lFinal], ["desktop-4", "desktop-5"]);
    });

    it("three simultaneously connected outputs each develop their own distinct, non-overlapping local trailing empty", () => {
        // Generalizes twoOutputSetup to three outputs connected and occupied
        // at once (spec Q-Domain: one trailing empty per connected output,
        // not per output-pair). All three windows start on the pre-existing
        // desktop-1, which resolves into E's list (session primary); L and N
        // start with no desktops of their own, exactly as L does in
        // twoOutputSetup. Each output's own move-append creates its own
        // occupied desktop and the same cleanup dispatch replenishes that
        // output's own trailing empty while also seeding an initial trailing
        // empty for any other connected output still lacking one.
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        for (const win of [wE, wL, wN]) {
            makeFloating(harness, win);
        }
        // wE's move creates desktop-2 (occupied) and the same cleanup
        // dispatch replenishes desktop-3 as E's own trailing empty, and
        // seeds L's and N's own initial trailing empties (desktop-4 and
        // desktop-5 respectively) since both are connected outputs with no
        // desktops of their own yet.
        moveToTrailing(harness, wE);
        // wL reuses its just-seeded trailing desktop-4 and the same cleanup
        // dispatch replenishes desktop-6 as L's fresh trailing empty.
        moveToTrailing(harness, wL);
        // wN reuses its just-seeded trailing desktop-5 and the same cleanup
        // dispatch replenishes desktop-7 as N's fresh trailing empty.
        moveToTrailing(harness, wN);

        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const keyN = controller.outputKeyFor(OUTPUT_N) as string;
        assert.equal(new Set([keyE, keyL, keyN]).size, 3);

        const snapshot = controller.localWorkspaceSnapshot();
        assert.deepEqual([...(snapshot[keyE] ?? [])], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...(snapshot[keyL] ?? [])], ["desktop-4", "desktop-6"]);
        assert.deepEqual([...(snapshot[keyN] ?? [])], ["desktop-5", "desktop-7"]);

        // The three domains are structurally distinct: no desktop id is a
        // member of more than one output's local list.
        const allIds = [...(snapshot[keyE] ?? []), ...(snapshot[keyL] ?? []), ...(snapshot[keyN] ?? [])];
        assert.equal(new Set(allIds).size, allIds.length);

        // A repeated cleanup dispatch afterward is idempotent: nothing
        // further is created or removed, matching "reconciliation is stable
        // across repeated triggers" above but for three simultaneous
        // domains.
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        const after = controller.localWorkspaceSnapshot();
        assert.deepEqual([...(after[keyE] ?? [])], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...(after[keyL] ?? [])], ["desktop-4", "desktop-6"]);
        assert.deepEqual([...(after[keyN] ?? [])], ["desktop-5", "desktop-7"]);
    });

    it("disconnecting one of three connected outputs removes only its own empty, invisible desktops and leaves the two survivors' local lists and current desktops completely unaffected", () => {
        // Builds on the same three-output occupied state as the test above,
        // then disconnects N (matching "marks a removed output's owned
        // empties..." above, but with a third, uninvolved survivor present).
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        for (const win of [wE, wL, wN]) {
            makeFloating(harness, win);
        }
        moveToTrailing(harness, wE);
        moveToTrailing(harness, wL);
        moveToTrailing(harness, wN);

        const keyE = controller.outputKeyFor(OUTPUT_E) as string;
        const keyL = controller.outputKeyFor(OUTPUT_L) as string;
        const before = controller.localWorkspaceSnapshot();
        const eBefore = [...(before[keyE] ?? [])];
        const lBefore = [...(before[keyL] ?? [])];
        const currentEBefore = harness.currentDesktopByOutput.get(OUTPUT_E);
        const currentLBefore = harness.currentDesktopByOutput.get(OUTPUT_L);

        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        // Disconnect N: its own trailing empty (desktop-7) is now empty and
        // invisible (N is dropped from screens()) and becomes cleanup-
        // eligible; N's occupied desktop-5 (still holding wN) is not empty,
        // so it is never removed, purely orphaned out of every domain's
        // local list. E's and L's own local lists and current desktops are
        // completely untouched, and no desktop is created purely as a
        // result of the disconnect (disconnect never replenishes).
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();

        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-7"],
        );
        assert.equal(harness.createDesktopCalls.length, creates);

        const after = controller.localWorkspaceSnapshot();
        assert.deepEqual([...(after[keyE] ?? [])], eBefore);
        assert.deepEqual([...(after[keyL] ?? [])], lBefore);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_E), currentEBefore);
        assert.equal(harness.currentDesktopByOutput.get(OUTPUT_L), currentLBefore);
    });

    it("rapid disconnect/reconnect flapping of one output, interleaved with a window occupying its own trailing empty mid-flap, converges to exactly one trailing empty per output with no residual oscillation (per-output-local)", () => {
        const { harness, controller, wE, wL1 } = twoOutputSetup();
        makeFloating(harness, wE);
        moveToTrailing(harness, wE);
        const [eBefore] = twoLocalLists(controller);
        assert.deepEqual([...eBefore], ["desktop-1", "desktop-2", "desktop-3"]);

        // Flap L rapidly (disconnect/reconnect back-to-back, nothing else
        // changed), then, mid-flap and before anything settles, move a
        // window onto L (seeding its own trailing empty for the first
        // time), then flap once more.
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        makeFloating(harness, wL1);
        moveToTrailing(harness, wL1);
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        let settled = 0;
        while (harness.yields.length > 0 && settled < 10) {
            harness.flushNextYield();
            settled += 1;
        }
        harness.emitDesktopsChanged();

        // E's own domain, never touched by L's flapping, is unaffected.
        const [eAfter, lAfter] = twoLocalLists(controller);
        assert.deepEqual([...eAfter], ["desktop-1", "desktop-2", "desktop-3"]);
        // L converges to exactly its one occupied desktop (wL1's move) plus
        // exactly one trailing empty: no duplicates, no leftover churn from
        // the flap itself.
        assert.equal(lAfter.length, 2);
        assert.equal(new Set(lAfter).size, 2);

        // A further settle dispatch against this converged state is a pure
        // no-op: repeated flapping leaves no residual oscillation.
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        const [eFinal, lFinal] = twoLocalLists(controller);
        assert.deepEqual([...eFinal], eAfter);
        assert.deepEqual([...lFinal], lAfter);
    });
});
