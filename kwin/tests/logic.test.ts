import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    DIRECTIONS,
    classifyDirection,
    compareLeaves,
    containsPoint,
    findNeighborLeaf,
    isEligibleWindow,
    pickTargetLeaf,
    planAutomaticPlacement,
    planCancellation,
    planDragPlacement,
    planKeyboardInsertion,
    sameScope,
    type AutomaticRequest,
    type Direction,
    type DragRequest,
    type KeyboardRequest,
    type Leaf,
    type OriginRecord,
    type Point,
    type Rect,
    type Rejection,
    type Result,
    type Scope,
    type WindowRef,
} from "../src/logic";

const SCOPE_1: Scope = { output: {}, desktopId: "1" };
const SCOPE_2: Scope = { output: {}, desktopId: "2" };
const SCOPE_2_SAME_OUTPUT: Scope = { output: SCOPE_1.output, desktopId: "2" };

const RECT_100: Rect = { x: 0, y: 0, width: 100, height: 100 };
const RECT_RIGHT: Rect = { x: 200, y: 0, width: 100, height: 100 };

function window(id: string, normal = true, managed = true): WindowRef {
    return { id, normal, managed };
}

function leaf(
    id: string,
    geometry: Rect,
    windows: readonly WindowRef[] = [],
    isLayout = false,
): Leaf {
    return { id, isLayout, geometry, windows };
}

function expectOk<T>(result: Result<T>): T {
    assert.ok(result.ok);
    if (!result.ok) {
        throw new Error("expected success");
    }
    return result.value;
}

function expectRejection<T>(result: Result<T>, kind: Rejection["kind"]): void {
    assert.ok(!result.ok);
    if (result.ok) {
        throw new Error("expected rejection");
    }
    assert.equal(result.reason.kind, kind);
}

function expectDirection(point: Point, rect: Rect): Direction {
    const classified = expectOk(classifyDirection(point, rect));
    if (classified.kind === "center") {
        throw new Error("expected a direction");
    }
    return classified.direction;
}

function keyRequest(overrides: Partial<KeyboardRequest>): KeyboardRequest {
    const focusedLeaf = leaf("focused", RECT_100, [window("win-focused")]);
    return {
        scope: SCOPE_1,
        focusedLeaf,
        focusedWindow: window("win-focused"),
        incoming: window("win-incoming"),
        record: null,
        ...overrides,
    };
}

function dragRequest(overrides: Partial<DragRequest>): DragRequest {
    const originLeaf = leaf("origin", RECT_100, [window("win-dragged")]);
    const targetLeaf = leaf("target", RECT_RIGHT, [window("win-target")]);
    return {
        scope: SCOPE_1,
        originLeaf,
        draggedWindow: window("win-dragged"),
        targetLeaf,
        pointer: { x: 290, y: 50 },
        record: null,
        ...overrides,
    };
}

function autoRequest(overrides: Partial<AutomaticRequest>): AutomaticRequest {
    return {
        scope: SCOPE_1,
        window: window("win-auto"),
        leaves: [leaf("a", { x: 0, y: 0, width: 100, height: 100 })],
        ...overrides,
    };
}

