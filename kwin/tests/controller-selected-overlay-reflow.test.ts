import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { type CurrentScope } from "../src/controller";
import {
    OUTPUT,
    RECT,
    type TestTile,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";
import {
    attachTileWriter,
    configureThreeOccupantPreset,
    countEvent,
    currentScopeFor,
    invokeShortcut,
    presetSetup,
} from "./controller-fixture-scenarios";

describe("TileController selected overlay reflow", () => {
    it("compacts occupants into ordinal leaves after a removal leaves a hole", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");
        const scope = currentScopeFor(state.active);
        const overlay = state.controller.readSelectedOverlay(scope);
        assert.ok(overlay !== null);
        assert.equal(overlay.preset, "dwindle");

        // After the preset, ordinal leaves hold [active, lateWindow, earlyWindow].
        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(state.active.tile, realized.left);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        assert.equal(state.controller.isEnabled, true);
    });

    it("never reassigns a window that still lingers in its leaf when removal is processed", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // Worst-case removal timing: the removed window is still listed in its
        // leaf's window array, so only the identity guard prevents reassignment.
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(state.active.tile, realized.left);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
    });

    it("compacts the overlay after a successful detach without retiling the detached window", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        invokeShortcut(state.harness, "plasma-auto-tiler-detach");

        assert.equal(state.active.tile, null);
        assert.equal(state.lateWindow.tile, realized.left);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(countEvent(state.harness.logs, "detach-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
        assert.ok(
            state.harness.logs.indexOf("plasma-auto-tiler:detach-completed") <
                state.harness.logs.indexOf("plasma-auto-tiler:reflow-completed"),
        );
        for (const entry of state.harness.logs) {
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("does not reflow a selected overlay when detaching a same-scope external window", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const external = window({ tile: state.early });
        state.early.windows = [external];
        state.harness.active = external;
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");

        assert.equal(external.tile, null);
        assert.equal(countEvent(state.harness.logs, "detach-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("adds an eligible new window into the first trailing leaf only when capacity exists", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        attachTileWriter(state.active);
        attachTileWriter(state.lateWindow);
        attachTileWriter(state.earlyWindow);

        // Removal + compaction leaves the trailing leaf empty.
        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);
        assert.equal(state.earlyWindow.tile, realized.middle);

        const incoming = window();
        state.harness.emitAdded(incoming);

        assert.equal(incoming.tile, realized.right);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 2);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 0);
    });

    it("falls through to generic automatic placement when the selected overlay is full", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const managed: unknown[] = [];
        state.early.manage = (value) => {
            managed.push(value);
            return true;
        };
        const incoming = window();
        state.harness.emitAdded(incoming);

        assert.equal(countEvent(state.harness.logs, "reflow-no-capacity"), 1);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 1);
        assert.deepEqual(managed, [incoming]);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("rejects ineligible and out-of-scope additions without touching the overlay", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const before = state.controller.readSelectedOverlay(scope);
        assert.ok(before !== null);

        state.harness.emitAdded(window({ resizeable: false }));
        state.harness.emitAdded(window({ output: null }));

        assert.equal(countEvent(state.harness.logs, "window-added-rejected:not-resizeable"), 1);
        assert.equal(countEvent(state.harness.logs, "window-added-rejected:scope-unavailable"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(countEvent(state.harness.logs, "reflow-rejected:candidate-eligibility"), 0);
        const after = state.controller.readSelectedOverlay(scope);
        assert.ok(after !== null);
        assert.equal(after.root, before.root);
        assert.deepEqual(after.leaves, [realized.left, realized.middle, realized.right]);
    });

    it("does not pull a window already tiled outside the overlay into the overlay", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const external = tile({ x: 400, y: 0, width: 100, height: 100 });
        state.root.tiles = [...(state.root.tiles as TestTile[]), external];
        const tiledElsewhere = window({ tile: external });
        external.windows = [tiledElsewhere];
        state.harness.emitAdded(tiledElsewhere);

        assert.equal(countEvent(state.harness.logs, "reflow-rejected:candidate-eligibility"), 1);
        assert.equal(tiledElsewhere.tile, external);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 0);
    });

    it("discards a structurally drifted overlay without writing when a removal triggers reflow", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);

        state.harness.root = tile(RECT, true);
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-rejected:assignment-stale"), 0);
        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("is a no-op when the overlay is already compact and correct", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // A removal outside the overlay on the same scope reflows the overlay
        // but finds nothing to write.
        state.harness.emitRemoved(window());

        assert.equal(countEvent(state.harness.logs, "reflow-noop"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("aborts before any write when preflight validation fails", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // The same window occupying two leaves is an inconsistent overlay.
        realized.middle.windows = [state.active];
        state.harness.emitRemoved(state.earlyWindow);

        assert.equal(countEvent(state.harness.logs, "reflow-rejected:occupancy-validity"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.active.tile, realized.left);
        assert.equal(state.lateWindow.tile, realized.middle);
        assert.equal(state.earlyWindow.tile, realized.right);
    });

    it("stops fail-fast after a partial write without claiming rollback", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // Removing the first occupant needs two writes (late -> left, early -> middle).
        // The second write must fail.
        Object.defineProperty(state.earlyWindow, "tile", {
            configurable: true,
            value: realized.right,
            writable: false,
        });
        realized.left.windows = [];
        state.harness.emitRemoved(state.active);

        assert.equal(countEvent(state.harness.logs, "reflow-partial:assignment-failed"), 1);
        assert.equal(state.lateWindow.tile, realized.left);
        assert.equal(state.earlyWindow.tile, realized.right);
        assert.equal(state.controller.isEnabled, true);
    });

    it("rejects when topology changes between planning and the first write", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        let reads = 0;
        const decoy = tile(RECT, true);
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                reads += 1;
                // The reflow planning revalidates the overlay once (read one),
                // then the per-write revalidation re-reads it (read two) and
                // sees the decoy, so the first write rejects.
                return reads <= 1 ? state.root : decoy;
            },
        });

        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-rejected:assignment-stale"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(state.earlyWindow.tile, realized.right);
        assert.equal(state.controller.isEnabled, true);
    });

    it("writes in deterministic ordinal order", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.lateWindow, writes);
        attachTileWriter(state.earlyWindow, writes);

        realized.left.windows = [];
        state.harness.emitRemoved(state.active);

        assert.deepEqual(writes, [
            { window: state.lateWindow, target: realized.left },
            { window: state.earlyWindow, target: realized.middle },
        ]);
    });

    it("retains the current ordinal traversal after a manual move on the next reflow", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        // Manual directional moves swap the order without an immediate reflow.
        state.lateWindow.tile = realized.left;
        realized.left.windows = [state.lateWindow];
        state.active.tile = realized.right;
        realized.right.windows = [state.active];

        // The next lifecycle reflow compacts the moved traversal (late first),
        // not the preset's original active-first order.
        realized.middle.windows = [];
        state.harness.emitRemoved(state.earlyWindow);

        assert.equal(state.active.tile, realized.middle);
        assert.equal(state.lateWindow.tile, realized.left);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
    });

    it("reflows only the affected scope when multiple scopes have selected overlays", () => {
        const first = presetSetup();
        const realized = configureThreeOccupantPreset(first);
        invokeShortcut(first.harness, "plasma-auto-tiler-apply-columns");
        const firstScope = currentScopeFor(first.active);

        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        const source2 = tile();
        const active2 = window({ tile: source2, desktops: [desktop2] });
        source2.windows = [active2];
        root2.tiles = [source2];
        first.harness.rootsByDesktop.set("desktop-2", root2);
        first.harness.currentDesktop = desktop2;
        first.harness.active = active2;
        first.harness.windows = [active2];
        invokeShortcut(first.harness, "plasma-auto-tiler-apply-columns");
        const secondScope: CurrentScope = {
            output: OUTPUT,
            desktop: desktop2,
            scope: { output: OUTPUT, desktopId: desktop2.id },
        };
        assert.ok(first.controller.readSelectedOverlay(secondScope) !== null);

        first.harness.emitRemoved(active2);

        // Only the removed window's scope reflows (no-op); scope 1 is untouched.
        assert.equal(countEvent(first.harness.logs, "reflow-noop"), 1);
        assert.equal(countEvent(first.harness.logs, "reflow-completed"), 0);
        const overlay1 = first.controller.readSelectedOverlay(firstScope);
        assert.ok(overlay1 !== null);
        assert.equal(overlay1.root, first.source);
        assert.deepEqual(overlay1.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(first.active.tile, realized.left);
        assert.equal(first.lateWindow.tile, realized.middle);
        assert.equal(first.earlyWindow.tile, realized.right);
    });

    it("does not reflow an unrelated scope when a removed wrapper loses its scope", () => {
        const first = presetSetup();
        const realized = configureThreeOccupantPreset(first);
        invokeShortcut(first.harness, "plasma-auto-tiler-apply-columns");

        const detachedScopeWindow = window({ output: null });
        first.harness.emitRemoved(detachedScopeWindow);

        assert.equal(countEvent(first.harness.logs, "reflow-noop"), 0);
        assert.equal(countEvent(first.harness.logs, "reflow-completed"), 0);
        assert.equal(first.active.tile, realized.left);
        assert.equal(first.lateWindow.tile, realized.middle);
        assert.equal(first.earlyWindow.tile, realized.right);
    });

    it("never calls structural tile operations during reflow", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        let structuralCalls = 0;
        for (const leaf of [realized.left, realized.middle, realized.right]) {
            leaf.split = () => {
                structuralCalls += 1;
                throw new Error("private-window-title");
            };
            leaf.unmanage = () => {
                structuralCalls += 1;
                return false;
            };
        }
        realized.left.manage = () => {
            structuralCalls += 1;
            return false;
        };

        realized.middle.windows = [];
        state.harness.emitRemoved(state.lateWindow);

        assert.equal(structuralCalls, 0);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 1);
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(state.controller.isEnabled, true);
        for (const entry of state.harness.logs) {
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });
});
