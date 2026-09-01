import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DROP_OUTLINE_PREVIEW_CONFIG_KEY, TileController } from "../src/controller";
import {
    Harness,
    RECT,
    type TestTile,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";
import {
    attachTileWriter,
    collectLeaves,
    countEvent,
    dragSetup,
    invokeShortcut,
    movedGeometry,
    nativeDropSetup,
    startDrag,
} from "./controller-fixture-scenarios";

// The live minimum-split floor failure: four full-width rows 245px tall inside
// a 980px working height (y 44..289, 289..534, 534..779, 779..1024). A 50/50
// vertical split of a 245px row yields 122.5px halves, below KWin's 15%
// working-height floor (147px), so the split must be refused before mutating.
function rowsDropSetup(dropOutlinePreview = false): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly rows: readonly [TestTile, TestTile, TestTile, TestTile];
    readonly row0Win: TestWindow;
    readonly row1Win: TestWindow;
    readonly row2Win: TestWindow;
    readonly row3Win: TestWindow;
    readonly splits: number[];
} {
    const harness = new Harness();
    harness.clientArea = { x: 0, y: 44, width: 1536, height: 980 };
    const row0 = tile({ x: 0, y: 44, width: 1536, height: 245 });
    const row1 = tile({ x: 0, y: 289, width: 1536, height: 245 });
    const row2 = tile({ x: 0, y: 534, width: 1536, height: 245 });
    const row3 = tile({ x: 0, y: 779, width: 1536, height: 245 });
    const root = tile({ x: 0, y: 44, width: 1536, height: 980 }, true);
    root.layoutDirection = 2;
    const row0Win = window({ tile: row0, caption: "row0" });
    const row1Win = window({ tile: row1, caption: "row1" });
    const row2Win = window({ tile: row2, caption: "row2" });
    const row3Win = window({ tile: row3, caption: "row3" });
    row0.windows = [row0Win];
    row1.windows = [row1Win];
    row2.windows = [row2Win];
    row3.windows = [row3Win];
    root.tiles = [row0, row1, row2, row3];
    harness.root = root;
    harness.active = row0Win;
    harness.windows = [row0Win, row1Win, row2Win, row3Win];
    harness.configValues.set(DROP_OUTLINE_PREVIEW_CONFIG_KEY, dropOutlinePreview);
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(row0Win, writes);
    attachTileWriter(row1Win, writes);
    attachTileWriter(row2Win, writes);
    attachTileWriter(row3Win, writes);
    const splits: number[] = [];
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    const halve = (source: TestTile, direction: number): unknown => {
        splits.push(direction);
        source.isLayout = true;
        source.windows = [];
        const geometry = source.absoluteGeometry;
        const first = tile({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height });
        const second = tile({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height });
        if (direction === 1) {
            first.absoluteGeometry = { x: geometry.x, y: geometry.y, width: geometry.width / 2, height: geometry.height };
            second.absoluteGeometry = { x: geometry.x + geometry.width / 2, y: geometry.y, width: geometry.width / 2, height: geometry.height };
        } else {
            first.absoluteGeometry = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height / 2 };
            second.absoluteGeometry = { x: geometry.x, y: geometry.y + geometry.height / 2, width: geometry.width, height: geometry.height / 2 };
        }
        first.relativeGeometry = first.absoluteGeometry;
        second.relativeGeometry = second.absoluteGeometry;
        first.manage = manage(first);
        second.manage = manage(second);
        source.tiles = [first, second];
        return [first, second];
    };
    row0.split = (direction) => halve(row0, direction);
    row1.split = (direction) => halve(row1, direction);
    row2.split = (direction) => halve(row2, direction);
    row3.split = (direction) => halve(row3, direction);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, rows: [row0, row1, row2, row3], row0Win, row1Win, row2Win, row3Win, splits };
}
function assertLeafPartition(leaves: readonly TestTile[], area: typeof RECT): void {
    let total = 0;
    for (const leaf of leaves) {
        const g = leaf.absoluteGeometry;
        assert.ok(g.x >= area.x - 1e-9 && g.y >= area.y - 1e-9, "leaf must start within the working area");
        assert.ok(g.x + g.width <= area.x + area.width + 1e-9, "leaf must not exceed the working area width");
        assert.ok(g.y + g.height <= area.y + area.height + 1e-9, "leaf must not exceed the working area height");
        total += g.width * g.height;
    }
    for (let i = 0; i < leaves.length; i += 1) {
        for (let j = i + 1; j < leaves.length; j += 1) {
            const a = leaves[i]!.absoluteGeometry;
            const b = leaves[j]!.absoluteGeometry;
            const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            assert.equal(overlaps, false, `leaves ${i} and ${j} must not overlap`);
        }
    }
    assert.equal(total, area.width * area.height, "leaves must sum the full working extent");
}
describe("TileController interactive drag outline preview and minimum-split geometry", () => {
    it("shows the whole valid target leaf on a stepped drag without structural mutation", () => {
        const { harness, origin, target, dragged } = dragSetup(true);
        let structuralCalls = 0;
        for (const subject of [origin, target]) {
            subject.manage = () => {
                structuralCalls += 1;
                return false;
            };
            subject.unmanage = () => {
                structuralCalls += 1;
                return false;
            };
            subject.split = () => {
                structuralCalls += 1;
                return [];
            };
            subject.remove = () => {
                structuralCalls += 1;
                return false;
            };
        }
        harness.cursor = { x: 250, y: 50 };

        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());

        assert.deepEqual(harness.showOutlineCalls, [{ x: 200, y: 0, w: 100, h: 100 }]);
        assert.equal(harness.hideOutlineCalls, 0);
        assert.equal(structuralCalls, 0);
        assert.equal(dragged.tile, origin);
    });

    it("suppresses duplicate stepped outline requests", () => {
        const { harness, dragged } = dragSetup(true);
        harness.cursor = { x: 250, y: 50 };

        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());

        assert.equal(harness.showOutlineCalls.length, 1);
        assert.equal(harness.hideOutlineCalls, 0);
    });

    it("hides a shown outline when a stepped target becomes unresolved, origin, out of scope, or topology-invalid", () => {
        const cases: ReadonlyArray<(state: ReturnType<typeof dragSetup>) => void> = [
            ({ harness }) => {
                harness.cursor = { x: 1000, y: 1000 };
            },
            ({ harness }) => {
                harness.cursor = { x: 50, y: 50 };
            },
            ({ dragged }) => {
                dragged.desktops = [];
            },
            ({ target }) => {
                target.absoluteGeometry = { x: 200, y: 0, width: 0, height: 100 };
                target.relativeGeometry = target.absoluteGeometry;
            },
        ];
        for (const invalidate of cases) {
            const state = dragSetup(true);
            state.harness.cursor = { x: 250, y: 50 };
            startDrag(state.dragged);
            state.dragged.interactiveMoveResizeStepped.emit(movedGeometry());
            invalidate(state);
            state.dragged.interactiveMoveResizeStepped.emit(movedGeometry());

            assert.equal(state.harness.showOutlineCalls.length, 1);
            assert.equal(state.harness.hideOutlineCalls, 1);
        }
    });

    it("clears the preview before a target resize observer can consume invalidation", () => {
        const state = dragSetup(true);
        state.harness.cursor = { x: 250, y: 50 };
        startDrag(state.dragged);
        state.dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        assert.equal(state.harness.showOutlineCalls.length, 1);

        state.targetWindow.resize = true;
        state.targetWindow.interactiveMoveResizeStarted.emit();
        assert.equal(state.harness.hideOutlineCalls, 1);
        assert.equal(state.controller.hasActiveDrag, true);
    });

    it("clears the preview when its target window is removed", () => {
        const state = dragSetup(true);
        state.harness.cursor = { x: 250, y: 50 };
        startDrag(state.dragged);
        state.dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        assert.equal(state.harness.showOutlineCalls.length, 1);

        state.harness.emitRemoved(state.targetWindow);

        assert.equal(state.harness.hideOutlineCalls, 1);
    });

    it("replans the release against a new target after previewing another target", () => {
        const state = dragSetup(true);
        const secondTarget = tile({ x: 400, y: 0, width: 100, height: 100 });
        const secondWindow = window({ tile: secondTarget });
        secondTarget.windows = [secondWindow];
        const upper = tile({ x: 400, y: 0, width: 100, height: 50 });
        const lower = tile({ x: 400, y: 50, width: 100, height: 50 });
        upper.manage = (value) => {
            (value as TestWindow).tile = upper;
            upper.windows = [value as TestWindow];
            return true;
        };
        lower.manage = (value) => {
            (value as TestWindow).tile = lower;
            lower.windows = [value as TestWindow];
            return true;
        };
        secondTarget.split = (direction) => {
            secondTarget.isLayout = true;
            secondTarget.layoutDirection = direction;
            secondTarget.windows = [];
            secondTarget.tiles = [upper, lower];
            return [];
        };
        state.root.tiles = [state.origin, state.target, secondTarget];
        state.harness.windows = [state.dragged, state.targetWindow, secondWindow];

        state.harness.cursor = { x: 250, y: 50 };
        startDrag(state.dragged);
        state.dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        assert.deepEqual(state.harness.showOutlineCalls, [{ x: 200, y: 0, w: 100, h: 100 }]);

        state.harness.cursor = { x: 450, y: 50 };
        state.dragged.tile = null;
        state.dragged.frameGeometry = { x: 400, y: 0, width: 100, height: 100 };
        state.dragged.interactiveMoveResizeFinished.emit();

        assert.equal(state.target.isLayout, false);
        assert.equal(secondTarget.isLayout, true);
        assert.equal(state.targetWindow.tile, state.target);
        assert.equal(state.dragged.tile, lower);
    });

    it("hides a shown outline when the target split would violate the minimum size", () => {
        const { harness, row0Win } = rowsDropSetup(true);
        startDrag(row0Win);
        harness.cursor = { x: 10, y: 400 };
        row0Win.interactiveMoveResizeStepped.emit(movedGeometry());
        harness.cursor = { x: 768, y: 411 };
        row0Win.interactiveMoveResizeStepped.emit(movedGeometry());

        assert.equal(harness.showOutlineCalls.length, 1);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("does nothing for stepped outlines when the configuration is disabled", () => {
        const { harness, dragged } = dragSetup();
        harness.cursor = { x: 250, y: 50 };

        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());

        assert.equal(harness.showOutlineCalls.length, 0);
        assert.equal(harness.hideOutlineCalls, 0);
    });

    it("clears a shown outline once when a drop finishes successfully", () => {
        const { harness, term1Win, term2Win } = nativeDropSetup(true);
        harness.cursor = { x: 50, y: 25 };
        startDrag(term2Win);
        term2Win.interactiveMoveResizeStepped.emit({ x: 0, y: 0, width: 100, height: 50 });
        assert.equal(harness.showOutlineCalls.length, 1);

        term2Win.frameGeometry = { x: 0, y: 0, width: 100, height: 50 };
        term2Win.tile = term1Win.tile;
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("clears a shown outline once when the final drop is refused as undersized", () => {
        const { controller, harness, row0Win } = rowsDropSetup(true);
        harness.cursor = { x: 10, y: 400 };
        startDrag(row0Win);
        row0Win.interactiveMoveResizeStepped.emit(movedGeometry());
        assert.equal(harness.showOutlineCalls.length, 1);

        row0Win.tile = null;
        row0Win.frameGeometry = { x: 718, y: 361, width: 100, height: 100 };
        harness.cursor = { x: 768, y: 411 };
        row0Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-refused:undersized-split"), 1);
        assert.equal(harness.hideOutlineCalls, 1);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("clears a shown outline when its origin is invalidated or removed", () => {
        const actions: ReadonlyArray<(state: ReturnType<typeof dragSetup>) => void> = [
            ({ dragged }) => dragged.desktopsChanged.emit(),
            ({ harness, dragged }) => harness.emitRemoved(dragged),
        ];
        for (const clear of actions) {
            const state = dragSetup(true);
            state.harness.cursor = { x: 250, y: 50 };
            startDrag(state.dragged);
            state.dragged.interactiveMoveResizeStepped.emit(movedGeometry());
            clear(state);

            assert.equal(state.harness.hideOutlineCalls, 1);
            assert.equal(state.controller.hasActiveDrag, false);
        }
    });

    it("clears a shown outline before replacing a stale drag", () => {
        const { controller, harness, dragged, targetWindow } = dragSetup(true);
        harness.cursor = { x: 250, y: 50 };
        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());

        targetWindow.move = true;
        targetWindow.interactiveMoveResizeStarted.emit();
        targetWindow.move = false;

        assert.equal(harness.hideOutlineCalls, 1);
        assert.equal(controller.hasActiveDrag, true);
    });

    it("clears a shown outline when the controller disables without duplicate teardown", () => {
        const { controller, harness, target, dragged } = dragSetup(true);
        harness.cursor = { x: 250, y: 50 };
        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        target.split = () => [];
        dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(controller.isEnabled, false);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("does not hide an outline again after terminal cleanup", () => {
        const { controller, harness, dragged } = dragSetup(true);
        harness.cursor = { x: 250, y: 50 };
        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        dragged.interactiveMoveResizeFinished.emit();
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(controller.hasActiveDrag, false);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("hides a shown outline once when finished arrives while fullscreen", () => {
        const { controller, harness, dragged } = dragSetup(true);
        harness.cursor = { x: 250, y: 50 };
        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        assert.equal(harness.showOutlineCalls.length, 1);

        dragged.fullScreen = true;
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "fullscreen:ignored lifecycle while fullscreen"), 1);
        assert.equal(controller.hasActiveDrag, true);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("hides a shown outline once when finished arrives while maximized", () => {
        const { controller, harness, dragged } = dragSetup(true);
        harness.cursor = { x: 250, y: 50 };
        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit(movedGeometry());
        assert.equal(harness.showOutlineCalls.length, 1);

        invokeShortcut(harness, "plasma-auto-tiler-maximize");
        assert.equal(countEvent(harness.logs, "maximize:enter covered"), 1);
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "maximize:ignored lifecycle while maximized"), 1);
        assert.equal(controller.hasActiveDrag, true);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("contains drag exceptions and clears active state", () => {
        const { controller, harness, target, dragged } = dragSetup();
        target.split = () => {
            throw "split";
        };
        startDrag(dragged);
        dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, false);
        assert.equal(countEvent(harness.logs, "disabled:exception"), 1);
    });

    it("resolves a native Shift-drop overlap into a position-directed split and defers the origin collapse", () => {
        const { harness, controller, root, term1, right, term2, term3, top, bottom, term1Win, term2Win, term3Win } =
            nativeDropSetup();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        startDrag(term2Win);
        // Model the native finish: KWin manages term2 into term1 and vacates
        // term2 before interactiveMoveResizeFinished fires.
        term2Win.frameGeometry = movedGeometry();
        term2Win.tile = term1;
        harness.cursor = { x: 50, y: 75 };
        term2Win.interactiveMoveResizeFinished.emit();

        // Finish-only: the position-directed split happens in this dispatch and
        // no removal runs yet.
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 0);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.deepEqual(top.windows, [term1Win]);
        assert.deepEqual(bottom.windows, [term2Win]);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        assert.deepEqual(right.tiles, [term2, term3]);
        assert.equal(harness.yields.length, 1);
        assert.equal(controller.hasActiveDrag, false);

        // After the one-shot yield the empty origin collapses and KWin
        // promotes the single-child V-wrapper, leaving the whole accepted tree
        // H[V[term1, term2], term3] with term3 as the root's direct right
        // child. The mirrored chain is a valid dwindle(3) ordering, so no
        // unwanted reconstruction is queued.
        harness.flushNextYield();
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.deepEqual(root.tiles, [term1, term3]);
        assert.equal(term1.isLayout, true);
        assert.equal(term1.layoutDirection, 2);
        assert.deepEqual(term1.tiles, [top, bottom]);
        assert.deepEqual(top.windows, [term1Win]);
        assert.deepEqual(bottom.windows, [term2Win]);
        assert.deepEqual(term3.windows, [term3Win]);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.equal(term3Win.tile, term3);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
        assert.equal(harness.yields.length, 0);
        assert.equal(controller.isEnabled, true);
    });

    it("defaults a central-zone native Shift drop to a vertical split with the occupant above", () => {
        const { harness, controller, term1, top, bottom, term1Win, term2Win } = nativeDropSetup();

        startDrag(term2Win);
        term2Win.frameGeometry = movedGeometry();
        term2Win.tile = term1;
        harness.cursor = { x: 50, y: 50 };
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(term1.layoutDirection, 2);
        assert.equal(term1Win.tile, top);
        assert.equal(term2Win.tile, bottom);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(controller.isEnabled, true);
    });

    it("restores the origin when the native drop target is not exactly dragged plus one occupant", () => {
        const { harness, controller, term1, term2, term1Win, term2Win } = nativeDropSetup();
        const extra = window({ tile: term1 });

        startDrag(term2Win);
        term2Win.frameGeometry = movedGeometry();
        term2Win.tile = term1;
        term1.windows = [term1Win, term2Win, extra];
        harness.cursor = { x: 50, y: 75 };
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal((term1.windows as TestWindow[]).includes(term2Win), false);
        assert.equal(controller.isEnabled, true);
    });

    it("refuses an undersized drop split while the dragged window still holds its origin leaf, leaving the tree untouched", () => {
        const { harness, controller, root, rows, row0Win, row2Win, splits } = rowsDropSetup();
        const [row0, row1, row2, row3] = rows;
        assert.equal(row2.absoluteGeometry.height, 245);
        assert.equal((harness.clientArea as typeof RECT).height, 980);

        startDrag(row0Win);
        // Model the no-op condition: the dragged window never left its origin
        // leaf, and the finish resolver point lands on the center of row2
        // (534..779). The center dead zone classifies a vertical split, whose
        // 122.5px halves fall below the 147px floor, so the drop is refused
        // before any mutation and no rollback is required.
        row0Win.frameGeometry = { x: 768, y: 656, width: 100, height: 100 };
        harness.cursor = { x: 768, y: 656 };
        row0Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-refused:undersized-split"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 0);
        assert.equal(splits.length, 0);
        // Tree structure is completely untouched: the four rows remain the four
        // leaves, row2 was never split, and no new tile exists.
        assert.deepEqual(root.tiles, [row0, row1, row2, row3]);
        assert.equal(row2.isLayout, false);
        assert.deepEqual(row2.tiles, []);
        assert.equal(collectLeaves(root).length, 4);
        // The dragged window still holds its origin leaf and row2 keeps its
        // single occupant: refusal needs no rollback because nothing mutated.
        assert.equal(row0Win.tile, row0);
        assert.deepEqual(row0.windows, [row0Win]);
        assert.deepEqual(row2.windows, [row2Win]);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("restores the captured origin when KWin clears the dragged tile and the drop split is undersized", () => {
        const { harness, controller, root, rows, row0Win, row2Win, splits } = rowsDropSetup();
        const [row0, row1, row2, row3] = rows;
        assert.equal(row2.absoluteGeometry.height, 245);
        assert.equal((harness.clientArea as typeof RECT).height, 980);
        const startupYields = harness.yields.length;
        // Model live KWin: the origin is captured while the dragged window
        // still holds row0, then KWin clears the dragged window's tile before
        // the finish hook, exactly as observed in the live runner.
        startDrag(row0Win);
        row0.manage = (value: unknown): boolean => {
            (value as TestWindow).tile = row0;
            return true;
        };
        row0Win.tile = null;
        row0Win.frameGeometry = { x: 768, y: 656, width: 100, height: 100 };
        harness.cursor = { x: 768, y: 656 };
        row0Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-refused:undersized-split"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(row0Win.tile, row0);
        assert.deepEqual(row0.windows, [row0Win]);
        assert.deepEqual(row2.windows, [row2Win]);
        assert.deepEqual(row0.absoluteGeometry, { x: 0, y: 44, width: 1536, height: 245 });
        assert.equal(splits.length, 0);
        assert.deepEqual(root.tiles, [row0, row1, row2, row3]);
        assert.equal(row2.isLayout, false);
        assert.deepEqual(row2.tiles, []);
        assert.equal(collectLeaves(root).length, 4);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 0);
        // rowsDropSetup arms one startup reconstruction yield (ownership-pending)
        // because its flat four-row tree is not canonical dwindle. The undersized
        // refusal must queue no yield of its own, so the count is unchanged from
        // that startup baseline.
        assert.equal(harness.yields.length, startupYields);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("keeps a passing drop split contiguous, non-overlapping, and summing the full working extent", () => {
        const { harness, controller, root, rows, row0Win, splits } = rowsDropSetup();
        const row2 = rows[2];
        assert.ok(row2 !== undefined);

        startDrag(row0Win);
        // Native Shift drop into the left half of row2 (534..779): a horizontal
        // 50/50 split of the 1536px-wide row yields 768px halves, above the 15%
        // working-width floor (230.4px), so the split is allowed.
        row0Win.tile = row2;
        row0Win.frameGeometry = { x: 300, y: 656, width: 100, height: 100 };
        harness.cursor = { x: 300, y: 656 };
        row0Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-refused:undersized-split"), 0);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(splits.length, 1);
        assert.equal(row2.isLayout, true);
        assert.equal(collectLeaves(root).length, 5);
        // The geometry invariant still holds after the split: the leaves are
        // contiguous, non-overlapping, and sum the full working extent.
        assertLeafPartition(collectLeaves(root), harness.clientArea as typeof RECT);
        assert.equal(controller.isEnabled, true);
    });

});
