import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_SEQUENTIAL_LENGTH } from "../src/boundary";
import { DROP_OUTLINE_PREVIEW_CONFIG_KEY, TileController } from "../src/controller";
import { type Point } from "../src/logic";
import {
    Harness,
    OUTPUT,
    RECT,
    type TestSignal,
    type TestTile,
    type TestWindow,
    attachTileWriter,
    collectLeaves,
    countEvent,
    dragSetup,
    invokeShortcut,
    movedGeometry,
    nativeDropSetup,
    qv4MethodSignal,
    startDrag,
    tile,
    window,
} from "./controller-fixtures";

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
        assert.equal(countEvent(harness.logs, "drag-attach-summary:12:12:0"), 1);
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6:6:0"), 0);

        harness.emitCurrentDesktopChanged(null, null, null);
        assert.equal(countEvent(harness.logs, "drag-attach-summary:12:12:0"), 1);
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
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6:5:1"), 1);
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
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6:6:0"), 1);
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
        assert.equal(countEvent(harness.logs, "drag-attach-summary:6144:6144:0"), 1);
        const overflow = window({ tile: null });
        harness.emitAdded(overflow);
        assert.equal(countEvent(harness.logs, "drag-attach-skipped:max-windows"), 1);
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
});
