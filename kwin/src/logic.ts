// Pure deterministic topology and hit-test planning for the Custom Tile
// vertical slice. Independent of KWin and Qt: no global access, no imports
// from the ambient KWin declarations, immutable inputs and outputs only.
// Every plan is an instruction for a later adapter to execute; none of these
// functions mutates the topology, splits a tile, or rebuilds a container.

export type Direction = "left" | "right" | "up" | "down";

// The four placement directions in the order the drag planner can emit.
export const DIRECTIONS: readonly Direction[] = ["left", "right", "up", "down"];

export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface WindowRef {
    readonly id: string;
    readonly normal: boolean;
    readonly managed: boolean;
}

export function isEligibleWindow(window: WindowRef): boolean {
    return window.normal && window.managed;
}

export interface Leaf {
    readonly id: string;
    readonly isLayout: boolean;
    readonly geometry: Rect;
    readonly windows: readonly WindowRef[];
}

// Session-local scope: exact Output object identity plus virtual-desktop ID.
// Output references are opaque; identity is reference equality only.
export interface Scope {
    readonly output: object;
    readonly desktopId: string;
}

export function sameScope(a: Scope, b: Scope): boolean {
    return a.output === b.output && a.desktopId === b.desktopId;
}

// Origin record captured when a window begins a drag or a keyboard insertion is
// armed. Cancellation restores exactly this association and geometry.
export interface OriginRecord {
    readonly scope: Scope;
    readonly originLeafId: string;
    readonly windowId: string;
    readonly geometry: Rect;
}

export type RejectionKind =
    | "invalid-numbers"
    | "invalid-geometry"
    | "pointer-outside"
    | "same-window"
    | "same-leaf"
    | "empty-target"
    | "ineligible-target"
    | "ineligible-window"
    | "stale-state"
    | "mismatched-state"
    | "no-target"
    | "cross-scope"
    | "invalid-leaf-count"
    | "invalid-blueprint"
    | "invalid-preset-kind";

export interface Rejection {
    readonly kind: RejectionKind;
    readonly message: string;
}

export type Result<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: Rejection };

function reject(
    kind: RejectionKind,
    message: string,
): { readonly ok: false; readonly reason: Rejection } {
    return { ok: false, reason: { kind, message } };
}

function isValidRect(rect: Rect): boolean {
    return (
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        rect.width > 0 &&
        Number.isFinite(rect.height) &&
        rect.height > 0
    );
}

function isValidPoint(point: Point): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y);
}

// Outer containment is half-open: [x, x + width) x [y, y + height). A point on
// the right or bottom edge is outside; a point on the left or top edge is in.
export function containsPoint(rect: Rect, point: Point): boolean {
    return (
        point.x >= rect.x &&
        point.x < rect.x + rect.width &&
        point.y >= rect.y &&
        point.y < rect.y + rect.height
    );
}

// Deterministic occupied-target ordering rule: a leaf orders before another
// when its top edge (y) is smaller, then its left edge (x), then its id.
// This is the single tie-break rule used by pickTargetLeaf and automatic
// placement, so both stay deterministic for any leaf arrangement.
export function compareLeaves(a: Leaf, b: Leaf): number {
    if (a.geometry.y !== b.geometry.y) {
        return a.geometry.y < b.geometry.y ? -1 : 1;
    }
    if (a.geometry.x !== b.geometry.x) {
        return a.geometry.x < b.geometry.x ? -1 : 1;
    }
    if (a.id < b.id) {
        return -1;
    }
    if (a.id > b.id) {
        return 1;
    }
    return 0;
}

// Smallest occupied non-layout leaf under the point, by the ordering rule.
// Returns null when no eligible occupied leaf contains the point.
export function pickTargetLeaf(leaves: readonly Leaf[], point: Point): Leaf | null {
    let best: Leaf | null = null;
    for (const leaf of leaves) {
        if (leaf.isLayout || leaf.windows.length === 0) {
            continue;
        }
        if (!containsPoint(leaf.geometry, point)) {
            continue;
        }
        if (best === null || compareLeaves(leaf, best) < 0) {
            best = leaf;
        }
    }
    return best;
}

