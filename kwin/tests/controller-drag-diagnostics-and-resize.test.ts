import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    Harness,
    RECT,
    type TestTile,
    type TestWindow,
    setFullscreen,
    setMaximized,
    setSticky,
    tile,
    window,
} from "./controller-fixtures";
import {
    attachTileWriter,
    countEvent,
    dragSetup,
    invokeShortcut,
    movedGeometry,
    nativeDropSetup,
    reconstructDropSetup,
    startDrag,
} from "./controller-fixture-scenarios";
import { TileController } from "../src/controller";

describe("TileController drag snapshot diagnostics", () => {
    function snapshotPayloads(logs: readonly string[], prefix: string): unknown[] {
        const marker = `plasma-auto-tiler:${prefix}`;
        return logs.filter((entry) => entry.startsWith(marker)).map((entry) => JSON.parse(entry.slice(marker.length)));
    }

    it("emits a compact before snapshot with final geometry, resolver center, and topology leaves", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const before = snapshotPayloads(harness.logs, "drag-snapshot-before:");
        assert.equal(before.length, 1);
        const payload = before[0] as {
            geometry: { x: number; y: number; width: number; height: number };
            center: { x: number; y: number };
            pointSource: string;
            leaves: unknown[];
        };
        assert.deepEqual(payload.geometry, { x: 0, y: 50, width: 100, height: 50 });
        assert.deepEqual(payload.center, { x: 50, y: 75 });
        assert.equal(payload.pointSource, "frame-center");
        assert.deepEqual(payload.leaves, [
            {
                id: "tile-0",
                geometry: { x: 100, y: 50, width: 100, height: 50 },
                occupants: [{ id: "window-0", caption: "term3" }],
            },
            { id: "tile-1", geometry: { x: 100, y: 0, width: 100, height: 50 }, occupants: [] },
            {
                id: "tile-2",
                geometry: { x: 0, y: 0, width: 100, height: 100 },
                occupants: [{ id: "window-1", caption: "term1" }],
            },
        ]);
    });

    it("reports the target resolution outcome as a compact JSON log", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
    });

    it("reports empty-leaf target resolution with occupancy empty in the target outcome", () => {
        const { harness, root, origin, target, dragged } = dragSetup();
        const empty = tile({ x: 400, y: 0, width: 100, height: 100 });
        root.tiles = [origin, target, empty];
        startDrag(dragged);
        dragged.tile = null;
        dragged.frameGeometry = movedGeometry();
        harness.cursor = { x: 450, y: 50 };
        dragged.interactiveMoveResizeFinished.emit();

        const targetPayloads = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(targetPayloads.length, 1);
        assert.deepEqual(targetPayloads[0], {
            kind: "resolved",
            leaf: "tile-0",
            center: { x: 450, y: 50 },
            pointSource: "cursor",
            occupancy: "empty",
        });
    });

    it("uses a finite cursor as the resolver point and records pointSource cursor", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursor = { x: 50, y: 25 };
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 25 },
            pointSource: "cursor",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 0);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-read-threw"), 0);
    });

    it("falls back to the frame center and emits a one-time diagnostic when the cursor is unavailable", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursor = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 1);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-read-threw"), 0);
    });

    it("falls back to the frame center and emits a one-time diagnostic when the cursor is not a finite point", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursor = { x: Infinity, y: 25 };
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 1);
    });

    it("falls back to the frame center and emits a one-time diagnostic when the cursor read throws", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.cursorThrows = true;
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "resolved",
            leaf: "tile-2",
            center: { x: 50, y: 75 },
            pointSource: "frame-center",
            occupancy: "occupied",
        });
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-read-threw"), 1);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 0);
    });

    it("shares the chosen cursor point between the bail suffix and the target payload", () => {
        const { harness, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2.windows = [term2Win];
        harness.cursor = { x: 150, y: 25 };
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "target-is-origin",
            center: { x: 150, y: 25 },
            pointSource: "cursor",
        });
        assert.equal(countEvent(harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(countEvent(harness.logs, "drag-point-fallback:cursor-not-a-point"), 0);
    });

    it("reports a bail target outcome with the existing bail diagnostic and no after snapshot", () => {
        const { harness, term2, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 100, y: 0, width: 100, height: 50 };
        term2Win.tile = null;
        term2.windows = [term2Win];
        term2Win.interactiveMoveResizeFinished.emit();

        const target = snapshotPayloads(harness.logs, "drag-target:");
        assert.equal(target.length, 1);
        assert.deepEqual(target[0], {
            kind: "target-is-origin",
            center: { x: 150, y: 25 },
            pointSource: "frame-center",
        });
        assert.equal(countEvent(harness.logs, "drag-bail:target-is-origin:150,25"), 1);
        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-after:").length, 0);
    });

    it("emits a before snapshot with null leaves and a topology status on a topology bail", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        harness.root = null;
        term2Win.interactiveMoveResizeFinished.emit();

        const before = snapshotPayloads(harness.logs, "drag-snapshot-before:");
        assert.equal(before.length, 1);
        assert.deepEqual(before[0], {
            geometry: { x: 0, y: 50, width: 100, height: 50 },
            center: null,
            leaves: null,
            topology: "root-lookup",
        });
        assert.equal(countEvent(harness.logs, "drag-bail:topology-unavailable:root-lookup"), 1);
    });

    it("emits a before snapshot with null center and decoded leaves on a geometry bail", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 0, width: 0, height: 0 };
        term2Win.interactiveMoveResizeFinished.emit();

        const before = snapshotPayloads(harness.logs, "drag-snapshot-before:");
        assert.equal(before.length, 1);
        const payload = before[0] as {
            geometry: unknown;
            center: unknown;
            leaves: unknown[];
            topology?: unknown;
        };
        assert.deepEqual(payload.geometry, { x: 0, y: 0, width: 0, height: 0 });
        assert.equal(payload.center, null);
        assert.equal(payload.topology, undefined);
        assert.equal(payload.leaves.length, 3);
        assert.equal(countEvent(harness.logs, "drag-bail:geometry-invalid"), 1);
    });

    it("emits an after snapshot once the deferred reflow completion has settled", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();

        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-after:").length, 0);

        harness.flushNextYield();

        const after = snapshotPayloads(harness.logs, "drag-snapshot-after:");
        assert.equal(after.length, 1);
        const payload = after[0] as { leaves: unknown[] };
        assert.deepEqual(payload.leaves, [
            {
                id: "tile-0",
                geometry: { x: 100, y: 50, width: 100, height: 50 },
                occupants: [{ id: "window-0", caption: "term3" }],
            },
            {
                id: "tile-1",
                geometry: { x: 0, y: 50, width: 100, height: 50 },
                occupants: [{ id: "window-1", caption: "term2" }],
            },
            {
                id: "tile-2",
                geometry: { x: 0, y: 0, width: 100, height: 50 },
                occupants: [{ id: "window-2", caption: "term1" }],
            },
        ]);
    });

    it("reuses the resolution and collapse decodes so a successful drop adds no whole-root decode", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        harness.rootReads = 0;
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();
        // One pre/resolution decode: the before and target snapshots reuse it.
        assert.equal(harness.rootReads, 1);
        harness.flushNextYield();
        // Settle + collapse postcondition + invariant; the after snapshot
        // reuses the collapse postcondition decode.
        assert.equal(harness.rootReads, 4);
    });

    it("swallows snapshot serialization errors into fixed failed diagnostics without affecting the drop", () => {
        const { harness, controller, term2Win } = nativeDropSetup();
        const original = JSON.stringify;
        JSON.stringify = () => {
            throw new Error("snapshot sink failure");
        };
        try {
            startDrag(term2Win);
            term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
            term2Win.tile = null;
            term2Win.interactiveMoveResizeFinished.emit();
            harness.flushNextYield();
        } finally {
            JSON.stringify = original;
        }
        assert.equal(countEvent(harness.logs, "drag-snapshot-failed:before:serialize"), 1);
        assert.equal(countEvent(harness.logs, "drag-snapshot-failed:target:serialize"), 1);
        assert.equal(countEvent(harness.logs, "drag-snapshot-failed:after:serialize"), 1);
        assert.equal(countEvent(harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(controller.isEnabled, true);
    });
});

