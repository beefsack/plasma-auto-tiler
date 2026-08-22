import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, TileController } from "../src/controller";
import {
    Harness,
    RECT,
    tile,
    type TestTile,
    window,
} from "./controller-fixtures";
import { attachTileWriter, countEvent, installDwindleSplitter, makeTile } from "./controller-fixture-scenarios";

// Install a splitter that mirrors KWin's `CustomTile::split()` inline mutation
// under the minimum-geometry boundary. Unlike `installCapacityRejectingSplitter`
// (which returns an invalid pair without realizing the split), this splitter
// realizes the split in the live tree *before* the controller can validate the
// returned children: while `state.rejecting` is true it turns the tile into a
// layout whose first child carries zero extent on the split axis (KWin's
// below-minimum empty child). A controller that splits before preflighting
// therefore leaves the tree mutated even though `orderCustomTilesByAxis` then
// rejects the pair.
function installInlineMutatingRejectingSplitter(tile: TestTile, state: { rejecting: boolean }): void {
    tile.split = (direction) => {
        const horizontal = direction === 1;
        const validA = makeTile(
            horizontal ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 100, height: 50 },
        );
        const validB = makeTile(
            horizontal ? { x: 50, y: 0, width: 50, height: 100 } : { x: 0, y: 50, width: 100, height: 50 },
        );
        tile.isLayout = true;
        tile.layoutDirection = direction;
        tile.windows = [];
        if (state.rejecting) {
            const empty = makeTile(
                horizontal ? { x: 0, y: 0, width: 0, height: 100 } : { x: 0, y: 0, width: 100, height: 0 },
            );
            installDwindleSplitter(empty);
            installDwindleSplitter(validB);
            tile.tiles = [empty, validB];
            return [empty, validB];
        }
        installDwindleSplitter(validA);
        installDwindleSplitter(validB);
        tile.tiles = [validA, validB];
        return [validA, validB];
    };
}