// Smallest non-layout leaf (occupied or empty) under the point, by the
// ordering rule. Returns null when no non-layout leaf contains the point.
// Geometry-drop target resolution uses this because an empty non-layout leaf is
// a valid direct-placement target, unlike the occupied-only pickTargetLeaf.
export function pickDropLeaf(leaves: readonly Leaf[], point: Point): Leaf | null {
    let best: Leaf | null = null;
    for (const leaf of leaves) {
        if (leaf.isLayout) {
            continue;
        }
        if (!containsPoint(leaf.geometry, point)) {
            continue;
        }
        if (best === null || compareLeaves(leaf, best) < 0) {
            best = leaf;
        }
    }
    return best;
}

// Directional-neighbor selection: a candidate's facing edge must be strictly on
// the requested side and its perpendicular half-open interval must overlap the
// current leaf. The smallest facing-edge distance wins; ties resolve with the
// existing compareLeaves order. Gaps are allowed, there is no wrap, and no
// candidate returns null.
export function findNeighborLeaf(
    leaves: readonly Leaf[],
    current: Leaf,
    direction: Direction,
): Leaf | null {
    let best: Leaf | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const leaf of leaves) {
        if (leaf.id === current.id) {
            continue;
        }
        const distance = neighborDistance(current.geometry, leaf.geometry, direction);
        if (distance === null) {
            continue;
        }
        if (best === null || distance < bestDistance) {
            best = leaf;
            bestDistance = distance;
        } else if (distance === bestDistance && compareLeaves(leaf, best) < 0) {
            best = leaf;
        }
    }
    return best;
}

// Facing-edge distance for a candidate on the requested side, or null when the
// candidate is not strictly on that side or its half-open perpendicular
// interval does not overlap the current rect.
function neighborDistance(
    current: Rect,
    candidate: Rect,
    direction: Direction,
): number | null {
    switch (direction) {
        case "left":
            if (candidate.x + candidate.width > current.x) {
                return null;
            }
            if (!intervalsOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height)) {
                return null;
            }
            return current.x - (candidate.x + candidate.width);
        case "right":
            if (candidate.x < current.x + current.width) {
                return null;
            }
            if (!intervalsOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height)) {
                return null;
            }
            return candidate.x - (current.x + current.width);
        case "up":
            if (candidate.y + candidate.height > current.y) {
                return null;
            }
            if (!intervalsOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width)) {
                return null;
            }
            return current.y - (candidate.y + candidate.height);
        case "down":
            if (candidate.y < current.y + current.height) {
                return null;
            }
            if (!intervalsOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width)) {
                return null;
            }
            return candidate.y - (current.y + current.height);
    }
    return null;
}

// Half-open interval overlap: [aStart, aEnd) and [bStart, bEnd) overlap only
// when neither interval begins at or beyond the other's end edge.
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart < bEnd && bStart < aEnd;
}

// The center point of a positive finite rect, or null when the rect is not
// positive and finite. Used to anchor a plain drag's final frame geometry to a
// tile-tree leaf.
export function rectCenter(rect: Rect): Point | null {
    if (!isValidRect(rect)) {
        return null;
    }
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// Small documented numeric tolerance for relativeGeometry equality checks, in
// screen-relative [0,1] units. A difference at or below this bound counts as
// equal; the tolerance exists because KWin derives relativeGeometry from
// floating-point geometry arithmetic.
export const RELATIVE_GEOMETRY_EPSILON = 1e-6;

// The axis a two-child layout splits along: Horizontal (side-by-side) children
// split "x", Vertical (stacked) children split "y".
export type SplitAxis = "x" | "y";

export interface EqualSplit {
    readonly axis: SplitAxis;
    readonly first: Rect;
    readonly second: Rect;
}

function nearEdge(rect: Rect, axis: SplitAxis): number {
    return axis === "x" ? rect.x : rect.y;
}

function farEdge(rect: Rect, axis: SplitAxis): number {
    return axis === "x" ? rect.x + rect.width : rect.y + rect.height;
}

function perpStart(rect: Rect, axis: SplitAxis): number {
    return axis === "x" ? rect.y : rect.x;
}

function perpEnd(rect: Rect, axis: SplitAxis): number {
    return axis === "x" ? rect.y + rect.height : rect.x + rect.width;
}

function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= RELATIVE_GEOMETRY_EPSILON;
}

