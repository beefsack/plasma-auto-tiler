import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TileController } from "../src/controller";
import {
    DESKTOP,
    Harness,
    OUTPUT,
    RECT,
    type TestTile,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";
import { attachTileWriter, countEvent, installDwindleSplitter, invokeShortcut, setup } from "./controller-fixture-scenarios";

describe("TileController per-workspace maximize", () => {
    const WORK_AREA = { x: 0, y: 0, width: 200, height: 200 };

    function maximizeSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly root: TestTile;
        readonly target: TestTile;
        readonly focused: TestWindow;
    } {
        const state = setup();
        state.harness.clientArea = WORK_AREA;
        return state;
    }

    function setFullscreen(subject: TestWindow, value: boolean): void {
        subject.fullScreen = value;
        subject.fullScreenChanged.emit();
    }

    it("covers with the work-area geometry and preserves the exact tree and tile slot", () => {
        const { harness, root, target, focused } = maximizeSetup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(focused, writes);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.deepEqual(target.windows, [focused]);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "maximize:enter preserved"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 1);
    });

    it("restores the tile geometry on the second toggle and clears the record", () => {
        const { harness, target, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, RECT);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        // A third toggle re-enters: the record was fully cleared.
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 2);
    });

    it("ignores drag and lifecycle events while maximized without placement or retile", () => {
        const { harness, controller, root, target, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.moveResizedChanged.emit();
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.yields.length, 0);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("preserves a maximized finish record until exit, then accepts a second drag", () => {
        const state = maximizeSetup();
        state.focused.move = true;
        state.focused.interactiveMoveResizeStarted.emit();
        invokeShortcut(state.harness, "plasma-auto-tiler-maximize");
        state.focused.interactiveMoveResizeFinished.emit();
        assert.equal(state.controller.hasActiveDrag, true);

        invokeShortcut(state.harness, "plasma-auto-tiler-maximize");
        state.focused.move = true;
        state.focused.interactiveMoveResizeStarted.emit();

        assert.equal(countEvent(state.harness.logs, "drag-origin-captured"), 2);
        assert.equal(state.controller.hasActiveDrag, true);
    });

    it("no-ops the maximize command while the active window is fullscreen with a specific reason", () => {
        const { harness, focused } = maximizeSetup();
        focused.fullScreen = true;
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-ignored:fullscreen"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter preserved"), 0);
    });

    it("preserves the maximize record through a fullscreen round trip and re-covers on exit", () => {
        const { harness, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        setFullscreen(focused, true);
        assert.equal(countEvent(harness.logs, "fullscreen:enter preserved"), 1);
        setFullscreen(focused, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "maximize:re-covered"), 1);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.deepEqual(focused.frameGeometry, RECT);
    });

    it("refuses to maximize a sticky window", () => {
        const { harness, focused, target } = maximizeSetup();
        target.unmanage = (_value) => {
            focused.tile = null;
            target.windows = [];
            return true;
        };
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:sticky"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 0);
    });

    it("refuses to float a maximized window before any mutation", () => {
        const { harness, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:maximized"), 1);
        // The maximize cover and record stay intact: no restore, no unmanage.
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "float-completed"), 0);
    });

    it("refuses sticky on a maximized window before any mutation", () => {
        const { harness, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-rejected:maximized"), 1);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 0);
        assert.equal(countEvent(harness.logs, "float-completed"), 0);
    });

    it("refuses a workspace move while maximized before any mutation", () => {
        const { harness, focused, target } = maximizeSetup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(countEvent(harness.logs, "workspace-move-pending"), 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
        // No restore happened: the maximize cover and record stay intact.
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.tile, target);
    });

    it("refuses a workspace move on a maximized window without inspecting its restore path", () => {
        const { harness, focused, target } = maximizeSetup();
        harness.desktopsList = [
            { id: "desktop-1", x11DesktopNumber: 1 },
            { id: "desktop-2", x11DesktopNumber: 2 },
        ];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        focused.tile = null;
        target.windows = [];
        target.manage = () => false;
        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");
        assert.equal(countEvent(harness.logs, "workspace-move-refused:maximized"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit restore failed:assignment-failed"), 0);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(harness.currentDesktopWrites.length, 0);
    });

    it("clears the maximize record on close and proceeds with normal removal", () => {
        const { harness, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        // Live KWin lists the removed window in its former leaf until the
        // deferred one-shot yield collapses it.
        harness.emitRemoved(focused);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        target.windows = [];
        focused.tile = null;
        assert.equal(harness.flushNextYield(), true);
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
    });

    it("keeps unrelated window addition managed while another window is maximized", () => {
        const { harness, root, target, focused } = maximizeSetup();
        // A retained empty leaf lets automatic placement absorb an added
        // window without a structural split into the preserved slot.
        const empty = tile();
        empty.manage = (value) => {
            const win = value as TestWindow;
            win.tile = empty;
            empty.windows = [win];
            return true;
        };
        root.tiles = [target, empty];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
        assert.equal(incoming.tile, empty);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        assert.equal(countEvent(harness.logs, "maximize:ignored reconstruction while maximized"), 0);
        // The unrelated window's removal proceeds through the normal removal
        // path and never gets globally blocked by the maximize record.
        harness.emitRemoved(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        empty.windows = [];
        incoming.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
        assert.equal(focused.tile, target);
    });

    it("records an already-maximized tiled window at startup preserving its state and tree", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.deepEqual(target.windows, [focused]);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        // The Meta+M toggle must not simulate the native unmaximize that alone
        // clears a startup-native classification: it is refused, not restored.
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:startup-native"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.frameGeometry, RECT);
        // A real native unmaximize transition restores the tile geometry
        // through the startup record.
        focused.maximizeMode = 0;
        focused.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.deepEqual(focused.frameGeometry, RECT);
        assert.equal(focused.tile, target);
    });

    it("leaves an already-maximized untiled ordinary window unmanaged until its state clears", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        target.windows = [];
        root.tiles = [target];
        harness.root = root;
        harness.active = maximizedUntiled;
        harness.windows = [maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        // The Meta+M toggle must not simulate the native unmaximize that alone
        // clears a startup-native classification: it is refused, not cleared.
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:startup-native"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 0);
        assert.equal(maximizedUntiled.tile, null);
        // A real native unmaximize transition clears the classification and
        // unblocks the scope.
        maximizedUntiled.maximizeMode = 0;
        maximizedUntiled.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 1);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps a startup-native-maximized untiled window unmanaged through a fullscreen round trip", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        target.windows = [];
        root.tiles = [target];
        harness.root = root;
        harness.active = maximizedUntiled;
        harness.windows = [maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        setFullscreen(maximizedUntiled, true);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        setFullscreen(maximizedUntiled, false);
        // The fullscreen exit must not place the still-classified window:
        // ordinary placement is skipped while the startup record persists.
        assert.equal(countEvent(harness.logs, "fullscreen:exit newly managed"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 0);
        // A real native unmaximize transition then clears the classification.
        maximizedUntiled.maximizeMode = 0;
        maximizedUntiled.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 1);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(controller.isEnabled, true);
    });

    it("does not let an untiled startup-maximized window suppress malformed tree reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile();
        const b = tile();
        const normal = window({ tile: a });
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        a.windows = [normal];
        b.windows = [];
        root.tiles = [a, b];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        attachTileWriter(normal);
        harness.root = root;
        harness.active = normal;
        harness.windows = [normal, maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        // The untiled startup-maximized window preserves no slot, so it must
        // not block the reconstruction of the malformed tree: the scope has
        // one owned window against two leaves, the bijection fails, and the
        // reconstruction arms instead of being refused.
        assert.equal(countEvent(harness.logs, "maximize:ignored reconstruction while maximized"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(maximizedUntiled.tile, null);
        // The reconstruction completes and the maximized window stays untiled.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.ok(normal.tile !== null);
        assert.equal(maximizedUntiled.tile, null);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("bails non-destructively and logs a reason when the preserved slot is gone", () => {
        const { harness, root, focused, target } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        focused.tile = null;
        target.windows = [];
        root.tiles = [];
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize:exit restore failed:tile-missing"), 1);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 0);
        assert.equal(focused.frameGeometry, WORK_AREA);
    });

    it("rejects with a specific reason when there is no active window", () => {
        const { harness } = maximizeSetup();
        harness.active = null;
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize-rejected:no-active-window"), 1);
    });

    it("keeps repeated maximize toggles idempotent", () => {
        const { harness, focused } = maximizeSetup();
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize:enter preserved"), 2);
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 2);
        assert.deepEqual(focused.frameGeometry, WORK_AREA);
    });

    it("defers a tiled maximized scope so additions do not split and no inert forms", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);

        const incoming = window();
        harness.windows = [focused, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(incoming.tile, null);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(harness.yields.length, 0);
    });

    it("refuses an insertion targeting a normal occupant leaf in a multi-leaf scope with a tiled maximized preserved tile elsewhere", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const maximizedLeaf = tile({ x: 0, y: 0, width: 50, height: 100 });
        const occupantLeaf = tile({ x: 50, y: 0, width: 50, height: 100 });
        const maximized = window({ tile: maximizedLeaf, maximizeMode: 3 });
        const occupant = window({ tile: occupantLeaf });
        maximizedLeaf.windows = [maximized];
        occupantLeaf.windows = [occupant];
        root.tiles = [maximizedLeaf, occupantLeaf];
        harness.root = root;
        harness.active = maximized;
        harness.windows = [maximized, occupant];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);

        const incoming = window();
        harness.windows = [maximized, occupant, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(incoming.tile, null);
        assert.equal(maximized.tile, maximizedLeaf);
        assert.equal(occupant.tile, occupantLeaf);
        assert.deepEqual(root.tiles, [maximizedLeaf, occupantLeaf]);
        assert.equal(harness.yields.length, 0);
    });

    it("does not defer reconstruction or insertion in a different output scope for a maximized window", () => {
        const harness = new Harness();
        const OUTPUT_B = { ...OUTPUT, name: "screen-2" };
        const desktopB = { id: "desktop-2" };
        const rootA = tile(RECT, true);
        const targetA = tile();
        const maximized = window({ tile: targetA, maximizeMode: 3 });
        targetA.windows = [maximized];
        rootA.tiles = [targetA];
        const rootB = tile(RECT, true);
        const leafB = tile();
        const winB = window({ tile: leafB, output: OUTPUT_B, desktops: [desktopB] });
        leafB.windows = [winB];
        rootB.tiles = [leafB];
        for (const entry of [leafB]) {
            entry.remove = () => {
                rootB.tiles = (rootB.tiles as TestTile[]).filter((value) => value !== entry);
                return true;
            };
        }
        installDwindleSplitter(rootB);
        attachTileWriter(winB);
        harness.rootsByDesktop.set(DESKTOP.id, rootA);
        harness.rootsByDesktop.set(desktopB.id, rootB);
        harness.root = rootA;
        harness.active = maximized;
        harness.windows = [maximized, winB];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(maximized.tile, targetA);
        assert.equal(harness.yields.length, 0);

        harness.currentDesktop = desktopB;
        harness.currentDesktopValue = desktopB;
        const incomingB = window({ output: OUTPUT_B, desktops: [desktopB] });
        attachTileWriter(incomingB);
        harness.windows = [maximized, winB, incomingB];
        harness.emitAdded(incomingB);
        assert.equal(countEvent(harness.logs, "maximize:ignored reconstruction while maximized"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 0);
        while (harness.flushNextYield()) {
            // Drain to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.ok(winB.tile !== null);
        assert.ok(incomingB.tile !== null);
        assert.equal(maximized.tile, targetA);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("recovers a deferred tiled maximized scope on native unmaximize", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(focused);
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        attachTileWriter(incoming);
        harness.windows = [focused, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(incoming.tile, null);

        focused.maximizeMode = 0;
        focused.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.ok(focused.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("settles an owned scope when a native unmaximize clears an untiled startup record", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const normal = window({ tile: target });
        const maximizedUntiled = window({ tile: null, maximizeMode: 3 });
        target.windows = [normal];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(normal);
        attachTileWriter(maximizedUntiled);
        harness.root = root;
        harness.active = normal;
        harness.windows = [normal, maximizedUntiled];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(maximizedUntiled.tile, null);

        maximizedUntiled.maximizeMode = 0;
        maximizedUntiled.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit cleared"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.ok(normal.tile !== null);
        assert.ok(maximizedUntiled.tile !== null);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("recovers a maximized scope when the maximized window closes", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(focused);
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        attachTileWriter(incoming);
        harness.windows = [focused, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.equal(incoming.tile, null);

        harness.emitRemoved(focused);
        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        target.windows = [];
        focused.tile = null;
        harness.windows = [incoming];
        while (harness.flushNextYield()) {
            // Drain the removal collapse and the reconstruction it arms.
        }
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        const later = window();
        attachTileWriter(later);
        harness.windows = [incoming, later];
        harness.emitAdded(later);
        assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), 1);
        assert.ok(later.tile !== null);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps repeated no-empty-leaf additions to a deferred maximized scope non-inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target, maximizeMode: 3 });
        target.windows = [focused];
        root.tiles = [target];
        const spliceFromTree = (node: TestTile, entry: TestTile): boolean => {
            const children = node.tiles as TestTile[];
            for (let index = 0; index < children.length; index += 1) {
                if (children[index] === entry) {
                    children.splice(index, 1);
                    return true;
                }
                if (spliceFromTree(children[index] as TestTile, entry)) {
                    return true;
                }
            }
            return false;
        };
        for (const leaf of [target]) {
            leaf.remove = () => {
                spliceFromTree(root, leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(focused);
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        harness.clientArea = WORK_AREA;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "maximize:startup recorded"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const pending: TestWindow[] = [];
        for (let index = 0; index < 3; index += 1) {
            const added = window();
            attachTileWriter(added);
            pending.push(added);
            harness.windows = [focused, ...pending];
            harness.emitAdded(added);
            assert.equal(countEvent(harness.logs, "maximize:ignored insert while maximized"), index + 1);
            assert.equal(added.tile, null);
            assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
            assert.equal(harness.yields.length, 0);
        }

        focused.maximizeMode = 0;
        focused.maximizedChanged.emit();
        assert.equal(countEvent(harness.logs, "maximize:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        for (const added of pending) {
            assert.ok(added.tile !== null);
        }
        assert.ok(focused.tile !== null);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("marks a scope inert on an insertion occupant-count mismatch", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const win1 = window({ tile: a });
        const win2 = window({ tile: b });
        a.windows = [win1];
        b.windows = [win2];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = win1;
        harness.windows = [win1, win2];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const win3 = window({ tile: b });
        b.windows = [win2, win3];
        harness.windows = [win1, win2, win3];
        const incoming = window();
        harness.windows = [win1, win2, win3, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-occupant-count-mismatch"), 1);
        assert.equal(incoming.tile, null);

        const later = window();
        harness.windows = [win1, win2, win3, incoming, later];
        harness.emitAdded(later);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-occupant-count-mismatch"), 1);
        assert.equal(later.tile, null);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(controller.isEnabled, true);
    });
});
