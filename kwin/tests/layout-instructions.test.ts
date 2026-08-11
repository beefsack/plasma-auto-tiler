import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    compileBlueprintInstructions,
    type BlueprintInstructions,
    type BlueprintPath,
} from "../src/layout-instructions";
import { buildBlueprint, type Blueprint } from "../src/layout-blueprint";
import { type Result } from "../src/logic";

function expectOk<T>(result: Result<T>): T {
    assert.ok(result.ok);
    if (!result.ok) {
        throw new Error("expected success");
    }
    return result.value;
}

function pathKey(path: BlueprintPath): string {
    return path.join("/");
}

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

describe("compileBlueprintInstructions", () => {
    it("maps a leaf-only blueprint ordinal to the root without splitting", () => {
        const blueprint = expectOk(buildBlueprint(1, "vertical"));

        assert.deepEqual(expectOk(compileBlueprintInstructions(blueprint)), {
            splits: [],
            leafPaths: [{ ordinal: 0, path: ["root"] }],
        });
    });

    it("emits every branch in executable pre-order with stable child paths", () => {
        const blueprint = expectOk(buildBlueprint(5, "vertical"));
        const instructions = expectOk(compileBlueprintInstructions(blueprint));

        assert.deepEqual(instructions.splits.map((split) => split.targetPath), [
            ["root"],
            ["root", "left"],
            ["root", "right"],
            ["root", "right", "right"],
        ]);
        assert.deepEqual(instructions.splits.map((split) => split.orientation), [
            "vertical",
            "vertical",
            "vertical",
            "vertical",
        ]);
        assertExecutablePreorder(instructions);
    });

    for (const orientation of ["vertical", "horizontal"] as const) {
        it(`maps a balanced ${orientation} topology by deterministic ordinal`, () => {
            const blueprint = expectOk(buildBlueprint(8, orientation));
            const instructions = expectOk(compileBlueprintInstructions(blueprint));

            assert.equal(instructions.splits.length, 7);
            assert.ok(instructions.splits.every((split) => split.orientation === orientation));
            assert.deepEqual(instructions.leafPaths.map((leaf) => leaf.ordinal), [0, 1, 2, 3, 4, 5, 6, 7]);
            assert.equal(new Set(instructions.leafPaths.map((leaf) => pathKey(leaf.path))).size, 8);
            assertExecutablePreorder(instructions);
        });
    }

    it("is deterministic, preserves the blueprint, and isolates output paths", () => {
        const blueprint = expectOk(buildBlueprint(4, "horizontal"));
        const before = structuredClone(blueprint);
        const first = expectOk(compileBlueprintInstructions(blueprint));
        const second = expectOk(compileBlueprintInstructions(blueprint));

        assert.deepEqual(blueprint, before);
        assert.notEqual(first, second);
        assert.deepEqual(first, second);
        assert.notEqual(first.splits[0]?.leftPath, first.splits[1]?.targetPath);
        assert.notEqual(first.splits[1]?.leftPath, first.leafPaths[0]?.path);
    });

    it("rejects duplicate leaf ordinals in manually constructed topology", () => {
        const malformed: Blueprint = {
            kind: "branch",
            orientation: "vertical",
            left: { kind: "leaf", ordinal: 0 },
            right: { kind: "leaf", ordinal: 0 },
        };
        const result = compileBlueprintInstructions(malformed);

        assert.ok(!result.ok);
        if (!result.ok) {
            assert.equal(result.reason.kind, "invalid-blueprint");
        }
    });
});