// Equal 50/50 split of a parent rect along one axis, from two children that
// currently tile the parent. Returns null unless the parent and both children
// are positive finite rects, the two children are adjacent (first far edge ==
// second near edge), and they fill the parent along the axis (first near ==
// parent near, second far == parent far) with both spanning the parent's full
// perpendicular extent. A null result means the midpoint is not a provably safe
// target, so no write should be attempted.
export function planEqualSplit(
    parent: Rect,
    a: Rect,
    b: Rect,
    axis: SplitAxis,
): EqualSplit | null {
    if (!isValidRect(parent) || !isValidRect(a) || !isValidRect(b)) {
        return null;
    }
    const [first, second] = nearEdge(a, axis) <= nearEdge(b, axis) ? [a, b] : [b, a];
    if (nearlyEqual(nearEdge(first, axis), nearEdge(second, axis))) {
        return null;
    }
    if (
        !nearlyEqual(perpStart(first, axis), perpStart(parent, axis)) ||
        !nearlyEqual(perpEnd(first, axis), perpEnd(parent, axis)) ||
        !nearlyEqual(perpStart(second, axis), perpStart(parent, axis)) ||
        !nearlyEqual(perpEnd(second, axis), perpEnd(parent, axis))
    ) {
        return null;
    }
    if (!nearlyEqual(nearEdge(first, axis), nearEdge(parent, axis))) {
        return null;
    }
    if (!nearlyEqual(farEdge(first, axis), nearEdge(second, axis))) {
        return null;
    }
    if (!nearlyEqual(farEdge(second, axis), farEdge(parent, axis))) {
        return null;
    }
    const start = nearEdge(parent, axis);
    const end = farEdge(parent, axis);
    const midpoint = start + (end - start) / 2;
    const firstTarget =
        axis === "x"
            ? { x: start, y: first.y, width: midpoint - start, height: first.height }
            : { x: first.x, y: start, width: first.width, height: midpoint - start };
    const secondTarget =
        axis === "x"
            ? { x: midpoint, y: second.y, width: end - midpoint, height: second.height }
            : { x: second.x, y: midpoint, width: second.width, height: end - midpoint };
    return { axis, first: firstTarget, second: secondTarget };
}

// Whether two rects are equal along the split axis within the documented
// numeric tolerance. Used to prove the two reflow leaves became equal after a
// relativeGeometry write; the perpendicular extents are fixed by parent tiling.
export function equalAlongAxis(a: Rect, b: Rect, axis: SplitAxis): boolean {
    const aExtent = axis === "x" ? a.width : a.height;
    const bExtent = axis === "x" ? b.width : b.height;
    return Math.abs(aExtent - bExtent) <= RELATIVE_GEOMETRY_EPSILON;
}

// Normalized pointer fraction relative to a positive finite rect. The pointer
// must be inside the half-open rect; a fraction of exactly 1 on either axis is
// outside.
export type DragClass =
    | { readonly kind: "center" }
    | { readonly kind: "direction"; readonly direction: Direction };

export function classifyDirection(point: Point, rect: Rect): Result<DragClass> {
    if (!isValidPoint(point)) {
        return reject("invalid-numbers", "pointer coordinates must be finite");
    }
    if (!isValidRect(rect)) {
        return reject("invalid-geometry", "rect must have positive finite width and height");
    }
    const fx = (point.x - rect.x) / rect.width;
    const fy = (point.y - rect.y) / rect.height;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) {
        return reject("pointer-outside", "pointer is outside the rect (half-open containment)");
    }
    const dx = fx - 0.5;
    const dy = fy - 0.5;
    // Center dead zone is the central 50%: max(|dx|, |dy|) < 0.25. An exact
    // deviation of 0.25 selects a direction.
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.25) {
        return { ok: true, value: { kind: "center" } };
    }
    // Horizontal wins an exact diagonal tie (|dx| === |dy|).
    if (Math.abs(dx) >= Math.abs(dy)) {
        return { ok: true, value: { kind: "direction", direction: dx < 0 ? "left" : "right" } };
    }
    return { ok: true, value: { kind: "direction", direction: dy < 0 ? "up" : "down" } };
}

export interface KeyboardRecord {
    readonly scope: Scope;
    readonly leafId: string;
    readonly windowId: string;
}

