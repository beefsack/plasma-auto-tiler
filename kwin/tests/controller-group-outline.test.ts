import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TileController } from "../src/controller";
import { Harness, RECT, tile, window } from "./controller-fixtures";
import { attachTileWriter } from "./controller-fixture-scenarios";

type GroupOutlineController = {
    flashFocusedGroup(): void;
    showDropOutline(geometry: typeof RECT): void;
    hideDropOutline(): void;
};

function groupOutlineController(controller: TileController): GroupOutlineController {
    return controller as unknown as GroupOutlineController;
}

describe("TileController group outline", () => {
    it("flashes the focused leaf parent after automatic reconstruction", () => {
        const harness = new Harness();
        const root = tile(RECT);
        const first = window({ tile: root });
        const second = window({ tile: root });
        root.windows = [first, second];
        root.split = (direction) => {
            root.isLayout = true;
            root.layoutDirection = direction;
            root.windows = [];
            const left = tile({ x: 0, y: 0, width: 50, height: 100 });
            const right = tile({ x: 50, y: 0, width: 50, height: 100 });
            left.parent = root;
            right.parent = root;
            root.tiles = [left, right];
            return [left, right];
        };
        harness.root = root;
        harness.active = first;
        harness.windows = [first, second];
        attachTileWriter(first);
        attachTileWriter(second);

        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(harness.flushNextYield(), true);
        assert.equal(harness.flushNextYield(), true);

        assert.equal(harness.scheduled.length, 1);
        assert.deepEqual(harness.showOutlineCalls, [{ x: 0, y: 0, w: 100, h: 100 }]);
        harness.fireScheduled(0);
        assert.equal(harness.hideOutlineCalls, 1);
    });

    it("does nothing for a focused root leaf without a layout parent", () => {
        const harness = new Harness();
        const root = tile(RECT);
        const focused = window({ tile: root });
        root.windows = [focused];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());
        controller.start();

        groupOutlineController(controller).flashFocusedGroup();

        assert.deepEqual(harness.showOutlineCalls, []);
        assert.equal(harness.scheduled.length, 0);
    });

    it("does nothing for a focused leaf with invalid layout parent geometry", () => {
        const harness = new Harness();
        const root = tile({ x: 0, y: 0, width: 0, height: 100 }, true);
        const focusedTile = tile({ x: 10, y: 20, width: 30, height: 40 });
        const focused = window({ tile: focusedTile });
        focusedTile.parent = root;
        focusedTile.windows = [focused];
        root.tiles = [focusedTile];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = new TileController(harness.environment());

        groupOutlineController(controller).flashFocusedGroup();

        assert.deepEqual(harness.showOutlineCalls, []);
        assert.equal(harness.scheduled.length, 0);
    });

    it("keeps stale group callbacks and group flashes from replacing a drag outline", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const focusedTile = tile({ x: 10, y: 20, width: 30, height: 40 });
        const focused = window({ tile: focusedTile });
        focusedTile.parent = root;
        focusedTile.windows = [focused];
        root.tiles = [focusedTile];
        harness.root = root;
        harness.active = focused;
        harness.windows = [focused];
        const controller = groupOutlineController(new TileController(harness.environment()));

        controller.flashFocusedGroup();
        controller.flashFocusedGroup();
        harness.fireScheduled(0);
        assert.equal(harness.hideOutlineCalls, 0);
        harness.fireScheduled(1);
        assert.equal(harness.hideOutlineCalls, 1);

        controller.showDropOutline(RECT);
        controller.flashFocusedGroup();
        assert.equal(harness.scheduled.length, 2);
        assert.deepEqual(harness.showOutlineCalls[harness.showOutlineCalls.length - 1], { x: 0, y: 0, w: 100, h: 100 });
        controller.hideDropOutline();
        controller.flashFocusedGroup();
        controller.showDropOutline({ x: 1, y: 2, width: 3, height: 4 });
        harness.fireScheduled(2);
        assert.equal(harness.hideOutlineCalls, 2);
    });
});