describe("TileController drag reconstruction final snapshot", () => {
    function snapshotPayloads(logs: readonly string[], prefix: string): unknown[] {
        const marker = `plasma-auto-tiler:${prefix}`;
        return logs.filter((entry) => entry.startsWith(marker)).map((entry) => JSON.parse(entry.slice(marker.length)));
    }

    it("emits one drag-snapshot-final only after the queued reconstruction settles", () => {
        const state = reconstructDropSetup();
        startDrag(state.aWin);
        state.aWin.frameGeometry = { x: 100, y: 0, width: 50, height: 100 };
        state.aWin.tile = null;
        state.aWin.interactiveMoveResizeFinished.emit();

        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(snapshotPayloads(state.harness.logs, "drag-snapshot-final:").length, 0);

        // The origin collapse leaves the root with a single layout child, so a
        // full reconstruction is queued; the final snapshot must not appear
        // while that reconstruction is still pending.
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
        assert.equal(snapshotPayloads(state.harness.logs, "drag-snapshot-final:").length, 0);

        // The reconstruction settles over two more yields (collapse then
        // rebuild); the final snapshot appears only once it is done.
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(snapshotPayloads(state.harness.logs, "drag-snapshot-final:").length, 0);
        assert.equal(state.harness.flushNextYield(), true);

        const final = snapshotPayloads(state.harness.logs, "drag-snapshot-final:");
        assert.equal(final.length, 1);
        const payload = final[0] as {
            leaves: Array<{
                id: string;
                geometry: { width: number; height: number };
                occupants: Array<{ id: string; caption: string }>;
            }>;
        };
        assert.equal(payload.leaves.length, 2);
        assert.deepEqual(
            payload.leaves.map((leaf) => leaf.occupants[0]?.caption).sort(),
            ["a", "b"],
        );
        for (const leaf of payload.leaves) {
            assert.equal(typeof leaf.id, "string");
            assert.equal(leaf.occupants.length, 1);
            assert.equal(typeof leaf.occupants[0]?.id, "string");
            assert.ok(leaf.geometry.width > 0 && leaf.geometry.height > 0);
        }
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 2);
        assert.equal(state.harness.yields.length, 0);
        assert.equal(state.controller.isEnabled, true);
    });

    it("emits no drag-snapshot-final on a non-reconstructing drop", () => {
        const { harness, term2Win } = nativeDropSetup();
        startDrag(term2Win);
        term2Win.frameGeometry = { x: 0, y: 50, width: 100, height: 50 };
        term2Win.tile = null;
        term2Win.interactiveMoveResizeFinished.emit();
        harness.flushNextYield();

        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-after:").length, 1);
        assert.equal(snapshotPayloads(harness.logs, "drag-snapshot-final:").length, 0);
        assert.equal(countEvent(harness.logs, "ownership-pending"), 0);
    });
});