export interface KeyboardRequest {
    readonly scope: Scope;
    readonly direction: Direction;
    readonly focusedLeaf: Leaf;
    readonly focusedWindow: WindowRef;
    readonly incoming: WindowRef;
    readonly record: KeyboardRecord | null;
}

export interface KeyboardPlan {
    readonly kind: "keyboard-insertion";
    readonly scope: Scope;
    readonly direction: Direction;
    readonly targetLeaf: Leaf;
    readonly targetWindow: WindowRef;
    readonly incoming: WindowRef;
    readonly targetSide: Direction;
    readonly incomingSide: Direction;
}

function oppositeDirection(direction: Direction): Direction {
    switch (direction) {
        case "left":
            return "right";
        case "right":
            return "left";
        case "up":
            return "down";
        case "down":
            return "up";
    }
}

// The new window appears on the requested side and the focused occupied target
// keeps the opposite child; left/right split horizontally and up/down
// vertically. The adapter maps these sides to concrete split children. A stale
// or mismatched recorded focus rejects safely.
export function planKeyboardInsertion(request: KeyboardRequest): Result<KeyboardPlan> {
    if (!isValidRect(request.focusedLeaf.geometry)) {
        return reject("invalid-geometry", "focused leaf geometry must be positive and finite");
    }
    if (request.focusedLeaf.isLayout) {
        return reject("ineligible-target", "focused leaf must not be a layout container");
    }
    if (request.focusedLeaf.windows.length === 0) {
        return reject("empty-target", "focused leaf is empty");
    }
    if (!request.focusedLeaf.windows.some((window) => window.id === request.focusedWindow.id)) {
        return reject("mismatched-state", "focused window is not associated with the focused leaf");
    }
    if (request.focusedLeaf.windows.some((window) => !isEligibleWindow(window))) {
        return reject("ineligible-target", "focused leaf contains an ineligible window");
    }
    if (!isEligibleWindow(request.incoming)) {
        return reject("ineligible-window", "incoming window is not eligible");
    }
    if (request.incoming.id === request.focusedWindow.id) {
        return reject("same-window", "incoming window is the focused window");
    }
    if (request.focusedLeaf.windows.some((window) => window.id === request.incoming.id)) {
        return reject("same-leaf", "incoming window already occupies the focused leaf");
    }
    if (request.record !== null) {
        if (!sameScope(request.record.scope, request.scope)) {
            return reject("cross-scope", "recorded scope differs from the current scope");
        }
        if (request.record.leafId !== request.focusedLeaf.id) {
            return reject("stale-state", "recorded leaf no longer matches the focused leaf");
        }
        if (request.record.windowId !== request.focusedWindow.id) {
            return reject("stale-state", "recorded window no longer matches the focused window");
        }
    }
    return {
        ok: true,
        value: {
            kind: "keyboard-insertion",
            scope: request.scope,
            direction: request.direction,
            targetLeaf: request.focusedLeaf,
            targetWindow: request.focusedWindow,
            incoming: request.incoming,
            targetSide: oppositeDirection(request.direction),
            incomingSide: request.direction,
        },
    };
}

export interface DragRequest {
    readonly scope: Scope;
    readonly originLeaf: Leaf;
    readonly draggedWindow: WindowRef;
    readonly targetLeaf: Leaf;
    readonly pointer: Point;
    readonly record: OriginRecord | null;
}

export type DragPlan =
    | {
        readonly kind: "drag-direction";
        readonly scope: Scope;
        readonly direction: Direction;
        readonly originLeaf: Leaf;
        readonly targetLeaf: Leaf;
        readonly selectedWindow: WindowRef;
        readonly oppositeWindow: WindowRef;
        readonly originRetained: true;
    }
    | {
        readonly kind: "drag-noop";
        readonly scope: Scope;
        readonly originLeaf: Leaf;
        readonly targetLeaf: Leaf;
    };

