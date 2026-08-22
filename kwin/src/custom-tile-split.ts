import { decodeSequential, isCustomTile, splitCustomTile, type CustomTileCapability } from "./boundary";
import { type BlueprintSplitSeam } from "./layout-executor";
import { type Orientation } from "./layout-blueprint";

const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;

function splitDirection(orientation: Orientation): number {
    return orientation === "horizontal" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
}

export const customTileSplitSeam: BlueprintSplitSeam<CustomTileCapability> = {
    split: (tile, orientation) => splitCustomTile(tile, splitDirection(orientation)),
    // split()'s return shape is native-unproven and unused (see
    // docs/changes/nary-split-support/research/native-binding-evidence.md:169-172).
    // Children are obtained by re-decoding the split target's own `tiles`
    // afterward, the same re-decode-after-mutation shape already established
    // for `removeCustomTile` (boundary.ts:431-433) and already used at the
    // resize postcondition (controller.ts:2715).
    decodeChildren: (tile) => {
        const decoded = decodeSequential(tile.tiles, isCustomTile, 2);
        if (!decoded.ok) {
            return null;
        }
        const a = decoded.value[0];
        const b = decoded.value[1];
        if (a === undefined || b === undefined) {
            return null;
        }
        // Multi-ordinal array position on `tiles` is unestablished for the
        // native binding (native-binding-evidence.md:149-176: observed only
        // on a one-child root). Order children by relativeGeometry along the
        // split axis instead of trusting array index.
        const axis = tile.layoutDirection === HORIZONTAL_LAYOUT_DIRECTION ? "x" : "y";
        const aPosition = a.relativeGeometry[axis];
        const bPosition = b.relativeGeometry[axis];
        if (aPosition === bPosition) {
            return null;
        }
        return Object.freeze(aPosition < bPosition ? [a, b] : [b, a]);
    },
};
