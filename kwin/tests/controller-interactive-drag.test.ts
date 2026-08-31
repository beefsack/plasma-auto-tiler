import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_SEQUENTIAL_LENGTH } from "../src/boundary";
import { TileController } from "../src/controller";
import { type Point } from "../src/logic";
import {
    Harness,
    OUTPUT,
    RECT,
    type TestSignal,
    type TestWindow,
    qv4MethodSignal,
    tile,
    window,
} from "./controller-fixtures";
import {
    countEvent,
    dragSetup,
    movedGeometry,
    sameAxisRowDropSetup,
    startDrag,
} from "./controller-fixture-scenarios";

describe("TileController interactive drag", () => {
    it("captures only interactive moves and permits one active drag", () => {
        const { controller, dragged, targetWindow } = dragSetup();
        dragged.resize = true;
        dragged.interactiveMoveResizeStarted.emit();
        assert.equal(controller.hasActiveDrag, false);

        startDrag(dragged);
        assert.equal(controller.hasActiveDrag, true);
        targetWindow.move = true;
        targetWindow.interactiveMoveResizeStarted.emit();
        assert.equal(controller.hasActiveDrag, true);
    });

    it("does not overwrite a captured origin on a repeated start of the same window", () => {
        const { controller, harness, origin, target, dragged, targetWindow } = dragSetup();
        startDrag(dragged);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);

        // A repeated started signal for the same window (e.g. a move/resize
        // retransition) must not re-capture the origin or corrupt the drag.
        dragged.move = true;
        dragged.interactiveMoveResizeStarted.emit();
        dragged.move = false;
        assert.equal(countEvent(harness.logs, "drag-started"), 2);
        assert.equal(countEvent(harness.logs, "drag-origin-captured"), 1);
        assert.equal(controller.hasActiveDrag, true);

        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.equal(controller.hasActiveDrag, false);
        assert.deepEqual(origin.windows, [dragged]);
        assert.deepEqual(target.windows, [targetWindow]);
    });

    it("does not claim a cancellation when origin association and geometry are unchanged", () => {
        const { controller, origin, dragged, target } = dragSetup();
        let splits = 0;
        let restores = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        origin.manage = () => {
            restores += 1;
            return true;
        };
        startDrag(dragged);
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(splits, 0);
        assert.equal(restores, 0);
    });

    it("restores association through origin manage when the cursor resolves to the origin or no occupied leaf", () => {
        for (const cursor of [{ x: 60, y: 60 }, { x: 1000, y: 1000 }]) {
            const { harness, controller, origin, target, dragged } = dragSetup();
            let restores = 0;
            let splits = 0;
            origin.manage = (value) => {
                restores += 1;
                assert.equal(value, dragged);
                return true;
            };
            target.split = () => {
                splits += 1;
                return [];
            };
            harness.cursor = cursor;
            startDrag(dragged);
            dragged.tile = null;
            dragged.frameGeometry = movedGeometry();
            dragged.interactiveMoveResizeFinished.emit();
            assert.equal(controller.hasActiveDrag, false);
            assert.equal(restores, 1);
            assert.equal(splits, 0);
        }
    });

    it("rejects stale, same, multiple, ineligible, invalid, and cross-scope targets before split", () => {
        const cases: ReadonlyArray<(state: ReturnType<typeof dragSetup>) => void> = [
            (state) => {
                // The final frame center sits over the origin, so no occupied
                // leaf resolves and the drop restores.
                state.dragged.frameGeometry = { x: 10, y: 10, width: 100, height: 100 };
            },
            (state) => {
                state.target.windows = [state.targetWindow, window({ tile: state.target })];
            },
            (state) => {
                state.targetWindow.normalWindow = false;
            },
            (state) => {
                state.target.absoluteGeometry = { x: 200, y: 0, width: 0, height: 100 };
            },
            (state) => {
                state.dragged.output = { ...OUTPUT };
            },
        ];
        for (const configure of cases) {
            const state = dragSetup();
            let splits = 0;
            let restores = 0;
            state.origin.manage = () => {
                restores += 1;
                return true;
            };
            state.target.split = () => {
                splits += 1;
                return [];
            };
            startDrag(state.dragged);
            state.dragged.tile = null;
            // Final frame center over the target so the geometry-derived target
            // resolves and the planner's own validation decides the bail.
            state.dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
            configure(state);
            state.dragged.interactiveMoveResizeFinished.emit();
            assert.equal(splits, 0);
            assert.equal(state.controller.hasActiveDrag, false);
            assert.equal(state.controller.isEnabled, true);
            assert.ok(restores <= 1);
        }
    });

    it("maps all directions to geometric children, retaining the origin leaf", () => {
        // With no cursor available the final frame center is the fallback
        // resolver point, so its position inside the four target-leaf regions
        // decides the split axis and side.
        const cases: ReadonlyArray<[typeof RECT, number]> = [
            [{ x: 160, y: 0, width: 100, height: 100 }, 1],
            [{ x: 240, y: 0, width: 100, height: 100 }, 1],
            [{ x: 200, y: 0, width: 100, height: 20 }, 2],
            [{ x: 200, y: 80, width: 100, height: 20 }, 2],
        ];
        for (const [finalGeometry, expectedDirection] of cases) {
            const { origin, target, dragged, targetWindow } = dragSetup();
            const managed: unknown[] = [];
            const first = tile(
                expectedDirection === 1
                    ? { x: 200, y: 0, width: 50, height: 100 }
                    : { x: 200, y: 0, width: 100, height: 50 },
                false,
                (value) => {
                    managed.push(value);
                    return true;
                },
            );
            const second = tile(
                expectedDirection === 1
                    ? { x: 250, y: 0, width: 50, height: 100 }
                    : { x: 200, y: 50, width: 100, height: 50 },
                false,
                (value) => {
                    managed.push(value);
                    return true;
                },
            );
            let direction = 0;
            target.split = (value) => {
                direction = value;
                target.isLayout = true;
                target.layoutDirection = value;
                target.tiles = [first, second];
                return [second, first];
            };
            startDrag(dragged);
            dragged.frameGeometry = finalGeometry;
            dragged.interactiveMoveResizeFinished.emit();
            assert.equal(direction, expectedDirection);
            assert.equal(managed[0], targetWindow);
            assert.equal(managed[1], dragged);
            assert.deepEqual(origin.windows, [dragged]);
        }
    });

    it("reads the live post-split tiles rather than trusting split()'s return value (cross-axis anti-pattern regression)", () => {
        // target.parent stays null (dragSetup's default), so this drop always
        // takes the cross-axis path regardless of direction.
        const { origin, target, dragged, targetWindow } = dragSetup();
        const managed: unknown[] = [];
        const first = tile({ x: 200, y: 0, width: 50, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        const second = tile({ x: 250, y: 0, width: 50, height: 100 }, false, (value) => {
            managed.push(value);
            return true;
        });
        // The returned children are distinct objects with degenerate,
        // duplicate-position geometry that `orderCustomTilesByAxis` would
        // reject outright if trusted directly. The live `target.tiles` (what
        // the fix re-decodes) holds the real, valid children instead.
        const bogusFirst = tile({ x: 0, y: 0, width: 0, height: 0 });
        const bogusSecond = tile({ x: 0, y: 0, width: 0, height: 0 });
        target.split = () => {
            target.isLayout = true;
            target.tiles = [first, second];
            return [bogusFirst, bogusSecond];
        };
        startDrag(dragged);
        dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(managed[0], targetWindow);
        assert.equal(managed[1], dragged);
        assert.deepEqual(origin.windows, [dragged]);
    });

    it("selects the split direction from the cursor across all regions with a central dead-zone default", () => {
        const cases: ReadonlyArray<[Point, number]> = [
            [{ x: 210, y: 50 }, 1],
            [{ x: 290, y: 50 }, 1],
            [{ x: 250, y: 10 }, 2],
            [{ x: 250, y: 90 }, 2],
            [{ x: 250, y: 50 }, 2],
        ];
        for (const [cursor, expectedDirection] of cases) {
            const { harness, origin, target, dragged, targetWindow } = dragSetup();
            const managed: unknown[] = [];
            const first = tile(
                expectedDirection === 1
                    ? { x: 200, y: 0, width: 50, height: 100 }
                    : { x: 200, y: 0, width: 100, height: 50 },
                false,
                (value) => {
                    managed.push(value);
                    return true;
                },
            );
            const second = tile(
                expectedDirection === 1
                    ? { x: 250, y: 0, width: 50, height: 100 }
                    : { x: 200, y: 50, width: 100, height: 50 },
                false,
                (value) => {
                    managed.push(value);
                    return true;
                },
            );
            let direction = 0;
            target.split = (value) => {
                direction = value;
                target.isLayout = true;
                target.layoutDirection = value;
                target.tiles = [first, second];
                return [second, first];
            };
            startDrag(dragged);
            dragged.tile = null;
            dragged.frameGeometry = movedGeometry();
            harness.cursor = cursor;
            dragged.interactiveMoveResizeFinished.emit();
            assert.equal(direction, expectedDirection);
            assert.equal(managed[0], targetWindow);
            assert.equal(managed[1], dragged);
            assert.deepEqual(origin.windows, [dragged]);
        }
    });

    it("places the dragged window directly into an empty leaf without splitting or occupied-leaf reflow", () => {
        const { harness, controller, root, origin, target, dragged } = dragSetup();
        const empty = tile({ x: 400, y: 0, width: 100, height: 100 });
        root.tiles = [origin, target, empty];
        let splits = 0;
        target.split = () => {
            splits += 1;
            return [];
        };
        empty.manage = (value) => {
            (value as TestWindow).tile = empty;
            empty.windows = [value as TestWindow];
            return true;
        };
        startDrag(dragged);
        dragged.tile = null;
        dragged.frameGeometry = movedGeometry();
        harness.cursor = { x: 450, y: 50 };
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(splits, 0);
        assert.equal(countEvent(harness.logs, "drag-empty-target"), 1);
        assert.equal(countEvent(harness.logs, "drag-empty-placement"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 0);
        assert.equal(dragged.tile, empty);
        assert.equal(countEvent(harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("logs the decisive plan rejection reason when an occupied target cannot be reflowed", () => {
        const { harness, controller, target, targetWindow, dragged } = dragSetup();
        target.windows = [targetWindow, window({ tile: target }), window({ tile: target })];
        startDrag(dragged);
        dragged.tile = null;
        dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-bail:geometry-plan-rejected:invalid-leaf-count"), 1);
        assert.equal(countEvent(harness.logs, "drag-origin-restored"), 1);
        assert.equal(controller.hasActiveDrag, false);
        assert.equal(controller.isEnabled, true);
    });

    it("disables structural drag once for malformed split output or post-split manage failure", () => {
        const malformed = dragSetup();
        malformed.target.split = () => [];
        startDrag(malformed.dragged);
        malformed.dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        malformed.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(malformed.controller.isEnabled, false);
        assert.equal(countEvent(malformed.harness.logs, "disabled:drag-split-result-invalid"), 1);

        const failedManage = dragSetup();
        const first = tile({ x: 200, y: 0, width: 50, height: 100 }, false, () => false);
        const second = tile({ x: 250, y: 0, width: 50, height: 100 });
        failedManage.target.split = () => [first, second];
        failedManage.target.tiles = [first, second];
        startDrag(failedManage.dragged);
        failedManage.dragged.frameGeometry = { x: 240, y: 0, width: 100, height: 100 };
        failedManage.dragged.interactiveMoveResizeFinished.emit();
        assert.equal(failedManage.controller.isEnabled, false);
        assert.equal(countEvent(failedManage.harness.logs, "disabled:drag-manage-failed"), 1);
    });

    it("deduplicates and disconnects existing and newly added interactive handlers", () => {
        const { harness, dragged } = dragSetup();
        harness.emitAdded(dragged);
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        dragged.desktopsChanged.emit();
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 0);
        if (harness.desktopChanged !== undefined) {
            harness.emitCurrentDesktopChanged(null, null, null);
        }
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        const added = window();
        harness.emitAdded(added);
        harness.emitAdded(added);
        assert.equal(added.interactiveMoveResizeStarted.subscriberCount, 1);
        harness.emitRemoved(added);
        assert.equal(added.interactiveMoveResizeStarted.subscriberCount, 0);
    });

    it("emits exactly one startup drag-attach summary aggregating per-signal results", () => {
        const { harness } = dragSetup();
        assert.equal(countEvent(harness.logs, "drag-attach-summary:14:14:0"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6:6:0"), 0);

        harness.emitCurrentDesktopChanged(null, null, null);
        assert.equal(countEvent(harness.logs, "drag-attach-summary:14:14:0"), 1);
    });

    it("reports a per-signal attach failure with a useful detail without skipping the window", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const origin = tile();
        const dragged = window({ tile: origin });
        delete (dragged as Partial<TestWindow>).moveResizedChanged;
        origin.windows = [dragged];
        root.tiles = [origin];
        harness.root = root;
        harness.windows = [dragged];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        assert.equal(countEvent(harness.logs, "drag-attach-summary:7:6:1"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-interaction-signals"), 0);
        const failed = harness.logs.find((entry) =>
            entry.startsWith("plasma-auto-tiler:drag-attach-failed:moveResizedChanged:"),
        );
        assert.notEqual(failed, undefined);
        assert.ok(
            failed?.includes("typeof undefined"),
            `failed line must name the observed typeof, got: ${failed}`,
        );
    });

    it("attaches function-valued, prototype-provided signals approximating the QJSEngine shape (not live proof)", () => {
        // QV4 exposes QObject signal properties as callable QObjectMethod
        // functions whose connect/disconnect live on the function prototype
        // (qv4qobjectwrapper.cpp:322-323), so the whole-window isSignal-style
        // guard that required an object-valued signal with an own connect
        // member was live-proven false. A window whose interaction signals are
        // function-valued through a custom prototype and a getter approximates
        // that QJSEngine shape here. This is a static approximation, NOT live
        // proof that KWin delivers these signals.
        const harness = new Harness();
        const root = tile(RECT, true);
        const origin = tile();
        const dragged = window({ tile: origin });
        const qv4Signals: Record<string, TestSignal & (() => void)> = {
            interactiveMoveResizeStarted: qv4MethodSignal(),
            interactiveMoveResizeStepped: qv4MethodSignal(),
            interactiveMoveResizeFinished: qv4MethodSignal(),
            outputChanged: qv4MethodSignal(),
            desktopsChanged: qv4MethodSignal(),
            moveResizedChanged: qv4MethodSignal(),
        };
        for (const name of Object.keys(qv4Signals)) {
            Object.defineProperty(dragged, name, {
                get: () => qv4Signals[name],
                enumerable: false,
                configurable: true,
            });
        }
        origin.windows = [dragged];
        root.tiles = [origin];
        harness.root = root;
        harness.windows = [dragged];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-summary:7:7:0"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-interaction-signals"), 0);
        assert.equal(
            harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-attach-failed:")),
            false,
        );
        assert.equal(dragged.interactiveMoveResizeStarted.subscriberCount, 1);
        dragged.interactiveMoveResizeStarted.emit();
        assert.equal(countEvent(harness.logs, "drag-started"), 1);
    });

    it("logs a distinct skip reason for every remaining attach guard", () => {
        const harness = new Harness();
        harness.root = tile(RECT, true);
        const plain = window({ tile: null });
        const wrongDesktop = window({ tile: null, desktops: [{ id: "other-desktop" }] });
        const nullOutput = window({ tile: null, output: null });
        harness.windows = [plain, wrongDesktop, nullOutput];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:out-of-scope"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-scope"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:no-interaction-signals"), 0);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:not-window"), 0);
        harness.emitAdded({ normalWindow: true });
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:not-window"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:duplicate"), 0);
        harness.emitAdded(plain);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:duplicate"), 1);
        assert.equal(controller.hasActiveDrag, false);
    });

    it("logs a window-list decode failure as the attach guard skip", () => {
        const harness = new Harness();
        harness.windows = "not-a-window-list";
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:window-list-decode-failed"), 1);
        assert.equal(
            harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-attach-summary:")),
            false,
            "a failed window-list decode must not emit a startup summary",
        );
    });

    it("skips interactive attachment once the window map is at capacity", () => {
        const harness = new Harness();
        harness.root = tile(RECT, true);
        const windows: TestWindow[] = [];
        for (let i = 0; i < MAX_SEQUENTIAL_LENGTH; i += 1) {
            windows.push(window({ tile: null }));
        }
        harness.windows = windows;
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(countEvent(harness.logs, "drag-attach-summary:7168:7168:0"), 1);
        const overflow = window({ tile: null });
        harness.emitAdded(overflow);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:max-windows"), 1);
    });

    it("same-axis wraps: adds a new direct sibling to a 3-child row parent instead of wrapping the target, identified by geometry-order set difference over a scrambled raw tiles[] array", () => {
        const { harness, a, b, c, d, dragged, aWin, bWin, cWin } = sameAxisRowDropSetup();
        startDrag(dragged);
        dragged.tile = null;
        dragged.frameGeometry = movedGeometry();
        // Cursor sits inside b (the middle child), near its left edge, which
        // classifies as a horizontal ("left"/"right") direction, matching
        // parent's horizontal layoutDirection and taking the same-axis path.
        harness.cursor = { x: 110, y: 50 };
        dragged.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        // The dragged window is managed onto the new sibling d, identified by
        // set difference (it is stored at tiles[0], not adjacent to b).
        assert.equal(dragged.tile, d);
        assert.deepEqual(d.windows, [dragged]);
        // The occupant and target b are unchanged: b is never re-managed and
        // its window identity is untouched by this drop.
        assert.equal(bWin.tile, b);
        assert.deepEqual(b.windows, [bWin]);
        // Pre-existing siblings a and c keep their original geometry and
        // windows: this function performs no incidental reweighting.
        assert.deepEqual(a.relativeGeometry, { x: 0, y: 0, width: 100, height: 100 });
        assert.deepEqual(a.windows, [aWin]);
        assert.deepEqual(c.relativeGeometry, { x: 200, y: 0, width: 100, height: 100 });
        assert.deepEqual(c.windows, [cWin]);
    });

    it("logs diagnostic-only drag event signals without mutating tiles", () => {
        const { controller, harness, origin, target, targetWindow, dragged } = dragSetup();
        startDrag(dragged);
        dragged.interactiveMoveResizeStepped.emit();
        dragged.moveResizedChanged.emit();
        assert.equal(countEvent(harness.logs, "drag-started"), 1);
        assert.equal(countEvent(harness.logs, "drag-stepped"), 0);
        assert.equal(countEvent(harness.logs, "drag-move-resized-changed"), 1);
        assert.equal(controller.hasActiveDrag, true);
        dragged.interactiveMoveResizeStepped.emit();
        dragged.interactiveMoveResizeFinished.emit();
        assert.equal(countEvent(harness.logs, "drag-stepped"), 0);
        assert.equal(countEvent(harness.logs, "drag-unchanged"), 1);
        assert.deepEqual(origin.windows, [dragged]);
        assert.deepEqual(target.windows, [targetWindow]);
        assert.equal(controller.hasActiveDrag, false);
    });

});
