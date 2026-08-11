import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    buildBlueprint,
    buildDwindleBlueprint,
    type Blueprint,
    type Orientation,
} from "../src/layout-blueprint";
import { type Result } from "../src/logic";

function expectOk<T>(result: Result<T>): T {
    assert.ok(result.ok);
    if (!result.ok) {
        throw new Error("expected success");
    }
    return result.value;
}

function expectRejection<T>(result: Result<T>, kind: string): void {
    assert.ok(!result.ok);
    if (result.ok) {
        throw new Error("expected rejection");
    }
    assert.equal(result.reason.kind, kind);
}

function leafCount(node: Blueprint): number {
    if (node.kind === "leaf") {
        return 1;
    }
    return leafCount(node.left) + leafCount(node.right);
}

// Every branch has exactly two children and splits its count into floor/ceil
// halves; leaves form a preorder sequence of exactly 0..n-1.
function assertInvariants(node: Blueprint, startOrdinal: number, endOrdinal: number, orientation: Orientation): void {
    if (node.kind === "leaf") {
        assert.equal(node.ordinal, startOrdinal);
        return;
    }
    assert.equal(node.kind, "branch");
    assert.equal(node.orientation, orientation);
    const count = endOrdinal - startOrdinal;
    assert.ok(count >= 2);
    const leftCount = Math.floor(count / 2);
    const rightCount = count - leftCount;
    assert.equal(leafCount(node.left), leftCount);
    assert.equal(leafCount(node.right), rightCount);
    assert.ok(Math.abs(leftCount - rightCount) <= 1);
    assertInvariants(node.left, startOrdinal, startOrdinal + leftCount, orientation);
    assertInvariants(node.right, startOrdinal + leftCount, endOrdinal, orientation);
}

function ordinals(node: Blueprint): number[] {
    if (node.kind === "leaf") {
        return [node.ordinal];
    }
    return [...ordinals(node.left), ...ordinals(node.right)];
}

describe("buildBlueprint: representative leaf counts and orientations", () => {
    const counts = [1, 2, 3, 4, 5, 7, 8, 16, 17, 31];
    for (const count of counts) {
        for (const orientation of ["vertical", "horizontal"] as const) {
            it(`builds ${count} leaves with ${orientation} orientation`, () => {
                const tree = expectOk(buildBlueprint(count, orientation));
                assert.equal(leafCount(tree), count);
                assertInvariants(tree, 0, count, orientation);
                assert.deepEqual(ordinals(tree), Array.from({ length: count }, (_, i) => i));
            });
        }
    }
});

describe("buildBlueprint: determinism and input immutability", () => {
    it("returns structurally equal blueprints for equivalent inputs", () => {
        const count = 17;
        const orientation: Orientation = "vertical";
        const first = expectOk(buildBlueprint(count, orientation));
        const second = expectOk(buildBlueprint(count, orientation));
        assert.notEqual(first, second);
        assert.deepEqual(first, second);
    });

    it("does not mutate the count or orientation inputs", () => {
        const count = 13;
        const orientation: Orientation = "horizontal";
        expectOk(buildBlueprint(count, orientation));
        assert.equal(count, 13);
        assert.equal(orientation, "horizontal");
    });

    it("never returns a partial plan on rejection", () => {
        const result = buildBlueprint(0, "vertical");
        assert.ok(!result.ok);
        if (result.ok) {
            throw new Error("expected rejection");
        }
        assert.equal(result.reason.kind, "invalid-leaf-count");
        assert.ok(result.reason.message.length > 0);
    });
});

describe("buildBlueprint: invalid counts reject through the Result/Rejection pattern", () => {
    const invalidCounts: Array<[number, string]> = [
        [0, "zero"],
        [-1, "negative"],
        [-100, "negative"],
        [1.5, "fractional"],
        [0.5, "fractional between zero and one"],
        [Number.NaN, "NaN"],
        [Number.POSITIVE_INFINITY, "positive infinity"],
        [Number.NEGATIVE_INFINITY, "negative infinity"],
    ];
    for (const [count, label] of invalidCounts) {
        for (const orientation of ["vertical", "horizontal"] as const) {
            it(`rejects ${label} leaf count ${String(count)} for ${orientation}`, () => {
                expectRejection(buildBlueprint(count, orientation), "invalid-leaf-count");
            });
        }
    }
});

