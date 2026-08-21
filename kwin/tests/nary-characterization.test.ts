import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Harness, tile, window } from "./controller-fixtures";
import { TileController } from "../src/controller";
import {
    attachTileWriter,
    configureThreeOccupantPreset,
    installDwindleSplitter,
    invokeShortcut,
    presetSetup,
    serializeTileTree,
} from "./controller-fixture-scenarios";

// Golden "before" baseline: characterizes current binary-split behavior by
// driving the real TileController through ordinary automatic-placement and
// preset-shortcut paths, then serializing the resulting native tile tree.
// Later N-ary topology migration units compare against these pinned values
// to prove byte-identical results for existing binary-only inputs.
describe("N-ary migration characterization: binary-split baseline", () => {
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
});
