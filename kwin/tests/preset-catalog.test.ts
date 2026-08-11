import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    buildPreset,
    PRESET_KINDS,
    type PresetKind,
} from "../src/preset-catalog";
import {
    compileBlueprintInstructions,
    type BlueprintInstructions,
    type BlueprintPath,
} from "../src/layout-instructions";
import { buildBlueprint, buildBlueprintByDepth, type Orientation } from "../src/layout-blueprint";
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

function pathKey(path: BlueprintPath): string {
    return path.join("/");
}

// Each split targets an already-created path and creates two new child paths,
// so the splits are executable in pre-order and end at exactly the leaves.
function assertExecutablePreorder(instructions: BlueprintInstructions): void {
    const available = new Set(["root"]);
    for (const split of instructions.splits) {
        assert.ok(available.delete(pathKey(split.targetPath)));
        assert.notEqual(pathKey(split.leftPath), pathKey(split.rightPath));
        available.add(pathKey(split.leftPath));
        available.add(pathKey(split.rightPath));
    }
    assert.deepEqual(
        [...available].sort(),
        instructions.leafPaths.map((leaf) => pathKey(leaf.path)).sort(),
    );
}

// Simulate the floor/ceil split shape over the compiled instructions to prove
// every subtree is balanced: child counts differ by at most one and every leaf
// path resolves to a single unit.
function assertBalancedInstructions(instructions: BlueprintInstructions, count: number): void {
    const counts = new Map<string, number>([["root", count]]);
    for (const split of instructions.splits) {
        const targetKey = pathKey(split.targetPath);
        const leftKey = pathKey(split.leftPath);
        const rightKey = pathKey(split.rightPath);
        const targetCount = counts.get(targetKey);
        assert.ok(targetCount !== undefined);
        const leftCount = Math.floor(targetCount / 2);
        const rightCount = targetCount - leftCount;
        assert.ok(Math.abs(leftCount - rightCount) <= 1);
        counts.set(leftKey, leftCount);
        counts.set(rightKey, rightCount);
    }
    assert.equal(instructions.leafPaths.length, count);
    for (const leaf of instructions.leafPaths) {
        assert.equal(counts.get(pathKey(leaf.path)), 1);
    }
}

function balancedOrientationAtDepth(depth: number): Orientation {
    return depth % 2 === 0 ? "horizontal" : "vertical";
}

describe("buildPreset: singleton maps ordinal zero to the unsplit root for every preset", () => {
    for (const kind of PRESET_KINDS) {
        it(`maps the ${kind} singleton to the unsplit root`, () => {
            assert.deepEqual(expectOk(buildPreset(kind, 1)), {
                splits: [],
                leafPaths: [{ ordinal: 0, path: ["root"] }],
            });
        });
    }
});

describe("buildPreset: columns and rows use only their specified orientations", () => {
    for (const count of [2, 3, 5, 4, 8]) {
        it(`columns at count ${count} is horizontal everywhere`, () => {
            const instructions = expectOk(buildPreset("columns", count));
            assert.equal(instructions.splits.length, count - 1);
            assert.ok(instructions.splits.every((split) => split.orientation === "horizontal"));
            assertExecutablePreorder(instructions);
        });
        it(`rows at count ${count} is vertical everywhere`, () => {
            const instructions = expectOk(buildPreset("rows", count));
            assert.equal(instructions.splits.length, count - 1);
            assert.ok(instructions.splits.every((split) => split.orientation === "vertical"));
            assertExecutablePreorder(instructions);
        });
    }
});

describe("buildPreset: balanced-grid alternates from a horizontal root and stays balanced", () => {
    for (const count of [2, 3, 5, 6, 7, 9, 11, 16]) {
        it(`balanced-grid at count ${count} alternates orientation by depth`, () => {
            const instructions = expectOk(buildPreset("balanced-grid", count));
            for (const split of instructions.splits) {
                assert.equal(split.orientation, balancedOrientationAtDepth(split.targetPath.length - 1));
            }
            assert.equal(instructions.splits.length, count - 1);
            assertBalancedInstructions(instructions, count);
            assertExecutablePreorder(instructions);
        });
    }
});

describe("buildPreset: every preset compiles count - 1 pre-order splits with complete ordinals", () => {
    for (const kind of PRESET_KINDS) {
        for (const count of [1, 2, 3, 5, 8, 13]) {
            it(`${kind} at count ${count} has ${count - 1} splits and ordinals 0..${count - 1}`, () => {
                const instructions = expectOk(buildPreset(kind, count));
                assert.equal(instructions.splits.length, count - 1);
                assert.equal(instructions.leafPaths.length, count);
                assert.deepEqual(
                    instructions.leafPaths.map((leaf) => leaf.ordinal),
                    Array.from({ length: count }, (_, i) => i),
                );
                assert.equal(new Set(instructions.leafPaths.map((leaf) => pathKey(leaf.path))).size, count);
                assertExecutablePreorder(instructions);
            });
        }
    }
});

