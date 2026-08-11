import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collapseToRootLeaf, type ResetSnapshot } from "../src/topology-reset";

interface Tile {
    readonly id: string;
    readonly children: Tile[];
    readonly occupants: Window[];
    readonly root: boolean;
}
interface Window {
    readonly id: string;
}

function snapshot(root: Tile): ResetSnapshot<Tile, Window> {
    const tiles: Array<{ tile: Tile; children: readonly Tile[]; occupants: readonly Window[]; removable: boolean }> = [];
    const visit = (tile: Tile): void => {
        tiles.push({ tile, children: tile.children, occupants: tile.occupants, removable: !tile.root });
        for (const child of tile.children) {
            visit(child);
        }
    };
    visit(root);
    return { root, tiles };
}

function seam(root: Tile, removeThrows = false) {
    return {
        snapshot: () => snapshot(root),
        unmanage: (tile: Tile, window: Window) => {
            const index = tile.occupants.indexOf(window);
            if (index < 0) return false;
            tile.occupants.splice(index, 1);
            return true;
        },
        remove: (tile: Tile) => {
            if (removeThrows) throw new Error("remove");
            const parent = all(root).find((candidate) => candidate.children.includes(tile));
            if (parent === undefined) return false;
            parent.children.splice(parent.children.indexOf(tile), 1);
            // Mirror KWin's single-child non-root promotion.
            if (!parent.root && parent.children.length === 1) {
                const survivor = parent.children[0];
                const grandparent = all(root).find((candidate) => candidate.children.includes(parent));
                if (survivor !== undefined && grandparent !== undefined) {
                    grandparent.children.splice(grandparent.children.indexOf(parent), 1, survivor);
                }
            }
            return true;
        },
    };
}

function all(root: Tile): Tile[] {
    return [root, ...root.children.flatMap(all)];
}

function leaf(id: string, occupants: Window[] = []): Tile {
    return { id, children: [], occupants, root: false };
}

describe("collapseToRootLeaf", () => {
    it("collapses a 25/50/25-like three-leaf tree while preserving the root", () => {
        const root: Tile = { id: "root", root: true, occupants: [], children: [] };
        const branch: Tile = { id: "branch", root: false, occupants: [], children: [leaf("middle"), leaf("right")] };
        root.children.push(leaf("left", [{ id: "one" }]), branch);
        const result = collapseToRootLeaf(seam(root));
        assert.deepEqual(result, { ok: true, removed: 3 });
        assert.equal(snapshot(root).root, root);
        assert.equal(root.children.length, 0);
    });

    it("collapses nested trees and leaves a singleton root unchanged", () => {
        const root: Tile = { id: "root", root: true, occupants: [], children: [] };
        const nested: Tile = { id: "nested", root: false, occupants: [], children: [leaf("a"), leaf("b")] };
        root.children.push(nested, leaf("c"));
        assert.equal(collapseToRootLeaf(seam(root)).ok, true);
        assert.deepEqual(collapseToRootLeaf(seam(root)), { ok: true, removed: 0 });
    });

    it("rejects an unmanageable occupant before removal and reports mutation-possible remove failures", () => {
        const root: Tile = { id: "root", root: true, occupants: [], children: [leaf("one", [{ id: "a" }])] };
        const rejecting = seam(root);
        rejecting.unmanage = () => false;
        assert.deepEqual(collapseToRootLeaf(rejecting), { ok: false, stage: "pre-mutation-rejection", removed: 0 });
        assert.deepEqual(collapseToRootLeaf(seam(root, true)), { ok: false, stage: "reset-may-have-mutated", removed: 0 });
    });

    it("reports mutation-possible when a void remove call has no decoded postcondition", () => {
        const root: Tile = { id: "root", root: true, occupants: [], children: [leaf("one")] };
        const noOp = seam(root);
        noOp.remove = () => true;
        assert.deepEqual(collapseToRootLeaf(noOp), { ok: false, stage: "reset-may-have-mutated", removed: 1 });
    });
});
