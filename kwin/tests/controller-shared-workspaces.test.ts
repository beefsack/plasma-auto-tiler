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

describe("TileController shared workspaces (Unit 07)", () => {
    const OUTPUT_E = { ...OUTPUT, name: "screen-e", serialNumber: "11" };
    const OUTPUT_L = { ...OUTPUT, name: "screen-l", serialNumber: "22" };
    const DESKTOP_1 = { id: "desktop-1", x11DesktopNumber: 1 };
    const DESKTOP_2 = { id: "desktop-2", x11DesktopNumber: 2 };

    // Two-output shared session: every output shows the same logical desktop
    // and the global list IS the shared set (spec D3). With no replenish,
    // startup creates nothing; desktop-3 is seeded directly as the owned
    // trailing empty the tests below build on. All moves below are floating
    // moves (membership write + follow only, never a tile-tree mutation).
    // Per-output currents are modeled through the override so the
    // synchronized state is observable per output.
    function sharedSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly wE: TestWindow;
        readonly wL: TestWindow;
    } {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2, { id: "desktop-3", x11DesktopNumber: 3 }];
        harness.nextDesktopNumber = 3;
        // Null currents at startup so no scope is owned and no dwindle
        // reconstruction is armed (the same pattern as the Unit 05 two-output
        // setup); tests set a current when they need a window in scope.
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
        (controller as unknown as { ownedDesktopIds: Set<string> }).ownedDesktopIds.add("desktop-3");
        return { harness, controller, wE, wL };
    }

    // Model both outputs already showing the shared desktop-1 without firing a
    // scope event, so navigation assertions start from the spec H.13 state.
    function bothOnDesktopOne(harness: Harness): void {
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_1);
    }

    // Float a window through the sticky toggle and clear the pin so it is
    // floating and movable on the desktop it belongs to, with no tile tree.
    function makeSharedFloating(harness: Harness, win: TestWindow): void {
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.active = win;
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
    }

    function bothOutputsOn(harness: Harness): [string, string] {
        const e = harness.currentDesktopByOutput.get(OUTPUT_E) ?? harness.currentDesktop;
        const l = harness.currentDesktopByOutput.get(OUTPUT_L) ?? harness.currentDesktop;
        return [(e as { id: string }).id, (l as { id: string }).id];
    }

    it("Meta+0 registers as the stable workspace-0 shortcut and Meta+Shift+0 remains registered (shared)", () => {
        const { harness } = sharedSetup();
        assert.equal(
            harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-workspace-0"),
            true,
        );
        assert.equal(
            harness.shortcuts.some((entry) => entry.name === "plasma-auto-tiler-move-workspace-append"),
            true,
        );
    });

    it("holds one global ordered shared desktop-id set with one owned trailing empty, duplicate-free on repeat", () => {
        // Spec D3/F: the shared set is the ordered live global list plus the one
        // owned trailing empty created by startup reconciliation. A repeated
        // reconciliation creates no duplicate and removes nothing.
        const { harness, controller } = sharedSetup();
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3"]);
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("Meta+2 writes the same desktop id to E and L (spec H.10/H.13)", () => {
        // Spec H.10: mode shared, Meta+2 sets E and L to the same desktop id;
        // H.13: both show logical 1, Meta+2 changes both to logical 2. The
        // synchronization iterates setCurrentDesktopForScreen over every
        // connected output; no window output ever moves.
        const { harness, wE } = sharedSetup();
        bothOnDesktopOne(harness);
        harness.active = wE;
        assert.deepEqual(bothOutputsOn(harness), ["desktop-1", "desktop-1"]);
        const writesBefore = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        const newWrites = harness.currentDesktopForScreenWrites.slice(writesBefore);
        assert.equal(newWrites.length, 2);
        for (const write of newWrites) {
            assert.equal((write.desktop as { id: string }).id, "desktop-2");
        }
        assert.deepEqual(
            newWrites.map((write) => write.output).sort((a, b) => (a as { name: string }).name.localeCompare((b as { name: string }).name)),
            [OUTPUT_E, OUTPUT_L],
        );
    });

    it("synchronizes every output with no focused window (activeScreen unavailable)", () => {
        // Shared navigation is output-agnostic: it synchronizes every connected
        // output regardless of focus, so the absence of a focused window and an
        // unavailable activeScreen never blocks the shared write.
        const { harness } = sharedSetup();
        harness.active = null;
        harness.activeScreenValue = null;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
    });

    it("retains exactly two empty shared desktops after switching to the second desktop", () => {
        const { harness, controller } = sharedSetup();
        harness.windows = [];
        harness.active = null;
        harness.desktopsList = [DESKTOP_1, DESKTOP_2];
        harness.nextDesktopNumber = 2;
        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_1);
        harness.emitDesktopsChanged();
        harness.removedDesktops.length = 0;

        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        harness.emitDesktopsChanged();

        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.deepEqual(
            (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
            ["desktop-1", "desktop-2"],
        );
        assert.equal(harness.removedDesktops.length, 0);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2"]);
    });

    it("global-unique cleanup stops multiple removals at the global floor", () => {
        const desktop3 = { id: "desktop-3", x11DesktopNumber: 3 };
        const desktop4 = { id: "desktop-4", x11DesktopNumber: 4 };
        const desktop5 = { id: "desktop-5", x11DesktopNumber: 5 };
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "global-unique");
        harness.screensList = [OUTPUT_E];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2, desktop3, desktop4, desktop5];
        harness.nextDesktopNumber = 5;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const controller = new TileController(harness.environment());
        controller.start();

        harness.currentDesktop = desktop5;
        harness.currentDesktopValue = desktop5;
        harness.currentDesktopByOutput.set(OUTPUT_E, desktop5);
        harness.emitDesktopsChanged();

        assert.deepEqual(
            harness.removedDesktops.map((desktop) => (desktop as { id: string }).id),
            ["desktop-1", "desktop-2", "desktop-3"],
        );
        assert.deepEqual(
            (harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id),
            ["desktop-4", "desktop-5"],
        );
        assert.deepEqual(Object.values(controller.globalUniqueAssignmentSnapshot()), [["desktop-4", "desktop-5"]]);
    });

    it("an absent shared index is a specific no-op with no write or create", () => {
        const { harness } = sharedSetup();
        harness.active = null;
        const writes = harness.currentDesktopForScreenWrites.length;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-9");
        assert.equal(countEvent(harness.logs, "workspace-navigate-absent:9"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    it("Meta+Shift+2 moves the eligible active window then synchronizes all outputs", () => {
        // Spec D3 move-follow: single membership write on the active window's
        // output, then switch every output to the shared target.
        const { harness, wE } = sharedSetup();
        makeSharedFloating(harness, wE);
        harness.active = wE;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        // The other output's window is untouched: its membership is unchanged
        // and no window ever transfers outputs implicitly.
        assert.deepEqual((wE.output as { name: string }).name, "screen-e");
    });

    it("Meta+Shift+0 reuses the existing structurally-last trailing empty, and cleanup replenishes it once it is occupied", () => {
        const { harness, controller, wE } = sharedSetup();
        makeSharedFloating(harness, wE);
        harness.active = wE;
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        // The destination is the existing trailing empty desktop-3 (the
        // structurally-last domain entry), reused rather than created for
        // the move itself. desktop-3 is now occupied, so the same pass's
        // cleanup replenishes it with a new trailing empty (desktop-4);
        // desktop-2 (never occupied, not the trailing position once
        // desktop-4 exists) is swept in the same pass.
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-3"]);
        assert.deepEqual(bothOutputsOn(harness), ["desktop-3", "desktop-3"]);
        assert.equal(harness.createDesktopCalls.length, createsBefore + 1);
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id),
            ["desktop-2"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3", "desktop-4"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-3", "desktop-4"]);
    });

    it("Meta+Shift+0 creates a shared desktop when no trailing empty exists, and cleanup replenishes it once occupied", () => {
        // Single pre-existing desktop, itself occupied by the moving window's
        // future scope: the move-append path finds no trailing empty to
        // reuse (the sole desktop is the window's own current desktop) and
        // creates the destination desktop-2. Once occupied by the move,
        // desktop-2 is the trailing position, so cleanup replenishes it with
        // a further trailing empty (desktop-3) in the same pass.
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        harness.windows = [wE];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
        assert.equal(harness.createDesktopCalls.length, 0);
        makeSharedFloating(harness, wE);
        harness.active = wE;
        const createsBefore = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        // One destination is created for the move (desktop-2); it then
        // becomes occupied and is the trailing position, so the same pass's
        // cleanup replenishes it with a new trailing empty (desktop-3).
        const createdId = (harness.createDesktopCalls[createsBefore] as { position: number; name: string });
        assert.equal(createdId.name, "2");
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-2"]);
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.equal(harness.createDesktopCalls.length, createsBefore + 2);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-2", "desktop-3"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("refuses sticky, fullscreen, and maximized shared moves before any write or create", () => {
        const sticky = sharedSetup();
        makeSharedFloating(sticky.harness, sticky.wE);
        const enabledBaseline = countEvent(sticky.harness.logs, "sticky-enabled");
        invokeShortcut(sticky.harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(sticky.harness.logs, "sticky-enabled"), enabledBaseline + 1);
        const createsBefore = sticky.harness.createDesktopCalls.length;
        sticky.harness.active = sticky.wE;
        invokeShortcut(sticky.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(sticky.harness.logs, "workspace-move-refused:sticky"), 1);
        assert.equal(sticky.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(sticky.harness.createDesktopCalls.length, createsBefore);

        const fullscreen = sharedSetup();
        makeSharedFloating(fullscreen.harness, fullscreen.wE);
        fullscreen.wE.fullScreen = true;
        const createsFs = fullscreen.harness.createDesktopCalls.length;
        fullscreen.harness.active = fullscreen.wE;
        invokeShortcut(fullscreen.harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(fullscreen.harness.logs, "workspace-move-refused:fullscreen"), 1);
        assert.equal(fullscreen.harness.currentDesktopForScreenWrites.length, 0);
        assert.equal(fullscreen.harness.createDesktopCalls.length, createsFs);

        // A tiled window so the maximize action can record it.
        const maximized = new Harness();
        maximized.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        maximized.screensList = [OUTPUT_E, OUTPUT_L];
        maximized.desktopsList = [DESKTOP_1, DESKTOP_2];
        maximized.nextDesktopNumber = 2;
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

    it("cleanup never removes the current shared desktop, and stops at the global floor", () => {
        // The owned trailing empty (desktop-3) becomes the synchronized
        // current desktop on every output; a reconciliation must keep it
        // (current + visible, and also the structurally-last domain entry).
        // The other empty desktops (desktop-1 and desktop-2, neither the
        // trailing position, no windows in scope) are eligible, but cleanup
        // stops after desktop-1 so the global count remains two. Windows are
        // cleared so no scope/reconstruction defers cleanup.
        const { harness, controller } = sharedSetup();
        harness.windows = [];
        harness.active = null;
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-3" });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3" });
        harness.currentDesktop = { id: "desktop-3" };
        harness.currentDesktopValue = { id: "desktop-3" };
        harness.removedDesktops.length = 0;
        harness.emitDesktopsChanged();
        assert.deepEqual(
            harness.removedDesktops.map((entry) => (entry as { id: string }).id).sort(),
            ["desktop-1"],
        );
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-2", "desktop-3"]);
    });

    it("hotplug adds a new output at the current shared workspace and never creates a desktop", () => {
        const { harness, controller } = sharedSetup();
        harness.active = null;
        // Plain navigation never triggers cleanup, so the owned desktop-3
        // stays present even though it is now empty and invisible.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-3"]);
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        // Disconnect L: no desktop is created, and the connected output's
        // current desktop is untouched.
        harness.screensList = [OUTPUT_E];
        harness.screensChanged?.();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal((harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id, "desktop-2");
        // Reconnect the identical tuple: it joins the current shared workspace
        // (desktop-2) without creating a desktop.
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.screensChanged?.();
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.equal(harness.createDesktopCalls.length, creates);
    });

    it("a throwing shared sync write is reported and never corrupts state (rollback-safe)", () => {
        // A per-output write failure is reported per output and the remaining
        // outputs still synchronize; the current desktop state is never left
        // partially mutated beyond the failed write itself.
        const { harness, controller } = sharedSetup();
        harness.active = null;
        harness.setCurrentDesktopThrows = new Error("sync-failed");
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-navigate-failed:sync-failed"), 2);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("a failing move-append create is non-destructive and leaves the shared set unchanged", () => {
        // When createDesktop throws, the move-append aborts before any write:
        // the window stays put, no current changes, and the shared set is
        // intact (repeat/failure-safe).
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        harness.windows = [wE];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        makeSharedFloating(harness, wE);
        harness.active = wE;
        harness.createDesktopThrows = new Error("create-failed");
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-append");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.deepEqual((wE.desktops as unknown[]).map((entry) => (entry as { id: string }).id), ["desktop-1"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
    });

    it("Meta+0 reuses the existing structurally-last trailing empty and synchronizes every output (spec D3)", () => {
        // desktop-3 is the existing owned trailing empty; Meta+0 reuses it
        // rather than creating, and synchronizes both E and L to it.
        const { harness, controller } = sharedSetup();
        bothOnDesktopOne(harness);
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-3", "desktop-3"]);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
        assert.equal(countEvent(harness.logs, "workspace-zero-completed"), 1);
    });

    it("Meta+0 is a no-op when the trailing empty is already the shared current desktop (Q-Zero)", () => {
        const { harness, controller } = sharedSetup();
        harness.currentDesktop = { id: "desktop-3" };
        harness.currentDesktopValue = { id: "desktop-3" };
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-3" });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3" });
        const writes = harness.currentDesktopForScreenWrites.length;
        const creates = harness.createDesktopCalls.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-zero-no-op:already-there"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2", "desktop-3"]);
    });

    it("Meta+0 creates exactly one shared desktop when no trailing empty exists and synchronizes all outputs", () => {
        // A single pre-existing desktop, occupied by a window: the sole
        // domain entry is not empty, so there is no trailing empty to reuse,
        // and Meta+0 creates the shared destination exactly once.
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        harness.windows = [window({ output: OUTPUT_E, desktops: [DESKTOP_1] })];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
        harness.active = null;
        harness.activeScreenValue = OUTPUT_E;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.deepEqual(bothOutputsOn(harness), ["desktop-2", "desktop-2"]);
        assert.deepEqual([...controller.ownedDesktopIdSnapshot()], ["desktop-2"]);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1", "desktop-2"]);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("Meta+0 shared create failure is non-destructive and reason-logged", () => {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.desktopsList = [DESKTOP_1];
        harness.nextDesktopNumber = 1;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        harness.windows = [window({ output: OUTPUT_E, desktops: [DESKTOP_1] })];
        const controller = new TileController(harness.environment());
        controller.start();
        harness.activeScreenValue = OUTPUT_E;
        harness.createDesktopThrows = new Error("create-failed");
        const writes = harness.currentDesktopForScreenWrites.length;
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-append-create-failed:create-failed"), 1);
        assert.equal(harness.currentDesktopForScreenWrites.length, writes);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], ["desktop-1"]);
        assert.equal(harness.removedDesktops.length, 0);
    });

    it("Meta+0 shared sync write failure is reported per output and never corrupts state", () => {
        const { harness, controller } = sharedSetup();
        harness.active = null;
        harness.setCurrentDesktopThrows = new Error("sync-failed");
        invokeShortcut(harness, "plasma-auto-tiler-workspace-0");
        assert.equal(countEvent(harness.logs, "workspace-navigate-failed:sync-failed"), 2);
        // The existing trailing empty (desktop-3) is reused, not created;
        // only the per-output sync write fails.
        assert.deepEqual(
            [...controller.sharedWorkspaceSnapshot()],
            ["desktop-1", "desktop-2", "desktop-3"],
        );
    });

    it("repeated cleanupDesktops dispatches against unchanged shared state are idempotent (no net creates or removes)", () => {
        const { harness, controller } = sharedSetup();
        harness.windows = [];
        harness.active = null;
        harness.currentDesktopByOutput.set(OUTPUT_E, { id: "desktop-3" });
        harness.currentDesktopByOutput.set(OUTPUT_L, { id: "desktop-3" });
        harness.currentDesktop = { id: "desktop-3" };
        harness.currentDesktopValue = { id: "desktop-3" };
        harness.emitDesktopsChanged();
        const creates = harness.createDesktopCalls.length;
        const removals = harness.removedDesktops.length;
        const snapshot = [...controller.sharedWorkspaceSnapshot()];
        harness.emitDesktopsChanged();
        harness.emitDesktopsChanged();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.equal(harness.removedDesktops.length, removals);
        assert.deepEqual([...controller.sharedWorkspaceSnapshot()], snapshot);
    });

    it("three simultaneously connected outputs all synchronize onto the same single shared desktop, and disconnecting one down to two survivors stays fully synchronized with no spurious create (shared)", () => {
        // Generalizes sharedSetup to three outputs (Q-Domain: shared has one
        // global trailing empty regardless of output count; synchronizeShared
        // forces every connected output onto the same desktop by design).
        const OUTPUT_N = { ...OUTPUT, name: "screen-n", serialNumber: "33" };
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.desktopsList = [DESKTOP_1, DESKTOP_2, { id: "desktop-3", x11DesktopNumber: 3 }];
        harness.nextDesktopNumber = 3;
        harness.currentDesktop = null;
        harness.currentDesktopValue = null;
        harness.currentDesktopForOutputOverride = (output) =>
            harness.currentDesktopByOutput.get(output) ?? harness.currentDesktop;
        const wE = window({ output: OUTPUT_E });
        const wL = window({ output: OUTPUT_L });
        const wN = window({ output: OUTPUT_N });
        harness.windows = [wE, wL, wN];
        harness.active = null;
        const controller = new TileController(harness.environment());
        controller.start();
        (controller as unknown as { ownedDesktopIds: Set<string> }).ownedDesktopIds.add("desktop-3");

        harness.currentDesktop = DESKTOP_1;
        harness.currentDesktopValue = DESKTOP_1;
        harness.currentDesktopByOutput.set(OUTPUT_E, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_L, DESKTOP_1);
        harness.currentDesktopByOutput.set(OUTPUT_N, DESKTOP_1);
        harness.active = wE;
        const onAll = (): [string, string, string] => [
            (harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id,
            (harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id,
            (harness.currentDesktopByOutput.get(OUTPUT_N) as { id: string }).id,
        ];
        // Meta+2 synchronizes all three connected outputs, not just a pair.
        invokeShortcut(harness, "plasma-auto-tiler-workspace-2");
        assert.deepEqual(onAll(), ["desktop-2", "desktop-2", "desktop-2"]);

        // Disconnect N: no desktop is created purely from the disconnect,
        // and E's/L's synchronized current desktop is unaffected.
        harness.removedDesktops.length = 0;
        const creates = harness.createDesktopCalls.length;
        harness.screensList = [OUTPUT_E, OUTPUT_L];
        harness.currentDesktopByOutput.delete(OUTPUT_N);
        harness.screensChanged?.();
        assert.equal(harness.createDesktopCalls.length, creates);
        assert.deepEqual(
            [
                (harness.currentDesktopByOutput.get(OUTPUT_E) as { id: string }).id,
                (harness.currentDesktopByOutput.get(OUTPUT_L) as { id: string }).id,
            ],
            ["desktop-2", "desktop-2"],
        );

        // Reconnect N: it joins the current shared workspace without
        // creating a desktop, restoring full three-output synchronization.
        harness.screensList = [OUTPUT_E, OUTPUT_L, OUTPUT_N];
        harness.screensChanged?.();
        assert.deepEqual(onAll(), ["desktop-2", "desktop-2", "desktop-2"]);
        assert.equal(harness.createDesktopCalls.length, creates);
    });
});