// Owned dwindle(2) scope H[target, origin] with a horizontal (side-by-side)
// split target. A drag of the origin window onto the target splits the target
// into 50/50 left/right children; the fixture's origin removal models KWin's
// "last child fills the area" donation, expanding the right child so the two
// reflow leaves become 25/75. The controller's normalize step then writes the
// equal 50/50 halves. The fixture models the controller's intent, not real
// KWin setter behavior: the neighbor-adjusting relativeGeometry write is a
// static stand-in, not live proof.
function normalizeSetup(
    setterMode: "adjust" | "throw" | "no-adjust" = "adjust",
): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly target: TestTile;
    readonly origin: TestTile;
    readonly left: TestTile;
    readonly right: TestTile;
    readonly dragged: TestWindow;
    readonly occupant: TestWindow;
} {
    const harness = new Harness();
    const root = tile({ x: 0, y: 0, width: 200, height: 100 }, true);
    const target = tile({ x: 0, y: 0, width: 100, height: 100 });
    const origin = tile({ x: 100, y: 0, width: 100, height: 100 });
    const occupant = window({ tile: target, caption: "occupant" });
    const dragged = window({ tile: origin, caption: "dragged" });
    target.windows = [occupant];
    origin.windows = [dragged];
    root.tiles = [target, origin];
    harness.root = root;
    harness.active = occupant;
    harness.windows = [occupant, dragged];
    const writes: Array<{ window: TestWindow; target: object | null }> = [];
    attachTileWriter(occupant, writes);
    attachTileWriter(dragged, writes);
    const left = tile({ x: 0, y: 0, width: 50, height: 100 });
    const right = tile({ x: 50, y: 0, width: 50, height: 100 });
    left.parent = target;
    right.parent = target;
    const manage = (leaf: TestTile) => (value: unknown): boolean => {
        (value as TestWindow).tile = leaf;
        return true;
    };
    left.manage = manage(left);
    right.manage = manage(right);
    target.split = (direction) => {
        target.isLayout = true;
        target.layoutDirection = direction;
        target.windows = [];
        target.tiles = [left, right];
        return [left, right];
    };
    origin.remove = () => {
        root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== origin);
        // Donation: target spans the full width and the last (right) child
        // absorbs the extra area, so the two reflow leaves become 25/75.
        target.relativeGeometry = { x: 0, y: 0, width: 200, height: 100 };
        target.absoluteGeometry = target.relativeGeometry;
        right.relativeGeometry = { x: 50, y: 0, width: 150, height: 100 };
        right.absoluteGeometry = right.relativeGeometry;
        // Setter model: "adjust" pushes right's near edge on a left write,
        // "throw" models a failing write, "no-adjust" models a write that does
        // not reach the sibling (so the post-decode stays unequal).
        let leftState = left.relativeGeometry;
        Object.defineProperty(left, "relativeGeometry", {
            configurable: true,
            get: () => leftState,
            set:
                setterMode === "throw"
                    ? () => {
                          throw new Error("relativeGeometry write failed");
                      }
                    : (next: typeof RECT) => {
                          leftState = next;
                          left.absoluteGeometry = next;
                          if (setterMode === "adjust") {
                              const near = next.x + next.width;
                              const far = right.relativeGeometry.x + right.relativeGeometry.width;
                              right.relativeGeometry = {
                                  x: near,
                                  y: right.relativeGeometry.y,
                                  width: far - near,
                                  height: right.relativeGeometry.height,
                              };
                              right.absoluteGeometry = right.relativeGeometry;
                          }
                      },
        });
        return true;
    };
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, target, origin, left, right, dragged, occupant };
}

function runNormalizeDrag(state: ReturnType<typeof normalizeSetup>): void {
    startDrag(state.dragged);
    state.dragged.tile = null;
    state.dragged.frameGeometry = { x: 40, y: 40, width: 20, height: 20 };
    state.harness.cursor = { x: 75, y: 50 };
    state.dragged.interactiveMoveResizeFinished.emit();
}

