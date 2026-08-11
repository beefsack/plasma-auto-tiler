import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { customTileSplitSeam } from "../src/custom-tile-split";
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
        decodeChildren: (value) => {
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
});

describe("customTileSplitSeam", () => {
    it("maps orientations and strictly decodes exactly two CustomTile children", () => {
        const directions: number[] = [];
        const child = customTile();
        const root = customTile((direction) => {
            directions.push(direction);
            return [child, customTile()];
        });

        customTileSplitSeam.split(root, "horizontal");
        customTileSplitSeam.split(root, "vertical");
        assert.deepEqual(directions, [1, 2]);
        assert.equal(customTileSplitSeam.decodeChildren([child]), null);
        assert.notEqual(customTileSplitSeam.decodeChildren([child, customTile()]), null);
    });
});

function customTile(split: (direction: number) => unknown = () => []): {
    readonly relativeGeometry: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly absoluteGeometry: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly parent: null;
    readonly tiles: readonly [];
    readonly windows: readonly [];
    readonly isLayout: false;
    readonly canBeRemoved: true;
    readonly layoutDirection: 1;
    readonly manage: () => boolean;
    readonly unmanage: () => boolean;
    readonly split: (direction: number) => unknown;
} {
    const geometry = { x: 0, y: 0, width: 1, height: 1 };
    return {
        relativeGeometry: geometry,
        absoluteGeometry: geometry,
        parent: null,
        tiles: [],
        windows: [],
        isLayout: false,
        canBeRemoved: true,
        layoutDirection: 1,
        manage: () => true,
        unmanage: () => true,
        split,
    };
}