// Drag over a different occupied leaf. The selected side receives the dragged
// window; the opposite side receives the target window. The origin leaf is
// retained (empty) after success and is never collapsed or restructured. The
// central 50% dead zone is a deliberate no-op, not an error.
export function planDragPlacement(request: DragRequest): Result<DragPlan> {
    if (!isValidPoint(request.pointer)) {
        return reject("invalid-numbers", "pointer coordinates must be finite");
    }
    if (!isValidRect(request.originLeaf.geometry)) {
        return reject("invalid-geometry", "origin leaf geometry must be positive and finite");
    }
    if (!isValidRect(request.targetLeaf.geometry)) {
        return reject("invalid-geometry", "target leaf geometry must be positive and finite");
    }
    if (request.originLeaf.id === request.targetLeaf.id) {
        return reject("same-leaf", "origin and target leaf are the same");
    }
    if (request.targetLeaf.isLayout) {
        return reject("ineligible-target", "target leaf must not be a layout container");
    }
    if (request.targetLeaf.windows.length === 0) {
        return reject("empty-target", "target leaf is empty");
    }
    if (request.targetLeaf.windows.some((window) => !isEligibleWindow(window))) {
        return reject("ineligible-target", "target leaf contains an ineligible window");
    }
    if (!request.originLeaf.windows.some((window) => window.id === request.draggedWindow.id)) {
        return reject("mismatched-state", "dragged window is not associated with the origin leaf");
    }
    if (!isEligibleWindow(request.draggedWindow)) {
        return reject("ineligible-window", "dragged window is not eligible");
    }
    const oppositeWindow = request.targetLeaf.windows[0];
    if (oppositeWindow === undefined) {
        return reject("empty-target", "target leaf is empty");
    }
    if (request.draggedWindow.id === oppositeWindow.id) {
        return reject("same-window", "dragged window is the target window");
    }
    if (request.record !== null) {
        if (!sameScope(request.record.scope, request.scope)) {
            return reject("cross-scope", "recorded scope differs from the current scope");
        }
        if (request.record.originLeafId !== request.originLeaf.id) {
            return reject("stale-state", "recorded origin leaf no longer matches the origin leaf");
        }
        if (request.record.windowId !== request.draggedWindow.id) {
            return reject("stale-state", "recorded window no longer matches the dragged window");
        }
    }
    const classified = classifyDirection(request.pointer, request.targetLeaf.geometry);
    if (!classified.ok) {
        return classified;
    }
    if (classified.value.kind === "center") {
        return {
            ok: true,
            value: {
                kind: "drag-noop",
                scope: request.scope,
                originLeaf: request.originLeaf,
                targetLeaf: request.targetLeaf,
            },
        };
    }
    return {
        ok: true,
        value: {
            kind: "drag-direction",
            scope: request.scope,
            direction: classified.value.direction,
            originLeaf: request.originLeaf,
            targetLeaf: request.targetLeaf,
            selectedWindow: request.draggedWindow,
            oppositeWindow,
            originRetained: true,
        },
    };
}

export interface GeometryDropRequest {
    readonly scope: Scope;
    readonly originLeaf: Leaf;
    readonly targetLeaf: Leaf;
    readonly draggedWindow: WindowRef;
    readonly pointer: Point;
    readonly record: OriginRecord | null;
}

export type GeometryDropPlan =
    | {
        readonly kind: "geometry-drop";
        readonly scope: Scope;
        readonly direction: Direction;
        readonly originLeaf: Leaf;
        readonly targetLeaf: Leaf;
        readonly selectedWindow: WindowRef;
        readonly oppositeWindow: WindowRef;
    }
    | {
        readonly kind: "geometry-drop-empty";
        readonly scope: Scope;
        readonly originLeaf: Leaf;
        readonly targetLeaf: Leaf;
        readonly selectedWindow: WindowRef;
    };

