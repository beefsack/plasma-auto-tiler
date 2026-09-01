import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { type CurrentScope, type ManagedScope, TileController, WORKSPACE_MODE_CONFIG_KEY } from "../src/controller";
import { Harness, RECT, tile, type TestTile, type TestWindow, window } from "./controller-fixtures";
import {
    attachTileWriter,
    configureThreeOccupantPreset,
    countEvent,
    currentScopeFor,
    dragSetup,
    invokeShortcut,
    moveSetup,
    nativeDropSetup,
    presetSetup,
    setup,
    startDrag,
    swapSetup,
} from "./controller-fixture-scenarios";

type GroupOutlineController = {
    flashFocusedGroup(): void;
    showDropOutline(geometry: typeof RECT): void;
    hideDropOutline(): void;
};

function groupOutlineController(controller: TileController): GroupOutlineController {
    return controller as unknown as GroupOutlineController;
}

describe("TileController group outline", () => {
    it("flashes the focused leaf parent after automatic reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT);
        const first = window({ tile: root });
        const second = window({ tile: root });
        root.windows = [first, second];
        root.split = (direction) => {
            root.isLayout = true;
            root.layoutDirection = direction;
            root.windows = [];
            const left = tile({ x: 0, y: 0, width: 50, height: 100 });
            const right = tile({ x: 50, y: 0, width: 50, height: 100 });
            left.parent = root;
            right.parent = root;
            root.tiles = [left, right];
            return [left, right];
        };
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        attachTileWriter(first);
        attachTileWriter(second);

        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(harness.flushNextYield(), true);
        assert.equal(harness.flushNextYield(), true);

        assert.equal(harness.scheduled.length, 1);
        assert.deepEqual(harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        harness.fireScheduled(0);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("flashes once after an arrow move into an empty sibling", () => {
        const state = moveSetup("right");
        state.focusedTile.parent = state.root;
        state.target.parent = state.root;
        state.target.manage = (value) => {
            state.focusedTile.windows = [];
            state.focused.tile = state.target;
            state.target.windows = [value];
            return true;
        };

        invokeShortcut(state.harness, "plasma-auto-tiler-move-right-arrow");

        assert.deepEqual(state.harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        assert.equal(state.harness.scheduled.length, 1);
    });

    it("flashes once after swapping same-parent occupied siblings", () => {
        const state = swapSetup("right");
        state.source.parent = state.root;
        state.target.parent = state.root;

        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");

        assert.deepEqual(state.harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        assert.equal(state.harness.scheduled.length, 1);
    });

    it("does nothing for a focused root leaf without a layout parent", () => {
        const harness = new Harness();
        const root = tile(RECT);
        const focused = window({ tile: root });
        root.windows = [focused];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());
        controller.start();

        groupOutlineController(controller).flashFocusedGroup();

        assert.deepEqual(harness.showOutlineCalls, []);
        assert.equal(harness.scheduled.length, 0);
    });

    it("does nothing for a focused leaf with invalid layout parent geometry", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 0, height: 100 }, true);
        const focusedTile = tile({ x: 10, y: 20, width: 30, height: 40 });
        const focused = window({ tile: focusedTile });
        focusedTile.parent = root;
        focusedTile.windows = [focused];
        root.tiles = [focusedTile];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());

        groupOutlineController(controller).flashFocusedGroup();

        assert.deepEqual(harness.showOutlineCalls, []);
        assert.equal(harness.scheduled.length, 0);
    });

    it("keeps stale group callbacks and group flashes from replacing a drag outline", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const focusedTile = tile({ x: 10, y: 20, width: 30, height: 40 });
        const focused = window({ tile: focusedTile });
        focusedTile.parent = root;
        focusedTile.windows = [focused];
        root.tiles = [focusedTile];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = groupOutlineController(new TileController(harness.environment()));

        controller.flashFocusedGroup();
        controller.flashFocusedGroup();
        harness.fireScheduled(0);
        assert.equal(harness.hideOutlineCalls, 0);
        harness.fireScheduled(1);
        assert.equal(harness.hideOutlineCalls, 1);

        controller.showDropOutline(RECT);
        controller.flashFocusedGroup();
        assert.equal(harness.scheduled.length, 2);
        assert.deepEqual(harness.showOutlineCalls[harness.showOutlineCalls.length - 1], { x: 0, y: 0, w: 100, h: 100 });
        controller.hideDropOutline();
        controller.flashFocusedGroup();
        controller.showDropOutline({ x: 1, y: 2, width: 3, height: 4 });
        harness.fireScheduled(2);
        assert.equal(harness.hideOutlineCalls, 2);
    });

    it("restores an independently active group flash after interactive preview cleanup", () => {
        const state = dragSetup(true);
        state.origin.parent = state.root;
        const inspectable = groupOutlineController(state.controller);
        inspectable.flashFocusedGroup();
        state.harness.cursor = { x: 250, y: 25 };
        startDrag(state.dragged);
        state.dragged.interactiveMoveResizeStepped.emit({ x: 0, y: 0, width: 100, height: 100 });

        state.dragged.fullScreen = true;
        state.dragged.interactiveMoveResizeFinished.emit();

        assert.deepEqual(state.harness.showOutlineCalls, [
            { x: 0, y: 0, w: 100, h: 100 },
            { x: 200, y: 0, w: 100, h: 100 },
            { x: 0, y: 0, w: 100, h: 100 },
        ]);
        assert.equal(state.harness.hideOutlineCalls, 0);
        state.harness.fireScheduled(0);
        assert.equal(state.harness.hideOutlineCalls, 1);
    });

    it("clears group ownership when its outline scheduler cannot arm", () => {
        const state = dragSetup(true);
        state.origin.parent = state.root;
        state.harness.scheduleOnceThrows = new Error("timer unavailable");
        groupOutlineController(state.controller).flashFocusedGroup();
        state.harness.scheduleOnceThrows = undefined;

        startDrag(state.dragged);
        state.harness.cursor = { x: 250, y: 50 };
        state.dragged.interactiveMoveResizeStepped.emit({ x: 0, y: 0, width: 100, height: 100 });
        state.dragged.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(state.harness.logs, "group-outline-schedule-failed"), 1);
        assert.deepEqual(state.harness.showOutlineCalls, [
            { x: 0, y: 0, w: 100, h: 100 },
            { x: 200, y: 0, w: 100, h: 100 },
        ]);
        assert.equal(state.harness.hideOutlineCalls, 2);
    });

    it("flashes the focused leaf parent after a manual preset split", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        realized.left.parent = state.source;

        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        assert.equal(state.active.tile, realized.left);
        assert.deepEqual(state.harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        assert.equal(state.harness.scheduled.length, 1);
    });

    it("flashes once after keyboard insertion completes on window-added", () => {
        const { harness, target, focused } = setup();
        const left = tile({ x: 0, y: 0, width: 50, height: 100 });
        const right = tile({ x: 50, y: 0, width: 50, height: 100 });
        left.parent = target;
        right.parent = target;
        left.manage = (value) => {
            (value as TestWindow).tile = left;
            return true;
        };
        right.manage = (value) => {
            (value as TestWindow).tile = right;
            return true;
        };
        target.split = (direction) => {
            target.isLayout = true;
            target.layoutDirection = direction;
            target.windows = [];
            target.tiles = [left, right];
            return [left, right];
        };
        const incoming = window();

        invokeShortcut(harness, "plasma-auto-tiler-insert-right");
        harness.emitAdded(incoming);

        assert.equal(focused.tile, left);
        assert.equal(incoming.tile, right);
        assert.deepEqual(harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        assert.equal(harness.scheduled.length, 1);
    });

    it("flashes once after automatic direct insertion into an owned empty leaf", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const occupied = tile();
        const occupiedWindow = window({ tile: occupied });
        occupied.windows = [occupiedWindow];
        const empty = tile();
        empty.parent = root;
        occupied.parent = root;
        root.tiles = [occupied, empty];
        harness.root = root;
        harness.active = null;
        harness.windows = [];

        const controller = new TileController(harness.environment());
        controller.start();

        empty.manage = (value) => {
            (value as TestWindow).tile = empty;
            return true;
        };

        // Force session ownership of the scope directly: this test's focus is
        // the owned-scope automatic-insertion dispatch reached through the
        // public `window-added` entry point, not the separate ownership
        // engagement path exercised elsewhere.
        const scope = currentScopeFor(occupiedWindow);
        const inspectable = controller as unknown as { managedScopes: Map<unknown, Map<string, ManagedScope>> };
        let byDesktop = inspectable.managedScopes.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map();
            inspectable.managedScopes.set(scope.output, byDesktop);
        }
        byDesktop.set(scope.desktop.id, { scope, inert: false });

        const incoming = window();
        harness.windows = [occupiedWindow, incoming];
        harness.active = incoming;
        harness.emitAdded(incoming);

        assert.equal(incoming.tile, empty);
        assert.deepEqual(harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        assert.equal(harness.scheduled.length, 1);
    });

    it("flashes once after an owned freed-leaf collapse on window-removed", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const leafA = tile({ x: 0, y: 0, width: 50, height: 100 });
        const leafB = tile({ x: 50, y: 0, width: 50, height: 100 });
        const focusedWindow = window({ tile: leafA });
        const removedWindow = window({ tile: leafB });
        leafA.windows = [focusedWindow];
        leafB.windows = [removedWindow];
        leafA.parent = root;
        leafB.parent = root;
        root.tiles = [leafA, leafB];
        harness.root = root;
        harness.active = null;
        harness.windows = [];

        const controller = new TileController(harness.environment());
        controller.start();

        leafB.remove = () => {
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leafB);
            return true;
        };

        // Force session ownership of the scope directly, same rationale as
        // the automatic-insertion test above.
        const scope = currentScopeFor(focusedWindow);
        const inspectable = controller as unknown as { managedScopes: Map<unknown, Map<string, ManagedScope>> };
        let byDesktop = inspectable.managedScopes.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map();
            inspectable.managedScopes.set(scope.output, byDesktop);
        }
        byDesktop.set(scope.desktop.id, { scope, inert: false });

        harness.windows = [focusedWindow];
        harness.active = focusedWindow;
        // Simulate KWin having already evacuated the removed window from its
        // leaf's window list before the removed signal fires (matching the
        // pattern used by the selected-overlay reflow tests).
        leafB.windows = [];
        harness.emitRemoved(removedWindow);

        assert.deepEqual(harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        assert.equal(harness.scheduled.length, 1);
    });

    it("flashes after a native drop split and again after the deferred origin collapse", () => {
        const { harness, term1, term1Win, term2Win, top, bottom } = nativeDropSetup();
        // The fixture's split() realizes `term1.tiles = [top, bottom]` but
        // does not wire `.parent` back (unneeded by its existing callers);
        // set it here so `flashFocusedGroup`'s parent-walk resolves.
        top.parent = term1;
        bottom.parent = term1;

        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        // Split flow: `completeDrag`'s `gate.run` flushes synchronously right
        // after `emit()` returns. `term1Win` (still `harness.active`) now sits
        // under the realized `term1` layout node, so the flash targets
        // `term1`'s geometry.
        assert.equal((term1Win.tile as TestTile).parent, term1);
        assert.deepEqual(harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);

        // Collapse flow: settle the deferred origin removal. `term1Win`'s
        // parent is still `term1` (the collapse only affects the vacated
        // `term2`/`right` branch), so this flush repeats the same geometry
        // rather than producing a distinct one - that is the expected
        // outcome, not a missing second flash.
        assert.equal(harness.flushNextYield(), true);
        assert.deepEqual(harness.showOutlineCalls, [
            { x: 0, y: 0, w: 100, h: 100 },
            { x: 0, y: 0, w: 100, h: 100 },
        ]);
    });

    it("flashes the sibling's parent after a cross-workspace source collapse, then the mover's new parent after deferred adoption", () => {
        const harness = new Harness();
        harness.configValues.set(WORKSPACE_MODE_CONFIG_KEY, "shared");

        const desktop1 = { id: "desktop-1", x11DesktopNumber: 1 };
        const desktop2 = { id: "desktop-2", x11DesktopNumber: 2 };
        harness.desktopsList = [desktop1, desktop2];
        harness.currentDesktop = desktop1;
        harness.currentDesktopValue = desktop1;

        // Source scope (desktop-1): owned two-leaf layout. `leafA` survives
        // the move; `leafB` is the mover's origin leaf.
        const sourceRoot = tile(RECT, true);
        const leafA = tile({ x: 0, y: 0, width: 50, height: 100 });
        const leafB = tile({ x: 50, y: 0, width: 50, height: 100 });
        leafA.parent = sourceRoot;
        leafB.parent = sourceRoot;
        sourceRoot.tiles = [leafA, leafB];

        const survivor = window({ tile: leafA, caption: "survivor" });
        const mover = window({ tile: leafB, caption: "mover", desktops: [desktop1] });
        leafA.windows = [survivor];
        leafB.windows = [mover];

        leafB.unmanage = () => {
            mover.tile = null;
            leafB.windows = [];
            return true;
        };
        leafB.remove = () => {
            sourceRoot.tiles = (sourceRoot.tiles as TestTile[]).filter((entry) => entry !== leafB);
            // Focus-follow lands on the remaining sibling the instant its
            // leaf is freed, before the collapse's flush runs.
            harness.active = survivor;
            return true;
        };

        // Target scope (desktop-2): owned layout with an occupied leaf and a
        // trailing empty leaf the mover is adopted into.
        const targetRoot = tile(RECT, true);
        const occupiedLeaf = tile({ x: 0, y: 0, width: 50, height: 100 });
        const emptyLeaf = tile({ x: 50, y: 0, width: 50, height: 100 });
        occupiedLeaf.parent = targetRoot;
        emptyLeaf.parent = targetRoot;
        targetRoot.tiles = [occupiedLeaf, emptyLeaf];
        const occupant = window({ tile: occupiedLeaf, caption: "occupant", desktops: [desktop2] });
        occupiedLeaf.windows = [occupant];
        emptyLeaf.manage = (value) => {
            (value as TestWindow).tile = emptyLeaf;
            emptyLeaf.windows = [value];
            return true;
        };

        harness.rootsByDesktop.set(desktop1.id, sourceRoot);
        harness.rootsByDesktop.set(desktop2.id, targetRoot);
        harness.active = mover;
        harness.windows = [survivor, mover, occupant];

        const controller = new TileController(harness.environment());
        controller.start();

        const sourceScope: CurrentScope = {
            output: mover.output!,
            desktop: desktop1,
            scope: { output: mover.output!, desktopId: desktop1.id },
        };
        const targetScope: CurrentScope = {
            output: mover.output!,
            desktop: desktop2,
            scope: { output: mover.output!, desktopId: desktop2.id },
        };
        const inspectable = controller as unknown as { managedScopes: Map<unknown, Map<string, ManagedScope>> };
        const sourceByDesktop = new Map<string, ManagedScope>();
        sourceByDesktop.set(desktop1.id, { scope: sourceScope, inert: false });
        inspectable.managedScopes.set(mover.output, sourceByDesktop);
        const targetByDesktop = inspectable.managedScopes.get(mover.output)!;
        targetByDesktop.set(desktop2.id, { scope: targetScope, inert: false });

        invokeShortcut(harness, "plasma-auto-tiler-move-workspace-2");

        // Collapse flow: `moveActiveToWorkspace`'s `gate.run` flushes
        // synchronously. Active is now the survivor (via the focus-follow
        // simulated above), whose parent is the still-valid `sourceRoot`.
        assert.deepEqual(harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);

        // Adoption flow: settle the deferred destination placement. KWin's
        // real move-follow switches focus to the moved window itself.
        harness.active = mover;
        assert.equal(harness.flushNextYield(), true);
        assert.equal(mover.tile, emptyLeaf);
        assert.deepEqual(harness.showOutlineCalls, [
            { x: 0, y: 0, w: 100, h: 100 },
            { x: 0, y: 0, w: 100, h: 100 },
        ]);
    });
});