// Exact dwindle chain shapes for counts 1 through 6. Each branch's left child
// is the next ordinal leaf; the right child recurses the remainder with the
// orientation alternating from a horizontal root.
const DWINDLE_BLUEPRINTS: Array<[number, Blueprint]> = [
    [1, { kind: "leaf", ordinal: 0 }],
    [
        2,
        {
            kind: "branch",
            orientation: "horizontal",
            left: { kind: "leaf", ordinal: 0 },
            right: { kind: "leaf", ordinal: 1 },
        },
    ],
    [
        3,
        {
            kind: "branch",
            orientation: "horizontal",
            left: { kind: "leaf", ordinal: 0 },
            right: {
                kind: "branch",
                orientation: "vertical",
                left: { kind: "leaf", ordinal: 1 },
                right: { kind: "leaf", ordinal: 2 },
            },
        },
    ],
    [
        4,
        {
            kind: "branch",
            orientation: "horizontal",
            left: { kind: "leaf", ordinal: 0 },
            right: {
                kind: "branch",
                orientation: "vertical",
                left: { kind: "leaf", ordinal: 1 },
                right: {
                    kind: "branch",
                    orientation: "horizontal",
                    left: { kind: "leaf", ordinal: 2 },
                    right: { kind: "leaf", ordinal: 3 },
                },
            },
        },
    ],
    [
        5,
        {
            kind: "branch",
            orientation: "horizontal",
            left: { kind: "leaf", ordinal: 0 },
            right: {
                kind: "branch",
                orientation: "vertical",
                left: { kind: "leaf", ordinal: 1 },
                right: {
                    kind: "branch",
                    orientation: "horizontal",
                    left: { kind: "leaf", ordinal: 2 },
                    right: {
                        kind: "branch",
                        orientation: "vertical",
                        left: { kind: "leaf", ordinal: 3 },
                        right: { kind: "leaf", ordinal: 4 },
                    },
                },
            },
        },
    ],
    [
        6,
        {
            kind: "branch",
            orientation: "horizontal",
            left: { kind: "leaf", ordinal: 0 },
            right: {
                kind: "branch",
                orientation: "vertical",
                left: { kind: "leaf", ordinal: 1 },
                right: {
                    kind: "branch",
                    orientation: "horizontal",
                    left: { kind: "leaf", ordinal: 2 },
                    right: {
                        kind: "branch",
                        orientation: "vertical",
                        left: { kind: "leaf", ordinal: 3 },
                        right: {
                            kind: "branch",
                            orientation: "horizontal",
                            left: { kind: "leaf", ordinal: 4 },
                            right: { kind: "leaf", ordinal: 5 },
                        },
                    },
                },
            },
        },
    ],
];

describe("buildDwindleBlueprint: exact alternating chain topology for counts 1 through 6", () => {
    for (const [count, expected] of DWINDLE_BLUEPRINTS) {
        it(`builds the exact dwindle tree for ${count} leaves`, () => {
            assert.deepEqual(expectOk(buildDwindleBlueprint(count)), expected);
        });
    }

    it("is deterministic and never returns a partial plan on rejection", () => {
        const count = 6;
        const first = expectOk(buildDwindleBlueprint(count));
        const second = expectOk(buildDwindleBlueprint(count));
        assert.notEqual(first, second);
        assert.deepEqual(first, second);
        const rejected = buildDwindleBlueprint(0);
        assert.ok(!rejected.ok);
        if (rejected.ok) {
            throw new Error("expected rejection");
        }
        assert.equal(rejected.reason.kind, "invalid-leaf-count");
    });

    it("rejects the same invalid counts as the balanced generator", () => {
        for (const [count, label] of [
            [0, "zero"],
            [-1, "negative"],
            [1.5, "fractional"],
            [Number.NaN, "NaN"],
            [Number.POSITIVE_INFINITY, "positive infinity"],
        ] as Array<[number, string]>) {
            it(`rejects ${label} leaf count ${String(count)}`, () => {
                expectRejection(buildDwindleBlueprint(count), "invalid-leaf-count");
            });
        }
    });
});