// Structural shape check: the live tree must realize the dwindle blueprint
// exactly, with the first decoded child as the blueprint's left subtree and
// the second as its right subtree, and orientation alternating from a
// horizontal root at depth zero.
describe("TileController automatic dwindle insertion preflight", () => {
    it("refuses an undersized automatic insertion before splitting, leaving the tree unmutated and the newcomer floating", () => {
        const harness = new Harness();
        // A dwindle(1) scope whose single leaf (20px wide in a 100px working
        // area) halves to 10px on a horizontal split, below the 15% working
        // width floor (15px), so the intended insertion is genuinely undersized.
        const root = tile({ x: 0, y: 0, width: 20, height: 100 });
        const first = window({ tile: root });
        root.windows = [first];
        const seam = { rejecting: true };
        installInlineMutatingRejectingSplitter(root, seam);
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

        // The intended leaf must be preflighted before any split, so a refused
        // insertion mutates nothing. Pre-change the split ran first and realized
        // an empty child inline, so the tree below is a layout holding a
        // zero-width leaf and this first assertion fails.
        assert.equal(root.isLayout, false, "the intended leaf must not be split before the refusal");
        assert.deepEqual(root.tiles, []);
        assert.deepEqual(root.windows, [first]);
        assert.equal(first.tile, root);
        // Only the newcomer stays floating: no gap, no inert scope.
        assert.equal(second.tile, null, "the impossible newcomer stays floating");
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        // The refusal must not rely on a failed split plus reconstruction
        // recovery, so no reconstruction is armed and no yield is queued.
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("still splits the insertion when the working area is unreadable instead of inventing a floor", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 20, height: 100 });
        const first = window({ tile: root });
        root.windows = [first];
        installDwindleSplitter(root);
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        // No readable working area: the preflight must not invent a minimum
        // floor, so the insertion proceeds exactly as before the change.
        harness.clientArea = null;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const second = window();
        harness.windows = [first, second];
        attachTileWriter(second);
        harness.emitAdded(second);

        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(root.isLayout, true);
        const children = root.tiles as TestTile[];
        assert.equal(children.length, 2);
        assert.equal(first.tile, children[0]);
        assert.equal(second.tile, children[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("falls back to the closest eligible leaf when the intended right-spine leaf is undersized", () => {
        const harness = new Harness();
        // A dwindle(2) scope H[a, b] whose right-spine leaf `b` (50x20) is too
        // short to split vertically (20/2 = 10 < 15% of the 100px working
        // height), while `a` (50x100) is eligible. The insertion falls back to
        // splitting `a` under its own depth-one (vertical) orientation.
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 20 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The undersized intended leaf `b` is untouched; the eligible `a` is
        // split vertically and receives the newcomer on its second child.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(b.isLayout, false);
        assert.deepEqual(b.tiles, []);
        assert.equal(bWin.tile, b);
        assert.equal(a.isLayout, true);
        assert.equal(a.layoutDirection, 2);
        const aChildren = a.tiles as TestTile[];
        assert.equal(aChildren.length, 2);
        assert.equal(aWin.tile, aChildren[0]);
        assert.equal(incoming.tile, aChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("resolves an equal-distance fallback tie to the earlier compareLeaves leaf", () => {
        const harness = new Harness();
        // A dwindle(3) tree H[V[A1, A2], M] whose right-spine leaf `M` (50x20,
        // depth one, vertical) is undersized. In compareLeaves order the leaves
        // are A1 (x:0,y:0), M (x:50,y:0), A2 (x:0,y:50): M sits at the middle index, so A1
        // and A2 are both one index away. Both are eligible (depth two,
        // horizontal, 50px wide), so the earlier A1 wins the tie.
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, true);
        left.layoutDirection = 2;
        const a1 = tile({ x: 0, y: 0, width: 50, height: 50 });
        const a2 = tile({ x: 0, y: 50, width: 50, height: 50 });
        const m = tile({ x: 50, y: 0, width: 50, height: 20 });
        const a1Win = window({ tile: a1, caption: "a1" });
        const a2Win = window({ tile: a2, caption: "a2" });
        const mWin = window({ tile: m, caption: "m" });
        a1.windows = [a1Win];
        a2.windows = [a2Win];
        m.windows = [mWin];
        left.tiles = [a1, a2];
        root.tiles = [left, m];
        installDwindleSplitter(a1);
        installDwindleSplitter(a2);
        installDwindleSplitter(m);
        harness.root = root;
        harness.active = a1Win;
        harness.windows = [a1Win, a2Win, mWin];
        attachTileWriter(a1Win);
        attachTileWriter(a2Win);
        attachTileWriter(mWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [a1Win, a2Win, mWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The earlier compareLeaves candidate A1 wins the equal-distance tie;
        // M and A2 are untouched.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(m.isLayout, false);
        assert.equal(a2.isLayout, false);
        assert.equal(mWin.tile, m);
        assert.equal(a2Win.tile, a2);
        assert.equal(a1.isLayout, true);
        assert.equal(a1.layoutDirection, 1);
        const a1Children = a1.tiles as TestTile[];
        assert.equal(a1Children.length, 2);
        assert.equal(a1Win.tile, a1Children[0]);
        assert.equal(incoming.tile, a1Children[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });
});

describe("TileController automatic split target insertion", () => {
    it("keeps the default dwindle split on the deepest-right-spine leaf even when another leaf is larger", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // Absent `automaticSplitTarget` keeps the dwindle intent: the larger
        // leaf `a` is not chosen, and the deepest-right-spine `b` is split.
        assert.equal(controller.automaticSplitTargetSnapshot(), "dwindle");
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(a.isLayout, false);
        assert.equal(aWin.tile, a);
        assert.equal(b.isLayout, true);
        const bChildren = b.tiles as TestTile[];
        assert.equal(bChildren.length, 2);
        assert.equal(bWin.tile, bChildren[0]);
        assert.equal(incoming.tile, bChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("largest splits the greatest-area occupied leaf instead of the deepest-right-spine leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "largest");
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // `largest` selects the greater-area occupied leaf `a` over the
        // deepest-right-spine `b`, and `b` is untouched.
        assert.equal(controller.automaticSplitTargetSnapshot(), "largest");
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(b.isLayout, false);
        assert.equal(bWin.tile, b);
        assert.equal(a.isLayout, true);
        const aChildren = a.tiles as TestTile[];
        assert.equal(aChildren.length, 2);
        assert.equal(aWin.tile, aChildren[0]);
        assert.equal(incoming.tile, aChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("active splits the active in-scope occupied leaf over the deepest-right-spine leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "active");
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // `active` selects the active occupied leaf `a`; the deepest `b` stays
        // untouched.
        assert.equal(controller.automaticSplitTargetSnapshot(), "active");
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(b.isLayout, false);
        assert.equal(bWin.tile, b);
        assert.equal(a.isLayout, true);
        const aChildren = a.tiles as TestTile[];
        assert.equal(aChildren.length, 2);
        assert.equal(aWin.tile, aChildren[0]);
        assert.equal(incoming.tile, aChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("active falls back to the dwindle deepest-right-spine leaf when the active window is floating", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "active");
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const a = tile({ x: 0, y: 0, width: 50, height: 100 });
        const b = tile({ x: 50, y: 0, width: 50, height: 50 });
        const aWin = window({ tile: a, caption: "a" });
        const bWin = window({ tile: b, caption: "b" });
        a.windows = [aWin];
        b.windows = [bWin];
        root.tiles = [a, b];
        installDwindleSplitter(a);
        installDwindleSplitter(b);
        harness.root = root;
        harness.active = aWin;
        harness.windows = [aWin, bWin];
        attachTileWriter(aWin);
        attachTileWriter(bWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [aWin, bWin, incoming];
        harness.active = incoming;
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The active window is the incoming floating window (no leaf): the
        // `active` intent falls back to the dwindle deepest-right-spine `b`.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(a.isLayout, false);
        assert.equal(aWin.tile, a);
        assert.equal(b.isLayout, true);
        const bChildren = b.tiles as TestTile[];
        assert.equal(bChildren.length, 2);
        assert.equal(bWin.tile, bChildren[0]);
        assert.equal(incoming.tile, bChildren[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("applies the nearest-splittable fallback relative to the selected active leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "active");
        // H[V[A1, A2], M]: the active leaf A1 (20x100) is undersized for its
        // depth-two horizontal split (10 < 15px floor), while A2 and M are
        // splittable. The dwindle deepest-right-spine leaf is M, so this
        // proves the fallback resolves from the selected A1 intent, not the
        // dwindle intent.
        const root = tile(RECT, true);
        root.layoutDirection = 1;
        const left = tile({ x: 0, y: 0, width: 50, height: 100 }, true);
        left.layoutDirection = 2;
        const a1 = tile({ x: 0, y: 0, width: 20, height: 100 });
        const a2 = tile({ x: 20, y: 0, width: 30, height: 100 });
        const m = tile({ x: 50, y: 0, width: 50, height: 100 });
        const a1Win = window({ tile: a1, caption: "a1" });
        const a2Win = window({ tile: a2, caption: "a2" });
        const mWin = window({ tile: m, caption: "m" });
        a1.windows = [a1Win];
        a2.windows = [a2Win];
        m.windows = [mWin];
        left.tiles = [a1, a2];
        root.tiles = [left, m];
        installDwindleSplitter(a1);
        installDwindleSplitter(a2);
        installDwindleSplitter(m);
        harness.root = root;
        harness.active = a1Win;
        harness.windows = [a1Win, a2Win, mWin];
        attachTileWriter(a1Win);
        attachTileWriter(a2Win);
        attachTileWriter(mWin);
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        const incoming = window();
        harness.windows = [a1Win, a2Win, mWin, incoming];
        attachTileWriter(incoming);
        harness.emitAdded(incoming);

        // The selected active leaf A1 is not split (undersized), the dwindle
        // deepest M is not split, and the eligible leaf nearest to A1 by
        // stable compareLeaves ordinal (A2) receives the split.
        assert.equal(countEvent(harness.logs, "ownership-add-split"), 1);
        assert.equal(a1.isLayout, false);
        assert.equal(a1Win.tile, a1);
        assert.equal(m.isLayout, false);
        assert.equal(mWin.tile, m);
        assert.equal(a2.isLayout, true);
        assert.equal(a2.layoutDirection, 1);
        const a2Children = a2.tiles as TestTile[];
        assert.equal(a2Children.length, 2);
        assert.equal(a2Win.tile, a2Children[0]);
        assert.equal(incoming.tile, a2Children[1]);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(harness.yields.length, 0);
    });

    it("floats the newcomer without topology mutation when largest has no occupied leaf", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "largest");
        const root = tile(RECT, true);
        const leaf = tile({ x: 0, y: 0, width: 50, height: 100 });
        const first = window({ tile: leaf });
        leaf.windows = [first];
        root.tiles = [leaf];
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        let removes = 0;
        leaf.remove = () => {
            removes += 1;
            root.tiles = [];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        // Collapse the owned scope down to N=0 (an empty zero-child layout
        // root), matching the removal path of the established N=0 tests.
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

        // `largest` yields no eligible occupied intended leaf on the empty
        // scope: the newcomer floats and the tree stays untouched.
        const incoming = window();
        harness.windows = [incoming];
        harness.active = incoming;
        attachTileWriter(incoming);
        harness.emitAdded(incoming);
        assert.equal(countEvent(harness.logs, "ownership-add-refused:no-eligible-leaf"), 1);
        assert.equal(incoming.tile, null);
        assert.deepEqual(root.tiles, []);
        assert.deepEqual(root.windows, []);
        assert.equal(harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:ownership-inert:")), false);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(harness.scheduled.length, 0);
    });
});
