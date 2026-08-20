import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TileController } from "../src/controller";
import {
    Harness,
    RECT,
    type TestTile,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";
import { countEvent, invokeShortcut } from "./controller-fixture-scenarios";

describe("TileController floating and sticky windows", () => {
    function floatSetup(): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly root: TestTile;
        readonly target: TestTile;
        readonly focused: TestWindow;
        readonly manages: Array<{ tile: TestTile; window: TestWindow }>;
        readonly unmanages: Array<{ tile: TestTile; window: TestWindow }>;
    } {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const manages: Array<{ tile: TestTile; window: TestWindow }> = [];
        const unmanages: Array<{ tile: TestTile; window: TestWindow }> = [];
        target.manage = (value) => {
            const w = value as TestWindow;
            manages.push({ tile: target, window: w });
            w.tile = target;
            target.windows = [w];
            return true;
        };
        target.unmanage = (value) => {
            const w = value as TestWindow;
            unmanages.push({ tile: target, window: w });
            w.tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        return { harness, controller, root, target, focused, manages, unmanages };
    }

    function setFullscreen(subject: TestWindow, value: boolean): void {
        subject.fullScreen = value;
        subject.fullScreenChanged.emit();
    }

    it("floats a tiled window retaining the vacated leaf and recording centered 60% work-area geometry", () => {
        const { harness, controller, root, target, focused, unmanages } = floatSetup();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(unmanages.length, 1);
        assert.equal(focused.tile, null);
        assert.deepEqual(root.tiles, [target], "the vacated leaf is retained");
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
        assert.equal(countEvent(harness.logs, "float-completed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("tiles a floating window back through tile.manage and reuses the remembered geometry on re-float", () => {
        const { harness, root, target, focused, manages } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(manages.length, 1);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
        assert.deepEqual(root.tiles, [target]);

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.tile, null);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
    });

    it("leaves a floating window floating on a capacity failure with the exact reason", () => {
        const { harness, root, target, focused, manages } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        const second = window();
        harness.emitAdded(second);
        assert.equal(second.tile, target, "the new window fills the retained empty leaf");

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(manages.filter((entry) => entry.window === focused).length, 0);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "tile-failed:no-available-leaf"), 1);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.deepEqual(root.tiles, [target]);
    });

    it("retains the all-desktop pin and floating state when a sticky window's tile request fails", () => {
        const { harness, root, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);

        const second = window();
        harness.emitAdded(second);
        assert.equal(second.tile, target, "the new window fills the retained empty leaf");

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "tile-failed:no-available-leaf"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.equal(focused.onAllDesktops, true, "the all-desktop pin survives the failed tile request");
        assert.equal(focused.tile, null, "the window remains floating");
        assert.deepEqual(root.tiles, [target]);
    });

    it("restores the all-desktop pin when a sticky window's tile assignment fails", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        let failManage = false;
        target.manage = (value) => {
            if (failManage) {
                return false;
            }
            (value as TestWindow).tile = target;
            target.windows = [value as TestWindow];
            return true;
        };
        target.unmanage = (value) => {
            (value as TestWindow).tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);

        failManage = true;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "tile-failed:assignment-failed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.equal(focused.onAllDesktops, true, "the all-desktop pin is restored after the failed tile");
        assert.equal(focused.tile, null, "the window remains floating");
        assert.deepEqual(root.tiles, [target]);
    });

    it("logs a distinct reason when a failed tile cannot restore the all-desktop pin", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        target.manage = () => false;
        target.unmanage = (value) => {
            (value as TestWindow).tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);

        let pinned = true;
        Object.defineProperty(focused, "onAllDesktops", {
            configurable: true,
            get: () => pinned,
            set: (value: boolean) => {
                if (value === true) {
                    throw new Error("pin-write-failed");
                }
                pinned = value;
            },
        });

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "tile-failed:assignment-failed"), 1);
        assert.equal(countEvent(harness.logs, "tile-failed:sticky-restore-failed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.equal(focused.tile, null, "the window remains floating");
    });

    it("never tiles a sticky window whose all-desktop pin cannot be cleared", () => {
        const { harness, root, target, focused, manages } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);
        assert.equal(focused.tile, null);

        Object.defineProperty(focused, "onAllDesktops", {
            configurable: true,
            get: () => true,
        });

        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(manages.filter((entry) => entry.window === focused).length, 0);
        assert.equal(focused.tile, null, "the window is not tiled when the pin cannot be cleared");
        assert.equal(countEvent(harness.logs, "tile-failed:sticky-clear-failed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 0);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
        assert.deepEqual(root.tiles, [target]);
    });

    it("leaves a floating window floating on an assignment failure with the exact reason", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const target = tile();
        const focused = window({ tile: target });
        target.windows = [focused];
        root.tiles = [target];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        let failManage = false;
        target.manage = (value) => {
            if (failManage) {
                return false;
            }
            (value as TestWindow).tile = target;
            target.windows = [value as TestWindow];
            return true;
        };
        target.unmanage = (value) => {
            (value as TestWindow).tile = null;
            target.windows = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        failManage = true;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "tile-failed:assignment-failed"), 1);
        assert.equal(countEvent(harness.logs, "tile-completed"), 0);
    });

    it("excludes a floating window from automatic placement, drag capture, and reconstruction", () => {
        const { harness, controller, root, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");

        // A move drag on the floating window is ignored with the exact reason.
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:floating"), 1);
        assert.equal(controller.hasActiveDrag, false);
        focused.move = false;
        focused.interactiveMoveResizeFinished.emit();

        // Adding a window fills the retained leaf and never re-tiles or
        // reconstructs around the floating window.
        const added = window();
        harness.emitAdded(added);
        assert.equal(added.tile, target);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.deepEqual(root.tiles, [target]);
    });

    it("adopts an already all-desktops startup window as sticky floating with no collapse or keepAbove", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const floating = window({ desktops: [], onAllDesktops: true, tile: null });
        const tiled = window({ tile: b });
        a.windows = [];
        b.windows = [tiled];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = tiled;
        harness.windows = [floating, tiled];
        const controller = new TileController(harness.environment());
        controller.start();

        assert.equal(countEvent(harness.logs, "startup-sticky-float"), 1);
        assert.equal(floating.tile, null);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(harness.yields.length, 0);

        // Fullscreen round trip keeps the sticky window floating.
        setFullscreen(floating, true);
        setFullscreen(floating, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored float"), 1);
        assert.equal(floating.tile, null);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);

        assert.equal(harness.logs.some((entry) => entry.includes("keepAbove")), false);
        assert.equal(controller.isEnabled, true);
    });

    it("sticky from tiled floats first, pins all desktops, and sticky off remains floating with geometry retained", () => {
        const { harness, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.tile, null);
        assert.equal(focused.onAllDesktops, true);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
        assert.equal(countEvent(harness.logs, "float-completed"), 1);
        assert.equal(countEvent(harness.logs, "sticky-enabled"), 1);

        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, false);
        assert.equal(focused.tile, null, "sticky off remains floating");
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 1);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
    });

    it("tiling a sticky window clears its all-desktop pin first", () => {
        const { harness, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.onAllDesktops, false);
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 1);
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
    });

    it("retains float geometry and floating state through a fullscreen round trip", () => {
        const { harness, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        setFullscreen(focused, true);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        setFullscreen(focused, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored float"), 1);
        assert.equal(focused.tile, null);
        assert.deepEqual(focused.frameGeometry, { x: 20, y: 20, width: 60, height: 60 });
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("restores a user-adjusted float geometry through a fullscreen round trip", () => {
        const { harness, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        const userGeometry = { x: 30, y: 40, width: 70, height: 50 };
        focused.frameGeometry = userGeometry;

        setFullscreen(focused, true);
        setFullscreen(focused, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored float"), 1);
        assert.equal(focused.tile, null);
        assert.deepEqual(focused.frameGeometry, userGeometry);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("drops only session state on floating window close without any structural remove or collapse", () => {
        const { harness, root, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        let removes = 0;
        target.remove = () => {
            removes += 1;
            return true;
        };
        harness.emitRemoved(focused);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
    });

    it("emits the exact ignored-reason logs for no active window and fullscreen and ineligible windows", () => {
        const { harness } = floatSetup();
        harness.active = null;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:no-active-window"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-rejected:no-active-window"), 1);

        const fullscreenActive = window({ fullScreen: true });
        harness.active = fullscreenActive;
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 2);

        harness.active = window({ normalWindow: false });
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:not-normal-window"), 1);

        harness.active = window({ appletPopup: true });
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(countEvent(harness.logs, "sticky-rejected:applet-popup"), 1);
    });

    it("rejects floating a window associated with a layout tile", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const focused = window({ tile: root });
        root.windows = [focused];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(countEvent(harness.logs, "float-rejected:active-tile-association"), 1);
        assert.equal(countEvent(harness.logs, "float-completed"), 0);
    });

    it("routes attach of a floating window through the float-to-tile transition", () => {
        const { harness, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-float-toggle");
        assert.equal(focused.tile, null);

        invokeShortcut(harness, "plasma-auto-tiler-attach");
        assert.equal(focused.tile, target);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
        assert.equal(countEvent(harness.logs, "attach-completed"), 0);
    });

    it("routes attach of a sticky floating window through the float-to-tile transition, clearing the pin", () => {
        const { harness, target, focused } = floatSetup();
        invokeShortcut(harness, "plasma-auto-tiler-sticky-toggle");
        assert.equal(focused.onAllDesktops, true);
        assert.equal(focused.tile, null);

        invokeShortcut(harness, "plasma-auto-tiler-attach");
        assert.equal(focused.tile, target);
        assert.equal(focused.onAllDesktops, false, "attach clears the pin through the float-to-tile transition");
        assert.equal(countEvent(harness.logs, "sticky-disabled"), 1);
        assert.equal(countEvent(harness.logs, "tile-completed"), 1);
        assert.equal(countEvent(harness.logs, "attach-completed"), 0);
    });

    it("declines startup adoption of an already tile-managed all-desktops window with no mutation", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const tiledSticky = window({ tile: leaf, onAllDesktops: true });
        leaf.windows = [tiledSticky];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = tiledSticky;
        harness.windows = [tiledSticky];
        const controller = new TileController(harness.environment());
        controller.start();

        assert.equal(countEvent(harness.logs, "startup-sticky-float"), 0);
        assert.equal(countEvent(harness.logs, "startup-sticky-declined:tile-managed"), 1);
        assert.equal(tiledSticky.tile, leaf, "the window keeps its tile");
        assert.equal(tiledSticky.onAllDesktops, true, "the pin is not mutated at startup");
    });
});
