import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TileController } from "../src/controller";
import { buildDwindleBlueprint } from "../src/layout-blueprint";
import {
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
    invokeShortcut,
    presetSetup,
} from "./controller-fixture-scenarios";

describe("TileController automatic dwindle ownership removals and capacity recovery", () => {
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

});