// Keyboard split-resize fixture. Root is a two-child layout split along the
// chosen axis; the focused window sits on the near (first) or far (second)
// child. The focused child's relativeGeometry setter models the documented
// KWin CustomTile::setRelativeGeometry sibling adjustment: "adjust" moves the
// sibling's shared edge (the fixture's intent, not live proof), "throw" models
// a failing write, and "no-adjust" models a write that does not reach the
// sibling so the post-decode extent check reports a mismatch. `writes` counts
// geometry writes to the focused child so a test can prove exactly one write.
function resizeSetup(
    axis: "x" | "y" = "x",
    focusedSide: "first" | "second" = "first",
    setterMode: "adjust" | "throw" | "no-adjust" = "adjust",
    profile: "cosmic" | "hyprland" | "bspwm" = "cosmic",
): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly first: TestTile;
    readonly second: TestTile;
    readonly focused: TestWindow;
    readonly neighbor: TestWindow;
    readonly writes: number[];
} {
    const harness = new Harness();
    const root = tile({ x: 0, y: 0, width: 200, height: 200 }, true);
    root.layoutDirection = axis === "x" ? 1 : 2;
    const firstGeometry =
        axis === "x"
            ? { x: 0, y: 0, width: 100, height: 200 }
            : { x: 0, y: 0, width: 200, height: 100 };
    const secondGeometry =
        axis === "x"
            ? { x: 100, y: 0, width: 100, height: 200 }
            : { x: 0, y: 100, width: 200, height: 100 };
    const first = tile(firstGeometry);
    const second = tile(secondGeometry);
    first.parent = root;
    second.parent = root;
    root.tiles = [first, second];
    const focusedTile = focusedSide === "first" ? first : second;
    const neighborTile = focusedSide === "first" ? second : first;
    const focused = window({ tile: focusedTile, caption: "focused" });
    const neighbor = window({ tile: neighborTile, caption: "neighbor" });
    focusedTile.windows = [focused];
    neighborTile.windows = [neighbor];
    harness.root = root;
    harness.active = focused;
    harness.windows = [focused, neighbor];
    const writes: number[] = [];
    let state = focusedTile.relativeGeometry;
    Object.defineProperty(focusedTile, "relativeGeometry", {
        configurable: true,
        get: () => state,
        set: (next: typeof RECT) => {
            writes.push(1);
            if (setterMode === "throw") {
                throw new Error("relativeGeometry write failed");
            }
            state = next;
            focusedTile.absoluteGeometry = next;
            if (setterMode === "adjust") {
                const neighborState = neighborTile.relativeGeometry;
                // The documented setter adjusts the sibling at the shared edge:
                // a near-side focused tile moves the shared edge at its far
                // edge, a far-side focused tile at its near edge.
                const updated =
                    axis === "x"
                        ? focusedSide === "first"
                            ? {
                                  x: next.x + next.width,
                                  y: neighborState.y,
                                  width: neighborState.x + neighborState.width - (next.x + next.width),
                                  height: neighborState.height,
                              }
                            : {
                                  x: neighborState.x,
                                  y: neighborState.y,
                                  width: next.x - neighborState.x,
                                  height: neighborState.height,
                              }
                        : focusedSide === "first"
                            ? {
                                  x: neighborState.x,
                                  y: next.y + next.height,
                                  width: neighborState.width,
                                  height: neighborState.y + neighborState.height - (next.y + next.height),
                              }
                            : {
                                  x: neighborState.x,
                                  y: neighborState.y,
                                  width: neighborState.width,
                                  height: next.y - neighborState.y,
                              };
                neighborTile.relativeGeometry = updated;
                neighborTile.absoluteGeometry = updated;
            }
        },
    });
    harness.configValues.set("shortcutProfile", profile);
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, first, second, focused, neighbor, writes };
}