describe("buildPreset: matches the compiled blueprint generator output", () => {
    it("columns equals a constant-horizontal blueprint compilation", () => {
        assert.deepEqual(
            expectOk(buildPreset("columns", 7)),
            expectOk(compileBlueprintInstructions(expectOk(buildBlueprint(7, "horizontal")))),
        );
    });
    it("rows equals a constant-vertical blueprint compilation", () => {
        assert.deepEqual(
            expectOk(buildPreset("rows", 7)),
            expectOk(compileBlueprintInstructions(expectOk(buildBlueprint(7, "vertical")))),
        );
    });
    it("balanced-grid equals an alternating-depth blueprint compilation", () => {
        const blueprint = expectOk(
            buildBlueprintByDepth(11, (depth) => (depth % 2 === 0 ? "horizontal" : "vertical")),
        );
        assert.deepEqual(
            expectOk(buildPreset("balanced-grid", 11)),
            expectOk(compileBlueprintInstructions(blueprint)),
        );
    });
});

describe("buildPreset: deterministic, immutable, and free of shared aliases", () => {
    it("returns deep-equal fresh instructions for repeated calls", () => {
        const first = expectOk(buildPreset("balanced-grid", 9));
        const second = expectOk(buildPreset("balanced-grid", 9));
        assert.notEqual(first, second);
        assert.deepEqual(first, second);
        assert.notEqual(first.splits, second.splits);
        assert.notEqual(first.leafPaths, second.leafPaths);
        assert.notEqual(first.splits[0], second.splits[0]);
    });
});

describe("buildPreset: invalid counts reject with fixed errors", () => {
    const invalidCounts: Array<[number, string]> = [
        [0, "zero"],
        [-1, "negative"],
        [-100, "negative"],
        [1.5, "fractional"],
        [0.5, "fractional between zero and one"],
        [Number.NaN, "NaN"],
        [Number.POSITIVE_INFINITY, "positive infinity"],
        [Number.NEGATIVE_INFINITY, "negative infinity"],
        [2 ** 53, "one past the safe-integer boundary"],
        [Number.MAX_SAFE_INTEGER + 1, "unsafe integer"],
    ];
    for (const [count, label] of invalidCounts) {
        for (const kind of PRESET_KINDS) {
            it(`rejects ${label} count ${String(count)} for ${kind}`, () => {
                expectRejection(buildPreset(kind, count), "invalid-leaf-count");
            });
        }
    }
});

describe("buildPreset: unknown kinds reject instead of silently accepting arbitrary strings", () => {
    const invalidKinds: unknown[] = [
        "bogus",
        "",
        "Columns",
        "COLUMNS",
        "grid",
        "custom",
        undefined,
        null,
        42,
        {},
    ];
    for (const value of invalidKinds) {
        it(`rejects kind ${String(value)}`, () => {
            expectRejection(buildPreset(value as PresetKind, 4), "invalid-preset-kind");
        });
    }
});

describe("catalog and preset output are runtime-immutable", () => {
    it("freezes the PRESET_KINDS catalog array", () => {
        assert.ok(Object.isFrozen(PRESET_KINDS));
        assert.throws(() => {
            (PRESET_KINDS as unknown as string[]).push("grid");
        }, TypeError);
    });

    it("freezes the successful result graph down to every path array", () => {
        const result = buildPreset("balanced-grid", 9);
        assert.ok(result.ok);
        if (!result.ok) {
            throw new Error("expected success");
        }
        assert.ok(Object.isFrozen(result));
        assert.ok(Object.isFrozen(result.value));
        assert.ok(Object.isFrozen(result.value.splits));
        assert.ok(Object.isFrozen(result.value.leafPaths));
        for (const split of result.value.splits) {
            assert.ok(Object.isFrozen(split));
            assert.ok(Object.isFrozen(split.targetPath));
            assert.ok(Object.isFrozen(split.leftPath));
            assert.ok(Object.isFrozen(split.rightPath));
        }
        for (const leaf of result.value.leafPaths) {
            assert.ok(Object.isFrozen(leaf));
            assert.ok(Object.isFrozen(leaf.path));
        }
        assert.throws(() => {
            (result.value.splits as unknown as unknown[]).push({} as never);
        }, TypeError);
        assert.throws(() => {
            (result.value.leafPaths as unknown as unknown[]).push({} as never);
        }, TypeError);
        assert.throws(() => {
            (result.value.splits[0] as unknown as { targetPath: string[] }).targetPath.push("bogus");
        }, TypeError);
    });
});
