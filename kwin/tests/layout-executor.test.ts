import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { customTileSplitSeam, orderCustomTilesByAxis } from "../src/custom-tile-split";
import { executeBlueprintInstructions, type BlueprintSplitSeam } from "../src/layout-executor";
import { buildBlueprint } from "../src/layout-blueprint";
import { compileBlueprintInstructions, type BlueprintInstructions } from "../src/layout-instructions";
import { type Result } from "../src/logic";

interface TestTile {
    readonly id: string;
}

function expectOk<T>(result: Result<T>): T {
    assert.ok(result.ok);
    if (!result.ok) {
        throw new Error("expected success");
    }
    return result.value;
}

function plan(count: number, orientation: "vertical" | "horizontal" = "vertical"): BlueprintInstructions {
    return expectOk(compileBlueprintInstructions(expectOk(buildBlueprint(count, orientation))));
}

function seam(
    responses: ReadonlyMap<string, unknown>,
    calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }>,
): BlueprintSplitSeam<TestTile> {
    return {
        split: (tile, orientation) => {
            calls.push({ id: tile.id, orientation });
            const response = responses.get(tile.id);
            if (response instanceof Error) {
                throw response;
            }
            return response;
        },
        // Mirrors the production seam: decodeChildren now reads from the
        // split TARGET (looked up by id), not from split()'s return value,
        // even though this synthetic seam sources both from the same
        // responses map.
        decodeChildren: (tile) => {
            const value = responses.get(tile.id);
            if (!Array.isArray(value) || value.length !== 2) {
                return null;
            }
            const left = value[0];
            const right = value[1];
            if (!isTestTile(left) || !isTestTile(right)) {
                return null;
            }
            return [left, right];
        },
    };
}

function isTestTile(value: unknown): value is TestTile {
    return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string";
}

function expectFailure(result: ReturnType<typeof executeBlueprintInstructions<TestTile>>): void {
    assert.equal(result.ok, false);
    if (result.ok) {
        throw new Error("expected failure");
    }
    assert.equal(result.code, "blueprint-execution-failed");
}