// Plain (no-modifier) drop finish: KWin has floated the dragged window at the
// drop point and no custom tile was applied, so the target is derived from the
// chosen finish-time resolver point against the tile tree instead of any
// native tile assignment. The origin leaf may or may not still list the dragged
// window: KWin's unmanage can lag the finish hook, and both states must plan.
// The same plan is authoritative for a native Shift drop, whose target leaf
// already holds the dragged window plus one occupant, so all drop kinds
// converge on one reflow. An empty non-layout target leaf is a valid
// direct-placement target: the dragged window is placed into it without a
// split. An occupied target plans the position-directed split of the target
// leaf; the origin collapse is a separate deferred phase. The split direction
// and dragged side derive from the chosen pointer relative to the target leaf
// geometry; the central 50% dead zone defaults to a vertical split with the
// original occupant above and the dragged window below.
export function planGeometryDrop(request: GeometryDropRequest): Result<GeometryDropPlan> {
    if (!isValidPoint(request.pointer)) {
        return reject("invalid-numbers", "pointer coordinates must be finite");
    }
    if (!isValidRect(request.originLeaf.geometry)) {
        return reject("invalid-geometry", "origin leaf geometry must be positive and finite");
    }
    if (!isValidRect(request.targetLeaf.geometry)) {
        return reject("invalid-geometry", "target leaf geometry must be positive and finite");
    }
    if (request.originLeaf.id === request.targetLeaf.id) {
        return reject("same-leaf", "origin and target leaf are the same");
    }
    if (request.targetLeaf.isLayout) {
        return reject("ineligible-target", "target leaf must not be a layout container");
    }
    if (request.targetLeaf.windows.length > 2) {
        return reject("invalid-leaf-count", "geometry drop target must hold the dragged window plus at most one occupant");
    }
    if (
        request.targetLeaf.windows.length === 2 &&
        !request.targetLeaf.windows.some((window) => window.id === request.draggedWindow.id)
    ) {
        return reject("invalid-leaf-count", "a two-window target must hold the dragged window plus one occupant");
    }
    if (request.targetLeaf.windows.filter((window) => window.id === request.draggedWindow.id).length > 1) {
        return reject("mismatched-state", "dragged window must appear at most once in the target leaf");
    }
    if (request.targetLeaf.windows.some((window) => !isEligibleWindow(window))) {
        return reject("ineligible-target", "target leaf contains an ineligible window");
    }
    if (!isEligibleWindow(request.draggedWindow)) {
        return reject("ineligible-window", "dragged window is not eligible");
    }
    if (request.originLeaf.windows.filter((window) => window.id === request.draggedWindow.id).length > 1) {
        return reject("mismatched-state", "dragged window must appear at most once in the origin leaf");
    }
    if (request.record !== null) {
        if (!sameScope(request.record.scope, request.scope)) {
            return reject("cross-scope", "recorded scope differs from the current scope");
        }
        if (request.record.originLeafId !== request.originLeaf.id) {
            return reject("stale-state", "recorded origin leaf no longer matches the origin leaf");
        }
        if (request.record.windowId !== request.draggedWindow.id) {
            return reject("stale-state", "recorded window no longer matches the dragged window");
        }
    }
    if (request.targetLeaf.windows.length === 0) {
        return {
            ok: true,
            value: {
                kind: "geometry-drop-empty",
                scope: request.scope,
                originLeaf: request.originLeaf,
                targetLeaf: request.targetLeaf,
                selectedWindow: request.draggedWindow,
            },
        };
    }
    const oppositeWindow = request.targetLeaf.windows.find((window) => window.id !== request.draggedWindow.id);
    if (oppositeWindow === undefined) {
        return reject("invalid-leaf-count", "geometry drop target must hold exactly one occupant besides the dragged window");
    }
    const classified = classifyDirection(request.pointer, request.targetLeaf.geometry);
    if (!classified.ok) {
        return classified;
    }
    const direction = classified.value.kind === "center" ? "down" : classified.value.direction;
    return {
        ok: true,
        value: {
            kind: "geometry-drop",
            scope: request.scope,
            direction,
            originLeaf: request.originLeaf,
            targetLeaf: request.targetLeaf,
            selectedWindow: request.draggedWindow,
            oppositeWindow,
        },
    };
}

export interface CancellationRequest {
    readonly scope: Scope;
    readonly record: OriginRecord | null;
}

export interface CancellationPlan {
    readonly kind: "cancellation";
    readonly scope: Scope;
    readonly originLeafId: string;
    readonly windowId: string;
    readonly geometry: Rect;
}

