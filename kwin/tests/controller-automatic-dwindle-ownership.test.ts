import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TileController } from "../src/controller";
import { buildDwindleBlueprint } from "../src/layout-blueprint";
import {
    DESKTOP,
    Harness,
    RECT,
    tile,
    type TestTile,
    window,
} from "./controller-fixtures";
import {
    assertDwindleShape,
    attachTileWriter,
    configureThreeOccupantPreset,
    countEvent,
    currentScopeFor,
    installCapacityRejectingSplitter,
    installDwindleSplitter,
    installStaleReturnSplitter,
    invokeShortcut,
    presetSetup,
} from "./controller-fixture-scenarios";

describe("TileController automatic dwindle ownership", () => {
    it("adopts a stable scope on controller start without any structural call", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let splits = 0;
        let removes = 0;
        for (const value of [root, left, right]) {
            value.split = () => {
                splits += 1;
                return [];
            };
            value.remove = () => {
                removes += 1;
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();

        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-split"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(first.tile, left);
        assert.equal(second.tile, right);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("reconstructs a persisted same-shape tree with empty leaves instead of adopting it", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window();
        const second = window();
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        let splits = 0;
        for (const leaf of [left, right]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        const installedSplit = root.split;
        root.split = (direction) => {
            splits += 1;
            return installedSplit(direction);
        };
        attachTileWriter(first);
        attachTileWriter(second);
        const controller = new TileController(harness.environment());
        controller.start();

        // The shape is a valid dwindle(2) but both leaves are empty and both
        // windows are floating: the occupancy bijection fails, so ownership is
        // not taken directly and the reconstruction is armed with no direct
        // structural call and no timer.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        // Phase one (first yield): removals-only collapse, no split.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 2);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Phase two (second yield): splits-only rebuild assigning the
        // population to the freshly realized dwindle leaves.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 2);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.notEqual(first.tile, second.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("reconstructs a persisted same-shape tree with one empty leaf and a floating window", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window();
        left.windows = [first];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        for (const leaf of [left, right]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        const controller = new TileController(harness.environment());
        controller.start();

        // One leaf is correctly occupied but the other is empty and the second
        // owned window is floating: the occupancy bijection fails even though
        // the shape is a valid dwindle(2), so the reconstruction is armed with
        // no direct structural call.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 2);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 2);
        assert.equal(harness.yields.length, 0);
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.notEqual(first.tile, second.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("adopts a zero-child layout root as the sole usable leaf of a one-window scope", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = window({ tile: root });
        root.windows = [first];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let splits = 0;
        let removes = 0;
        root.split = () => {
            splits += 1;
            return [];
        };
        root.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();

        // The zero-child layout root is the sole usable leaf, so the tree is
        // already dwindle(1) with the owned window in that leaf: ownership is
        // taken with no structural call and no reconstruction yield. This MUST
        // fail if dwindleMatches counts only non-layout tiles, which would
        // reject the root and arm a needless collapse/split reconstruction.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(first.tile, root);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("splits the zero-child layout root on insertion instead of marking the scope inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = window({ tile: root });
        root.windows = [first];
        installDwindleSplitter(root);
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);

        // The zero-child root is the sole usable leaf and the insertion point
        // at depth zero: splitting it grows dwindle(1) into dwindle(2). This
        // MUST fail with the prior behavior, which could not resolve a
        // non-layout insertion leaf and marked the scope inert.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        const rootChildren = root.tiles as TestTile[];
        assert.equal(rootChildren.length, 2);
        assert.equal(first.tile, rootChildren[0]);
        assert.equal(second.tile, rootChildren[1]);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("leaves a zero-child layout root with no owned windows unmanaged and untouched", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        harness.root = root;
        let splits = 0;
        let removes = 0;
        root.split = () => {
            splits += 1;
            return [];
        };
        root.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();

        // An empty scope has no owned population, so it is never managed,
        // never reconstructed, and never marked inert.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 0);
        assert.deepEqual(root.tiles, []);
    });

    it("adopts the current desktop scope when a window is added after a switch to an empty workspace", () => {
        const harness = new Harness();
        const root1 = tile(RECT, true);
        const first = window({ tile: root1 });
        root1.windows = [first];
        harness.rootsByDesktop.set(DESKTOP.id, root1);
        harness.active = first;
        harness.windows = [first];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Switch to an empty desktop with no window: no anchor exists, so the
        // desktop is left unmanaged at the change notification.
        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        harness.rootsByDesktop.set(desktop2.id, root2);
        harness.currentDesktop = desktop2;
        harness.emitCurrentDesktopChanged(null, desktop2, null);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);

        // An eligible window appears on the now-current empty desktop. It must
        // adopt the scope (not silently drop it) and reconstruct it so the
        // window ends up tiled. Pre-fix this path hit generic placement with no
        // empty leaf and produced no ownership-pending and no insertion.
        const second = window({ desktops: [desktop2] });
        attachTileWriter(second);
        harness.active = second;
        harness.windows = [first, second];
        harness.emitAdded(second);

        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "window-added-noop:no-empty-leaf"), 0);

        while (harness.flushNextYield()) {
            // Drain the two-phase reconstruction to completion.
        }
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(second.tile, root2);
    });

    it("emits a decisive no-op diagnostic when an in-scope addition reaches placement with no empty leaf on an inert scope", () => {
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

        // A malformed split damages the scope, marking it inert for the session.
        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);

        // A later eligible addition on the inert scope reaches generic placement
        // with no empty leaf and no dwindle fallback: it must emit a decisive
        // no-op reason instead of disappearing silently.
        const later = window();
        harness.emitAdded(later);
        assert.equal(countEvent(harness.logs, "window-added-noop:no-empty-leaf"), 1);
        assert.equal(later.tile, null);
    });

    it("rebuilds a non-dwindle one-window scope onto the collapsed zero-child root's sole leaf", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: a });
        a.windows = [first];
        root.tiles = [a, b];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // Phase one collapse: the two-leaf tree collapses to the zero-child
        // layout root and arms the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Phase two: the collapsed zero-child root is not dwindle(1) until the
        // floating population occupies its sole usable leaf, so the rebuild
        // assigns the window to the root. This MUST fail if the count-one
        // match accepted the empty zero-child root: the window would be
        // dropped floating and ownership claimed without occupying it.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        assert.equal(first.tile, root);
        assert.deepEqual(root.windows, [first]);
        assert.equal(harness.scheduled.length, 0);
    });

    it("rebuilds a non-dwindle owned scope as the dwindle blueprint after a deferred remove-to-split yield", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        let removes = 0;
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();

        // The flat three-leaf tree is non-dwindle: ownership is recorded and
        // the reconstruction arms its first one-shot event-loop yield. No
        // structural call happens in the takeover dispatch, no timer is
        // scheduled, and exactly one yield is armed. This MUST fail if the
        // takeover dispatch does not arm the callback.
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        // First yield dispatch: the removals-only collapse runs synchronously
        // with a fresh whole-root decode after every remove, no split, and it
        // arms the second one-shot yield. This MUST fail if the collapse phase
        // does not arm the next callback.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 3);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Second yield dispatch: the splits-only dwindle rebuild runs in one
        // synchronous batch and assigns the owned population, with no removals,
        // and no yield is armed afterwards.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(removes, 3);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.ok(third.tile !== null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("re-resolves the root and fresh-decodes around every rebuild split instead of retaining returned child handles", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installStaleReturnSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // The rebuild never splits a child retained from a prior split: the
        // second split would throw if the controller reused the first split's
        // return values, so the success below proves every structural call is
        // preceded by a fresh root resolution and tree decode.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.ok(third.tile !== null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("inserts each added window on the dwindle right spine with alternating orientation", () => {
        const harness = new Harness();
        const root = tile();
        const first = window({ tile: root });
        root.windows = [first];
        installDwindleSplitter(root);
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(first.tile, (root.tiles as TestTile[])[0]);
        assert.equal(second.tile, (root.tiles as TestTile[])[1]);

        const third = window();
        harness.windows = [first, second, third];
        attachTileWriter(third);
        harness.emitAdded(third);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 2);
        const rootChildren = root.tiles as TestTile[];
        const right = rootChildren[1];
        assert.ok(right !== undefined);
        assert.equal(second.tile, (right.tiles as TestTile[])[0]);
        assert.equal(third.tile, (right.tiles as TestTile[])[1]);

        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("rebuilds for the changed managed count when windows leave before the reconstruction completes", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // The third window closes before the reconstruction's first yield
        // fires. Live KWin 6.7.3 still lists the removed window in its leaf
        // at `windowRemoved` (unit-19c), so the removal is deferred to one
        // one-shot event-loop yield instead of collapsing now; the pending
        // rebuild re-resolves the fresh population itself, and the removed
        // window is never reassigned. The old source failed here because its
        // unit-test contract required the leaf to already be freed at
        // `windowRemoved` (this `c.windows = []` before the notification),
        // which live KWin 6.7.3 never does.
        third.tile = c;
        c.windows = [third];
        harness.windows = [first, second];
        harness.emitRemoved(third);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.yields.length, 2);

        // The leaf evacuation settles on the event loop before any callback.
        // KWin's `Tile::unmanage` both removes the window from the leaf's
        // windows list and clears `requestedTile`, so `third.tile` is nulled
        // here too.
        c.windows = [];
        third.tile = null;

        // The pending collapse-phase dispatch collapses the scope and arms
        // the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.yields.length, 2);

        // The deferred removal settle is inert: its captured leaf is already
        // gone from the fresh tree, so it must not remove or arm anything.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 1);

        // The split-phase dispatch realizes dwindle(2) from the changed
        // population and completes the rebuild.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.equal(third.tile, null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("collapses the freed leaf after an owned window is removed, with a fresh whole-root decode", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let splits = 0;
        let removes = 0;
        for (const value of [left, right]) {
            value.split = () => {
                splits += 1;
                return [];
            };
        }
        right.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== right);
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Live KWin 6.7.3 arrives at `windowRemoved` with the removed window
        // still listed in its former leaf's windows array and `window.tile`
        // still set (unit-19c), so the collapse cannot run in the removal
        // dispatch: the leaf is not yet provably freed. The removal is
        // deferred to one one-shot event-loop yield. The old source failed
        // this exact ordering: its `windowIndex(leaf.windows, window) >= 0`
        // guard returned early, so the freed leaf was never collapsed and the
        // tree never rebalanced. The previous test contract (leaf freed
        // before `windowRemoved`) does not match live KWin 6.7.3.
        second.tile = right;
        right.windows = [second];
        harness.windows = [first];
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.equal(harness.yields.length, 1);

        // The leaf evacuation settles on a later event-loop turn; only then
        // does the deferred settle collapse the provably-freed leaf, with a
        // fresh whole-root decode before and after the single remove. KWin's
        // `Tile::unmanage` also clears the removed window's `requestedTile`.
        right.windows = [];
        second.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(removes, 1);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, [left]);
        // The survivor stays tiled on the sole usable leaf under the layout
        // root: the scope is already dwindle(1), so no reconstruction is
        // armed and no split ever runs.
        assert.equal(first.tile, left);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("settles removal of the last window onto an empty tree without arming a reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        left.windows = [first];
        root.tiles = [left];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        let splits = 0;
        left.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        root.split = () => {
            splits += 1;
            return [];
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Removing the sole window down to N=0: the removal is deferred while
        // the window still lingers in its leaf, then the settle collapses the
        // last leaf to the empty zero-child root. An empty owned scope never
        // starts a reconstruction, so nothing is armed and no split ever runs.
        first.tile = left;
        left.windows = [first];
        harness.windows = [];
        harness.emitRemoved(first);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 1);

        // The window's tile is nulled with the evacuation, mirroring KWin's
        // `Tile::unmanage` clearing `requestedTile`.
        left.windows = [];
        first.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(removes, 1);
        assert.equal(splits, 0);
        assert.deepEqual(root.tiles, []);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("occupies an empty zero-child layout root with the first eligible window added after N=0", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile({ x: 0, y: 0, width: 50, height: 100 });
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        let splits = 0;
        leaf.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        root.split = () => {
            splits += 1;
            return [];
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Remove the last window down to N=0: the freed leaf collapses and the
        // owned scope's tree is the zero-child layout root.
        first.tile = leaf;
        leaf.windows = [first];
        harness.windows = [];
        harness.emitRemoved(first);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        leaf.windows = [];
        first.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // First eligible add on the N=0 scope: the incoming window must become
        // the empty zero-child root's occupant through one guarded
        // compatibility assignment, with no inert marking and no split. This
        // MUST fail with the pre-fix behavior, which required exactly one
        // occupant of the insertion leaf and marked the empty root inert.
        const incoming = window();
        attachTileWriter(incoming);
        harness.windows = [incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-occupied-root"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(splits, 0);
        assert.equal(incoming.tile, root);
        assert.deepEqual(root.windows, [incoming]);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("leaves a zero-child root untouched when its sole occupant is removed", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const first = window({ tile: root });
        root.windows = [first];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        root.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // The sole occupant lives on the zero-child layout root itself, the
        // scope's only usable leaf. The root is excluded from every removal,
        // so the notification returns before arming any settle yield and no
        // structural call or reconstruction follows.
        first.tile = root;
        root.windows = [first];
        harness.windows = [];
        harness.emitRemoved(first);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("makes a duplicate removal settle callback inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        right.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== right);
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Duplicate `windowRemoved` notifications for the same lingering
        // window arm two settle yields; the first collapses the freed leaf and
        // the second is inert because its captured leaf is gone from the fresh
        // tree. Exactly one remove ever runs.
        second.tile = right;
        right.windows = [second];
        harness.windows = [first];
        harness.emitRemoved(second);
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 2);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 2);

        right.windows = [];
        second.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(removes, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(removes, 1, "a duplicate settle callback cannot remove again");
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.deepEqual(root.tiles, [left]);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("never mixes a remove and a split in one dispatch", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let splits = 0;
        let removes = 0;
        right.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== right);
            return true;
        };
        // After the collapse the tree is functionally dwindle(1) under the
        // layout root, so the insertion splits the root horizontally at depth
        // zero, keeping the surviving occupant in the first child.
        const childA = tile({ x: 0, y: 0, width: 50, height: 100 });
        const childB = tile({ x: 50, y: 0, width: 50, height: 100 });
        root.split = (direction) => {
            splits += 1;
            assert.equal(direction, 1);
            root.isLayout = true;
            root.windows = [];
            root.tiles = [childA, childB];
            return [childA, childB];
        };
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();

        // Removal dispatch: the removed window is still listed in its leaf
        // (live KWin 6.7.3 ordering), so the removal is deferred and neither
        // a remove nor a split happens in the notification dispatch.
        second.tile = right;
        right.windows = [second];
        harness.windows = [first];
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 1);

        // Settle dispatch: exactly one collapse, zero splits. KWin's
        // `Tile::unmanage` has evacuated the leaf and cleared the removed
        // window's `requestedTile` by this event-loop turn.
        right.windows = [];
        second.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(splits, 0);
        assert.equal(removes, 1);
        assert.equal(harness.yields.length, 0);

        // Add dispatch: one dwindle insertion split, zero removals.
        const incoming = window();
        harness.windows = [first, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(removes, 1);
        assert.equal(splits, 1);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("excludes explicitly detached windows from the owned population and the dwindle rebuild", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // Detaching the third window before the reconstruction's first yield
        // fires removes it from the owned population, so the deferred rebuild
        // realizes dwindle(2) and never assigns the detached window.
        harness.active = third;
        invokeShortcut(harness, "plasma-auto-tiler-detach");
        assert.equal(countEvent(harness.logs, "detach-completed"), 1);
        assert.equal(third.tile, null);

        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.equal(third.tile, null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("does not collapse a leaf for a detached window's removal", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        const first = window({ tile: left });
        const second = window({ tile: right });
        left.windows = [first];
        right.windows = [second];
        root.tiles = [left, right];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        let removes = 0;
        right.remove = () => {
            removes += 1;
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        harness.active = second;
        invokeShortcut(harness, "plasma-auto-tiler-detach");
        assert.equal(second.tile, null);
        assert.equal(countEvent(harness.logs, "detach-completed"), 1);

        second.tile = null;
        right.windows = [];
        harness.emitRemoved(second);

        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.deepEqual(root.tiles, [left, right]);
        assert.equal(harness.yields.length, 0);
    });

    it("lets a valid selected overlay win over dwindle ownership", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");
        const scope = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        // The takeover reconstruction armed before the overlay was recorded is
        // dropped inertly on its first yield dispatch: a valid selected overlay
        // wins, so no collapse or split ever runs.
        assert.equal(state.harness.yields.length, 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-collapsed"), 0);
        assert.equal(state.harness.yields.length, 0);

        // A full valid overlay absorbs an add through the established reflow
        // fallback instead of a dwindle insertion split.
        const incoming = window();
        state.harness.emitAdded(incoming);
        assert.equal(countEvent(state.harness.logs, "ownership-add-split"), 0);

        // A removal reflows the overlay instead of collapsing a dwindle leaf.
        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
    });

    it("marks a damaged scope inert for the session and never retries dwindle there", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let splits = 0;
        // The single-leaf scope's insertion point is the layout root at depth
        // zero, so the malformed split stub lives on the root.
        root.split = () => {
            splits += 1;
            return [];
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);
        assert.equal(splits, 1);

        const later = window();
        harness.emitAdded(later);
        assert.equal(splits, 1, "a damaged scope is never retried");
        assert.equal(countEvent(harness.logs, "ownership-inert:insert-split-decode-failed"), 1);
        assert.equal(controller.isEnabled, true);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 0);
    });

    it("keeps a scope retryable when minimum geometry rejects the split children, then recovers on a later lifecycle dispatch", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leaf = tile();
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        const seam = { rejecting: true };
        installCapacityRejectingSplitter(root, seam);
        let removes = 0;
        leaf.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
            return true;
        };
        root.remove = () => {
            removes += 1;
            return true;
        };
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // A second window is added while KWin minimum geometry rejects the
        // split children. The strict geometry-order validation still rejects,
        // the incoming window is left unmanaged, and the scope is NOT marked
        // inert: the rejection is a capacity failure, not a damaged tree.
        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-add-failed:no-child-geometry"), 1);
        assert.equal(second.tile, null, "the impossible incoming insertion stays unmanaged");

        // The failed insert leaves the scope owned and retryable, so the same
        // add dispatch's invariant check can proceed and arms the deferred
        // reconstruction. This assertion MUST fail when the retry dispatch
        // seam is absent: the old source marked the scope inert and
        // `dwindleEnsureInvariant` was suppressed.
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // A later lifecycle dispatch collapses to the single root leaf.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // KWin geometry now admits a valid split; the deferred rebuild
        // proceeds and realizes dwindle(2) with both windows assigned. The
        // second `ownership-taken` is the rebuild completion.
        seam.rejecting = false;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 1, "the collapse removed exactly one leaf");
        const rootChildren = root.tiles as TestTile[];
        assert.equal(rootChildren.length, 2);
        assert.equal(first.tile, rootChildren[0]);
        assert.equal(second.tile, rootChildren[1]);
        const compiled = buildDwindleBlueprint(2);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("defers a removal during a pending reconstruction and keeps stale duplicate callbacks inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 25, height: 100 });
        const b = tile({ x: 25, y: 0, width: 25, height: 100 });
        const c = tile({ x: 50, y: 0, width: 25, height: 100 });
        const d = tile({ x: 75, y: 0, width: 25, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        const fourth = window({ tile: d });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        d.windows = [fourth];
        root.tiles = [a, b, c, d];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third, fourth];
        let removes = 0;
        for (const leaf of [a, b, c, d]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        attachTileWriter(fourth);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // A removal arrives while a reconstruction is already pending. Live
        // KWin 6.7.3 still lists the removed window in its leaf at
        // `windowRemoved`, so the removal is deferred to one one-shot
        // event-loop yield and never collapses in the notification dispatch.
        // The pending rebuild keeps sole control of the structural work and
        // re-resolves the changed population itself on its next dispatch. The
        // old source could never reach this state against live KWin: its
        // freed-leaf-first unit contract let a synchronous collapse run at
        // `windowRemoved`, but the live ordering leaves the window listed, so
        // the guard returned early and nothing ever settled.
        second.tile = b;
        b.windows = [second];
        harness.windows = [first, third, fourth];
        harness.emitRemoved(second);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 2);

        // The leaf evacuation settles on the event loop before any callback.
        // KWin's `Tile::unmanage` also clears the removed window's tile.
        b.windows = [];
        second.tile = null;

        // The pending collapse-phase dispatch collapses the scope to the
        // zero-child root and arms the split-phase yield.
        const collapseCallback = harness.yields[0]?.callback;
        assert.ok(collapseCallback !== undefined);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 2);
        // A duplicate dispatch of the same collapse callback is inert: after
        // the first fire the record advanced to awaiting-split, so a stale
        // repeat of the collapse callback cannot act again.
        collapseCallback();
        assert.equal(removes, 4, "a duplicate callback cannot collapse twice");
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);

        // The deferred removal settle is inert: its captured leaf is already
        // gone from the fresh tree, so it removes nothing and arms nothing.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(removes, 4, "a stale settle callback cannot remove a collapsed leaf");
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // The split-phase dispatch realizes dwindle(3) from the surviving
        // population and never reassigns the removed window.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.equal(controller.isEnabled, true);
        assert.equal(harness.scheduled.length, 0);
    });

    it("re-drives completion after a lost split-phase yield reply on the next lifecycle event", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        for (const leaf of [a, b, c]) {
            leaf.remove = () => {
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // First yield dispatch: the removals-only collapse completes and arms
        // the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // The split-phase reply is lost (a D-Bus error reply never dispatches
        // the callDBus callback, scripting.cpp:361-364), so the scope stays
        // collapsed and the pending record stays at awaiting-split.
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.deepEqual(root.tiles, []);

        // A later already-wired ordinary lifecycle event re-drives completion
        // instead of leaving the scope collapsed forever: the add is left
        // floating and the pending rebuild re-resolves the fresh population
        // (including the added window) on the re-armed yield. No inertness and
        // no premature split happen in the add dispatch.
        const incoming = window();
        harness.windows = [first, second, third, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 0);
        assert.equal(harness.yields.length, 1);

        // The re-armed yield completes the split rebuild exactly once and
        // realizes dwindle(4) with the added window tiled.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(4);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(first.tile !== null);
        assert.ok(second.tile !== null);
        assert.ok(third.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.equal(harness.scheduled.length, 0);
    });

    it("bounds re-drive re-arms so repeated lost split-phase replies mark the scope inert", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        let removes = 0;
        let splits = 0;
        for (const leaf of [a, b, c]) {
            leaf.split = () => {
                splits += 1;
                return [];
            };
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
        }
        installDwindleSplitter(root);
        attachTileWriter(first);
        attachTileWriter(second);
        attachTileWriter(third);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(harness.yields.length, 1);

        // First yield dispatch: the removals-only collapse completes and arms
        // the split-phase yield.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(harness.yields.length, 1);

        // The split-phase reply is lost (a D-Bus error reply never dispatches
        // the callDBus callback, scripting.cpp:361-364).
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);

        // A lifecycle event re-arms the split-phase yield (budget 1 of 2) so
        // the scope is not stranded collapsed after one lost reply. No split,
        // rebuild, or inertness happens in the lifecycle callback itself.
        const firstIncoming = window();
        harness.windows = [first, second, third, firstIncoming];
        attachTileWriter(firstIncoming);
        harness.emitAdded(firstIncoming);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(splits, 0);
        assert.equal(harness.yields.length, 1);

        // The re-armed reply is lost too; the scope stays collapsed.
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);
        assert.deepEqual(root.tiles, []);

        // Another ordinary lifecycle event spends the second re-arm of the
        // budget (2 of 2) and still re-arms: repeated loss has not yet marked
        // the scope inert.
        const secondIncoming = window();
        harness.windows = [first, second, third, firstIncoming, secondIncoming];
        attachTileWriter(secondIncoming);
        harness.emitAdded(secondIncoming);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 1);

        // That re-armed reply is lost as well, exhausting the budget.
        assert.equal(harness.dropNextYield(), true);
        assert.equal(harness.yields.length, 0);

        // One more ordinary lifecycle event finds the budget exhausted and
        // fails the scope closed: it becomes inert, the pending reconstruction
        // is dropped, and nothing is armed. No split or rebuild ever ran, the
        // scope stays collapsed, and no timer was scheduled.
        const thirdIncoming = window();
        harness.windows = [first, second, third, firstIncoming, secondIncoming, thirdIncoming];
        attachTileWriter(thirdIncoming);
        harness.emitAdded(thirdIncoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:rearm-budget-exhausted"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(splits, 0);
        assert.equal(removes, 3);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);

        // The inert scope is never retried: a further lifecycle event neither
        // re-arms a rebuild nor mutates structure.
        const fourthIncoming = window();
        harness.windows = [first, second, third, firstIncoming, secondIncoming, thirdIncoming, fourthIncoming];
        attachTileWriter(fourthIncoming);
        harness.emitAdded(fourthIncoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:rearm-budget-exhausted"), 1);
        assert.equal(splits, 0);
        assert.equal(removes, 3);
        assert.deepEqual(root.tiles, []);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("fails a scope closed when the one-shot yield arm fails", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 33, height: 100 });
        const b = tile({ x: 33, y: 0, width: 33, height: 100 });
        const c = tile({ x: 66, y: 0, width: 34, height: 100 });
        const first = window({ tile: a });
        const second = window({ tile: b });
        const third = window({ tile: c });
        a.windows = [first];
        b.windows = [second];
        c.windows = [third];
        root.tiles = [a, b, c];
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second, third];
        let splits = 0;
        let removes = 0;
        for (const leaf of [a, b, c]) {
            leaf.split = () => {
                splits += 1;
                return [];
            };
            leaf.remove = () => {
                removes += 1;
                return true;
            };
        }
        harness.yieldResult = false;
        const controller = new TileController(harness.environment());
        controller.start();

        // The takeover arm fails closed: the scope is inert, nothing is armed,
        // and no structural call ever ran.
        assert.equal(countEvent(harness.logs, "ownership-inert:initial-yield-arm-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(removes, 0);
        assert.equal(splits, 0);

        // The inert scope is never retried: a later add takes the generic
        // automatic-placement path, never a new reconstruction.
        const incoming = window();
        harness.windows = [first, second, third, incoming];
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-inert:initial-yield-arm-failed"), 1);
        assert.equal(harness.yields.length, 0);
        assert.equal(removes, 0);
        assert.equal(splits, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("accepts a non-canonical but bijection-intact tree at a steady-state removal and arms no reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 100 });
        const v = tile({ x: 100, y: 0, width: 100, height: 100 }, true);
        v.layoutDirection = 2;
        const b = tile({ x: 100, y: 0, width: 100, height: 50 });
        const h = tile({ x: 100, y: 50, width: 100, height: 50 }, true);
        const c = tile({ x: 100, y: 50, width: 100, height: 25 });
        const d = tile({ x: 100, y: 75, width: 100, height: 25 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        const cWin = window({ tile: c, caption: "c" });
        const dWin = window({ tile: d, caption: "d" });
        a.windows = [aWin];
        b.windows = [bWin];
        c.windows = [cWin];
        d.windows = [dWin];
        root.tiles = [a, v];
        v.tiles = [b, h];
        h.tiles = [c, d];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin, cWin, dWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        attachTileWriter(cWin);
        attachTileWriter(dWin);
        let removes = 0;
        let splits = 0;
        for (const value of [root, v, h, a, b, c, d]) {
            value.split = () => {
                splits += 1;
                return [];
            };
        }
        a.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
            // KWin promotes a single-child layout after a tile removal: the
            // vacated H wrapper disappears and the V chain becomes the root.
            if ((root.tiles as TestTile[]).length === 1) {
                const sole = (root.tiles as TestTile[])[0];
                if (sole !== undefined) {
                    harness.root = sole;
                }
            }
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();

        // The persisted canonical dwindle(4) chain H[a, V[b, H[c, d]]] is
        // adopted unchanged with no structural call.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // Removing the first-chain window `a`: live KWin 6.7.3 still lists the
        // window in its leaf at `windowRemoved`, so the collapse is deferred to
        // one one-shot event-loop yield.
        aWin.tile = a;
        a.windows = [aWin];
        harness.windows = [bWin, cWin, dWin];
        harness.emitRemoved(aWin);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(harness.yields.length, 1);

        // The settle removes `a` and the root promotes to its sole child, so
        // the live tree becomes the vertical-root V[b, H[c, d]]. The
        // window-to-leaf occupancy bijection is intact (three leaves, three
        // owned windows), so the steady-state invariant accepts the genuinely
        // non-canonical topology with the accepted diagnostic instead of arming
        // a reconstruction: no collapse beyond the single removal, no split, no
        // pending rebuild, and every survivor stays tiled.
        a.windows = [];
        aWin.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(removes, 1);
        assert.equal(splits, 0);
        assert.equal(harness.root, v);
        assert.equal(v.isLayout, true);
        assert.equal(v.layoutDirection, 2);
        assert.deepEqual(v.tiles, [b, h]);
        assert.deepEqual(h.tiles, [c, d]);
        assert.equal(bWin.tile, b);
        assert.equal(cWin.tile, c);
        assert.equal(dWin.tile, d);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });

    it("arms a reconstruction from a steady-state add when the occupancy bijection fails, with the failed diagnostic", () => {
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
        let splits = 0;
        for (const leaf of [a, b]) {
            leaf.remove = () => {
                removes += 1;
                root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
                return true;
            };
            leaf.split = () => {
                splits += 1;
                return [];
            };
        }
        const seam = { rejecting: true };
        installCapacityRejectingSplitter(b, seam);
        installDwindleSplitter(root);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();

        // The persisted canonical dwindle(2) H[a, b] is adopted unchanged, so
        // ownership is established before the bijection is broken.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // A third window arrives while KWin minimum geometry rejects the split
        // children: the insertion leaves the incoming window floating and the
        // live tree untouched, so the occupancy bijection fails (three owned
        // windows against two leaves) and the steady-state invariant arms the
        // deferred reconstruction with the failed diagnostic.
        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-failed:no-child-geometry"), 1);
        assert.equal(countEvent(harness.logs, "ownership-invariant:bijection-failed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(incoming.tile, null);
        assert.equal(splits, 0);
        assert.equal(removes, 0);
        assert.equal(harness.yields.length, 1);

        // The queued reconstruction settles: the removals-only collapse runs at
        // the first yield, then the splits-only rebuild realizes dwindle(3)
        // with every window tiled at the second.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(removes, 2);
        assert.equal(harness.yields.length, 1);
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 2);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(root, compiled.value, 0);
        }
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(incoming.tile !== null);
        assert.notEqual(aWin.tile, bWin.tile);
        assert.notEqual(aWin.tile, incoming.tile);
        assert.notEqual(bWin.tile, incoming.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("reconciles a foreign persisted non-canonical tree to the canonical dwindle shape on adoption", () => {
        const harness = new Harness();
        const v = tile(RECT, true);
        v.layoutDirection = 2;
        const h = tile({ x: 0, y: 0, width: 100, height: 50 }, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 50 });
        const b = tile({ x: 0, y: 50, width: 100, height: 50 });
        const c = tile({ x: 0, y: 0, width: 100, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        const cWin = window({ tile: c, caption: "c" });
        a.windows = [aWin];
        b.windows = [bWin];
        c.windows = [cWin];
        v.tiles = [a, h];
        h.tiles = [b, c];
        harness.root = v;
        harness.active = aWin;
        harness.windows = [aWin, bWin, cWin];
        let removes = 0;
        a.remove = () => {
            removes += 1;
            v.tiles = (v.tiles as TestTile[]).filter((entry) => entry !== a);
            return true;
        };
        b.remove = () => {
            removes += 1;
            h.tiles = (h.tiles as TestTile[]).filter((entry) => entry !== b);
            return true;
        };
        c.remove = () => {
            removes += 1;
            h.tiles = (h.tiles as TestTile[]).filter((entry) => entry !== c);
            return true;
        };
        h.remove = () => {
            removes += 1;
            v.tiles = (v.tiles as TestTile[]).filter((entry) => entry !== h);
            return true;
        };
        installDwindleSplitter(v);
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        attachTileWriter(cWin);
        const controller = new TileController(harness.environment());
        controller.start();

        // The foreign persisted vertical-root tree V[a, H[b, c]] has an intact
        // occupancy bijection (three leaves, three owned windows) but is
        // non-canonical (the root is vertical, not horizontal). Adoption must
        // reconcile it, not accept it through the steady-state bijection-only
        // branch: no ownership-taken and no acceptance diagnostic, just the
        // armed reconstruction.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 0);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(removes, 0);
        assert.equal(harness.scheduled.length, 0);
        assert.equal(harness.yields.length, 1);

        // Collapse phase: the nested tree collapses removals-only to the single
        // zero-child layout root, then arms the split phase.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 0);
        assert.equal(removes, 4);
        assert.deepEqual(v.tiles, []);
        assert.equal(harness.yields.length, 1);

        // Split phase: the canonical dwindle(3) shape is realized and every
        // window lands on its own leaf.
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
        const compiled = buildDwindleBlueprint(3);
        assert.equal(compiled.ok, true);
        if (compiled.ok) {
            assertDwindleShape(v, compiled.value, 0);
        }
        assert.ok(aWin.tile !== null);
        assert.ok(bWin.tile !== null);
        assert.ok(cWin.tile !== null);
        assert.notEqual(aWin.tile, bWin.tile);
        assert.notEqual(aWin.tile, cWin.tile);
        assert.notEqual(bWin.tile, cWin.tile);
        assert.equal(harness.scheduled.length, 0);
    });

    it("inserts a fourth window at the right-spine leaf of an owned non-canonical tree without reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const a = tile({ x: 0, y: 0, width: 100, height: 100 });
        const v = tile({ x: 100, y: 0, width: 100, height: 100 }, true);
        v.layoutDirection = 2;
        const b = tile({ x: 100, y: 0, width: 100, height: 50 });
        const h = tile({ x: 100, y: 50, width: 100, height: 50 }, true);
        const c = tile({ x: 100, y: 50, width: 100, height: 25 });
        const d = tile({ x: 100, y: 75, width: 100, height: 25 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        const cWin = window({ tile: c, caption: "c" });
        const dWin = window({ tile: d, caption: "d" });
        a.windows = [aWin];
        b.windows = [bWin];
        c.windows = [cWin];
        d.windows = [dWin];
        root.tiles = [a, v];
        v.tiles = [b, h];
        h.tiles = [c, d];
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin, cWin, dWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        attachTileWriter(cWin);
        attachTileWriter(dWin);
        let removes = 0;
        a.remove = () => {
            removes += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== a);
            if ((root.tiles as TestTile[]).length === 1) {
                const sole = (root.tiles as TestTile[])[0];
                if (sole !== undefined) {
                    harness.root = sole;
                }
            }
            return true;
        };
        installDwindleSplitter(d);
        const controller = new TileController(harness.environment());
        controller.start();

        // The persisted canonical dwindle(4) chain H[a, V[b, H[c, d]]] is
        // adopted unchanged with no structural call.
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);

        // Removing the first-chain window `a` promotes the root to its sole
        // child, leaving the owned non-canonical vertical-root tree V[b, H[c, d]]
        // with an intact bijection (three leaves, three owned windows). The
        // steady-state invariant accepts it instead of reconstructing.
        aWin.tile = a;
        a.windows = [aWin];
        harness.windows = [bWin, cWin, dWin];
        harness.emitRemoved(aWin);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(harness.yields.length, 1);
        a.windows = [];
        aWin.tile = null;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(removes, 1);
        assert.equal(harness.root, v);
        assert.equal(v.layoutDirection, 2);

        // A fourth window arrives into the owned non-canonical tree. The
        // insertion target is the deepest right-spine leaf `d` at depth two
        // (horizontal orientation), reached without depending on a canonical
        // root: `d` splits horizontally and the incoming window lands on its
        // second child, with the prior occupant on the first.
        const incoming = window();
        harness.windows = [bWin, cWin, dWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(countEvent(harness.logs, "ownership-accepted:non-canonical:bijection-intact"), 2);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.root, v);
        assert.equal(d.isLayout, true);
        assert.equal(d.layoutDirection, 1);
        const dChildren = d.tiles as TestTile[];
        assert.equal(dChildren.length, 2);
        assert.equal(dWin.tile, dChildren[0]);
        assert.equal(incoming.tile, dChildren[1]);
        const occupied = [bWin.tile, cWin.tile, dWin.tile, incoming.tile];
        for (const entry of occupied) {
            assert.notEqual(entry, null);
        }
        assert.equal(new Set(occupied).size, 4);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });
});