describe("executeBlueprintInstructions", () => {
    it("returns the supplied singleton root at ordinal zero without splitting", () => {
        const root = { id: "root" };
        const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
        const result = executeBlueprintInstructions(plan(1), root, seam(new Map(), calls));

        assert.deepEqual(result, { ok: true, leaves: [root], completedSplits: 0 });
        assert.equal(Object.isFrozen(result.ok ? result.leaves : []), true);
        assert.deepEqual(calls, []);
    });

    it("realizes nested paths in compiler pre-order with ordinal-aligned leaves", () => {
        const root = { id: "root" };
        const left = { id: "left" };
        const right = { id: "right" };
        const rightRight = { id: "right-right" };
        const zero = { id: "zero" };
        const one = { id: "one" };
        const two = { id: "two" };
        const three = { id: "three" };
        const four = { id: "four" };
        const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
        const source = plan(5, "horizontal");
        const before = structuredClone(source);
        const result = executeBlueprintInstructions(
            source,
            root,
            seam(new Map([
                ["root", [left, right]],
                ["left", [zero, one]],
                ["right", [two, rightRight]],
                ["right-right", [three, four]],
            ]), calls),
        );

        assert.ok(result.ok);
        if (result.ok) {
            assert.deepEqual(result.leaves, [zero, one, two, three, four]);
            assert.equal(result.completedSplits, 4);
            assert.equal(Object.isFrozen(result.leaves), true);
        }
        assert.deepEqual(calls, [
            { id: "root", orientation: "horizontal" },
            { id: "left", orientation: "horizontal" },
            { id: "right", orientation: "horizontal" },
            { id: "right-right", orientation: "horizontal" },
        ]);
        assert.deepEqual(source, before);
    });

    it("stops after a thrown split with truthful partial-mutation status", () => {
        const root = { id: "root" };
        const left = { id: "left" };
        const right = { id: "right" };
        const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
        const result = executeBlueprintInstructions(
            plan(4),
            root,
            seam(new Map<string, unknown>([["root", [left, right]], ["left", new Error("split")]]), calls),
        );

        expectFailure(result);
        if (!result.ok) {
            assert.equal(result.completedSplits, 1);
            assert.equal(result.mutationPossible, true);
        }
        assert.deepEqual(calls.map((call) => call.id), ["root", "left"]);
    });

    it("stops after a malformed child result without retrying", () => {
        const root = { id: "root" };
        const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
        const result = executeBlueprintInstructions(plan(2), root, seam(new Map([["root", [{ id: "left" }]]]), calls));

        expectFailure(result);
        if (!result.ok) {
            assert.equal(result.completedSplits, 0);
            assert.equal(result.mutationPossible, true);
        }
        assert.deepEqual(calls.map((call) => call.id), ["root"]);
    });

    it("rejects child and target aliases after the single mutating call", () => {
        const root = { id: "root" };
        const child = { id: "child" };
        for (const response of [[child, child], [root, child]]) {
            const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
            const result = executeBlueprintInstructions(plan(2), root, seam(new Map([["root", response]]), calls));

            expectFailure(result);
            if (!result.ok) {
                assert.equal(result.completedSplits, 0);
                assert.equal(result.mutationPossible, true);
            }
            assert.deepEqual(calls.map((call) => call.id), ["root"]);
        }
    });

    it("rejects a child that aliases another locally mapped leaf", () => {
        const root = { id: "root" };
        const left = { id: "left" };
        const right = { id: "right" };
        const replacement = { id: "replacement" };
        const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
        const result = executeBlueprintInstructions(
            plan(4),
            root,
            seam(new Map([["root", [left, right]], ["left", [right, replacement]]]), calls),
        );

        expectFailure(result);
        if (!result.ok) {
            assert.equal(result.completedSplits, 1);
            assert.equal(result.mutationPossible, true);
        }
        assert.deepEqual(calls.map((call) => call.id), ["root", "left"]);
    });

    it("rejects inconsistent instructions and final leaf mappings before mutation", () => {
        const root = { id: "root" };
        const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
        const inconsistent: BlueprintInstructions = {
            splits: [{
                targetPath: ["root"],
                orientation: "vertical",
                leftPath: ["root", "right"],
                rightPath: ["root", "left"],
            }],
            leafPaths: [{ ordinal: 0, path: ["root", "left"] }, { ordinal: 1, path: ["root", "right"] }],
        };
        const missingFinalLeaf: BlueprintInstructions = {
            splits: [{
                targetPath: ["root"],
                orientation: "vertical",
                leftPath: ["root", "left"],
                rightPath: ["root", "right"],
            }],
            leafPaths: [{ ordinal: 0, path: ["root", "left"] }, { ordinal: 1, path: ["root"] }],
        };

        for (const instructions of [inconsistent, missingFinalLeaf]) {
            const result = executeBlueprintInstructions(instructions, root, seam(new Map(), calls));
            expectFailure(result);
            if (!result.ok) {
                assert.equal(result.completedSplits, 0);
                assert.equal(result.mutationPossible, false);
            }
        }
        assert.deepEqual(calls, []);
    });

    it("fails deterministically when a seam's decodeChildren returns three children for a binary split", () => {
        const root = { id: "root" };
        const calls: Array<{ readonly id: string; readonly orientation: "vertical" | "horizontal" }> = [];
        const ternarySeam: BlueprintSplitSeam<TestTile> = {
            split: (tile, orientation) => {
                calls.push({ id: tile.id, orientation });
                return undefined;
            },
            decodeChildren: () => [{ id: "a" }, { id: "b" }, { id: "c" }],
        };
        const result = executeBlueprintInstructions(plan(2), root, ternarySeam);

        expectFailure(result);
        if (!result.ok) {
            assert.equal(result.completedSplits, 0);
            assert.equal(result.mutationPossible, true);
        }
        assert.deepEqual(calls.map((call) => call.id), ["root"]);
    });
});

