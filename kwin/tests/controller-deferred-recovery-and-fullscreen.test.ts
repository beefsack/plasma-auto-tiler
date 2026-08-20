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
import {
    attachTileWriter,
    countEvent,
    dragSetup,
    installCapacityRejectingSplitter,
    installDwindleSplitter,
    invokeShortcut,
    moveSetup,
    reconstructDropSetup,
    setup,
    startDrag,
    swapSetup,
} from "./controller-fixture-scenarios";

describe("TileController deferred invariant recovery", () => {
    it("recovers a leaf-count mismatch from a real drag split deferred origin removal", () => {
        const state = reconstructDropSetup();
        // KWin's CustomTile::remove() returns void: a no-throw call is only
        // mutation-possible, never an acknowledgement. Model the deleteLater
        // lag on the first origin removal: it reports success but the live tree
        // still lists the origin, so the settle postcondition sees a leaf-count
        // mismatch instead of a one-fewer-leaf tree.
        let aRemoves = 0;
        state.a.remove = () => {
            aRemoves += 1;
            if (aRemoves === 1) {
                return true;
            }
            state.root.tiles = (state.root.tiles as TestTile[]).filter((entry) => entry !== state.a);
            return true;
        };
        startDrag(state.aWin);
        state.aWin.frameGeometry = { x: 100, y: 0, width: 50, height: 100 };
        state.aWin.tile = null;
        state.aWin.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(state.harness.yields.length, 1);

        // The deferred origin removal settle hits the leaf-count mismatch:
        // recoverable, not inert. No after snapshot applies because the
        // collapse did not complete.
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "ownership-remove-failed:leaf-count"), 1);
        assert.equal(state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(state.harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
        assert.equal(
            state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-snapshot-after:")),
            false,
        );

        // The owed invariant recovery settles to a full reconstruction with both
        // windows tiled and no orphan left behind.
        while (state.harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 2);
        assert.equal(state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(state.aWin.tile !== null);
        assert.ok(state.bWin.tile !== null);
        assert.notEqual(state.aWin.tile, state.bWin.tile);
        assert.equal(state.harness.yields.length, 0);
    });

    it("defers the dwindle invariant during a live drag without structural work", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        installCapacityRejectingSplitter(b, { rejecting: true });
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);

        // Start a live drag on aWin and keep `move` true so the drag is still
        // live-moving when the invariant is reached.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);

        // A third window arrives while the drag is live. Its insertion hits the
        // minimum-geometry capacity rejection and stays floating, so the
        // steady-state invariant would normally arm a reconstruction. During a
        // live drag it must defer instead of doing structural work.
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-failed:no-child-geometry"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, [a, b]);
        assert.deepEqual(a.windows, [aWin]);
        assert.deepEqual(b.windows, [bWin]);
    });

    it("runs the owed invariant check once after a no-finish abnormal termination", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installCapacityRejectingSplitter(b, { rejecting: true });
        installDwindleSplitter(root);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin, then a third window arrives and the invariant is
        // deferred, marking exactly one owed check.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // Abnormal termination: the dragged window is removed with no finish
        // event. The owed check must run exactly once and arm the deferred
        // reconstruction.
        aWin.tile = null;
        harness.windows = [bWin, incoming];
        harness.emitRemoved(aWin);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The owed reconstruction settles: collapse then rebuild dwindle(2)
        // with both surviving windows tiled and no orphan left behind.
        while (harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.notEqual(bWin.tile, incoming.tile);
        assert.equal(harness.yields.length, 0);
    });

    it("runs the owed invariant check via moveResizedChanged when the finish signal is missed", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installCapacityRejectingSplitter(b, { rejecting: true });
        installDwindleSplitter(root);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin, then a third window arrives and the invariant is
        // deferred, marking exactly one owed check.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // The interactiveMoveResizeFinished signal is missed entirely: the
        // live move simply turns false, and the resulting moveResizedChanged
        // must run the owed invariant check. No window is removed and no
        // scope change happens.
        aWin.move = false;
        aWin.resize = false;
        aWin.moveResizedChanged.emit();
        assert.equal(countEvent(harness.logs, "drag-move-resized-changed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, [a, b]);
        assert.deepEqual(a.windows, [aWin]);
        assert.deepEqual(b.windows, [bWin]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The owed reconstruction settles: collapse then rebuild dwindle(3)
        // with all three windows tiled and no orphan left behind.
        while (harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(new Set([aWin.tile, bWin.tile, incoming.tile]).size, 3);
        assert.equal(harness.yields.length, 0);
    });

    it("defers adoption reconstruction during a live drag", () => {
        const harness = new Harness();
        const root1 = tile(RECT, true);
        const leaf = tile();
        const aWin = window({ tile: leaf, caption: "a" });
        leaf.windows = [aWin];
        root1.tiles = [leaf];
        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        const c = tile({ x: 0, y: 0, width: 50, height: 100 });
        const d = tile({ x: 50, y: 0, width: 50, height: 100 });
        const w2 = window({ tile: c, caption: "w2", desktops: [desktop2] });
        c.windows = [w2];
        root2.tiles = [c, d];
        harness.rootsByDesktop.set(DESKTOP.id, root1);
        harness.rootsByDesktop.set(desktop2.id, root2);
        harness.active = aWin;
        harness.windows = [aWin];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin on the first desktop.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);

        // A window arrives on a second, not-yet-owned desktop while the drag is
        // live: adoption would normally arm a reconstruction, but must defer.
        harness.currentDesktop = desktop2;
        harness.windows = [aWin, w2];
        harness.emitAdded(w2);

        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
    });

    it("defers a removal during a live drag without structural work", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        let removes = 0;
        for (const entry of [a, b]) {
            entry.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((tile) => tile !== entry);
                return true;
            };
        }
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();

        // bWin is removed (its leaf already provably freed) while the drag is
        // live: the removal must defer instead of structurally removing.
        b.windows = [];
        harness.windows = [aWin];
        harness.emitRemoved(bWin);

        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, [a, b]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The drag ends without a drop: the owed check runs and reconstructs the
        // reduced population with no orphan left behind.
        aWin.move = false;
        aWin.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);

        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.equal(harness.yields.length, 0);
    });

    it("defers a pending removal settle during a live drag", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const aWin = window({ tile: a });
        const bWin = window({ tile: b });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        let removes = 0;
        for (const entry of [a, b]) {
            entry.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((tile) => tile !== entry);
                return true;
            };
        }
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Remove bWin while it is still listed in its leaf: the removal is
        // deferred to a one-shot yield before any drag starts.
        bWin.tile = b;
        b.windows = [bWin];
        harness.windows = [aWin];
        harness.emitRemoved(bWin);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(harness.yields.length, 1);

        // A live drag starts before the deferred settle fires.
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();

        // The deferred settle fires mid-drag: it must defer instead of removing.
        harness.flushNextYield();
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(removes, 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.deepEqual(root.tiles, [a, b]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The drag ends without a drop: the owed check runs and reconstructs.
        aWin.move = false;
        aWin.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);

        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.equal(harness.yields.length, 0);
    });

    it("runs the owed check only after the deferred origin removal settles on a drop", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 100 });
        const b = tile({ x: 100, y: 0, width: 100, height: 100 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const manage = (leaf: TestTile) => (value: unknown): boolean => {
            (value as TestWindow).tile = leaf;
            return true;
        };
        const bLeft = tile({ x: 100, y: 0, width: 50, height: 100 });
        const bRight = tile({ x: 150, y: 0, width: 50, height: 100 });
        bLeft.manage = manage(bLeft);
        bRight.manage = manage(bRight);
        const seam = { rejecting: true };
        b.split = (direction) => {
            if (seam.rejecting) {
                return [tile({ x: 100, y: 0, width: 0, height: 100 }), tile({ x: 150, y: 0, width: 50, height: 100 })];
            }
            b.isLayout = true;
            b.layoutDirection = direction;
            b.windows = [];
            b.tiles = [bLeft, bRight];
            return [bLeft, bRight];
        };
        a.remove = () => {
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
            return true;
        };
        bLeft.remove = () => {
            b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bLeft);
            return true;
        };
        bRight.remove = () => {
            b.tiles = (b.tiles as TestTile[]).filter((entry) => entry !== bRight);
            return true;
        };
        b.remove = () => {
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== b);
            return true;
        };
        installDwindleSplitter(root);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live drag aWin, then a third window arrives and the invariant is
        // deferred (marking exactly one owed check).
        aWin.move = true;
        aWin.resize = false;
        aWin.interactiveMoveResizeStarted.emit();
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-invariant-deferred:drag-live"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // The drag ends as a drop onto bWin, arming the deferred origin removal.
        // The owed check must NOT run yet: the origin is transiently empty.
        seam.rejecting = false;
        aWin.tile = null;
        aWin.frameGeometry = { x: 100, y: 0, width: 50, height: 100 };
        aWin.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 1);

        // After the deferred origin removal settles, the owed check runs and
        // arms the reconstruction for the reduced population.
        harness.flushNextYield();
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        while (harness.flushNextYield()) {
            // Drain the reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(new Set([aWin.tile, bWin.tile, incoming.tile]).size, 3);
        assert.equal(harness.yields.length, 0);
    });

    it("clears a stale drag record before accepting a new drag", () => {
        const { controller, harness, dragged, targetWindow } = dragSetup();
        startDrag(dragged);
        assert.equal(controller.hasActiveDrag, true);
        assert.equal(dragged.move, false);

        // The drag ended without a finish event: the captured record is stale.
        // A new drag on the target window must clear it and capture fresh.
        targetWindow.move = true;
        targetWindow.interactiveMoveResizeStarted.emit();
        targetWindow.move = false;
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 2);
        assert.equal(controller.hasActiveDrag, true);
    });

    it("logs a drag-bail reason when finish has no tracked drag or a mismatched window", () => {
        const { harness, dragged, targetWindow } = dragSetup();
        // Finish with no tracked drag.
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 1);

        // Track a drag on `dragged`, then finish fires for a different window.
        startDrag(dragged);
        targetWindow.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:window-mismatch"), 1);
    });

    it("logs an interactive resize separately from an unknown non-move and attributes its follow-on bail", () => {
        const { harness, controller, dragged, targetWindow } = dragSetup();

        // An interactive resize (resize live, move not live) is not captured
        // and is logged as a resize, distinct from an unknown non-move.
        dragged.resize = true;
        dragged.move = false;
        dragged.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:resize"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:not-move"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        assert.equal(controller.hasActiveDrag, false);

        // The resize finish sees no tracked drag and the bail is attributed to
        // the resize rather than a generic no-tracked-drag.
        dragged.resize = false;
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag:resize"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 0);

        // An unknown non-move (neither move nor resize) keeps the generic
        // not-move capture failure and generic no-tracked-drag finish bail.
        targetWindow.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:not-move"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:resize"), 1);
        targetWindow.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 1);
    });

    it("does not attribute an unpaired finish after a completed resize", () => {
        const { harness, dragged } = dragSetup();

        // Complete a normal interactive resize.
        dragged.resize = true;
        dragged.interactiveMoveResizeStarted.emit();
        dragged.resize = false;
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag:resize"), 1);

        // A later finish with no preceding start must not be attributed to the
        // consumed resize gesture.
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag:resize"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:no-tracked-drag"), 1);
    });

    it("logs a drag-bail reason when invalidation clears an active tracked drag", () => {
        const { harness, controller, dragged } = dragSetup();
        startDrag(dragged);
        assert.equal(controller.hasActiveDrag, true);
        assert.equal(countEvent(harness.logs, "drag-bail:window-invalidated"), 0);

        dragged.desktopsChanged.emit();
        assert.equal(countEvent(harness.logs, "drag-bail:window-invalidated"), 1);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("logs an explicit reason when a tiled drag is ignored because its scope is inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        root.split = () => [];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // A malformed split marks the scope inert for the session.
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);

        // A move drag on the still-tiled window is ignored with an explicit log.
        first.move = true;
        first.resize = false;
        first.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-capture-failed:scope-inert"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        assert.equal(controller.hasActiveDrag, false);
    });
});