describe("TileController drag reflow normalization", () => {
    it("equalizes the two reflow leaves to 50/50 relative geometry after origin collapse", () => {
        const state = normalizeSetup();
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 1);
        runNormalizeDrag(state);
        assert.equal(countEvent(state.harness.logs, "drag-overlap-split-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-deferred"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);

        state.harness.flushNextYield();

        assert.equal(countEvent(state.harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 1);
        assert.equal(
            state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-reflow-normalize-skipped:")),
            false,
        );
        assert.equal(
            state.harness.logs.some((entry) => entry.startsWith("plasma-auto-tiler:drag-reflow-normalize-failed:")),
            false,
        );
        assert.equal(state.left.relativeGeometry.width, 100);
        assert.equal(state.right.relativeGeometry.width, 100);
        assert.equal(state.controller.isEnabled, true);
    });

    it("emits the after snapshot with equal ratios after normalization", () => {
        const state = normalizeSetup();
        runNormalizeDrag(state);
        state.harness.flushNextYield();
        const markers = state.harness.logs
            .filter((entry) => entry.startsWith("plasma-auto-tiler:drag-snapshot-after:"))
            .map((entry) => JSON.parse(entry.slice("plasma-auto-tiler:drag-snapshot-after:".length)));
        assert.equal(markers.length, 1);
        const payload = markers[0] as { leaves: Array<{ geometry: { width: number } }> };
        const widths = payload.leaves.map((leaf) => leaf.geometry.width);
        assert.equal(widths.length, 2);
        assert.equal(widths[0], widths[1]);
        assert.ok(
            state.harness.logs.indexOf("plasma-auto-tiler:drag-reflow-normalized") <
                state.harness.logs.findIndex((entry) => entry.startsWith("plasma-auto-tiler:drag-snapshot-after:")),
        );
    });

    it("skips normalization when the two leaves are not siblings", () => {
        const state = normalizeSetup();
        runNormalizeDrag(state);
        state.left.parent = {};
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-skipped:not-siblings"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(state.left.relativeGeometry.width, 50);
        assert.equal(state.right.relativeGeometry.width, 150);
        assert.equal(state.controller.isEnabled, true);
    });

    it("skips normalization when the parent has no known split axis", () => {
        const state = normalizeSetup();
        runNormalizeDrag(state);
        state.target.layoutDirection = 0;
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-skipped:floating-parent"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(state.controller.isEnabled, true);
    });

    it("contains a failed relativeGeometry write without disabling the controller", () => {
        const state = normalizeSetup("throw");
        runNormalizeDrag(state);
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-failed:write"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(countEvent(state.harness.logs, "ownership-remove-collapsed"), 1);
        assert.equal(state.controller.isEnabled, true);
    });

    it("reports a post-decode mismatch when the write does not reach the sibling", () => {
        const state = normalizeSetup("no-adjust");
        runNormalizeDrag(state);
        state.harness.flushNextYield();
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalize-failed:mismatch"), 1);
        assert.equal(countEvent(state.harness.logs, "drag-reflow-normalized"), 0);
        assert.equal(state.controller.isEnabled, true);
    });
});

describe("TileController COSMIC split resize mode", () => {
    const resizeEnter = "plasma-auto-tiler-resize-mode-outwards";
    const resizeEnterInverse = "plasma-auto-tiler-resize-mode-inwards";

    function nestedResizeSetup(
        outerSide: "first" | "second",
        focusedSide: "first" | "second",
    ): {
        readonly harness: Harness;
        readonly controller: TileController;
        readonly inner: TestTile;
        readonly outerNeighbor: TestTile;
        readonly focusedLeaf: TestTile;
        readonly writes: number[];
    } {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 300, height: 100 }, true);
        root.layoutDirection = 1;
        const innerGeometry = outerSide === "first"
            ? { x: 0, y: 0, width: 200, height: 100 }
            : { x: 100, y: 0, width: 200, height: 100 };
        const outerNeighborGeometry = outerSide === "first"
            ? { x: 200, y: 0, width: 100, height: 100 }
            : { x: 0, y: 0, width: 100, height: 100 };
        const inner = tile(innerGeometry, true);
        inner.layoutDirection = 1;
        const outerNeighbor = tile(outerNeighborGeometry);
        inner.parent = root;
        outerNeighbor.parent = root;
        root.tiles = outerSide === "first" ? [inner, outerNeighbor] : [outerNeighbor, inner];
        const firstLeaf = tile({ x: innerGeometry.x, y: 0, width: 100, height: 100 });
        const secondLeaf = tile({ x: innerGeometry.x + 100, y: 0, width: 100, height: 100 });
        firstLeaf.parent = inner;
        secondLeaf.parent = inner;
        inner.tiles = [firstLeaf, secondLeaf];
        const focusedLeaf = focusedSide === "first" ? firstLeaf : secondLeaf;
        const innerNeighbor = focusedSide === "first" ? secondLeaf : firstLeaf;
        const focused = window({ tile: focusedLeaf, caption: "focused" });
        const innerNeighborWindow = window({ tile: innerNeighbor, caption: "inner-neighbor" });
        const outerNeighborWindow = window({ tile: outerNeighbor, caption: "outer-neighbor" });
        focusedLeaf.windows = [focused];
        innerNeighbor.windows = [innerNeighborWindow];
        outerNeighbor.windows = [outerNeighborWindow];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused, innerNeighborWindow, outerNeighborWindow];
        const writes: number[] = [];
        let innerState = inner.relativeGeometry;
        Object.defineProperty(inner, "relativeGeometry", {
            configurable: true,
            get: () => innerState,
            set: (next: typeof RECT) => {
                writes.push(1);
                innerState = next;
                inner.absoluteGeometry = next;
                const neighborState = outerNeighbor.relativeGeometry;
                const updated = outerSide === "first"
                    ? {
                          x: next.x + next.width,
                          y: neighborState.y,
                          width: neighborState.x + neighborState.width - (next.x + next.width),
                          height: neighborState.height,
                      }
                    : {
                          x: neighborState.x,
                          y: neighborState.y,
                          width: next.x - neighborState.x,
                          height: neighborState.height,
                      };
                outerNeighbor.relativeGeometry = updated;
                outerNeighbor.absoluteGeometry = updated;
            },
        });
        const controller = new TileController(harness.environment());
        controller.start();
        return { harness, controller, inner, outerNeighbor, focusedLeaf, writes };
    }

    it("enters outwards mode, enters the inverse inwards mode, switches, and exits deterministically", () => {
        const state = resizeSetup();
        invokeShortcut(state.harness, resizeEnter);
        assert.equal(countEvent(state.harness.logs, "resize-mode-entered:outwards"), 1);
        assert.deepEqual(state.controller.resizeModeSnapshot(), { active: true, direction: "outwards" });

        invokeShortcut(state.harness, resizeEnterInverse);
        assert.equal(countEvent(state.harness.logs, "resize-mode-switched:inwards"), 1);
        assert.deepEqual(state.controller.resizeModeSnapshot(), { active: true, direction: "inwards" });

        invokeShortcut(state.harness, resizeEnterInverse);
        assert.equal(countEvent(state.harness.logs, "resize-mode-exited"), 1);
        assert.deepEqual(state.controller.resizeModeSnapshot(), { active: false, direction: "inwards" });

        invokeShortcut(state.harness, resizeEnterInverse);
        assert.equal(countEvent(state.harness.logs, "resize-mode-entered:inwards"), 1);
        invokeShortcut(state.harness, resizeEnter);
        assert.equal(countEvent(state.harness.logs, "resize-mode-switched:outwards"), 1);
        assert.deepEqual(state.controller.resizeModeSnapshot(), { active: true, direction: "outwards" });
        assert.equal(state.controller.isEnabled, true);
    });

    it("drives one resize step through the HJKL focus alias while outwards mode is active", () => {
        const state = resizeSetup();
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "focus-invoked"), 0);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.width, 110);
        assert.equal(state.second.relativeGeometry.x, 110);
        assert.equal(state.second.relativeGeometry.width, 90);
        assert.equal(state.controller.isEnabled, true);
    });

    it("drives one resize step through the arrow focus alias while outwards mode is active", () => {
        const state = resizeSetup();
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right-arrow");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.width, 110);
        assert.equal(state.second.relativeGeometry.width, 90);
    });

    it("grows the far-side focused window leftward in outwards mode and shrinks it in inwards mode", () => {
        const grown = resizeSetup("x", "second");
        invokeShortcut(grown.harness, resizeEnter);
        invokeShortcut(grown.harness, "plasma-auto-tiler-focus-left");
        assert.equal(countEvent(grown.harness.logs, "resize-completed"), 1);
        assert.equal(grown.writes.length, 1);
        assert.equal(grown.second.relativeGeometry.x, 90);
        assert.equal(grown.second.relativeGeometry.width, 110);
        assert.equal(grown.first.relativeGeometry.width, 90);

        const shrunk = resizeSetup("x", "second");
        invokeShortcut(shrunk.harness, resizeEnterInverse);
        invokeShortcut(shrunk.harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(shrunk.harness.logs, "resize-completed"), 1);
        assert.equal(shrunk.writes.length, 1);
        assert.equal(shrunk.second.relativeGeometry.x, 110);
        assert.equal(shrunk.second.relativeGeometry.width, 90);
        assert.equal(shrunk.first.relativeGeometry.width, 110);
    });

    it("shrinks the near-side focused window in inwards mode (COSMIC flipped-edge semantics)", () => {
        // Inwards flips the pressed edge: pressing left on the near-side
        // focused window targets the shared edge with its right sibling and
        // shrinks the focused window.
        const state = resizeSetup();
        invokeShortcut(state.harness, resizeEnterInverse);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-left");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.width, 90);
        assert.equal(state.second.relativeGeometry.x, 90);
        assert.equal(state.second.relativeGeometry.width, 110);
    });

    it("resizes a vertical split on up/down directions", () => {
        const state = resizeSetup("y");
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-down");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.height, 110);
        assert.equal(state.second.relativeGeometry.y, 110);
        assert.equal(state.second.relativeGeometry.height, 90);
    });

    it("restores normal focus after the mode is exited (cancel/exit)", () => {
        const state = resizeSetup();
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, resizeEnter);
        assert.equal(countEvent(state.harness.logs, "resize-mode-exited"), 1);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(state.harness.logs, "focus-invoked"), 1);
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 0);
        assert.equal(state.writes.length, 0);
    });

    it("never runs two resize steps for one directional press (no duplicate callback effect)", () => {
        const state = resizeSetup();
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.width, 110);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right-arrow");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 2);
        assert.equal(state.writes.length, 2);
        assert.equal(state.first.relativeGeometry.width, 120);
    });

    it("refuses below the 15% floor without any geometry write", () => {
        const state = resizeSetup();
        state.first.relativeGeometry = { x: 0, y: 0, width: 20, height: 200 };
        state.writes.length = 0;
        invokeShortcut(state.harness, resizeEnterInverse);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-left");
        assert.equal(countEvent(state.harness.logs, "resize-rejected:at-floor"), 1);
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 0);
        assert.equal(state.writes.length, 0);
        assert.equal(state.controller.isEnabled, true);
    });

    it("reports a failed geometry write without a second write or rollback and stays enabled", () => {
        const state = resizeSetup("x", "first", "throw");
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(state.harness.logs, "resize-rejected:write-failed"), 1);
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 0);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.width, 100);
        assert.equal(state.controller.isEnabled, true);
    });

    it("reports a postcondition mismatch when the sibling does not adjust, without a rollback write", () => {
        const state = resizeSetup("x", "first", "no-adjust");
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(state.harness.logs, "resize-rejected:postcondition"), 1);
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 0);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.width, 110);
        assert.equal(state.second.relativeGeometry.width, 100);
        assert.equal(state.controller.isEnabled, true);
    });

    it("rejects every ineligible active window with the fixed resize diagnostics", () => {
        const cases: ReadonlyArray<{
            readonly reason: string;
            readonly configure: (state: ReturnType<typeof resizeSetup>) => void;
        }> = [
            {
                reason: "resize-rejected:no-active-window",
                configure: (state) => {
                    state.harness.active = null;
                },
            },
            {
                reason: "resize-rejected:fullscreen",
                configure: (state) => {
                    setFullscreen(state.focused, true);
                },
            },
            {
                reason: "resize-rejected:sticky",
                configure: (state) => {
                    setSticky(state.focused, true);
                },
            },
            {
                reason: "resize-rejected:maximized",
                configure: (state) => {
                    setMaximized(state.focused, 2);
                },
            },
            {
                reason: "resize-rejected:desktop-output-scope",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
            },
            {
                reason: "resize-rejected:active-window-eligibility",
                configure: (state) => {
                    state.focused.resizeable = false;
                },
            },
            {
                reason: "resize-rejected:active-tile-association",
                configure: (state) => {
                    state.focused.tile = null;
                },
            },
            {
                reason: "resize-rejected:focused-occupancy-validity",
                configure: (state) => {
                    state.first.windows = [];
                },
            },
        ];
        for (const entry of cases) {
            const state = resizeSetup("x", "first");
            invokeShortcut(state.harness, resizeEnter);
            entry.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");
            assert.equal(countEvent(state.harness.logs, entry.reason), 1, entry.reason);
            assert.equal(countEvent(state.harness.logs, "resize-completed"), 0, entry.reason);
            assert.equal(state.writes.length, 0, entry.reason);
            assert.equal(state.controller.isEnabled, true, entry.reason);
        }
    });

    it("climbs to an outer split when the focused leaf has no sibling in the pressed direction", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 300, height: 100 }, true);
        root.layoutDirection = 1;
        const inner = tile({ x: 0, y: 0, width: 200, height: 100 }, true);
        inner.layoutDirection = 1;
        inner.parent = root;
        const third = tile({ x: 200, y: 0, width: 100, height: 100 });
        third.parent = root;
        root.tiles = [inner, third];
        const focusedLeaf = tile({ x: 100, y: 0, width: 100, height: 100 });
        const midLeaf = tile({ x: 0, y: 0, width: 100, height: 100 });
        focusedLeaf.parent = inner;
        midLeaf.parent = inner;
        inner.tiles = [midLeaf, focusedLeaf];
        const focused = window({ tile: focusedLeaf, caption: "focused" });
        const mid = window({ tile: midLeaf, caption: "mid" });
        const thirdWin = window({ tile: third, caption: "third" });
        focusedLeaf.windows = [focused];
        midLeaf.windows = [mid];
        third.windows = [thirdWin];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused, mid, thirdWin];
        const writes: number[] = [];
        let innerState = inner.relativeGeometry;
        Object.defineProperty(inner, "relativeGeometry", {
            configurable: true,
            get: () => innerState,
            set: (next: typeof RECT) => {
                writes.push(1);
                innerState = next;
                inner.absoluteGeometry = next;
                const thirdState = third.relativeGeometry;
                const updated = {
                    x: next.x + next.width,
                    y: thirdState.y,
                    width: thirdState.x + thirdState.width - (next.x + next.width),
                    height: thirdState.height,
                };
                third.relativeGeometry = updated;
                third.absoluteGeometry = updated;
            },
        });
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, resizeEnter);
        invokeShortcut(harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(harness.logs, "resize-completed"), 1);
        assert.equal(writes.length, 1);
        assert.equal(inner.relativeGeometry.width, 215);
        assert.equal(third.relativeGeometry.x, 215);
        assert.equal(third.relativeGeometry.width, 85);
        assert.equal(controller.isEnabled, true);
    });

    it("outwards crosses a right boundary by resizing the containing outer child by 5% of the outer split", () => {
        const state = nestedResizeSetup("first", "second");
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");

        // observed-not-endorsed: crossing the inner right boundary writes its
        // containing outer child rather than the focused leaf.
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.deepEqual(state.inner.relativeGeometry, { x: 0, y: 0, width: 215, height: 100 });
        assert.deepEqual(state.outerNeighbor.relativeGeometry, { x: 215, y: 0, width: 85, height: 100 });
        assert.deepEqual(state.focusedLeaf.relativeGeometry, { x: 100, y: 0, width: 100, height: 100 });
    });

    it("inwards crosses a right boundary by resizing the opposite-side containing outer child by 5%", () => {
        const state = nestedResizeSetup("second", "first");
        invokeShortcut(state.harness, resizeEnterInverse);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");

        // observed-not-endorsed: inwards maps right to the left boundary, then
        // writes the containing outer child after climbing.
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.deepEqual(state.inner.relativeGeometry, { x: 115, y: 0, width: 185, height: 100 });
        assert.deepEqual(state.outerNeighbor.relativeGeometry, { x: 0, y: 0, width: 115, height: 100 });
        assert.deepEqual(state.focusedLeaf.relativeGeometry, { x: 100, y: 0, width: 100, height: 100 });
    });

    it("refuses an outermost inwards mode-mapped boundary without a geometry write", () => {
        const state = resizeSetup("x", "first");
        invokeShortcut(state.harness, resizeEnterInverse);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-right");

        // observed-not-endorsed: inwards maps right to the left outer boundary
        // even though this focused tile has a physical right sibling.
        assert.equal(countEvent(state.harness.logs, "resize-rejected:no-parent"), 1);
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 0);
        assert.equal(state.writes.length, 0);
    });

    it("resolves no split when the focused window has no sibling at any matching ancestor", () => {
        const state = resizeSetup("x", "first");
        invokeShortcut(state.harness, resizeEnter);
        invokeShortcut(state.harness, "plasma-auto-tiler-focus-left");
        assert.equal(countEvent(state.harness.logs, "resize-rejected:no-parent"), 1);
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 0);
        assert.equal(state.writes.length, 0);
    });

    it("escapes an edge of a nested 3-child row to the adjacent divider in a 3-child parent", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 400, height: 100 }, true);
        root.layoutDirection = 1;
        const inner = tile({ x: 0, y: 0, width: 200, height: 100 }, true);
        inner.layoutDirection = 1;
        const outerMiddle = tile({ x: 200, y: 0, width: 100, height: 100 });
        const outerRight = tile({ x: 300, y: 0, width: 100, height: 100 });
        inner.parent = root;
        outerMiddle.parent = root;
        outerRight.parent = root;
        root.tiles = [inner, outerMiddle, outerRight];

        const innerFirst = tile({ x: 0, y: 0, width: 60, height: 100 });
        const innerMiddle = tile({ x: 60, y: 0, width: 60, height: 100 });
        const innerFocused = tile({ x: 120, y: 0, width: 80, height: 100 });
        innerFirst.parent = inner;
        innerMiddle.parent = inner;
        innerFocused.parent = inner;
        inner.tiles = [innerFirst, innerMiddle, innerFocused];

        const focused = window({ tile: innerFocused, caption: "focused" });
        const innerMiddleWindow = window({ tile: innerMiddle, caption: "inner-middle" });
        const outerMiddleWindow = window({ tile: outerMiddle, caption: "outer-middle" });
        const outerRightWindow = window({ tile: outerRight, caption: "outer-right" });
        innerFocused.windows = [focused];
        innerMiddle.windows = [innerMiddleWindow];
        outerMiddle.windows = [outerMiddleWindow];
        outerRight.windows = [outerRightWindow];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused, innerMiddleWindow, outerMiddleWindow, outerRightWindow];

        const writes: number[] = [];
        let innerState = inner.relativeGeometry;
        Object.defineProperty(inner, "relativeGeometry", {
            configurable: true,
            get: () => innerState,
            set: (next: typeof RECT) => {
                writes.push(1);
                innerState = next;
                inner.absoluteGeometry = next;
                const nextEdge = next.x + next.width;
                const updated = {
                    x: nextEdge,
                    y: outerMiddle.relativeGeometry.y,
                    width: outerMiddle.relativeGeometry.x + outerMiddle.relativeGeometry.width - nextEdge,
                    height: outerMiddle.relativeGeometry.height,
                };
                outerMiddle.relativeGeometry = updated;
                outerMiddle.absoluteGeometry = updated;
            },
        });

        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, resizeEnter);
        invokeShortcut(harness, "plasma-auto-tiler-focus-right");

        assert.equal(countEvent(harness.logs, "resize-completed"), 1);
        assert.equal(writes.length, 1);
        assert.deepEqual(inner.relativeGeometry, { x: 0, y: 0, width: 220, height: 100 });
        assert.deepEqual(outerMiddle.relativeGeometry, { x: 220, y: 0, width: 80, height: 100 });
        assert.deepEqual(outerRight.relativeGeometry, { x: 300, y: 0, width: 100, height: 100 });
        assert.deepEqual(innerFocused.relativeGeometry, { x: 120, y: 0, width: 80, height: 100 });
        assert.equal(controller.isEnabled, true);
    });

    it("only adjusts the focused child and its divider neighbor in a 3-child row, leaving the third child untouched", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 300, height: 100 }, true);
        root.layoutDirection = 1;
        const first = tile({ x: 0, y: 0, width: 100, height: 100 });
        const second = tile({ x: 100, y: 0, width: 100, height: 100 });
        const third = tile({ x: 200, y: 0, width: 100, height: 100 });
        first.parent = root;
        second.parent = root;
        third.parent = root;
        root.tiles = [first, second, third];
        const focused = window({ tile: first, caption: "focused" });
        const middle = window({ tile: second, caption: "middle" });
        const rightmost = window({ tile: third, caption: "rightmost" });
        first.windows = [focused];
        second.windows = [middle];
        third.windows = [rightmost];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused, middle, rightmost];
        const writes: number[] = [];
        let firstState = first.relativeGeometry;
        Object.defineProperty(first, "relativeGeometry", {
            configurable: true,
            get: () => firstState,
            set: (next: typeof RECT) => {
                writes.push(1);
                firstState = next;
                first.absoluteGeometry = next;
                // Only child index 1 (the immediate divider neighbor) is
                // adjusted; child index 2 is untouched by this setter.
                const secondState = second.relativeGeometry;
                const updated = {
                    x: next.x + next.width,
                    y: secondState.y,
                    width: secondState.x + secondState.width - (next.x + next.width),
                    height: secondState.height,
                };
                second.relativeGeometry = updated;
                second.absoluteGeometry = updated;
            },
        });
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, resizeEnter);
        invokeShortcut(harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(harness.logs, "resize-completed"), 1);
        assert.equal(writes.length, 1);
        assert.equal(first.relativeGeometry.width, 115);
        assert.equal(second.relativeGeometry.x, 115);
        assert.equal(second.relativeGeometry.width, 85);
        assert.deepEqual(third.relativeGeometry, { x: 200, y: 0, width: 100, height: 100 });
        assert.equal(controller.isEnabled, true);
    });

    it("rejects at the outer edge of a 3-child row with no further neighbor or ancestor", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 300, height: 100 }, true);
        root.layoutDirection = 1;
        const first = tile({ x: 0, y: 0, width: 100, height: 100 });
        const second = tile({ x: 100, y: 0, width: 100, height: 100 });
        const third = tile({ x: 200, y: 0, width: 100, height: 100 });
        first.parent = root;
        second.parent = root;
        third.parent = root;
        root.tiles = [first, second, third];
        const focused = window({ tile: third, caption: "focused" });
        const midWin = window({ tile: second, caption: "mid" });
        const leftWin = window({ tile: first, caption: "left" });
        third.windows = [focused];
        second.windows = [midWin];
        first.windows = [leftWin];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused, midWin, leftWin];
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, resizeEnter);
        invokeShortcut(harness, "plasma-auto-tiler-focus-right");
        assert.equal(countEvent(harness.logs, "resize-rejected:no-parent"), 1);
        assert.equal(countEvent(harness.logs, "resize-completed"), 0);
    });
});

describe("TileController bspwm direct resize bindings", () => {
    it("grows the focused window with each resize-expand direction row", () => {
        const state = resizeSetup("x", "first", "adjust", "bspwm");
        invokeShortcut(state.harness, "plasma-auto-tiler-resize-expand-right");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.equal(state.first.relativeGeometry.width, 110);
        assert.equal(state.second.relativeGeometry.width, 90);
    });

    it("shrinks the focused window with each resize-contract direction row", () => {
        const state = resizeSetup("x", "second", "adjust", "bspwm");
        invokeShortcut(state.harness, "plasma-auto-tiler-resize-contract-right");
        assert.equal(countEvent(state.harness.logs, "resize-completed"), 1);
        assert.equal(state.writes.length, 1);
        assert.equal(state.second.relativeGeometry.x, 110);
        assert.equal(state.second.relativeGeometry.width, 90);
        assert.equal(state.first.relativeGeometry.width, 110);
    });
});