describe("customTileSplitSeam", () => {
    it("maps orientations to the pinned KWin split() direction integers", () => {
        const directions: number[] = [];
        const root = customTile(() => {
            return undefined;
        });
        const spying = customTile((direction) => {
            directions.push(direction);
            return undefined;
        });
        customTileSplitSeam.split(spying, "horizontal");
        customTileSplitSeam.split(spying, "vertical");
        assert.deepEqual(directions, [1, 2]);
        assert.equal(root.layoutDirection, 1);
    });

    it("returns null when the split target has fewer than two CustomTile children", () => {
        const oneChild = customTile(undefined, [customTile()]);
        assert.equal(customTileSplitSeam.decodeChildren(oneChild), null);

        const noChildren = customTile();
        assert.equal(customTileSplitSeam.decodeChildren(noChildren), null);
    });

    it("decodes and orders three children by relativeGeometry when tiles reports three, not by tiles[] index", () => {
        const first = customTile(undefined, [], { x: 0, y: 0, width: 1, height: 3 });
        const second = customTile(undefined, [], { x: 1, y: 0, width: 1, height: 3 });
        const third = customTile(undefined, [], { x: 2, y: 0, width: 1, height: 3 });
        // Stored out of geometric order to prove index is not trusted.
        const parent = customTile(undefined, [third, first, second], undefined, HORIZONTAL_LAYOUT_DIRECTION);
        assert.deepEqual(customTileSplitSeam.decodeChildren(parent), [first, second, third]);
    });

    it("rejects a degenerate zero-extent child via orderCustomTilesByAxis", () => {
        const zeroWidth = customTile(undefined, [], { x: 0, y: 0, width: 0, height: 2 });
        const valid = customTile(undefined, [], { x: 1, y: 0, width: 1, height: 2 });
        assert.equal(orderCustomTilesByAxis([zeroWidth, valid], "x"), null);

        const zeroHeight = customTile(undefined, [], { x: 0, y: 0, width: 1, height: 0 });
        const validB = customTile(undefined, [], { x: 0, y: 1, width: 1, height: 1 });
        assert.equal(orderCustomTilesByAxis([zeroHeight, validB], "y"), null);
    });

    it("orders two children by relativeGeometry along the split axis, not by tiles[] index", () => {
        const leftChild = customTile(undefined, [], { x: 0, y: 0, width: 1, height: 2 });
        const rightChild = customTile(undefined, [], { x: 1, y: 0, width: 1, height: 2 });
        // Deliberately stored in reverse geometric order to prove ordering
        // is derived from geometry, not from tiles[] index position.
        const horizontalParent = customTile(undefined, [rightChild, leftChild], undefined, HORIZONTAL_LAYOUT_DIRECTION);
        assert.deepEqual(customTileSplitSeam.decodeChildren(horizontalParent), [leftChild, rightChild]);

        const topChild = customTile(undefined, [], { x: 0, y: 0, width: 2, height: 1 });
        const bottomChild = customTile(undefined, [], { x: 0, y: 1, width: 2, height: 1 });
        const verticalParent = customTile(undefined, [bottomChild, topChild], undefined, VERTICAL_LAYOUT_DIRECTION);
        assert.deepEqual(customTileSplitSeam.decodeChildren(verticalParent), [topChild, bottomChild]);
    });
});

const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;

function customTile(
    split: ((direction: number) => unknown) | undefined = () => undefined,
    tiles: readonly unknown[] = [],
    relativeGeometry: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } = { x: 0, y: 0, width: 1, height: 1 },
    layoutDirection: number = HORIZONTAL_LAYOUT_DIRECTION,
): {
    readonly relativeGeometry: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly absoluteGeometry: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly parent: null;
    readonly tiles: readonly unknown[];
    readonly windows: readonly [];
    readonly isLayout: false;
    readonly canBeRemoved: true;
    readonly layoutDirection: number;
    readonly manage: () => boolean;
    readonly unmanage: () => boolean;
    readonly split: (direction: number) => unknown;
} {
    return {
        relativeGeometry,
        absoluteGeometry: relativeGeometry,
        parent: null,
        tiles,
        windows: [],
        isLayout: false,
        canBeRemoved: true,
        layoutDirection,
        manage: () => true,
        unmanage: () => true,
        split: split ?? (() => undefined),
    };
}
