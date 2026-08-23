import {
    decodeSequential,
    isCustomTile,
    isTile,
    isVirtualDesktop,
    isWindow,
    MAX_SEQUENTIAL_LENGTH,
    type CustomTileCapability,
    type OutputCapability,
    type TileCapability,
    type WindowCapability,
} from "./boundary";
import { customTileSplitSeam } from "./custom-tile-split";
import { type Blueprint } from "./layout-blueprint";
import { type Leaf, type Scope, type WindowRef } from "./logic";

const MAX_TILES = MAX_SEQUENTIAL_LENGTH;
const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;

export interface DecodedLeaf {
    readonly tile: TileCapability;
    readonly windows: readonly WindowCapability[];
}

export interface OperationLeaf {
    readonly decoded: DecodedLeaf;
    readonly leaf: Leaf;
    readonly windows: readonly WindowCapability[];
    readonly refs: readonly WindowRef[];
}

export interface UsableLeaf {
    readonly tile: TileCapability;
    readonly windows: readonly WindowCapability[];
}

export interface TargetOccupant {
    readonly window: WindowCapability;
    readonly usesActiveWrapper: boolean;
}

export function windowInScope(
    window: unknown,
    scope: { readonly scope: Scope; readonly output: OutputCapability },
): window is WindowCapability {
    if (!isWindow(window)) {
        return false;
    }
    if (
        !window.normalWindow ||
        !window.managed ||
        !window.resizeable ||
        window.appletPopup ||
        window.output !== scope.output
    ) {
        return false;
    }
    const desktops = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
    return desktops.ok && desktops.value.some((desktop) => desktop.id === scope.scope.desktopId);
}

export function decodeLeaves(
    root: TileCapability,
    decodedBoundary: (kind: "tile-children" | "tile-occupancy") => void,
): readonly DecodedLeaf[] | null {
    const pending: TileCapability[] = [root];
    const visited = new Set<object>([root]);
    const leaves: DecodedLeaf[] = [];
    while (pending.length > 0) {
        const tile = pending.pop();
        if (tile === undefined) {
            return null;
        }
        const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
        if (!children.ok) {
            return null;
        }
        decodedBoundary("tile-children");
        for (const child of children.value) {
            if (visited.has(child)) {
                return null;
            }
            if (visited.size >= MAX_TILES) {
                return null;
            }
            visited.add(child);
            pending.push(child);
        }
        if (!tile.isLayout) {
            const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (!windows.ok) {
                return null;
            }
            decodedBoundary("tile-occupancy");
            leaves.push({ tile, windows: windows.value });
        }
    }
    return leaves;
}

// Walk every tile reachable beneath a root with strict acyclic bounded
// decoding. Returns null on any structural defect, otherwise all tiles.
export function decodeTileTree(root: TileCapability): readonly TileCapability[] | null {
    const pending: TileCapability[] = [root];
    const visited = new Set<object>([root]);
    const tiles: TileCapability[] = [root];
    while (pending.length > 0) {
        const tile = pending.pop();
        if (tile === undefined) {
            return null;
        }
        const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
        if (!children.ok) {
            return null;
        }
        for (const child of children.value) {
            if (visited.has(child)) {
                return null;
            }
            if (visited.size >= MAX_TILES) {
                return null;
            }
            visited.add(child);
            tiles.push(child);
            pending.push(child);
        }
    }
    return tiles;
}

// Walk the scope tree and return its usable leaves in decoded order with their
// decoded occupancy. Returns null on any structural decode failure, matching
// decodeTileTree's strictness.
export function decodeUsableLeaves(root: TileCapability): readonly UsableLeaf[] | null {
    const tiles = decodeTileTree(root);
    if (tiles === null) {
        return null;
    }
    const leaves: UsableLeaf[] = [];
    for (const tile of tiles) {
        if (!tile.isLayout) {
            const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (!windows.ok) {
                return null;
            }
            leaves.push({ tile, windows: windows.value });
            continue;
        }
        if (tile !== root) {
            continue;
        }
        const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
        if (!children.ok) {
            return null;
        }
        if (children.value.length === 0) {
            const windows = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (!windows.ok) {
                return null;
            }
            leaves.push({ tile, windows: windows.value });
        }
    }
    return leaves;
}

