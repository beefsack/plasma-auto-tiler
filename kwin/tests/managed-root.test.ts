import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CUSTOM_TILE_PADDING } from "../src/boundary";
import { prepareManagedRoot } from "../src/managed-root";

const RECT = { x: 0, y: 0, width: 100, height: 100 };

function rootWithEvents(events: string[]) {
    const root = {
        relativeGeometry: RECT,
        absoluteGeometry: RECT,
        parent: null,
        tiles: [] as unknown[],
        windows: [] as unknown[],
        isLayout: false,
        canBeRemoved: true,
        layoutDirection: 1,
        padding: 0,
        manage: (_window: unknown) => {
            events.push("assignment");
            return true;
        },
        unmanage: () => true,
        split: () => [],
    };
    let padding = 0;
    Object.defineProperty(root, "padding", {
        configurable: true,
        get: () => padding,
        set: (value: number) => {
            events.push(`padding:${value}`);
            padding = value;
        },
    });
    return root;
}

describe("managed Custom Tile root preparation", () => {
    it("sets padding before tile assignment or reflow at every root acquisition", () => {
        const events: string[] = [];
        const root = rootWithEvents(events);
        const acquire = (operation: (managedRoot: typeof root) => void): void => {
            const managedRoot = prepareManagedRoot(root);
            operation(managedRoot as typeof root);
        };

        acquire((managedRoot) => {
            assert.equal(managedRoot.manage({}), true);
        });
        acquire((managedRoot) => {
            events.push(`reflow:${managedRoot.padding}`);
        });

        assert.deepEqual(events, ["padding:8", "assignment", "padding:8", "reflow:8"]);
    });

    it("is repeat-safe: padding stays fixed and topology is unchanged", () => {
        const events: string[] = [];
        const child = {};
        const root = rootWithEvents(events);
        root.tiles = [child];
        const topology = root.tiles;

        prepareManagedRoot(root);
        prepareManagedRoot(root);

        assert.equal(root.padding, CUSTOM_TILE_PADDING);
        assert.equal(root.tiles, topology);
        assert.deepEqual(root.tiles, [child]);
        assert.deepEqual(events, ["padding:8", "padding:8"]);
    });
});
