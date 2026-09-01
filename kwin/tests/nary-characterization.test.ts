import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Harness, RECT, tile, window } from "./controller-fixtures";
import { TileController } from "../src/controller";
import { customTileSplitSeam } from "../src/custom-tile-split";
import { executeBlueprintInstructions } from "../src/layout-executor";
import { compileBlueprintInstructions } from "../src/layout-instructions";
import { type Blueprint } from "../src/layout-blueprint";
import {
    attachTileWriter,
    configureThreeOccupantPreset,
    installDwindleSplitter,
    invokeShortcut,
    presetSetup,
    serializeTileTree,
} from "./controller-fixture-scenarios";

function expectOk<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
    assert.ok(result.ok);
    if (!result.ok) {
        throw new Error("expected success");
    }
    return result.value;
}

function executeShape(blueprint: Blueprint): ReturnType<typeof serializeTileTree> {
    const root = tile();
    installDwindleSplitter(root, false, true);
    const instructions = expectOk(compileBlueprintInstructions(blueprint));
    const result = executeBlueprintInstructions(instructions, root, {
        split: (subject, orientation) => subject.split(orientation === "horizontal" ? 1 : 2),
        decodeChildren: (subject) => subject.tiles as typeof root[],
    });
    assert.ok(result.ok);
    return serializeTileTree(root);
}

// Golden "before" baseline: characterizes current binary-split behavior by
// driving the real TileController through ordinary automatic-placement and
// preset-shortcut paths, then serializing the resulting native tile tree.
// Later N-ary topology migration units compare against these pinned values
// to prove byte-identical results for existing binary-only inputs.
describe("N-ary migration characterization: binary-split baseline", () => {
    it("asserts the exact left- and right-nested horizontal structures", () => {
        assert.deepEqual(
            executeShape({
                kind: "branch",
                orientation: "horizontal",
                left: {
                    kind: "branch",
                    orientation: "horizontal",
                    left: { kind: "leaf", ordinal: 0 },
                    right: { kind: "leaf", ordinal: 1 },
                },
                right: { kind: "leaf", ordinal: 2 },
            }),
            {
                direction: 1,
                children: [
                    { direction: 1, children: [{ windows: [] }, { windows: [] }] },
                    { windows: [] },
                ],
            },
        );
        assert.deepEqual(
            executeShape({
                kind: "branch",
                orientation: "horizontal",
                left: { kind: "leaf", ordinal: 0 },
                right: {
                    kind: "branch",
                    orientation: "horizontal",
                    left: { kind: "leaf", ordinal: 1 },
                    right: { kind: "leaf", ordinal: 2 },
                },
            }),
            {
                direction: 1,
                children: [
                    { windows: [] },
                    { direction: 1, children: [{ windows: [] }, { windows: [] }] },
                ],
            },
        );
    });

    it("serializes a three-window dwindle chain to a pinned nested binary shape", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 100, height: 100 });
        const first = window({ tile: root, caption: "first" });
        root.windows = [first];
        installDwindleSplitter(root);
        harness.root = root;
        harness.active = first;
        harness.windows = [first];
        attachTileWriter(first);
        const controller = new TileController(harness.environment());
        controller.start();

        const second = window({ caption: "second" });
        attachTileWriter(second);
        harness.windows = [first, second];
        harness.emitAdded(second);

        const third = window({ caption: "third" });
        attachTileWriter(third);
        harness.windows = [first, second, third];
        harness.emitAdded(third);

        assert.deepEqual(serializeTileTree(root), {
            direction: 1,
            children: [
                { windows: ["first"] },
                {
                    direction: 2,
                    children: [{ windows: ["second"] }, { windows: ["third"] }],
                },
            ],
        });
    });

    it("serializes a preset-derived three-occupant shortcut insertion to a pinned nested binary shape", () => {
        const state = presetSetup();
        state.active.caption = "active";
        state.earlyWindow.caption = "early";
        state.lateWindow.caption = "late";
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");

        assert.deepEqual(serializeTileTree(state.source), {
            direction: 1,
            children: [
                { windows: ["active"] },
                {
                    direction: 1,
                    children: [{ windows: ["late"] }, { windows: ["early"] }],
                },
            ],
        });
    });

    it("executes a five-child split through the native-shaped decoder and rejects it at the binary executor boundary", () => {
        const root = tile(RECT, false);
        const children = Array.from({ length: 5 }, (_, index) =>
            tile({ x: index * 20, y: 0, width: 20, height: 100 }),
        );
        let splitCalls = 0;
        root.split = (direction) => {
            splitCalls += 1;
            assert.equal(direction, 1);
            root.isLayout = true;
            root.layoutDirection = direction;
            root.tiles = [...children].reverse();
            return { native: "opaque" };
        };
        customTileSplitSeam.split(root, "horizontal");
        assert.deepEqual(customTileSplitSeam.decodeChildren(root), children);

        const result = executeBlueprintInstructions(
            expectOk(compileBlueprintInstructions({
                kind: "branch",
                orientation: "horizontal",
                left: { kind: "leaf", ordinal: 0 },
                right: { kind: "leaf", ordinal: 1 },
            })),
            root,
            customTileSplitSeam,
        );

        assert.equal(splitCalls, 2);
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.completedSplits, 0);
            assert.equal(result.mutationPossible, true);
        }
    });
});
