// Source-safe reset planning for KWin Custom Tiles. This module has no KWin
// globals: the controller must supply fresh decoded snapshots around writes.

export interface ResetTile<Tile extends object, Window extends object> {
    readonly tile: Tile;
    readonly children: readonly Tile[];
    readonly occupants: readonly Window[];
    readonly removable: boolean;
}

export interface ResetSnapshot<Tile extends object, Window extends object> {
    readonly root: Tile;
    readonly tiles: readonly ResetTile<Tile, Window>[];
}

export interface ResetSeam<Tile extends object, Window extends object> {
    readonly snapshot: () => ResetSnapshot<Tile, Window> | null;
    readonly unmanage: (tile: Tile, window: Window) => boolean;
    readonly remove: (tile: Tile) => boolean;
}

export type ResetResult =
    | { readonly ok: true; readonly removed: number }
    | {
          readonly ok: false;
          readonly stage: "pre-mutation-rejection" | "reset-may-have-mutated";
          readonly removed: number;
      };

function validSnapshot<Tile extends object, Window extends object>(
    snapshot: ResetSnapshot<Tile, Window>,
    root: Tile,
): boolean {
    if (snapshot.root !== root || snapshot.tiles.length === 0) {
        return false;
    }
    const known = new Set<Tile>();
    let rootCount = 0;
    for (const entry of snapshot.tiles) {
        if (known.has(entry.tile)) {
            return false;
        }
        known.add(entry.tile);
        if (entry.tile === root) {
            rootCount += 1;
        }
        const children = new Set<Tile>();
        const occupants = new Set<Window>();
        for (const child of entry.children) {
            if (child === entry.tile || children.has(child)) {
                return false;
            }
            children.add(child);
        }
        for (const occupant of entry.occupants) {
            if (occupants.has(occupant)) {
                return false;
            }
            occupants.add(occupant);
        }
    }
    return rootCount === 1;
}

function removableLeaf<Tile extends object, Window extends object>(
    snapshot: ResetSnapshot<Tile, Window>,
): ResetTile<Tile, Window> | null {
    for (let index = snapshot.tiles.length - 1; index >= 0; index -= 1) {
        const entry = snapshot.tiles[index];
        if (entry !== undefined && entry.removable && entry.children.length === 0 && entry.occupants.length === 0) {
            return entry;
        }
    }
    return null;
}

// Fully unmanage every discovered occupant before the first removal. KWin's
// remove() otherwise re-picks occupants into a surviving leaf, so reset cannot
// preserve a deterministic controller-owned ordinal assignment.
export function collapseToRootLeaf<Tile extends object, Window extends object>(
    seam: ResetSeam<Tile, Window>,
): ResetResult {
    const first = seam.snapshot();
    if (first === null || !validSnapshot(first, first.root)) {
        return { ok: false, stage: "pre-mutation-rejection", removed: 0 };
    }
    const root = first.root;
    let unmanaged = 0;
    for (const entry of first.tiles) {
        for (const occupant of entry.occupants) {
            let unmanagedCurrent = false;
            try {
                unmanagedCurrent = seam.unmanage(entry.tile, occupant);
            } catch (error) {
                void error;
                return {
                    ok: false,
                    stage: unmanaged === 0 ? "pre-mutation-rejection" : "reset-may-have-mutated",
                    removed: 0,
                };
            }
            if (!unmanagedCurrent) {
                return {
                    ok: false,
                    stage: unmanaged === 0 ? "pre-mutation-rejection" : "reset-may-have-mutated",
                    removed: 0,
                };
            }
            unmanaged += 1;
        }
    }
    let removed = 0;
    while (true) {
        const snapshot = seam.snapshot();
        if (snapshot === null || !validSnapshot(snapshot, root)) {
            return { ok: false, stage: "reset-may-have-mutated", removed };
        }
        if (snapshot.tiles.length === 1) {
            const only = snapshot.tiles[0];
            if (only !== undefined && only.tile === root && only.children.length === 0 && only.occupants.length === 0) {
                return { ok: true, removed };
            }
            return { ok: false, stage: "reset-may-have-mutated", removed };
        }
        const leaf = removableLeaf(snapshot);
        if (leaf === null) {
            return { ok: false, stage: "reset-may-have-mutated", removed };
        }
        let removedLeaf = false;
        try {
            removedLeaf = seam.remove(leaf.tile);
        } catch (error) {
            void error;
            return { ok: false, stage: "reset-may-have-mutated", removed };
        }
        if (!removedLeaf) {
            return { ok: false, stage: "reset-may-have-mutated", removed };
        }
        removed += 1;
        // `CustomTile.remove()` returns void. Its only usable acknowledgement is
        // a freshly decoded root with one fewer reachable tile.
        const after = seam.snapshot();
        if (
            after === null ||
            !validSnapshot(after, root) ||
            after.tiles.length >= snapshot.tiles.length
        ) {
            return { ok: false, stage: "reset-may-have-mutated", removed };
        }
    }
}
