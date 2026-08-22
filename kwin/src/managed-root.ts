import {
    CUSTOM_TILE_PADDING,
    isCustomTile,
    setCustomTilePadding,
} from "./boundary";

export function prepareManagedRoot(root: unknown, onPaddingFailure?: () => void): unknown {
    if (isCustomTile(root) && !setCustomTilePadding(root, CUSTOM_TILE_PADDING)) {
        onPaddingFailure?.();
    }
    return root;
}
