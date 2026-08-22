import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planEqualSplit } from "../src/logic";
import { OUTPUT } from "./controller-fixtures";
import {
    countEvent,
    movedGeometry,
    nativeDropSetup,
    startDrag,
} from "./controller-fixture-scenarios";

describe("TileController interactive drag native/plain reflow and cursor-derived finish decisions", () => {
    it("reflows a plain drop from the final frame geometry into the accepted three-window example", () => {
        const { harness, controller, root, term1, right, term2, term3, top, bottom, term1Win, term2Win, term3Win } =
            nativeDropSetup();
        assert.equal(countEvent(harness.logs, "ownership-taken"), 1);

        startDrag(term2Win);
        // Model a plain drop: KWin floats the dragged window (no custom tile
        // is applied without Shift) at the final drop geometry, and the origin
        // leaf no longer lists it.
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        // The drag-hook entry log fires before any decision, then the geometry
        // target resolves and the shared reflow split runs with the origin
        // collapse deferred, exactly like the native Shift path.
        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-geometry-target"), 1);
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
        // H[V[term1, term2], term3].
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

    it("converges a plain drop and a native Shift drop on the same reflow", () => {
        const plain = nativeDropSetup();
        startDrag(plain.term2Win);
        plain.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        plain.term2Win.tile = null;
        plain.term2Win.interactiveMoveResizeFinished.emit();
        plain.harness.flushNextYield();

        const shift = nativeDropSetup();
        startDrag(shift.term2Win);
        shift.term2Win.frameGeometry = movedGeometry();
        shift.term2Win.tile = shift.term1;
        shift.harness.cursor = { x: 50, y: 75 };
        shift.term2Win.interactiveMoveResizeFinished.emit();
        shift.harness.flushNextYield();

        // Identical final tree shape and occupant mapping for both modifiers.
        assert.deepEqual(plain.root.tiles, [plain.term1, plain.term3]);
        assert.deepEqual(shift.root.tiles, [shift.term1, shift.term3]);
        assert.equal(plain.term1.isLayout, true);
        assert.equal(shift.term1.isLayout, true);
        assert.equal(plain.term1.layoutDirection, shift.term1.layoutDirection);
        assert.deepEqual(plain.term1.tiles, [plain.top, plain.bottom]);
        assert.deepEqual(shift.term1.tiles, [shift.top, shift.bottom]);
        assert.equal(plain.term1Win.tile, plain.top);
        assert.equal(shift.term1Win.tile, shift.top);
        assert.equal(plain.term2Win.tile, plain.bottom);
        assert.equal(shift.term2Win.tile, shift.bottom);
        assert.deepEqual(plain.term3.windows, [plain.term3Win]);
        assert.deepEqual(shift.term3.windows, [shift.term3Win]);
    });

    it("converges a vacated plain drop and a lagged origin-associated plain drop on the same reflow", () => {
        const vacated = nativeDropSetup();
        startDrag(vacated.term2Win);
        vacated.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        vacated.term2Win.tile = null;
        vacated.term2Win.interactiveMoveResizeFinished.emit();
        vacated.harness.flushNextYield();

        const lagged = nativeDropSetup();
        startDrag(lagged.term2Win);
        // KWin unmanage lags the finish hook: the window is floated (tile null)
        // but the origin leaf still lists it. The cursor sits over term1, so
        // the reflow must match the vacated drop exactly.
        lagged.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        lagged.term2Win.tile = null;
        lagged.term2.windows = [lagged.term2Win];
        lagged.harness.cursor = { x: 50, y: 75 };
        lagged.term2Win.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(lagged.harness.logs, "drag-geometry-target"), 1);
        assert.equal(countEvent(lagged.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(lagged.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(lagged.term1Win.tile, lagged.top);
        assert.equal(lagged.term2Win.tile, lagged.bottom);
        // KWin evacuates the lagged origin list, then the deferred one-shot
        // yield collapses the origin to the same accepted tree.
        lagged.term2.windows = [];
        lagged.harness.flushNextYield();
        assert.equal(countEvent(lagged.harness.logs, "ownership-remove-collapsed"), 1);

        assert.deepEqual(vacated.root.tiles, [vacated.term1, vacated.term3]);
        assert.deepEqual(lagged.root.tiles, [lagged.term1, lagged.term3]);
        assert.equal(vacated.term1.isLayout, true);
        assert.equal(lagged.term1.isLayout, true);
        assert.equal(vacated.term1.layoutDirection, lagged.term1.layoutDirection);
        assert.deepEqual(vacated.term1.tiles, [vacated.top, vacated.bottom]);
        assert.deepEqual(lagged.term1.tiles, [lagged.top, lagged.bottom]);
        assert.equal(vacated.term1Win.tile, vacated.top);
        assert.equal(lagged.term1Win.tile, lagged.top);
        assert.equal(vacated.term2Win.tile, vacated.bottom);
        assert.equal(lagged.term2Win.tile, lagged.bottom);
        assert.deepEqual(vacated.term3.windows, [vacated.term3Win]);
        assert.deepEqual(lagged.term3.windows, [lagged.term3Win]);
    });

    it("derives the split direction from the cursor point used for target resolution, for plain and Shift alike", () => {
        for (const mode of ["plain", "shift"] as const) {
            const state = nativeDropSetup();
            startDrag(state.term2Win);
            // The cursor sits in the upper half of term1, so the split is
            // vertical with the dragged window above; the final frame center
            // (lower half) is not the intent input and is ignored for direction.
            state.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
            state.harness.cursor = { x: 50, y: 25 };
            state.term2Win.tile = mode === "shift" ? state.term1 : null;
            state.term2Win.interactiveMoveResizeFinished.emit();
            state.harness.flushNextYield();

            assert.equal(countEvent(state.harness.logs, "drag-geometry-target"), 1);
            assert.equal(state.term1.layoutDirection, 2);
            assert.equal(state.term1Win.tile, state.bottom);
            assert.equal(state.term2Win.tile, state.top);
            assert.deepEqual(state.root.tiles, [state.term1, state.term3]);
            assert.equal(state.controller.isEnabled, true);
        }
    });

    it("derives the drop target from the cursor, bailing to the origin over the frame-center leaf", () => {
        const state = nativeDropSetup();
        startDrag(state.term2Win);
        // The cursor sits over the origin while the final frame center sits over
        // term1: the cursor is authoritative, so the drop bails back to the
        // origin instead of splitting term1.
        state.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        state.term2Win.tile = null;
        state.term2.windows = [state.term2Win];
        state.harness.cursor = { x: 150, y: 25 };
        state.term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(state.harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-origin-restored"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(state.term2Win.tile, state.term2);
        assert.deepEqual(state.term1.windows, [state.term1Win]);
        assert.equal(state.controller.hasActiveDrag, false);
        assert.equal(state.controller.isEnabled, true);
    });

    it("bails when native overlap state contradicts the cursor-derived target", () => {
        const { harness, controller, term1, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        // KWin managed the dragged window into term1, but the cursor sits over
        // term3: inconsistent state, never reflow.
        term2Win.tile = term1;
        term2Win.frameGeometry = { x: 100, y: 50, width: 100, height: 50 };
        harness.cursor = { x: 150, y: 75 };
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:geometry-native-mismatch"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs a distinct target-is-origin bail and restores the origin when the final frame center sits over the origin leaf", () => {
        const { harness, controller, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        // The frame center sits back over the origin leaf, and KWin's unmanage
        // lags the finish hook so the origin still lists the dragged window:
        // the center resolves to the origin, so the drop bails and restores.
        term2Win.frameGeometry = { x: 100, y: 0, width: 100, height: 50 };
        term2Win.tile = null;
        term2.windows = [term2Win];
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 0);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs a distinct no-target-leaf bail with the center point when the final frame center sits on no leaf", () => {
        const { harness, controller, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        // Final frame center sits outside every leaf (occupied or empty): the
        // vacated origin no longer lists the dragged window and no leaf contains
        // the center, so the drop bails with the decisive point.
        term2.windows = [];
        term2Win.frameGeometry = { x: 300, y: 0, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-finished"), 1);
        assert.equal(countEvent(harness.logs, "drag-bail:no-target-leaf:350,25"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(term2Win.tile, term2);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs distinct scope and topology bail reasons when the finish scope or tree is unavailable", () => {
        const changed = nativeDropSetup();
        startDrag(changed.term2Win);
        changed.term2Win.output = { ...OUTPUT };
        changed.term2Win.tile = null;
        changed.term2Win.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(changed.harness.logs, "drag-bail:scope-changed"), 1);
        assert.equal(changed.controller.hasActiveDrag, false);

        const missingRoot = nativeDropSetup();
        startDrag(missingRoot.term2Win);
        missingRoot.harness.root = null;
        missingRoot.term2Win.tile = null;
        missingRoot.term2Win.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(missingRoot.harness.logs, "drag-bail:topology-unavailable:root-lookup"), 1);
        assert.equal(missingRoot.controller.hasActiveDrag, false);
    });

    it("emits the drag-finished hook entry log before every finish decision and bail", () => {
        const cases: ReadonlyArray<{
            readonly outcome: string;
            readonly prepare: (state: ReturnType<typeof nativeDropSetup>) => void;
        }> = [
            {
                outcome: "drag-geometry-target",
                prepare: (state) => {
                    state.term2Win.tile = null;
                    state.term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
                },
            },
            {
                outcome: "drag-bail:no-target-leaf:350,25",
                prepare: (state) => {
                    state.term2Win.tile = null;
                    state.term2Win.frameGeometry = { x: 300, y: 0, width: 100, height: 50 };
                },
            },
            {
                outcome: "drag-geometry-target",
                prepare: (state) => {
                    state.term2Win.tile = state.term1;
                    state.harness.cursor = { x: 50, y: 75 };
                },
            },
        ];
        for (const testCase of cases) {
            const state = nativeDropSetup();
            startDrag(state.term2Win);
            testCase.prepare(state);
            state.term2Win.interactiveMoveResizeFinished.emit();
            const entry = "plasma-auto-tiler:drag-finished";
            const outcome = `plasma-auto-tiler:${testCase.outcome}`;
            assert.ok(state.harness.logs.includes(entry));
            assert.ok(state.harness.logs.indexOf(entry) < state.harness.logs.indexOf(outcome));
        }
    });

    it("planEqualSplit already refuses to normalize a same-axis 3-child parent shape (reflow no-op proof for N-ary same-axis drops)", () => {
        // A same-axis 3-child horizontal row [a, b, c]: dragged=a and
        // occupant=b are two of the parent's three children, so together
        // they never exactly fill the parent along the axis (c's span is
        // missing). normalizeReflowLeaves's existing guard (via
        // planEqualSplit) must therefore refuse and leave every sibling's
        // geometry untouched, rather than force an equalization meant only
        // for a 2-child-filling-parent shape.
        const parent = { x: 0, y: 0, width: 300, height: 100 };
        const a = { x: 0, y: 0, width: 100, height: 100 };
        const b = { x: 100, y: 0, width: 100, height: 100 };
        assert.equal(planEqualSplit(parent, a, b, "x"), null);
    });
});
