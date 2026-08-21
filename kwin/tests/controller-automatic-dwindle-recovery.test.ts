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
    countEvent,
    installCapacityRejectingSplitter,
    installDwindleSplitter,
} from "./controller-fixture-scenarios";

describe("TileController automatic dwindle ownership pending reconstruction and non-canonical ownership", () => {
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
