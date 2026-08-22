import {
    decodeSequential,
    isCustomTile,
    splitCustomTile,
    MAX_SEQUENTIAL_LENGTH,
    type CustomTileCapability,
} from "./boundary";
import { type BlueprintSplitSeam } from "./layout-executor";
import { type Orientation } from "./layout-blueprint";

const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;

function splitDirection(orientation: Orientation): number {
    return orientation === "horizontal" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
}

// Multi-ordinal array position on `tiles` is unestablished for the native
// binding (native-binding-evidence.md:149-176: observed only on a one-child
// root). Order children by relativeGeometry along the split axis instead of
// trusting array index. `children` is a project-side decoded array (the
// output of `decodeSequential`), not a raw native value, so ordinary array
// methods on it are safe here.
export function orderCustomTilesByAxis(
    children: readonly CustomTileCapability[],
    axis: "x" | "y",
): readonly CustomTileCapability[] | null {
    const positioned = children.map((child) => {
        const geometry = child.relativeGeometry;
        return { child, position: geometry[axis], width: geometry.width, height: geometry.height };
    });
    // Real, load-bearing guard: KWin minimum-tile-size splits can yield a
    // degenerate zero-extent child, which must be rejected as a capacity
    // failure rather than silently ordered.
    if (positioned.some((entry) => entry.width <= 0 || entry.height <= 0)) {
        return null;
    }
    const positions = positioned.map((entry) => entry.position);
    if (new Set(positions).size !== positions.length) {
        return null;
    }
    return Object.freeze(
        positioned
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((entry) => entry.child),
    );
}

export const customTileSplitSeam: BlueprintSplitSeam<CustomTileCapability> = {
    split: (tile, orientation) => splitCustomTile(tile, splitDirection(orientation)),
    // split()'s return shape is native-unproven and unused (see
    // docs/changes/nary-split-support/research/native-binding-evidence.md:169-172).
    // Children are obtained by re-decoding the split target's own `tiles`
    // afterward, the same re-decode-after-mutation shape already established
    // for `removeCustomTile` (boundary.ts:431-433) and already used at the
    // resize postcondition (controller.ts:2715).
    //
    // The decode accepts any length `tile.tiles` reports (not just 2); it is
    // up to each caller (e.g. the blueprint executor's own binary-split
    // contract) to decide what arity it requires.
    decodeChildren: (tile) => {
        const decoded = decodeSequential(tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
        if (!decoded.ok || decoded.value.length < 2) {
            return null;
        }
        const axis = tile.layoutDirection === HORIZONTAL_LAYOUT_DIRECTION ? "x" : "y";
        return orderCustomTilesByAxis(decoded.value, axis);
    },
};