describe("TileController fullscreen passthrough", () => {
    function setFullscreen(subject: TestWindow, value: boolean): void {
        subject.fullScreen = value;
        subject.fullScreenChanged.emit();
    }

    it("leaves a created fullscreen window unmanaged with no tile write", () => {
        const { harness } = setup();
        const created = window({ fullScreen: true });
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(created, writes);
        harness.emitAdded(created);
        assert.equal(created.tile, null);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        assert.equal(countEvent(harness.logs, "window-added-eligible"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
    });

    it("preserves the slot and never mutates the tree when a tiled window enters fullscreen", () => {
        const { harness, root, target, focused } = setup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(focused, writes);
        setFullscreen(focused, true);
        assert.equal(focused.tile, target);
        assert.equal(writes.length, 0);
        assert.deepEqual(root.tiles, [target]);
        assert.deepEqual(target.windows, [focused]);
        assert.equal(countEvent(harness.logs, "fullscreen:enter preserved"), 1);
    });

    it("ignores geometry and lifecycle events while fullscreen without placement, reconstruction, drag, or resize", () => {
        const { harness, controller, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.moveResizedChanged.emit();
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("restores the preserved slot on exit via tile.manage without a guarded window.tile write", () => {
        const { harness, target, focused } = setup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(focused, writes);
        setFullscreen(focused, true);
        focused.tile = null;
        target.windows = [];
        let manages = 0;
        target.manage = (value) => {
            manages += 1;
            return value === focused;
        };
        writes.length = 0;
        setFullscreen(focused, false);
        assert.equal(manages, 1);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restore failed"), 0);
    });

    it("keeps the fullscreen record through removal so the owned tree is not collapsed", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leafA = tile();
        const leafB = tile({ x: 200, y: 0, width: 100, height: 100 });
        const fsWin = window({ tile: leafA });
        const otherWin = window({ tile: leafB });
        leafA.windows = [fsWin];
        leafB.windows = [otherWin];
        root.tiles = [leafA, leafB];
        harness.root = root;
        harness.active = fsWin;
        harness.windows = [fsWin, otherWin];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        setFullscreen(fsWin, true);
        leafA.windows = [];
        let removes = 0;
        leafA.remove = () => {
            removes += 1;
            return true;
        };
        harness.emitRemoved(fsWin);
        assert.equal(removes, 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(otherWin.tile, leafB);
        assert.deepEqual(root.tiles, [leafA, leafB]);
        assert.ok(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen") >= 1);
        assert.equal(fsWin.fullScreenChanged.subscriberCount, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("does not reflow a selected overlay when another window is removed while fullscreen", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = tile();
        const second = tile({ x: 200, y: 0, width: 100, height: 100 });
        const fullscreen = window({ tile: first });
        const removed = window({ tile: second });
        first.windows = [fullscreen];
        second.windows = [removed];
        root.tiles = [first, second];
        harness.root = root;
        harness.active = fullscreen;
        harness.windows = [fullscreen, removed];
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-apply-columns");
        setFullscreen(fullscreen, true);
        second.windows = [];
        harness.emitRemoved(removed);
        assert.equal(fullscreen.tile, first);
        assert.equal(countEvent(harness.logs, "reflow-completed"), 0);
        assert.ok(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen") >= 1);
        assert.equal(controller.isEnabled, true);
    });

    it("suppresses the new scope after a fullscreen window changes output", () => {
        const { harness, root, target, focused } = setup();
        const otherOutput = { ...OUTPUT, name: "screen-2" };
        setFullscreen(focused, true);
        focused.output = otherOutput;
        focused.outputChanged.emit();
        const incoming = window({ output: otherOutput });
        harness.emitAdded(incoming);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, [target]);
        assert.ok(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen") >= 1);
    });

    it("newly manages a created fullscreen window on exit into an empty leaf", () => {
        const { harness, root, target } = setup();
        const empty = tile(RECT, false, () => true);
        root.tiles = [target, empty];
        const created = window({ fullScreen: true });
        harness.emitAdded(created);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        setFullscreen(created, false);
        assert.equal(countEvent(harness.logs, "fullscreen:exit newly managed"), 1);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
    });

    it("bails non-destructively and logs a reason when the preserved slot is gone", () => {
        const { harness, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.tile = null;
        target.windows = [];
        root.tiles = [];
        setFullscreen(focused, false);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restore failed:tile-missing"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 0);
        assert.equal(harness.yields.length, 0);
    });

    it("feature-detects a missing fullScreenChanged binding without failing startup", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const focused = window({ tile: null });
        delete (focused as unknown as Record<string, unknown>)["fullScreenChanged"];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
        assert.ok(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:fullscreen-attach-failed:fullScreenChanged:")));
        const created = window({ fullScreen: true });
        harness.emitAdded(created);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
    });

    it("guards keyboard window movement while the active window is fullscreen", () => {
        const state = moveSetup("right");
        setFullscreen(state.focused, true);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.focused.tile, state.focusedTile);
        assert.deepEqual(state.target.windows, []);
        assert.deepEqual(
            state.harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:move-") || entry.includes("fullscreen:ignored")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen"],
        );
    });

    it("never swaps the active window onto a fullscreen occupant", () => {
        const state = swapSetup("right");
        setFullscreen(state.occupant, true);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(
            countEvent(state.harness.logs.slice(baseline), "fullscreen:ignored lifecycle while fullscreen"),
            1,
        );
        assert.equal(state.active.tile, state.source);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(state.source.windows, [state.active]);
        assert.deepEqual(state.target.windows, [state.occupant]);
    });

    it("guards preset application while the active window is fullscreen", () => {
        const { harness, focused, target } = setup();
        setFullscreen(focused, true);
        const baseline = harness.logs.length;
        invokeShortcut(harness, "plasma-auto-tiler-apply-columns");
        assert.equal(focused.tile, target);
        assert.deepEqual(
            harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:preset-") || entry.includes("fullscreen:ignored")),
            [
                "plasma-auto-tiler:preset-invoked:columns",
                "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen",
            ],
        );
    });

    it("guards keyboard insertion arming while the active window is fullscreen", () => {
        const { harness, focused, target } = setup();
        setFullscreen(focused, true);
        const baseline = harness.logs.length;
        invokeShortcut(harness, "plasma-auto-tiler-insert-right");
        assert.equal(focused.tile, target);
        assert.deepEqual(
            harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:keyboard-") || entry.includes("fullscreen:ignored")),
            [
                "plasma-auto-tiler:keyboard-invoked",
                "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen",
            ],
        );
    });

    it("guards detach while the active window is fullscreen", () => {
        const { harness, focused, target } = setup();
        setFullscreen(focused, true);
        const baseline = harness.logs.length;
        invokeShortcut(harness, "plasma-auto-tiler-detach");
        assert.equal(focused.tile, target);
        assert.deepEqual(
            harness.logs
                .slice(baseline)
                .filter((entry) => entry.startsWith("plasma-auto-tiler:detach-") || entry.includes("fullscreen:ignored")),
            [
                "plasma-auto-tiler:detach-invoked",
                "plasma-auto-tiler:fullscreen:ignored lifecycle while fullscreen",
            ],
        );
    });

    it("guards drag/drop and resize lifecycle while fullscreen without reflow", () => {
        const { harness, controller, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.move = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.move = false;
        focused.resize = true;
        focused.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        focused.interactiveMoveResizeFinished.emit();
        assert.equal(harness.yields.length, 0);
        assert.equal(focused.tile, target);
        assert.deepEqual(root.tiles, [target]);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("records an already-fullscreen existing window at startup without tiling, writing, reconstruction, or automatic placement", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const fullscreen = window({ fullScreen: true });
        const target = tile();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(fullscreen, writes);
        target.manage = (value) => {
            fullscreen.tile = target;
            return value === fullscreen;
        };
        root.tiles = [target];
        harness.root = root;
        harness.active = fullscreen;
        harness.windows = [fullscreen];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.isEnabled, true);
        assert.equal(fullscreen.tile, null);
        assert.deepEqual(target.windows, []);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "fullscreen:enter unmanaged"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:enter preserved"), 0);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        const incoming = window();
        const incomingWrites: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(incoming, incomingWrites);
        harness.emitAdded(incoming);
        assert.equal(incoming.tile, null);
        assert.equal(incomingWrites.length, 0);
        assert.equal(writes.length, 0);
        assert.deepEqual(target.windows, []);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 0);
        fullscreen.move = true;
        fullscreen.interactiveMoveResizeStarted.emit();
        fullscreen.interactiveMoveResizeFinished.emit();
        assert.equal(fullscreen.tile, null);
        assert.equal(writes.length, 0);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 0);
        fullscreen.fullScreen = false;
        fullscreen.fullScreenChanged.emit();
        assert.equal(countEvent(harness.logs, "fullscreen:exit newly managed"), 1);
        assert.equal(fullscreen.tile, target);
        assert.equal(countEvent(harness.logs, "automatic-placement-managed"), 1);
    });

    it("bails non-destructively on exit when the preserved leaf became occupied by another window", () => {
        const { harness, root, target, focused } = setup();
        setFullscreen(focused, true);
        focused.tile = null;
        target.windows = [];
        const intruder = window({ tile: target });
        target.windows = [intruder];
        setFullscreen(focused, false);
        assert.equal(focused.tile, null);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restore failed:leaf-occupied"), 1);
        assert.equal(countEvent(harness.logs, "fullscreen:exit restored"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(intruder.tile, target);
        assert.deepEqual(root.tiles, [target]);
    });
});