// Cancellation returns only the recorded origin association and geometry. The
// target is never involved, so it cannot be mutated. A missing record or a
// scope mismatch rejects safely.
export function planCancellation(request: CancellationRequest): Result<CancellationPlan> {
    const record = request.record;
    if (record === null) {
        return reject("stale-state", "no recorded origin state to cancel");
    }
    if (!sameScope(record.scope, request.scope)) {
        return reject("cross-scope", "recorded scope differs from the current scope");
    }
    if (!isValidRect(record.geometry)) {
        return reject("invalid-geometry", "recorded geometry must be positive and finite");
    }
    return {
        ok: true,
        value: {
            kind: "cancellation",
            scope: request.scope,
            originLeafId: record.originLeafId,
            windowId: record.windowId,
            geometry: record.geometry,
        },
    };
}

export interface AutomaticRequest {
    readonly scope: Scope;
    readonly window: WindowRef;
    readonly leaves: readonly Leaf[];
}

export interface AutomaticPlan {
    readonly kind: "auto-fill";
    readonly scope: Scope;
    readonly leaf: Leaf;
    readonly window: WindowRef;
    readonly assignmentOnly: true;
}

function firstByOrder(leaves: readonly Leaf[]): Leaf | null {
    let best: Leaf | null = null;
    for (const leaf of leaves) {
        if (best === null || compareLeaves(leaf, best) < 0) {
            best = leaf;
        }
    }
    return best;
}

// Automatic placement picks the smallest retained empty leaf by the ordering
// rule and emits an assignment only: no split, rebuild, or collapse.
export function planAutomaticPlacement(request: AutomaticRequest): Result<AutomaticPlan> {
    if (!isEligibleWindow(request.window)) {
        return reject("ineligible-window", "window is not eligible");
    }
    const emptyLeaves: Leaf[] = [];
    for (const leaf of request.leaves) {
        if (!isValidRect(leaf.geometry)) {
            return reject("invalid-geometry", "leaf geometry must be positive and finite");
        }
        if (leaf.windows.some((window) => window.id === request.window.id)) {
            return reject("same-window", "window already occupies a leaf");
        }
        if (leaf.isLayout) {
            continue;
        }
        if (leaf.windows.length === 0) {
            emptyLeaves.push(leaf);
        }
    }
    const selected = firstByOrder(emptyLeaves);
    if (selected === null) {
        return reject("no-target", "no retained empty leaf is available");
    }
    return {
        ok: true,
        value: {
            kind: "auto-fill",
            scope: request.scope,
            leaf: selected,
            window: request.window,
            assignmentOnly: true,
        },
    };
}

// ==== Desktop cleanup removal selection ====
//
// Pure selection of at most one removable virtual desktop from an ordered
// snapshot of the live global desktop list. The controller reads all state
// fresh per call, resolves the opaque desktop capabilities to ids, and passes
// the four id sets here; this planner only decides which id may be removed. An
// entry is removable only when it is controller-owned, empty (no occupying
// windows), invisible on every output, and not protected as trailing capacity
// or the last global desktop. The ordered snapshot is the single determinism
// source: repeated calls with fresh equivalent snapshots select the same
// earliest eligible entry in stable order, never a set-member tie-break.

export interface DesktopCleanupRequest {
    readonly orderedIds: readonly string[];
    readonly ownedIds: ReadonlySet<string>;
    readonly visibleIds: ReadonlySet<string>;
    readonly occupiedIds: ReadonlySet<string>;
    readonly protectedTrailingIds: ReadonlySet<string>;
}

export interface DesktopCleanupPlan {
    readonly kind: "desktop-cleanup-removal";
    readonly id: string;
}

// Selects at most one removable desktop in snapshot order. None is selected
// when the snapshot holds a single global desktop or no entry is owned,
// empty, invisible, and unprotected; the caller then leaves the desktop list
// unchanged.
export function planDesktopCleanup(request: DesktopCleanupRequest): Result<DesktopCleanupPlan> {
    if (request.orderedIds.length <= 1) {
        return reject("no-target", "no removable desktop when only one global desktop remains");
    }
    for (const id of request.orderedIds) {
        if (!request.ownedIds.has(id)) {
            continue;
        }
        if (request.occupiedIds.has(id)) {
            continue;
        }
        if (request.visibleIds.has(id)) {
            continue;
        }
        if (request.protectedTrailingIds.has(id)) {
            continue;
        }
        return {
            ok: true,
            value: { kind: "desktop-cleanup-removal", id },
        };
    }
    return reject("no-target", "no owned empty invisible unprotected desktop is removable");
}