// Depth of every usable leaf beneath a scope root, keyed by tile identity, so
// a fallback insertion candidate can derive its own dwindle orientation the
// same way `deepestLeaf` derives the intended leaf's. Depth is the number of
// layout ancestors above the leaf; a non-layout root and a zero-child layout
// root are both depth zero. Null on a structural decode failure.
export function dwindleLeafDepths(root: CustomTileCapability): Map<CustomTileCapability, number> | null {
    const depths = new Map<CustomTileCapability, number>();
    const walk = (tile: CustomTileCapability, depth: number): boolean => {
        if (!tile.isLayout) {
            depths.set(tile, depth);
            return true;
        }
        const children = decodeSequential(tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
        if (!children.ok) {
            return false;
        }
        if (children.value.length === 0) {
            depths.set(tile, depth);
            return true;
        }
        for (const child of children.value) {
            if (child === undefined || !walk(child, depth + 1)) {
                return false;
            }
        }
        return true;
    };
    return walk(root, 0) ? depths : null;
}

// Pre-order left-to-right realization of a preset overlay root, mirroring the
// executor's decoded split children. A non-layout root realizes to itself; a
// layout root must decode to exactly two custom-tile children per level, so any
// manual split, removal, or reorder of the overlay subtree returns null.
// Child order is derived by the split adapter from relativeGeometry, not from
// tiles[] array index: multi-ordinal native array order is unestablished.
export function collectPresetLeaves(root: TileCapability): readonly TileCapability[] | null {
    if (!isCustomTile(root)) {
        return null;
    }
    if (!root.isLayout) {
        return [root];
    }
    const ordered = customTileSplitSeam.decodeChildren(root);
    if (ordered === null || ordered.length !== 2) {
        return null;
    }
    const left = ordered[0];
    const right = ordered[1];
    if (left === undefined || right === undefined) {
        return null;
    }
    const leftLeaves = collectPresetLeaves(left);
    if (leftLeaves === null) {
        return null;
    }
    const rightLeaves = collectPresetLeaves(right);
    if (rightLeaves === null) {
        return null;
    }
    return [...leftLeaves, ...rightLeaves];
}

export function makeOperationLeaves(leaves: readonly DecodedLeaf[]): readonly OperationLeaf[] {
    const result: OperationLeaf[] = [];
    let windowIndex = 0;
    for (let tileIndex = 0; tileIndex < leaves.length; tileIndex += 1) {
        const decoded = leaves[tileIndex];
        if (decoded === undefined) {
            return [];
        }
        const refs: WindowRef[] = [];
        for (const window of decoded.windows) {
            refs.push({
                id: `window-${windowIndex}`,
                normal: window.normalWindow,
                managed: window.managed,
            });
            windowIndex += 1;
        }
        result.push({
            decoded,
            windows: decoded.windows,
            refs,
            leaf: {
                id: `tile-${tileIndex}`,
                isLayout: decoded.tile.isLayout,
                geometry: decoded.tile.absoluteGeometry,
                windows: refs,
            },
        });
    }
    return result;
}

export function operationLeafForTile(leaves: readonly OperationLeaf[], tile: TileCapability): OperationLeaf | null {
    for (const leaf of leaves) {
        if (leaf.decoded.tile === tile) {
            return leaf;
        }
    }
    return null;
}

export function windowIndex(windows: readonly WindowCapability[], target: WindowCapability): number {
    for (let index = 0; index < windows.length; index += 1) {
        if (windows[index] === target) {
            return index;
        }
    }
    return -1;
}

export function targetOccupantForActive(target: OperationLeaf, active: WindowCapability): TargetOccupant | null {
    if (windowIndex(target.windows, active) >= 0) {
        return { window: active, usesActiveWrapper: true };
    }
    // KWin can expose the same singleton native window through distinct QJS
    // wrappers. A singleton eligible tile occupant remains unambiguous.
    if (target.windows.length !== 1) {
        return null;
    }
    const occupant = target.windows[0];
    return occupant === undefined ? null : { window: occupant, usesActiveWrapper: false };
}

export function ordinalClass(ordinal: number): "first" | "later" {
    return ordinal === 0 ? "first" : "later";
}

// Structural preset-shape match: a live custom-tile subtree must realize the
// blueprint node with the node's own orientation. The two children are
// accepted in either decoded order because the executor's path mapping follows
// the split-return order.
export function presetNodeMatches(tile: CustomTileCapability, node: Blueprint): boolean {
    if (node.kind === "leaf") {
        return !tile.isLayout;
    }
    if (!tile.isLayout) {
        return false;
    }
    if (tile.layoutDirection !== (node.orientation === "horizontal" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION)) {
        return false;
    }
    const children = decodeSequential(tile.tiles, isCustomTile, 2);
    if (!children.ok || children.value.length !== 2) {
        return false;
    }
    const first = children.value[0];
    const second = children.value[1];
    if (first === undefined || second === undefined) {
        return false;
    }
    return (
        (presetNodeMatches(first, node.left) && presetNodeMatches(second, node.right)) ||
        (presetNodeMatches(first, node.right) && presetNodeMatches(second, node.left))
    );
}

// Occupancy bijection for a dwindle-matched scope: every usable leaf must be
// occupied by exactly one owned-population window whose recorded `tile` is that
// leaf, and every population window must occupy exactly one leaf.
export function dwindleOccupancyMatches(
    scope: { readonly scope: Scope; readonly output: OutputCapability },
    leaves: readonly UsableLeaf[],
    population: readonly WindowCapability[],
): boolean {
    if (leaves.length !== population.length) {
        return false;
    }
    const occupied = new Set<object>();
    for (const leaf of leaves) {
        let occupants = 0;
        for (const value of leaf.windows) {
            if (windowInScope(value, scope) && value.tile === leaf.tile) {
                occupants += 1;
                occupied.add(value);
            }
        }
        if (occupants !== 1) {
            return false;
        }
    }
    for (const window of population) {
        if (!occupied.has(window)) {
            return false;
        }
    }
    return true;
}

// Bijection-only dwindle tree predicate: whether the live tree beneath the
// root realizes a window-to-leaf occupancy bijection with the owned population,
// without any shape requirement.
export function dwindleBijectionTreeMatches(
    scope: { readonly scope: Scope; readonly output: OutputCapability },
    root: CustomTileCapability,
    population: readonly WindowCapability[],
): boolean {
    const leaves = decodeUsableLeaves(root);
    if (leaves === null) {
        return false;
    }
    return dwindleOccupancyMatches(scope, leaves, population);
}
