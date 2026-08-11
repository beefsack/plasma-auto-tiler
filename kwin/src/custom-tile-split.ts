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
    decodeChildren: (value) => {
        const decoded = decodeSequential(value, isCustomTile, 2);
        if (!decoded.ok) {
            return null;
        }
        const left = decoded.value[0];
        const right = decoded.value[1];
        if (left === undefined || right === undefined) {
            return null;
        }
        return Object.freeze([left, right]);
    },
};
