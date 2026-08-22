import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { type CurrentScope } from "../src/controller";
import {
    DESKTOP,
    OUTPUT,
    RECT,
    tile,
    window,
} from "./controller-fixtures";
import {
    configureThreeOccupantPreset,
    countEvent,
    currentScopeFor,
    invokeShortcut,
    presetSetup,
} from "./controller-fixture-scenarios";

describe("TileController selected overlay state", () => {
    it("records the selected overlay only after every occupant assignment succeeds", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");

        const overlay = state.controller.readSelectedOverlay(currentScopeFor(state.active));
        assert.ok(overlay !== null);
        assert.equal(overlay.preset, "dwindle");
        assert.equal(overlay.root, state.source);
        assert.deepEqual(overlay.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(overlay.scope.scope.output, OUTPUT);
        assert.equal(overlay.scope.scope.desktopId, "desktop-1");
        assert.equal(countEvent(state.harness.logs, "preset-applied:dwindle"), 1);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("records a singleton preset without splitting and without geometry", () => {
        const state = presetSetup();
        state.root.tiles = [state.source];
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const overlay = state.controller.readSelectedOverlay(currentScopeFor(state.active));
        assert.ok(overlay !== null);
        assert.equal(overlay.root, state.source);
        assert.deepEqual(overlay.leaves, [state.source]);
        for (const entry of state.harness.logs) {
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("creates no overlay state on precondition, split, or assignment failure", () => {
        const cases: ReadonlyArray<{
            readonly configure: (state: ReturnType<typeof presetSetup>) => void;
            readonly expected: string;
        }> = [
            {
                configure: (state) => {
                    state.harness.active = null;
                },
                expected: "preset-rejected:no-active-window",
            },
            {
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
                expected: "preset-rejected:desktop-output-scope",
            },
            {
                configure: (state) => {
                    state.active.resizeable = false;
                },
                expected: "preset-rejected:active-window-eligibility",
            },
            {
                configure: (state) => {
                    state.late.windows = [state.active];
                },
                expected: "preset-rejected:occupancy-validity",
            },
            {
                configure: (state) => {
                    state.source.split = () => {
                        state.source.isLayout = true;
                        return [null, null];
                    };
                },
                expected: "preset-failed:split-mutation-possible",
            },
            {
                configure: (state) => {
                    const realized = configureThreeOccupantPreset(state);
                    realized.middle.manage = () => {
                        throw new Error("private-window-title");
                    };
                },
                expected: "preset-failed:assignment-failed:later",
            },
        ];
        for (const testCase of cases) {
            const state = presetSetup();
            const scope = currentScopeFor(state.active);
            testCase.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
            assert.equal(state.controller.readSelectedOverlay(scope), null);
            assert.equal(countEvent(state.harness.logs, testCase.expected), 1);
            assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
            for (const entry of state.harness.logs) {
                assert.equal(entry.includes("private-window-title"), false);
                assert.equal(entry.includes("screen-1"), false);
                assert.equal(entry.includes("desktop-1"), false);
            }
        }
    });

    it("preserves an existing same-scope overlay when a later application fails before mutating", () => {
        const cases: ReadonlyArray<{
            readonly name: string;
            readonly configure: (state: ReturnType<typeof presetSetup>) => void;
            readonly expected: string;
        }> = [
            {
                name: "precondition",
                configure: (state) => {
                    state.harness.active = null;
                },
                expected: "preset-rejected:no-active-window",
            },
            {
                name: "scope drift",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
                expected: "preset-rejected:desktop-output-scope",
            },
            {
                name: "occupancy drift",
                configure: (state) => {
                    state.late.windows = [state.active];
                },
                expected: "preset-rejected:occupancy-validity",
            },
        ];
        for (const testCase of cases) {
            const state = presetSetup();
            configureThreeOccupantPreset(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
            const scope = currentScopeFor(state.active);
            const before = state.controller.readSelectedOverlay(scope);
            assert.ok(before !== null);
            testCase.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
            assert.equal(countEvent(state.harness.logs, testCase.expected), 1);
            const after = state.controller.readSelectedOverlay(scope);
            assert.ok(after !== null);
            assert.equal(after.root, before.root);
            assert.deepEqual(after.leaves, before.leaves);
            assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        }
    });

    it("discards an existing overlay only when a mutating failure breaks its structure, never replacing it", () => {
        const split = presetSetup();
        const first = configureThreeOccupantPreset(split);
        invokeShortcut(split.harness, "plasma-auto-tiler-apply-columns");
        const splitScope = currentScopeFor(split.active);
        assert.ok(split.controller.readSelectedOverlay(splitScope) !== null);
        first.left.split = () => {
            first.left.isLayout = true;
            return [null, null];
        };
        invokeShortcut(split.harness, "plasma-auto-tiler-apply-columns");
        assert.equal(countEvent(split.harness.logs, "preset-failed:split-mutation-possible"), 1);
        assert.equal(split.controller.readSelectedOverlay(splitScope), null);
        assert.equal(countEvent(split.harness.logs, "selected-overlay-invalidated"), 1);

        const assign = presetSetup();
        const firstAssign = configureThreeOccupantPreset(assign);
        invokeShortcut(assign.harness, "plasma-auto-tiler-apply-columns");
        const assignScope = currentScopeFor(assign.active);
        assert.ok(assign.controller.readSelectedOverlay(assignScope) !== null);
        const failLeft = tile({ x: 0, y: 0, width: 33, height: 100 });
        const failBranch = tile({ x: 33, y: 0, width: 67, height: 100 });
        const failLeaf = tile({ x: 33, y: 0, width: 33, height: 100 });
        const failFarLeaf = tile({ x: 66, y: 0, width: 34, height: 100 });
        failLeft.manage = () => true;
        failBranch.split = () => {
            failBranch.isLayout = true;
            failBranch.tiles = [failLeaf, failFarLeaf];
            return [failLeaf, failFarLeaf];
        };
        failLeaf.manage = () => false;
        firstAssign.left.split = () => {
            firstAssign.left.isLayout = true;
            firstAssign.left.windows = [];
            firstAssign.left.tiles = [failLeft, failBranch];
            return [failLeft, failBranch];
        };
        invokeShortcut(assign.harness, "plasma-auto-tiler-apply-rows");
        assert.equal(countEvent(assign.harness.logs, "preset-failed:assignment-failed:later"), 1);
        assert.equal(assign.controller.readSelectedOverlay(assignScope), null);
        assert.equal(countEvent(assign.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("atomically replaces the same-scope overlay when a later preset succeeds", () => {
        const state = presetSetup();
        const first = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const firstOverlay = state.controller.readSelectedOverlay(scope);
        assert.ok(firstOverlay !== null);
        assert.equal(firstOverlay.root, state.source);

        const second = configureThreeOccupantPreset(state, first.left);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-balanced-grid");

        const replaced = state.controller.readSelectedOverlay(scope);
        assert.ok(replaced !== null);
        assert.notEqual(replaced.root, firstOverlay.root);
        assert.equal(replaced.root, first.left);
        assert.equal(replaced.preset, "balanced-grid");
        assert.deepEqual(replaced.leaves, [second.left, second.middle, second.right]);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("keeps overlays independent across exact desktop scopes", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope1 = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope1) !== null);

        const desktop2 = { id: "desktop-2" };
        const root2 = tile(RECT, true);
        const source2 = tile();
        const active2 = window({ tile: source2, desktops: [desktop2] });
        source2.windows = [active2];
        root2.tiles = [source2];
        state.harness.rootsByDesktop.set("desktop-2", root2);
        state.harness.currentDesktop = desktop2;
        state.harness.active = active2;
        state.harness.windows = [active2];

        invokeShortcut(state.harness, "plasma-auto-tiler-apply-rows");

        const firstOverlay = state.controller.readSelectedOverlay(scope1);
        const secondOverlay = state.controller.readSelectedOverlay({
            output: OUTPUT,
            desktop: desktop2,
            scope: { output: OUTPUT, desktopId: desktop2.id },
        });
        assert.ok(firstOverlay !== null);
        assert.ok(secondOverlay !== null);
        assert.equal(firstOverlay.preset, "columns");
        assert.equal(firstOverlay.root, state.source);
        assert.equal(secondOverlay.preset, "rows");
        assert.equal(secondOverlay.root, source2);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("does not return or discard the overlay for a different exact scope", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);

        const otherOutput = { ...OUTPUT, name: "screen-2" };
        const otherScope: CurrentScope = {
            output: otherOutput,
            desktop: DESKTOP,
            scope: { output: otherOutput, desktopId: DESKTOP.id },
        };
        assert.equal(state.controller.readSelectedOverlay(otherScope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);
    });

    it("returns the recorded overlay through the read seam on a healthy topology", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);

        const first = state.controller.readSelectedOverlay(scope);
        const second = state.controller.readSelectedOverlay(scope);
        assert.ok(first !== null);
        assert.ok(second !== null);
        assert.equal(first.preset, "columns");
        assert.equal(first.root, state.source);
        assert.deepEqual(first.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(second, first);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("discards inertly with one fixed diagnostic when the workspace root no longer yields the overlay", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");
        const scope = currentScopeFor(state.active);
        const overlay = state.controller.readSelectedOverlay(scope);
        assert.ok(overlay !== null);
        assert.equal(overlay.preset, "dwindle");

        state.harness.root = null;
        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);

        // The stale entry is gone; a further read stays inert without another diagnostic.
        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("discards when the current workspace root is not a Custom Tile", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const { layoutDirection: _layoutDirection, split: _split, ...nonCustomRoot } = tile(RECT, true);
        state.harness.root = nonCustomRoot;

        assert.equal(state.controller.readSelectedOverlay(scope), null);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("discards when the overlay root leaves, its topology drifts, or leaf order changes", () => {
        const removed = presetSetup();
        const first = configureThreeOccupantPreset(removed);
        invokeShortcut(removed.harness, "plasma-auto-tiler-apply-columns");
        const removedScope = currentScopeFor(removed.active);
        removed.source.tiles = [first.left];
        assert.equal(removed.controller.readSelectedOverlay(removedScope), null);
        assert.equal(countEvent(removed.harness.logs, "selected-overlay-invalidated"), 1);

        const unreachable = presetSetup();
        const second = configureThreeOccupantPreset(unreachable);
        invokeShortcut(unreachable.harness, "plasma-auto-tiler-apply-columns");
        const unreachableScope = currentScopeFor(unreachable.active);
        unreachable.root.tiles = [second.left];
        assert.equal(unreachable.controller.readSelectedOverlay(unreachableScope), null);
        assert.equal(countEvent(unreachable.harness.logs, "selected-overlay-invalidated"), 1);

        const reordered = presetSetup();
        const third = configureThreeOccupantPreset(reordered);
        invokeShortcut(reordered.harness, "plasma-auto-tiler-apply-columns");
        const reorderedScope = currentScopeFor(reordered.active);
        // Leaf order is derived from relativeGeometry, not raw `tiles[]` array
        // position, so a genuine order change is a geometry swap: left and
        // branch trade places along the split axis.
        const leftGeometry = third.left.relativeGeometry;
        third.left.relativeGeometry = third.branch.relativeGeometry;
        third.branch.relativeGeometry = leftGeometry;
        assert.equal(reordered.controller.readSelectedOverlay(reorderedScope), null);
        assert.equal(countEvent(reordered.harness.logs, "selected-overlay-invalidated"), 1);
    });

    it("preserves structurally valid overlay state when windows are removed or vacate leaves", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        state.harness.emitRemoved(state.active);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        realized.middle.windows = [];
        realized.right.windows = [];
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);
        assert.equal(state.controller.isEnabled, true);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("stays valid when a branch reports its children reversed in tiles[] relative to geometry", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const before = state.controller.readSelectedOverlay(scope);
        assert.ok(before !== null);
        assert.deepEqual(before.leaves, [realized.left, realized.middle, realized.right]);

        // Simulate the tree being re-observed with `tiles[]` array order
        // inverted at both levels while `relativeGeometry` (and thus the
        // canonical leaf order) is unchanged: raw array index no longer
        // matches geometric order, but the overlay's recorded leaves were
        // geometry-ordered at recording time, so re-reading must still find
        // them.
        state.source.tiles = [realized.branch, realized.left];
        realized.branch.tiles = [realized.right, realized.middle];

        const after = state.controller.readSelectedOverlay(scope);
        assert.ok(after !== null);
        assert.deepEqual(after.leaves, [realized.left, realized.middle, realized.right]);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
    });

    it("never assigns occupants while reading or validating overlay state", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const managedBefore = realized.managed.length;
        assert.ok(managedBefore > 0);

        assert.ok(state.controller.readSelectedOverlay(scope) !== null);
        assert.ok(state.controller.readSelectedOverlay(scope) !== null);

        // An invalidating read must also stay assignment-free.
        state.harness.root = null;
        assert.equal(state.controller.readSelectedOverlay(scope), null);

        assert.equal(realized.managed.length, managedBefore);
    });
});