describe("classifyDirection: four regions, dead zone, and boundaries", () => {
    it("selects each of the four directions from an interior point of its region", () => {
        const cases: ReadonlyArray<[Point, Direction]> = [
            [{ x: 90, y: 50 }, "right"],
            [{ x: 10, y: 50 }, "left"],
            [{ x: 50, y: 10 }, "up"],
            [{ x: 50, y: 90 }, "down"],
        ];
        for (const [point, expected] of cases) {
            assert.equal(expectDirection(point, RECT_100), expected);
        }
    });

    it("covers all four declared directions", () => {
        assert.deepEqual([...DIRECTIONS].sort(), ["down", "left", "right", "up"]);
    });

    it("returns center for the central 50% no-op zone", () => {
        for (const point of [
            { x: 50, y: 50 },
            { x: 49.9, y: 49.9 },
            { x: 40, y: 50 },
            { x: 50, y: 60 },
        ]) {
            const result = expectOk(classifyDirection(point, RECT_100));
            assert.equal(result.kind, "center", `expected center for ${JSON.stringify(point)}`);
        }
    });

    it("selects a direction at the exact 0.25 dead-zone boundary", () => {
        const cases: ReadonlyArray<[Point, Direction]> = [
            [{ x: 25, y: 50 }, "left"],
            [{ x: 75, y: 50 }, "right"],
            [{ x: 50, y: 25 }, "up"],
            [{ x: 50, y: 75 }, "down"],
        ];
        for (const [point, expected] of cases) {
            assert.equal(expectDirection(point, RECT_100), expected);
        }
    });

    it("resolves a diagonal by magnitude, horizontal wins an exact tie", () => {
        const cases: ReadonlyArray<[Point, Direction]> = [
            [{ x: 90, y: 10 }, "right"], // |dx| === |dy| tie -> horizontal
            [{ x: 10, y: 90 }, "left"],
            [{ x: 25, y: 25 }, "left"], // exact 0.25 tie -> horizontal
            [{ x: 75, y: 75 }, "right"],
            [{ x: 90, y: 20 }, "right"], // horizontal magnitude dominates
            [{ x: 20, y: 90 }, "down"], // vertical magnitude dominates
        ];
        for (const [point, expected] of cases) {
            assert.equal(expectDirection(point, RECT_100), expected);
        }
    });
});