describe("TileController trailing-empty invariant on first occupation (Unit 07 live regression)", () => {
    // Live-confirmed regression (unit-07 attempt-02): a fresh single-output,
    // single-desktop session where that desktop is currently empty is correct
    // (nothing to do). But the very first window ever placed on that sole
    // desktop, with no prior Meta+0/Meta+Shift+0, previously failed to append a
    // replacement trailing empty in any mode, because cleanupDesktops() guarded
    // its reconciliation/enforcement calls behind an unconditional
    // desktops.length <= 1 (plus, for per-output-local/global-unique, a single
    // connected output) early return that never inspected occupancy. That guard
    // is now removed; ensureTrailingEmptyDesktop's own structural last-position-
    // if-empty check keeps the true no-op case (step 1 below) a no-op.
    function singleDesktopModeSetup(mode: "per-output-local" | "global-unique" | "shared"): {
        readonly harness: Harness;
        readonly controller: TileController;
    } {
        const harness = new Harness();
        harness.root = tile(RECT, true);
        if (mode !== "per-output-local") {
            harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, mode);
        }
        const controller = new TileController(harness.environment());
        controller.start();
        return { harness, controller };
    }

    function modeSnapshot(controller: TileController, mode: "per-output-local" | "global-unique" | "shared"): readonly string[] {
        if (mode === "per-output-local") {
            return Object.values(controller.localWorkspaceSnapshot())[0] ?? [];
        }
        if (mode === "global-unique") {
            return Object.values(controller.globalUniqueAssignmentSnapshot())[0] ?? [];
        }
        return controller.sharedWorkspaceSnapshot();
    }

    for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
        it(`a fresh single-output, single-empty-desktop session creates nothing on start in ${mode} mode`, () => {
            const { harness } = singleDesktopModeSetup(mode);
            assert.equal(harness.createDesktopCalls.length, 0);
            assert.deepEqual((harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id), [
                "desktop-1",
            ]);
        });

        it(`the first window ever placed on the sole desktop appends a replacement trailing empty in ${mode} mode`, () => {
            const { harness, controller } = singleDesktopModeSetup(mode);
            const first = window();
            harness.windows = [first];
            harness.emitAdded(first);
            // Placing the first window into the empty root tile arms a
            // reconstruction (no tile tree exists yet); cleanup defers until
            // it settles, matching the existing deferred-reconstruction
            // pattern used elsewhere in this file.
            let settled = 0;
            while (harness.yields.length > 0 && settled < 10) {
                harness.flushNextYield();
                settled += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 1);
            assert.deepEqual((harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id), [
                "desktop-1",
                "desktop-2",
            ]);
            assert.deepEqual(modeSnapshot(controller, mode), ["desktop-1", "desktop-2"]);
        });

        it(`a second window occupying the replacement trailing empty appends another, and the prior one survives, in ${mode} mode`, () => {
            const { harness, controller } = singleDesktopModeSetup(mode);
            const first = window();
            harness.windows = [first];
            harness.emitAdded(first);
            let settledFirst = 0;
            while (harness.yields.length > 0 && settledFirst < 10) {
                harness.flushNextYield();
                settledFirst += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 1);
            const trailing = { id: "desktop-2", x11DesktopNumber: 2 };
            const incoming = window({ desktops: [trailing] });
            harness.windows = [...(harness.windows as unknown[]), incoming];
            harness.emitAdded(incoming);
            let settledSecond = 0;
            while (harness.yields.length > 0 && settledSecond < 10) {
                harness.flushNextYield();
                settledSecond += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 2);
            assert.deepEqual((harness.desktopsList as Array<{ id: string }>).map((desktop) => desktop.id), [
                "desktop-1",
                "desktop-2",
                "desktop-3",
            ]);
            assert.deepEqual(modeSnapshot(controller, mode), ["desktop-1", "desktop-2", "desktop-3"]);
        });

        it(`repeated cleanup dispatches after the first occupation's append settles are idempotent in ${mode} mode`, () => {
            const { harness, controller } = singleDesktopModeSetup(mode);
            const first = window();
            harness.windows = [first];
            harness.emitAdded(first);
            let settled = 0;
            while (harness.yields.length > 0 && settled < 10) {
                harness.flushNextYield();
                settled += 1;
            }
            assert.equal(harness.createDesktopCalls.length, 1);
            const creates = harness.createDesktopCalls.length;
            const removals = harness.removedDesktops.length;
            const snapshot = modeSnapshot(controller, mode);
            harness.emitDesktopsChanged();
            harness.emitDesktopsChanged();
            assert.equal(harness.createDesktopCalls.length, creates);
            assert.equal(harness.removedDesktops.length, removals);
            assert.deepEqual(modeSnapshot(controller, mode), snapshot);
        });
    }
});
