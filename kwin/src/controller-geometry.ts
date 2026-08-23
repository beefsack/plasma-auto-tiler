import {
    isCustomTile,
    type CustomTileCapability,
    type RectCapability,
} from "./boundary";
import { type Orientation } from "./layout-blueprint";
import { type Direction, type Point, type SplitAxis } from "./logic";

const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;

export type GeometryDropBail =
    | { readonly kind: "center-unresolved" }
    | { readonly kind: "no-target-leaf"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" }
    | { readonly kind: "target-is-origin"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" }
    | { readonly kind: "leaf-not-in-topology"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" };

export function sameGeometry(a: RectCapability, b: RectCapability): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function positiveGeometry(geometry: RectCapability): boolean {
    return geometry.width > 0 && geometry.height > 0;
}

function formatCoordinate(value: number): string {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "non-finite";
}

function formatPoint(point: Point): string {
    return `${formatCoordinate(point.x)},${formatCoordinate(point.y)}`;
}

export function dragGeometryBail(target: GeometryDropBail): string {
    switch (target.kind) {
        case "center-unresolved":
            return "drag-bail:center-unresolved";
        case "no-target-leaf":
            return `drag-bail:no-target-leaf:${formatPoint(target.center)}`;
        case "target-is-origin":
            return `drag-bail:target-is-origin:${formatPoint(target.center)}`;
        case "leaf-not-in-topology":
            return `drag-bail:leaf-not-in-topology:${formatPoint(target.center)}`;
    }
}

export function splitDirection(direction: Direction): number {
    return direction === "left" || direction === "right"
        ? HORIZONTAL_LAYOUT_DIRECTION
        : VERTICAL_LAYOUT_DIRECTION;
}

export function layoutDirectionFor(orientation: Orientation): number {
    return orientation === "horizontal" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
}

export function parentHasSameSplitAxis(tile: CustomTileCapability, axis: SplitAxis): boolean {
    const parent = tile.parent;
    return (
        parent !== null &&
        isCustomTile(parent) &&
        parent.isLayout &&
        parent.layoutDirection === (axis === "x" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION)
    );
}