describe("classifyDirection: half-open edges and invalid input", () => {
    it("keeps containment half-open: right and bottom edges are outside", () => {
        expectRejection(classifyDirection({ x: 100, y: 50 }, RECT_100), "pointer-outside");
        expectRejection(classifyDirection({ x: 50, y: 100 }, RECT_100), "pointer-outside");
        expectRejection(classifyDirection({ x: 100, y: 100 }, RECT_100), "pointer-outside");
        expectRejection(classifyDirection({ x: -1, y: 50 }, RECT_100), "pointer-outside");
        expectOk(classifyDirection({ x: 0, y: 50 }, RECT_100));
        expectOk(classifyDirection({ x: 50, y: 0 }, RECT_100));
    });

    it("rejects non-positive or non-finite rectangles", () => {
        const badRects: Rect[] = [
            { x: 0, y: 0, width: 0, height: 100 },
            { x: 0, y: 0, width: 100, height: 0 },
            { x: 0, y: 0, width: -10, height: 100 },
            { x: 0, y: 0, width: Number.NaN, height: 100 },
            { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
            { x: Number.NaN, y: 0, width: 100, height: 100 },
        ];
        for (const rect of badRects) {
            expectRejection(classifyDirection({ x: 50, y: 50 }, rect), "invalid-geometry");
        }
    });

    it("rejects non-finite pointer numbers", () => {
        const badPoints: Point[] = [
            { x: Number.NaN, y: 50 },
            { x: 50, y: Number.NaN },
            { x: Number.POSITIVE_INFINITY, y: 50 },
            { x: 50, y: Number.NEGATIVE_INFINITY },
        ];
        for (const point of badPoints) {
            expectRejection(classifyDirection(point, RECT_100), "invalid-numbers");
        }
    });

    it("exposes half-open containment on containsPoint directly", () => {
        assert.equal(containsPoint(RECT_100, { x: 0, y: 0 }), true);
        assert.equal(containsPoint(RECT_100, { x: 99.9, y: 50 }), true);
        assert.equal(containsPoint(RECT_100, { x: 100, y: 50 }), false);
        assert.equal(containsPoint(RECT_100, { x: 50, y: 100 }), false);
        assert.equal(containsPoint(RECT_100, { x: -0.1, y: 50 }), false);
    });
});

describe("pickTargetLeaf: deterministic occupied-target selection", () => {
    it("selects only occupied non-layout leaves under the point", () => {
        const occupied = leaf("o", RECT_100, [window("w1")]);
        const empty = leaf("e", RECT_RIGHT, []);
        const layout = leaf("l", { x: 400, y: 0, width: 100, height: 100 }, [], true);
        assert.equal(pickTargetLeaf([occupied, empty, layout], { x: 50, y: 50 })?.id, "o");
        assert.equal(pickTargetLeaf([empty, layout], { x: 50, y: 50 }), null);
        assert.equal(pickTargetLeaf([occupied], { x: 100, y: 50 }), null);
    });

    it("orders candidates by top edge, then left edge, then id", () => {
        const tall = leaf("tall", { x: 0, y: 50, width: 100, height: 100 }, [window("w1")]);
        const high = leaf("high", { x: 0, y: 10, width: 100, height: 100 }, [window("w2")]);
        assert.equal(pickTargetLeaf([tall, high], { x: 50, y: 60 })?.id, "high");

        const right = leaf("right", { x: 20, y: 10, width: 100, height: 100 }, [window("w3")]);
        const left = leaf("left", { x: 10, y: 10, width: 100, height: 100 }, [window("w4")]);
        assert.equal(pickTargetLeaf([right, left], { x: 50, y: 60 })?.id, "left");

        const idB = leaf("b", { x: 10, y: 10, width: 100, height: 100 }, [window("w5")]);
        const idA = leaf("a", { x: 10, y: 10, width: 100, height: 100 }, [window("w6")]);
        assert.equal(pickTargetLeaf([idB, idA], { x: 50, y: 60 })?.id, "a");
    });

    it("compareLeaves implements the same ordering rule", () => {
        const byY = leaf("a", { x: 0, y: 5, width: 1, height: 1 }, [window("w")]);
        const byX = leaf("b", { x: 5, y: 5, width: 1, height: 1 }, [window("w")]);
        const byId = leaf("c", { x: 0, y: 0, width: 1, height: 1 }, [window("w")]);
        assert.ok(compareLeaves(byY, byX) < 0);
        assert.ok(compareLeaves(byX, byY) > 0);
        assert.equal(compareLeaves(byY, byY), 0);
        assert.ok(compareLeaves(byId, { ...byId, id: "d" }) < 0);
    });
});

describe("findNeighborLeaf: directional neighbor selection", () => {
    const CURRENT = leaf("current", { x: 0, y: 0, width: 100, height: 100 });

    it("selects the qualifying neighbor for each of the four directions", () => {
        const left = leaf("left", { x: -200, y: 0, width: 100, height: 100 }, [window("w-left")]);
        const right = leaf("right", { x: 200, y: 0, width: 100, height: 100 }, [window("w-right")]);
        const up = leaf("up", { x: 0, y: -200, width: 100, height: 100 }, [window("w-up")]);
        const down = leaf("down", { x: 0, y: 200, width: 100, height: 100 }, [window("w-down")]);
        const leaves = [CURRENT, left, right, up, down];
        assert.equal(findNeighborLeaf(leaves, CURRENT, "left")?.id, "left");
        assert.equal(findNeighborLeaf(leaves, CURRENT, "right")?.id, "right");
        assert.equal(findNeighborLeaf(leaves, CURRENT, "up")?.id, "up");
        assert.equal(findNeighborLeaf(leaves, CURRENT, "down")?.id, "down");
    });

    it("rejects edge-touch and diagonal-only candidates", () => {
        const edgeRight = leaf("edge-right", { x: 100, y: 0, width: 100, height: 100 }, [window("w")]);
        assert.equal(findNeighborLeaf([CURRENT, edgeRight], CURRENT, "right"), null);
        const edgeLeft = leaf("edge-left", { x: -100, y: 0, width: 100, height: 100 }, [window("w")]);
        assert.equal(findNeighborLeaf([CURRENT, edgeLeft], CURRENT, "left"), null);
        const edgeUp = leaf("edge-up", { x: 0, y: -100, width: 100, height: 100 }, [window("w")]);
        assert.equal(findNeighborLeaf([CURRENT, edgeUp], CURRENT, "up"), null);
        const edgeDown = leaf("edge-down", { x: 0, y: 100, width: 100, height: 100 }, [window("w")]);
        assert.equal(findNeighborLeaf([CURRENT, edgeDown], CURRENT, "down"), null);

        const perpTouch = leaf("perp-touch", { x: 200, y: 100, width: 100, height: 100 }, [window("w")]);
        assert.equal(findNeighborLeaf([CURRENT, perpTouch], CURRENT, "right"), null);

        const diagonal = leaf("diagonal", { x: 200, y: 200, width: 100, height: 100 }, [window("w")]);
        for (const direction of DIRECTIONS) {
            assert.equal(findNeighborLeaf([CURRENT, diagonal], CURRENT, direction), null);
        }
    });

    it("permits gaps and picks the smallest facing-edge distance", () => {
        const near = leaf("near", { x: 300, y: 0, width: 100, height: 100 }, [window("w1")]);
        const far = leaf("far", { x: 600, y: 0, width: 100, height: 100 }, [window("w2")]);
        assert.equal(findNeighborLeaf([CURRENT, near], CURRENT, "right")?.id, "near");
        assert.equal(findNeighborLeaf([CURRENT, far, near], CURRENT, "right")?.id, "near");
    });

    it("tie-breaks by top edge, then left edge, then stable id", () => {
        const current = leaf("current", { x: 0, y: 50, width: 100, height: 50 });
        const lower = leaf("lower", { x: 200, y: 50, width: 100, height: 50 }, [window("w1")]);
        const higher = leaf("higher", { x: 200, y: 20, width: 100, height: 50 }, [window("w2")]);
        assert.equal(findNeighborLeaf([current, lower, higher], current, "right")?.id, "higher");

        const current2 = leaf("current", { x: 50, y: 0, width: 100, height: 100 });
        const right = leaf("right", { x: 50, y: 200, width: 100, height: 100 }, [window("w3")]);
        const left = leaf("left", { x: 10, y: 200, width: 100, height: 100 }, [window("w4")]);
        assert.equal(findNeighborLeaf([current2, right, left], current2, "down")?.id, "left");

        const idB = leaf("b", { x: 50, y: 200, width: 100, height: 100 }, [window("w5")]);
        const idA = leaf("a", { x: 50, y: 200, width: 100, height: 100 }, [window("w6")]);
        assert.equal(findNeighborLeaf([current2, idB, idA], current2, "down")?.id, "a");
    });

    it("is invariant to input order and excludes the current leaf by id", () => {
        const a = leaf("a", { x: 200, y: 0, width: 100, height: 100 }, [window("w1")]);
        const b = leaf("b", { x: 200, y: 20, width: 100, height: 100 }, [window("w2")]);
        assert.equal(findNeighborLeaf([CURRENT, a, b], CURRENT, "right")?.id, "a");
        assert.equal(findNeighborLeaf([b, a, CURRENT], CURRENT, "right")?.id, "a");

        const duplicateId = leaf("current", { x: 200, y: 0, width: 100, height: 100 }, [window("w3")]);
        assert.equal(findNeighborLeaf([CURRENT, duplicateId], CURRENT, "right"), null);
        assert.equal(findNeighborLeaf([CURRENT], CURRENT, "right"), null);
    });

    it("returns null for an empty result and never wraps", () => {
        const rightOnly = leaf("right", { x: 200, y: 0, width: 100, height: 100 }, [window("w")]);
        assert.equal(findNeighborLeaf([CURRENT, rightOnly], CURRENT, "left"), null);
        assert.equal(findNeighborLeaf([CURRENT, rightOnly], CURRENT, "up"), null);
        assert.equal(findNeighborLeaf([CURRENT, rightOnly], CURRENT, "down"), null);
        assert.equal(findNeighborLeaf([], CURRENT, "right"), null);
    });

    it("never mutates inputs and returns the exact candidate leaf", () => {
        const right = leaf("right", { x: 200, y: 0, width: 100, height: 100 }, [window("w")]);
        const leaves = [CURRENT, right];
        const selected = findNeighborLeaf(leaves, CURRENT, "right");
        assert.equal(selected, right);
        assert.deepEqual(leaves, [CURRENT, right]);
        assert.deepEqual(leaves[0]?.geometry, { x: 0, y: 0, width: 100, height: 100 });
        assert.equal(leaves[1]?.windows.length, 1);
    });
});

describe("planKeyboardInsertion: right-only placement", () => {
    it("places the incoming window right of the focused occupied target", () => {
        const plan = expectOk(planKeyboardInsertion(keyRequest({})));
        assert.equal(plan.kind, "keyboard-right");
        assert.equal(plan.targetWindow.id, "win-focused");
        assert.equal(plan.incoming.id, "win-incoming");
        assert.equal(plan.targetSide, "left");
        assert.equal(plan.incomingSide, "right");
        assert.equal(plan.targetLeaf.id, "focused");
    });

    it("rejects when the focused leaf is empty", () => {
        const focusedLeaf = leaf("focused", RECT_100, []);
        expectRejection(
            planKeyboardInsertion(keyRequest({ focusedLeaf })),
            "empty-target",
        );
    });

    it("rejects a focused window that is not in the focused leaf", () => {
        const focusedLeaf = leaf("focused", RECT_100, [window("other")]);
        expectRejection(
            planKeyboardInsertion(keyRequest({ focusedLeaf })),
            "mismatched-state",
        );
    });

    it("rejects an ineligible focused or incoming window", () => {
        const ineligibleFocused = leaf("focused", RECT_100, [window("win-focused", false)]);
        expectRejection(
            planKeyboardInsertion(keyRequest({ focusedLeaf: ineligibleFocused })),
            "ineligible-target",
        );
        expectRejection(
            planKeyboardInsertion(keyRequest({ incoming: window("win-incoming", false) })),
            "ineligible-window",
        );
        expectRejection(
            planKeyboardInsertion(keyRequest({ incoming: window("win-incoming", true, false) })),
            "ineligible-window",
        );
    });

    it("rejects a new-window mismatch: incoming is the focused window", () => {
        expectRejection(
            planKeyboardInsertion(keyRequest({ incoming: window("win-focused") })),
            "same-window",
        );
    });

    it("rejects when the incoming window already occupies the focused leaf", () => {
        const focusedLeaf = leaf("focused", RECT_100, [
            window("win-focused"),
            window("win-incoming"),
        ]);
        expectRejection(
            planKeyboardInsertion(keyRequest({ focusedLeaf })),
            "same-leaf",
        );
    });

    it("rejects a stale recorded focus", () => {
        const record = { scope: SCOPE_1, leafId: "other-leaf", windowId: "win-focused" };
        expectRejection(planKeyboardInsertion(keyRequest({ record })), "stale-state");
        const staleWindow = { scope: SCOPE_1, leafId: "focused", windowId: "old-window" };
        expectRejection(planKeyboardInsertion(keyRequest({ record: staleWindow })), "stale-state");
    });

    it("rejects a cross-scope recorded focus", () => {
        const record = { scope: SCOPE_2, leafId: "focused", windowId: "win-focused" };
        expectRejection(planKeyboardInsertion(keyRequest({ record })), "cross-scope");
    });

    it("rejects a layout container and invalid focused geometry", () => {
        const layoutLeaf = leaf("focused", RECT_100, [window("win-focused")], true);
        expectRejection(
            planKeyboardInsertion(keyRequest({ focusedLeaf: layoutLeaf })),
            "ineligible-target",
        );
        const badGeometry = leaf("focused", { x: 0, y: 0, width: 0, height: 100 }, [
            window("win-focused"),
        ]);
        expectRejection(
            planKeyboardInsertion(keyRequest({ focusedLeaf: badGeometry })),
            "invalid-geometry",
        );
    });
});

describe("planDragPlacement: directional placement and origin retention", () => {
    it("plans each direction with dragged window on the selected side", () => {
        const cases: ReadonlyArray<[Point, Direction]> = [
            [{ x: 290, y: 50 }, "right"],
            [{ x: 210, y: 50 }, "left"],
            [{ x: 250, y: 10 }, "up"],
            [{ x: 250, y: 90 }, "down"],
        ];
        for (const [pointer, direction] of cases) {
            const plan = expectOk(planDragPlacement(dragRequest({ pointer })));
            assert.equal(plan.kind, "drag-direction");
            assert.equal(plan.direction, direction);
            assert.equal(plan.selectedWindow.id, "win-dragged");
            assert.equal(plan.oppositeWindow.id, "win-target");
        }
    });

    it("retains the origin leaf on success", () => {
        const originLeaf = leaf("origin", RECT_100, [window("win-dragged")]);
        const plan = expectOk(
            planDragPlacement(dragRequest({ originLeaf })),
        );
        assert.equal(plan.kind, "drag-direction");
        assert.equal(plan.originRetained, true);
        assert.equal(plan.originLeaf, originLeaf);
        assert.equal(plan.originLeaf.windows[0]?.id, "win-dragged");
    });

    it("is a no-op in the central dead zone", () => {
        const plan = expectOk(planDragPlacement(dragRequest({ pointer: { x: 250, y: 50 } })));
        assert.equal(plan.kind, "drag-noop");
    });

    it("rejects a pointer outside the target leaf", () => {
        expectRejection(
            planDragPlacement(dragRequest({ pointer: { x: 300, y: 50 } })),
            "pointer-outside",
        );
    });

    it("rejects the same window, same leaf, empty and ineligible targets", () => {
        const originHoldingTarget = leaf("origin", RECT_100, [window("win-target")]);
        expectRejection(
            planDragPlacement(
                dragRequest({ originLeaf: originHoldingTarget, draggedWindow: window("win-target") }),
            ),
            "same-window",
        );
        const sameLeaf = leaf("origin", RECT_RIGHT, [window("win-target")]);
        expectRejection(planDragPlacement(dragRequest({ targetLeaf: sameLeaf })), "same-leaf");
        const empty = leaf("target", RECT_RIGHT, []);
        expectRejection(planDragPlacement(dragRequest({ targetLeaf: empty })), "empty-target");
        const layout = leaf("target", RECT_RIGHT, [window("win-target")], true);
        expectRejection(planDragPlacement(dragRequest({ targetLeaf: layout })), "ineligible-target");
        const ineligibleTarget = leaf("target", RECT_RIGHT, [window("win-target", false)]);
        expectRejection(
            planDragPlacement(dragRequest({ targetLeaf: ineligibleTarget })),
            "ineligible-target",
        );
    });

    it("rejects a dragged window that is not in the origin leaf", () => {
        const originLeaf = leaf("origin", RECT_100, [window("other")]);
        expectRejection(
            planDragPlacement(dragRequest({ originLeaf })),
            "mismatched-state",
        );
    });

    it("rejects an ineligible dragged window", () => {
        const originLeaf = leaf("origin", RECT_100, [window("win-dragged", false)]);
        expectRejection(
            planDragPlacement(dragRequest({ originLeaf, draggedWindow: window("win-dragged", false) })),
            "ineligible-window",
        );
    });

    it("rejects stale and cross-scope drag records", () => {
        const staleLeaf: OriginRecord = {
            scope: SCOPE_1,
            originLeafId: "other-leaf",
            windowId: "win-dragged",
            geometry: RECT_100,
        };
        expectRejection(planDragPlacement(dragRequest({ record: staleLeaf })), "stale-state");
        const staleWindow: OriginRecord = {
            scope: SCOPE_1,
            originLeafId: "origin",
            windowId: "old-window",
            geometry: RECT_100,
        };
        expectRejection(planDragPlacement(dragRequest({ record: staleWindow })), "stale-state");
        const crossScope: OriginRecord = {
            scope: SCOPE_2,
            originLeafId: "origin",
            windowId: "win-dragged",
            geometry: RECT_100,
        };
        expectRejection(planDragPlacement(dragRequest({ record: crossScope })), "cross-scope");
    });

    it("rejects invalid geometry and invalid pointer numbers", () => {
        const badOrigin = leaf("origin", { x: 0, y: 0, width: 0, height: 100 }, [
            window("win-dragged"),
        ]);
        expectRejection(planDragPlacement(dragRequest({ originLeaf: badOrigin })), "invalid-geometry");
        const badTarget = leaf("target", { x: 0, y: 0, width: Number.NaN, height: 100 }, [
            window("win-target"),
        ]);
        expectRejection(planDragPlacement(dragRequest({ targetLeaf: badTarget })), "invalid-geometry");
        expectRejection(
            planDragPlacement(dragRequest({ pointer: { x: Number.NaN, y: 50 } })),
            "invalid-numbers",
        );
    });
});

describe("planCancellation: origin restoration and scope rejection", () => {
    const validRecord: OriginRecord = {
        scope: SCOPE_1,
        originLeafId: "origin",
        windowId: "win-dragged",
        geometry: { x: 12, y: 34, width: 50, height: 60 },
    };

    it("returns only the recorded origin association and geometry", () => {
        const plan = expectOk(planCancellation({ scope: SCOPE_1, record: validRecord }));
        assert.deepEqual(plan, {
            kind: "cancellation",
            scope: SCOPE_1,
            originLeafId: "origin",
            windowId: "win-dragged",
            geometry: { x: 12, y: 34, width: 50, height: 60 },
        });
    });

    it("rejects a missing record as stale state", () => {
        expectRejection(planCancellation({ scope: SCOPE_1, record: null }), "stale-state");
    });

    it("rejects a cross-scope record", () => {
        const crossScope = { ...validRecord, scope: SCOPE_2 };
        expectRejection(planCancellation({ scope: SCOPE_1, record: crossScope }), "cross-scope");
        const sameOutputOtherDesktop = { ...validRecord, scope: SCOPE_2_SAME_OUTPUT };
        expectRejection(
            planCancellation({ scope: SCOPE_1, record: sameOutputOtherDesktop }),
            "cross-scope",
        );
    });

    it("rejects an invalid recorded geometry", () => {
        const badGeometry = { ...validRecord, geometry: { x: 0, y: 0, width: 0, height: 10 } };
        expectRejection(planCancellation({ scope: SCOPE_1, record: badGeometry }), "invalid-geometry");
    });
});

describe("planAutomaticPlacement: retained empty-leaf selection", () => {
    it("selects the smallest retained empty leaf by the ordering rule", () => {
        const below = leaf("z", { x: 0, y: 50, width: 100, height: 100 });
        const above = leaf("a", { x: 0, y: 0, width: 100, height: 100 });
        const plan = expectOk(
            planAutomaticPlacement(autoRequest({ leaves: [below, above] })),
        );
        assert.equal(plan.kind, "auto-fill");
        assert.equal(plan.leaf.id, "a");
        assert.equal(plan.window.id, "win-auto");
        assert.equal(plan.assignmentOnly, true);
    });

    it("tie-breaks by left edge and then by id", () => {
        const right = leaf("z", { x: 20, y: 0, width: 100, height: 100 });
        const left = leaf("a", { x: 10, y: 0, width: 100, height: 100 });
        const plan = expectOk(
            planAutomaticPlacement(autoRequest({ leaves: [right, left] })),
        );
        assert.equal(plan.leaf.id, "a");

        const idB = leaf("b", { x: 10, y: 0, width: 100, height: 100 });
        const idA = leaf("a", { x: 10, y: 0, width: 100, height: 100 });
        const planB = expectOk(
            planAutomaticPlacement(autoRequest({ leaves: [idB, idA] })),
        );
        assert.equal(planB.leaf.id, "a");
    });

    it("ignores layout containers and rejects when no empty leaf exists", () => {
        const layout = leaf("container", { x: 0, y: 0, width: 100, height: 100 }, [], true);
        expectRejection(
            planAutomaticPlacement(autoRequest({ leaves: [layout] })),
            "no-target",
        );
        const occupied = leaf("o", { x: 0, y: 0, width: 100, height: 100 }, [window("w")]);
        expectRejection(
            planAutomaticPlacement(autoRequest({ leaves: [occupied] })),
            "no-target",
        );
    });

    it("rejects an already-placed or ineligible window", () => {
        const occupied = leaf("o", { x: 0, y: 0, width: 100, height: 100 }, [window("win-auto")]);
        expectRejection(
            planAutomaticPlacement(autoRequest({ leaves: [occupied] })),
            "same-window",
        );
        expectRejection(
            planAutomaticPlacement(autoRequest({ window: window("win-auto", false) })),
            "ineligible-window",
        );
    });

    it("rejects invalid leaf geometry", () => {
        const bad = leaf("b", { x: 0, y: 0, width: 0, height: 100 });
        expectRejection(
            planAutomaticPlacement(autoRequest({ leaves: [bad] })),
            "invalid-geometry",
        );
    });
});

describe("identity, eligibility, and immutability", () => {
    it("compares scope by exact output identity plus desktop id", () => {
        assert.equal(sameScope(SCOPE_1, SCOPE_1), true);
        assert.equal(sameScope(SCOPE_1, SCOPE_2), false);
        assert.equal(sameScope(SCOPE_1, SCOPE_2_SAME_OUTPUT), false);
    });

    it("isEligibleWindow requires normal and managed", () => {
        assert.equal(isEligibleWindow(window("w")), true);
        assert.equal(isEligibleWindow(window("w", false)), false);
        assert.equal(isEligibleWindow(window("w", true, false)), false);
    });

    it("never mutates inputs and emits no rebuild instruction", () => {
        const originLeaf = leaf("origin", RECT_100, [window("win-dragged")]);
        const targetLeaf = leaf("target", RECT_RIGHT, [window("win-target")]);
        const drag = expectOk(
            planDragPlacement({
                scope: SCOPE_1,
                originLeaf,
                draggedWindow: window("win-dragged"),
                targetLeaf,
                pointer: { x: 290, y: 50 },
                record: null,
            }),
        );
        assert.equal(drag.kind, "drag-direction");
        assert.equal(drag.originLeaf, originLeaf);
        assert.equal(drag.targetLeaf, targetLeaf);
        assert.equal(originLeaf.windows.length, 1);
        assert.equal(originLeaf.windows[0]?.id, "win-dragged");
        assert.equal(targetLeaf.windows[0]?.id, "win-target");
        assert.ok(!("rebuild" in drag));
        assert.ok(!("collapse" in drag));
        assert.ok(!("split" in drag));

        const focusLeaf = leaf("focused", RECT_100, [window("win-focused")]);
        const keyboard = expectOk(
            planKeyboardInsertion({
                scope: SCOPE_1,
                focusedLeaf: focusLeaf,
                focusedWindow: window("win-focused"),
                incoming: window("win-incoming"),
                record: null,
            }),
        );
        assert.equal(keyboard.kind, "keyboard-right");
        assert.equal(keyboard.targetLeaf, focusLeaf);
        assert.equal(focusLeaf.windows.length, 1);
        assert.ok(!("rebuild" in keyboard));

        const empty = leaf("e", RECT_100);
        const auto = expectOk(
            planAutomaticPlacement({ scope: SCOPE_1, window: window("win-auto"), leaves: [empty] }),
        );
        assert.equal(auto.kind, "auto-fill");
        assert.equal(auto.assignmentOnly, true);
        assert.equal(auto.leaf, empty);
        assert.equal(empty.windows.length, 0);
    });
});
