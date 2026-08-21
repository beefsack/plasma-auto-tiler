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
    countEvent,
    installDwindleSplitter,
    installStaleReturnSplitter,
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

});
