import {
    FeatureGate,
    MAX_SEQUENTIAL_LENGTH,
    TransientState,
    assignWindowToTile,
    decodeSequential,
    detachWindowFromTile,
    isCustomTile,
    isOutput,
    isPoint,
    isTile,
    isVirtualDesktop,
    isWindow,
    manageTile,
    removeCustomTile,
    sameScope,
    setTileRelativeGeometry,
    splitCustomTile,
    type CustomTileCapability,
    type OutputCapability,
    type RectCapability,
    type TileCapability,
    type VirtualDesktopCapability,
    type WindowCapability,
} from "./boundary";
import { customTileSplitSeam } from "./custom-tile-split";
import { buildDwindleBlueprint, type Blueprint, type Orientation } from "./layout-blueprint";
import { executeBlueprintInstructions } from "./layout-executor";
import { type BlueprintPath } from "./layout-instructions";
import {
    equalAlongAxis,
    findNeighborLeaf,
    pickDropLeaf,
    planAutomaticPlacement,
    planEqualSplit,
    planGeometryDrop,
    planKeyboardInsertion,
    rectCenter,
    type Leaf,
    type Direction,
    type Point,
    type Scope,
    type SplitAxis,
    type WindowRef,
} from "./logic";
import { buildPreset, type PresetKind } from "./preset-catalog";
import {
    collapseToRootLeaf,
    type ResetSeam,
    type ResetSnapshot,
    type ResetTile,
} from "./topology-reset";

const MAX_TILES = MAX_SEQUENTIAL_LENGTH;
const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;
const DIAGNOSTIC_PREFIX = "plasma-auto-tiler:";
// A newly-mapped window's `desktops` value can still be settling at the
// exact `windowAdded` instant (unit-05/attempt-16 live evidence). One short,
// bounded re-evaluation gives it a chance to settle before being treated as
// permanently out of scope.
const DESKTOP_SCOPE_REEVALUATION_DELAY_MS = 50;
// Bounded re-drive budget per pending reconstruction phase. A lifecycle event
// while a reconstruction is pending re-arms that phase's one-shot yield so a
// single lost callDBus reply cannot strand a collapsed scope. A bound is still
// required: if every ListNames reply is lost, unlimited re-arms would leave a
// collapsed awaiting-split scope retrying forever instead of reaching the
// session-local inert state.
const MAX_YIELD_REARM_PER_PHASE = 2;

type BoundaryKind = "workspace-window-list" | "tile-children" | "tile-occupancy" | "split-result";

type TopologyRejection = "root-lookup" | "topology-decode";

export interface ControllerEnvironment {
    readonly activeWindow: () => unknown;
    readonly setActiveWindow: (window: WindowCapability) => void;
    readonly currentDesktopForOutput: (output: OutputCapability) => unknown;
    readonly rootTile: (output: OutputCapability, desktop: VirtualDesktopCapability) => unknown;
    readonly windowList: () => unknown;
    readonly cursorPos: () => unknown;
    readonly onWindowAdded: (handler: (window: unknown) => void) => void;
    readonly onWindowRemoved: (handler: (window: unknown) => void) => void;
    readonly onScreensChanged: (handler: () => void) => void;
    readonly onCurrentDesktopChanged: (handler: () => void) => void;
    readonly watchInteractiveWindow: (
        window: WindowCapability,
        started: () => void,
        finished: () => void,
        stepped: () => void,
        moveResizedChanged: () => void,
        invalidated: () => void,
    ) => { readonly disconnect: () => void; readonly ok: number; readonly failed: number };
    readonly onPendingTargetChanged: (window: WindowCapability, handler: () => void) => () => void;
    // Named one-shot event-loop yield used to defer dwindle reconstruction
    // between the removals-only collapse and the splits-only rebuild. Returns
    // whether the yield was armed: a false return means the caller must fail
    // closed rather than strand. The callback is guaranteed to fire at most
    // once per successful arm on a real later event-loop turn, never
    // synchronously, and holds no timer and relies on no signal.
    readonly yieldOnce: (callback: () => void) => boolean;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => () => void;
    readonly registerShortcut: (name: string, text: string, sequence: string, handler: () => void) => boolean;
    readonly log: (message: string) => void;
}

export interface CurrentScope {
    readonly scope: Scope;
    readonly output: OutputCapability;
    readonly desktop: VirtualDesktopCapability;
}

// Explicit ephemeral selected-overlay record for a future bounded
// assignment-only reflow. It carries only in-memory identity and preset/scope
// requirements: no titles, app IDs, geometry, or persisted data.
export interface SelectedOverlay {
    readonly scope: CurrentScope;
    readonly preset: PresetKind;
    readonly root: TileCapability;
    readonly leaves: readonly TileCapability[];
}

// Session-local managed-scope ownership record for automatic ratio-free
// dwindle. A scope becomes managed by the controller takeover on start or
// scope change and stays owned for the session unless it becomes inert: a
// failed or damaged scope is never retried in that session. No identity
// survives restart or hotplug.
export interface ManagedScope {
    readonly scope: CurrentScope;
    readonly inert: boolean;
}

// A deferred dwindle reconstruction awaiting its one-shot event-loop yield.
// Phase one collapses the owned scope to a single leaf in a synchronous
// removals-only dispatch; phase two rebuilds the ratio-free dwindle blueprint
// in a later dispatch. No tile handle is retained; every callback re-resolves
// the scope root and window membership fresh. The phase doubles as the
// per-pending arm bookkeeping: each armed yield is bound to the phase it was
// armed for, so a stale or duplicate callback for an already-advanced phase is
// inert. `rearmCount` counts how many times the current phase's yield has been
// re-armed by lifecycle events; it resets to zero when the phase advances, so
// each phase gets its own bounded re-drive budget.
export type RebuildPhase = "awaiting-collapse" | "awaiting-split";

export interface PendingRebuild {
    readonly scope: CurrentScope;
    phase: RebuildPhase;
    rearmCount: number;
    dragFinalSnapshot?: boolean;
}

interface DecodedLeaf {
    readonly tile: TileCapability;
    readonly windows: readonly WindowCapability[];
}

interface OperationLeaf {
    readonly decoded: DecodedLeaf;
    readonly leaf: Leaf;
    readonly windows: readonly WindowCapability[];
    readonly refs: readonly WindowRef[];
}

interface PendingKeyboard {
    readonly scope: CurrentScope;
    readonly sourceWindow: WindowCapability;
    readonly targetWindow: WindowCapability;
    readonly targetTile: TileCapability;
    readonly direction: Direction;
    readonly disconnect: () => void;
}

interface ActiveDrag {
    readonly scope: CurrentScope;
    readonly window: WindowCapability;
    readonly originTile: CustomTileCapability;
    readonly originGeometry: RectCapability;
}

// The two windows occupying the two leaves a reflow split produced: the
// dragged window and the split target's original occupant. Retained only as
// stable window identity across the deferred origin-collapse yield; their
// tiles are re-resolved from a fresh topology, never retained as stale
// wrappers.
interface ReflowLeaves {
    readonly dragged: WindowCapability;
    readonly occupant: WindowCapability;
}

// Why a finish-only drop resolved no geometry target. `resolved` carries the
// winning OperationLeaf plus whether it is empty (direct-placement target) or
// occupied (split target); every other variant is a distinct bail branch whose
// center point (when resolvable) is the decisive live value. `pointSource`
// records whether that point came from the documented workspace cursor or the
// final frame center fallback.
type GeometryDropResolution =
    | {
          readonly kind: "resolved";
          readonly target: OperationLeaf;
          readonly center: Point;
          readonly pointSource: "cursor" | "frame-center";
          readonly empty: boolean;
      }
    | GeometryDropBail;

type GeometryDropBail =
    | { readonly kind: "center-unresolved" }
    | { readonly kind: "no-target-leaf"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" }
    | { readonly kind: "target-is-origin"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" }
    | { readonly kind: "leaf-not-in-topology"; readonly center: Point; readonly pointSource: "cursor" | "frame-center" };

// One guarded `window.tile` assignment produced by reflow planning. `source`
// is the occupant's current tile at plan time (null only for an untiled
// addition candidate); `target` is the exact ordinal overlay leaf.
interface ReflowWrite {
    readonly window: WindowCapability;
    readonly source: TileCapability | null;
    readonly target: TileCapability;
}

// One guarded `window.tile` assignment produced by explicit scope fill. The
// full bounded plan is built before any write, then each entry revalidates
// before its own write and stops fail-fast on the first failure.
interface FillWrite {
    readonly window: WindowCapability;
    readonly target: TileCapability;
}

// Outcome of a bounded assignment-only selected-overlay reflow. Fixed private
// diagnostics map to distinct no-op/no-capacity, success, and failure/partial
// states; no-selection is silent and never claims a reflow happened.
type ReflowOutcome =
    | { readonly kind: "no-selection" }
    | { readonly kind: "no-op" }
    | { readonly kind: "no-capacity" }
    | { readonly kind: "completed"; readonly writes: number }
    | { readonly kind: "rejected"; readonly reason: string }
    | { readonly kind: "partial"; readonly reason: string; readonly writes: number };

// Outcome of a deterministic empty-leaf automatic placement. `managed` records
// the single guarded manage; every failure variant is a distinct reason for a
// decisive no-op diagnostic in the generic (non-owned) fallback path.
type AutomaticPlacementOutcome =
    | { readonly kind: "managed" }
    | { readonly kind: "topology-unavailable" }
    | { readonly kind: "no-empty-leaf" }
    | { readonly kind: "assignment-failed" };

function windowInScope(window: unknown, scope: CurrentScope): window is WindowCapability {
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

// Fixed, privacy-safe bucket describing why `window.desktops` did or did not
// contain the current desktop, for diagnostics only. Desktop ids and counts
// are scope identity and are never logged directly; this is deliberately
// coarser than that.
type DesktopScopeCheck = "decode-failed" | "no-desktops" | "no-match" | "match";

function desktopScopeCheck(window: WindowCapability, scope: CurrentScope): DesktopScopeCheck {
    const desktops = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
    if (!desktops.ok) {
        return "decode-failed";
    }
    if (desktops.value.length === 0) {
        return "no-desktops";
    }
    return desktops.value.some((desktop) => desktop.id === scope.scope.desktopId) ? "match" : "no-match";
}

function decodeLeaves(
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
function decodeTileTree(root: TileCapability): readonly TileCapability[] | null {
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

// A usable leaf of a dwindle-owned scope, per the coherent leaf/occupancy
// model: a non-layout tile, or a layout root with zero children (a collapsed
// scope root is itself the sole usable leaf). Interior layout tiles with one
// or more children are never usable.
interface UsableLeaf {
    readonly tile: TileCapability;
    readonly windows: readonly WindowCapability[];
}

// Walk the scope tree and return its usable leaves in decoded order with their
// decoded occupancy. Returns null on any structural decode failure, matching
// decodeTileTree's strictness.
function decodeUsableLeaves(root: TileCapability): readonly UsableLeaf[] | null {
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

// Pre-order left-to-right realization of a preset overlay root, mirroring the
// executor's decoded split children. A non-layout root realizes to itself; a
// layout root must decode to exactly two custom-tile children per level, so any
// manual split, removal, or reorder of the overlay subtree returns null.
function collectPresetLeaves(root: TileCapability): readonly TileCapability[] | null {
    if (!isCustomTile(root)) {
        return null;
    }
    if (!root.isLayout) {
        return [root];
    }
    const children = decodeSequential(root.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
    if (!children.ok || children.value.length !== 2) {
        return null;
    }
    const left = children.value[0];
    const right = children.value[1];
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

function makeOperationLeaves(leaves: readonly DecodedLeaf[]): readonly OperationLeaf[] {
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

function operationLeafForTile(leaves: readonly OperationLeaf[], tile: TileCapability): OperationLeaf | null {
    for (const leaf of leaves) {
        if (leaf.decoded.tile === tile) {
            return leaf;
        }
    }
    return null;
}

function windowIndex(windows: readonly WindowCapability[], target: WindowCapability): number {
    for (let index = 0; index < windows.length; index += 1) {
        if (windows[index] === target) {
            return index;
        }
    }
    return -1;
}

interface TargetOccupant {
    readonly window: WindowCapability;
    readonly usesActiveWrapper: boolean;
}

interface PresetOccupant {
    readonly window: WindowCapability;
    readonly originTile: TileCapability;
}

function targetOccupantForActive(target: OperationLeaf, active: WindowCapability): TargetOccupant | null {
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

function ordinalClass(ordinal: number): "first" | "later" {
    return ordinal === 0 ? "first" : "later";
}

function orderedChildren(
    children: readonly CustomTileCapability[],
    axis: "x" | "y",
): readonly [CustomTileCapability, CustomTileCapability] | null {
    const first = children[0];
    const second = children[1];
    if (first === undefined || second === undefined || children.length !== 2) {
        return null;
    }
    const firstGeometry = first.absoluteGeometry;
    const secondGeometry = second.absoluteGeometry;
    if (
        firstGeometry.width <= 0 ||
        firstGeometry.height <= 0 ||
        secondGeometry.width <= 0 ||
        secondGeometry.height <= 0 ||
        firstGeometry[axis] === secondGeometry[axis]
    ) {
        return null;
    }
    return firstGeometry[axis] < secondGeometry[axis] ? [first, second] : [second, first];
}

function sameGeometry(a: RectCapability, b: RectCapability): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function positiveGeometry(geometry: RectCapability): boolean {
    return geometry.width > 0 && geometry.height > 0;
}

function formatCoordinate(value: number): string {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "non-finite";
}

// Concise `x,y` point for bail diagnostics; coordinates are session-local
// geometry, never scope identity.
function formatPoint(point: Point): string {
    return `${formatCoordinate(point.x)},${formatCoordinate(point.y)}`;
}

function dragGeometryBail(target: GeometryDropBail): string {
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

// Bounded plain-string caption for snapshot occupants. Read-only, truncated to
// a fixed modest length so no caption can bloat a log line, and never a full
// window serialization. A non-string caption collapses to the empty string.
const SNAPSHOT_CAPTION_LIMIT = 40;

function snapshotCaption(value: unknown): string {
    const caption = typeof value === "string" ? value : "";
    return caption.length > SNAPSHOT_CAPTION_LIMIT ? caption.slice(0, SNAPSHOT_CAPTION_LIMIT) : caption;
}

function splitDirection(direction: Direction): number {
    return direction === "left" || direction === "right"
        ? HORIZONTAL_LAYOUT_DIRECTION
        : VERTICAL_LAYOUT_DIRECTION;
}

function layoutDirectionFor(orientation: Orientation): number {
    return orientation === "horizontal" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
}

// Structural dwindle-shape match: a live custom-tile subtree must realize the
// blueprint node with orientation alternating from a horizontal root at depth
// zero. The two children are accepted in either decoded order because the
// executor's "left"/"right" path mapping follows the split-return order.
function dwindleNodeMatches(tile: CustomTileCapability, node: Blueprint, depth: number): boolean {
    if (node.kind === "leaf") {
        return !tile.isLayout;
    }
    if (!tile.isLayout) {
        return false;
    }
    const expected = depth % 2 === 0 ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
    if (tile.layoutDirection !== expected) {
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
        (dwindleNodeMatches(first, node.left, depth + 1) &&
            dwindleNodeMatches(second, node.right, depth + 1)) ||
        (dwindleNodeMatches(first, node.right, depth + 1) &&
            dwindleNodeMatches(second, node.left, depth + 1))
    );
}

// Occupancy bijection for a dwindle-matched scope: every usable leaf must be
// occupied by exactly one owned-population window whose recorded `tile` is that
// leaf, and every population window must occupy exactly one leaf. An empty,
// duplicate, extra, or wrong-window leaf occupancy (or a population window
// missing from any leaf) is a mismatch, so a persisted same-shape tree with
// drifted occupancy is never adopted unchanged.
function dwindleOccupancyMatches(
    scope: CurrentScope,
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
// without any shape requirement. Reuses the leaf-level occupancy bijection
// logic, so a persisted tree that is not dwindle-shaped but whose leaves happen
// to hold the population is never mistaken for an adoptable scope by callers
// that combine this with the separate shape predicate.
function dwindleBijectionTreeMatches(
    scope: CurrentScope,
    root: CustomTileCapability,
    population: readonly WindowCapability[],
): boolean {
    const leaves = decodeUsableLeaves(root);
    if (leaves === null) {
        return false;
    }
    return dwindleOccupancyMatches(scope, leaves, population);
}

export class TileController {
    private readonly gate = new FeatureGate();
    private readonly pending = new TransientState<PendingKeyboard>();
    private readonly drag = new TransientState<ActiveDrag>();
    private readonly interactiveWindows = new Map<WindowCapability, () => void>();
    private readonly deferredEligibility = new Map<WindowCapability, () => void>();
    private readonly decodedBoundaries = new Set<BoundaryKind>();
    private readonly onceDiagnostics = new Set<string>();
    private readonly selectedOverlays = new Map<OutputCapability, Map<string, SelectedOverlay>>();
    // Windows removed since the last reflow read of their scope. Removal can
    // arrive while KWin still lists the window in its tile's window array;
    // this bounded identity guard keeps the reflow from ever reassigning a
    // removed window. Entries for settled (array-absent) windows are never
    // consulted and the set is capped so it cannot grow unboundedly.
    private readonly removedOccupants = new Set<WindowCapability>();
    // Per-output/per-desktop session-local managed-scope ownership for
    // automatic ratio-free dwindle. A scope is managed only when it holds
    // owned windows; a failed or damaged scope is recorded inert for the
    // session and never retried.
    private readonly managedScopes = new Map<OutputCapability, Map<string, ManagedScope>>();
    // Deferred dwindle reconstructions awaiting their one-shot event-loop
    // yields between the removals-only collapse and the splits-only rebuild.
    private readonly pendingRebuilds = new Map<OutputCapability, Map<string, PendingRebuild>>();
    // Explicitly detached windows (the detach action writes `window.tile` to
    // null) are excluded from the owned population and the dwindle rebuild.
    // Bounded like removedOccupants so it cannot grow without limit.
    private readonly detachedWindows = new Set<WindowCapability>();

    constructor(private readonly environment: ControllerEnvironment) {}

    get isEnabled(): boolean {
        return this.gate.isEnabled;
    }

    get hasPendingKeyboard(): boolean {
        return this.pending.current !== undefined;
    }

    get hasActiveDrag(): boolean {
        return this.drag.current !== undefined;
    }

    // Narrow read/self-validation seam for a future bounded assignment-only
    // reflow. The overlay for the exact scope is returned only when its
    // recorded root and ordinal leaves remain intact beneath the same current
    // Custom Tile root. Structural drift is discarded inertly with one fixed
    // private diagnostic; reading never mutates topology or assignments.
    readSelectedOverlay(scope: CurrentScope): SelectedOverlay | null {
        const byDesktop = this.selectedOverlays.get(scope.output);
        const overlay = byDesktop?.get(scope.desktop.id);
        if (overlay === undefined) {
            return null;
        }
        if (!this.selectedOverlayValid(overlay)) {
            byDesktop?.delete(scope.desktop.id);
            this.diagnostic("selected-overlay-invalidated");
            return null;
        }
        return overlay;
    }

    private diagnostic(event: string): void {
        try {
            this.environment.log(`${DIAGNOSTIC_PREFIX}${event}`);
        } catch (error) {
            void error;
            // Observability must never affect the guarded tiling operation.
        }
    }

    private decodedBoundary(kind: BoundaryKind): void {
        if (this.decodedBoundaries.has(kind)) {
            return;
        }
        this.decodedBoundaries.add(kind);
        this.diagnostic(`boundary-decoded:${kind}`);
    }

    private onceDiagnostic(event: string): void {
        if (this.onceDiagnostics.has(event)) {
            return;
        }
        this.onceDiagnostics.add(event);
        this.diagnostic(event);
    }

    private disabled(reason: string): void {
        this.diagnostic(`disabled:${reason}`);
    }

    start(): void {
        this.gate.run(() => {
            this.environment.onWindowAdded((window) => this.handleWindowAdded(window));
            this.environment.onWindowRemoved((window) => this.handleWindowRemoved(window));
            this.environment.onScreensChanged(() => this.handleScopeChange());
            this.environment.onCurrentDesktopChanged(() => this.handleScopeChange());
            this.attachExistingInteractiveWindows(true);
            const insertionRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-insert-right",
                "Insert next window right of focused leaf",
                "Meta+Alt+Right",
                () => this.armKeyboardInsertion("right"),
            );
            const insertionLeftRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-insert-left",
                "Insert next window left of focused leaf",
                "Meta+Alt+Left",
                () => this.armKeyboardInsertion("left"),
            );
            const insertionUpRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-insert-up",
                "Insert next window up of focused leaf",
                "Meta+Alt+Up",
                () => this.armKeyboardInsertion("up"),
            );
            const insertionDownRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-insert-down",
                "Insert next window down of focused leaf",
                "Meta+Alt+Down",
                () => this.armKeyboardInsertion("down"),
            );
            const leftRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-left",
                "Focus window left",
                "Meta+H",
                () => this.focusNeighbor("left"),
            );
            const downRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-down",
                "Focus window down",
                "Meta+J",
                () => this.focusNeighbor("down"),
            );
            const upRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-up",
                "Focus window up",
                "Meta+K",
                () => this.focusNeighbor("up"),
            );
            const rightRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-right",
                "Focus window right",
                "Meta+Alt+Ctrl+L",
                () => this.focusNeighbor("right"),
            );
            const focusLeftArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-left-arrow",
                "Focus window left (arrow)",
                "Meta+Left",
                () => this.focusNeighbor("left"),
            );
            const focusDownArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-down-arrow",
                "Focus window down (arrow)",
                "Meta+Down",
                () => this.focusNeighbor("down"),
            );
            const focusUpArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-up-arrow",
                "Focus window up (arrow)",
                "Meta+Up",
                () => this.focusNeighbor("up"),
            );
            const focusRightArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-focus-right-arrow",
                "Focus window right (arrow)",
                "Meta+Right",
                () => this.focusNeighbor("right"),
            );
            const moveLeftRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-left",
                "Move window left",
                "Meta+Shift+H",
                () => this.moveActiveWindow("left"),
            );
            const moveDownRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-down",
                "Move window down",
                "Meta+Shift+J",
                () => this.moveActiveWindow("down"),
            );
            const moveUpRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-up",
                "Move window up",
                "Meta+Shift+K",
                () => this.moveActiveWindow("up"),
            );
            const moveRightRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-right",
                "Move window right",
                "Meta+Shift+L",
                () => this.moveActiveWindow("right"),
            );
            const moveLeftArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-left-arrow",
                "Move window left (arrow)",
                "Meta+Shift+Left",
                () => this.moveActiveWindow("left"),
            );
            const moveDownArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-down-arrow",
                "Move window down (arrow)",
                "Meta+Shift+Down",
                () => this.moveActiveWindow("down"),
            );
            const moveUpArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-up-arrow",
                "Move window up (arrow)",
                "Meta+Shift+Up",
                () => this.moveActiveWindow("up"),
            );
            const moveRightArrowRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-move-right-arrow",
                "Move window right (arrow)",
                "Meta+Shift+Right",
                () => this.moveActiveWindow("right"),
            );
            const detachRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-detach",
                "Detach window from tile",
                "Meta+Shift+Space",
                () => this.detachActiveWindow(),
            );
            const attachRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-attach",
                "Attach window to available tile",
                "Meta+Alt+Shift+Space",
                () => this.attachActiveWindow(),
            );
            const fillScopeRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-fill-scope",
                "Fill available tiles with windows",
                "Meta+Alt+Return",
                () => this.fillScope(),
            );
            const columnsRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-apply-columns",
                "Apply columns in focused leaf",
                "Meta+Alt+1",
                () => this.applyPreset("columns"),
            );
            const rowsRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-apply-rows",
                "Apply rows in focused leaf",
                "Meta+Alt+2",
                () => this.applyPreset("rows"),
            );
            const gridRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-apply-balanced-grid",
                "Apply balanced grid in focused leaf",
                "Meta+Alt+3",
                () => this.applyPreset("balanced-grid"),
            );
            const dwindleRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-apply-dwindle",
                "Apply dwindle in focused leaf",
                "Meta+Alt+4",
                () => this.applyPreset("dwindle"),
            );
            if (
                !insertionRegistered ||
                !insertionLeftRegistered ||
                !insertionUpRegistered ||
                !insertionDownRegistered ||
                !leftRegistered ||
                !downRegistered ||
                !upRegistered ||
                !rightRegistered ||
                !focusLeftArrowRegistered ||
                !focusDownArrowRegistered ||
                !focusUpArrowRegistered ||
                !focusRightArrowRegistered ||
                !moveLeftRegistered ||
                !moveDownRegistered ||
                !moveUpRegistered ||
                !moveRightRegistered ||
                !moveLeftArrowRegistered ||
                !moveDownArrowRegistered ||
                !moveUpArrowRegistered ||
                !moveRightArrowRegistered ||
                !detachRegistered ||
                !attachRegistered ||
                !fillScopeRegistered ||
                !columnsRegistered ||
                !rowsRegistered ||
                !gridRegistered ||
                !dwindleRegistered
            ) {
                this.gate.disable("shortcut-registration-failed", (reason) => this.disabled(reason));
                return;
            }
            this.diagnostic("shortcut-registered");
            this.diagnostic("startup-handlers-ready");
            this.engageCurrentScope();
        }, (reason) => this.disabled(reason));
    }

    // Each directional insertion action arms exactly one pending insertion from
    // the active eligible in-scope occupant of the focused non-layout leaf. A
    // re-arm atomically replaces the source and the recorded direction, so a
    // later arm always supersedes an earlier one.
    armKeyboardInsertion(direction: Direction): void {
        this.gate.run(() => {
            this.diagnostic("keyboard-invoked");
            const hadPending = this.pending.current !== undefined;
            this.clearPending();
            if (hadPending) {
                this.diagnostic("keyboard-pending-replaced");
            }
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("keyboard-rejected:no-active-window");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("keyboard-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("keyboard-rejected:active-window-eligibility");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`keyboard-rejected:${reason}`);
            });
            if (topology === null || active.tile === null || !isTile(active.tile)) {
                if (topology !== null) {
                    this.diagnostic("keyboard-rejected:active-tile-association");
                }
                return;
            }
            const target = operationLeafForTile(topology, active.tile);
            if (target === null || target.leaf.isLayout) {
                this.diagnostic("keyboard-rejected:target-occupancy-validity");
                return;
            }
            for (const occupant of target.windows) {
                if (!windowInScope(occupant, scope)) {
                    this.diagnostic("keyboard-rejected:target-occupancy-validity");
                    return;
                }
            }
            const targetOccupant = targetOccupantForActive(target, active);
            if (targetOccupant === null) {
                this.diagnostic("keyboard-rejected:target-occupancy-validity");
                return;
            }
            const disconnect = this.environment.onPendingTargetChanged(targetOccupant.window, () => this.clearPending());
            this.pending.set({
                scope,
                sourceWindow: active,
                targetWindow: targetOccupant.window,
                targetTile: active.tile,
                direction,
                disconnect,
            });
            if (!targetOccupant.usesActiveWrapper) {
                this.diagnostic("keyboard-armed:target-occupant-wrapper");
            }
            this.diagnostic("keyboard-armed");
        }, (reason) => this.disabled(reason));
    }

    private focusNeighbor(direction: Direction): void {
        this.gate.run(() => {
            this.diagnostic("focus-invoked");
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("focus-rejected:no-active-window");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("focus-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("focus-rejected:active-window-eligibility");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`focus-rejected:${reason}`);
            });
            if (topology === null) {
                return;
            }
            if (active.tile === null || !isTile(active.tile)) {
                this.diagnostic("focus-rejected:active-tile-association");
                return;
            }
            const focused = operationLeafForTile(topology, active.tile);
            if (
                focused === null ||
                focused.leaf.isLayout ||
                focused.windows.length === 0 ||
                windowIndex(focused.windows, active) < 0
            ) {
                this.diagnostic("focus-rejected:focused-occupancy-validity");
                return;
            }
            for (const occupant of focused.windows) {
                if (!windowInScope(occupant, scope)) {
                    this.diagnostic("focus-rejected:focused-occupancy-validity");
                    return;
                }
            }
            const candidates = topology
                .filter(
                    (entry) =>
                        !entry.leaf.isLayout &&
                        entry.windows.length > 0 &&
                        entry.windows.every((occupant) => windowInScope(occupant, scope)),
                )
                .map((entry) => entry.leaf);
            const neighborLeaf = findNeighborLeaf(candidates, focused.leaf, direction);
            if (neighborLeaf === null) {
                this.diagnostic("focus-rejected:no-neighbor");
                return;
            }
            let target: OperationLeaf | null = null;
            for (const entry of topology) {
                if (entry.leaf === neighborLeaf) {
                    target = entry;
                    break;
                }
            }
            if (target === null || target.leaf.isLayout || target.windows.length === 0) {
                this.diagnostic("focus-rejected:target-occupancy-validity");
                return;
            }
            for (const occupant of target.windows) {
                if (!windowInScope(occupant, scope)) {
                    this.diagnostic("focus-rejected:target-occupancy-validity");
                    return;
                }
            }
            const targetWindow = target.windows[0];
            if (targetWindow === undefined) {
                this.diagnostic("focus-rejected:target-occupancy-validity");
                return;
            }
            this.environment.setActiveWindow(targetWindow);
        }, (reason) => this.disabled(reason));
    }

    private moveActiveWindow(direction: Direction): void {
        this.gate.run(() => {
            this.diagnostic("move-invoked");
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("move-rejected:no-active-window");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("move-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("move-rejected:active-window-eligibility");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`move-rejected:${reason}`);
            });
            if (topology === null) {
                return;
            }
            if (active.tile === null || !isTile(active.tile)) {
                this.diagnostic("move-rejected:active-tile-association");
                return;
            }
            const source = operationLeafForTile(topology, active.tile);
            if (
                source === null ||
                source.leaf.isLayout ||
                source.windows.length !== 1 ||
                windowIndex(source.windows, active) < 0 ||
                topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1
            ) {
                this.diagnostic("move-rejected:source-occupancy-validity");
                return;
            }
            for (const occupant of source.windows) {
                if (!windowInScope(occupant, scope)) {
                    this.diagnostic("move-rejected:source-occupancy-validity");
                    return;
                }
            }
            const candidates = topology
                .filter(
                    (entry) =>
                        !entry.leaf.isLayout &&
                        entry.leaf !== source.leaf,
                )
                .map((entry) => entry.leaf);
            const targetLeaf = findNeighborLeaf(candidates, source.leaf, direction);
            if (targetLeaf === null) {
                this.diagnostic("move-rejected:no-target");
                return;
            }
            let target: OperationLeaf | null = null;
            for (const entry of topology) {
                if (entry.leaf === targetLeaf) {
                    target = entry;
                    break;
                }
            }
            if (target === null || target.leaf.isLayout) {
                this.diagnostic("move-rejected:target-occupancy-validity");
                return;
            }
            if (target.windows.length === 0) {
                if (!this.moveAssignmentRevalidates(scope, active, source, target, direction)) {
                    this.diagnostic("move-rejected:assignment-stale");
                    return;
                }
                let assigned = false;
                try {
                    assigned = manageTile(target.decoded.tile, active);
                } catch (error) {
                    void error;
                    this.diagnostic("move-rejected:assignment-failed");
                    return;
                }
                if (!assigned) {
                    this.diagnostic("move-rejected:assignment-failed");
                    return;
                }
                this.diagnostic("move-completed");
                return;
            }
            this.swapToOccupiedTarget(scope, active, source, target, direction);
        }, (reason) => this.disabled(reason));
    }

    // Directional occupied-target swap: when the nearest ranked non-layout
    // directional leaf is occupied, its exactly-one eligible in-scope occupant
    // swaps with the active source. Two guarded `window.tile` writes each
    // revalidate immediately before the write, decode their postcondition, and
    // stop at the first failure. On a failed second write a single best-effort
    // restoration returns the source to its original leaf; no rollback is
    // claimed in any other path. Assignment-only: no topology method is ever
    // called.
    private swapToOccupiedTarget(
        scope: CurrentScope,
        active: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
        direction: Direction,
    ): void {
        this.diagnostic("move-swap-invoked");
        if (target.leaf.isLayout || target.windows.length !== 1) {
            this.diagnostic("move-rejected:swap-occupancy-validity");
            return;
        }
        const occupant = target.windows[0];
        if (occupant === undefined || !windowInScope(occupant, scope)) {
            this.diagnostic("move-rejected:swap-occupant-ineligible");
            return;
        }
        if (!this.swapRevalidates(scope, active, occupant, source, target, direction, "before-first")) {
            this.diagnostic("move-swap-rejected:stale");
            return;
        }
        let firstAssigned = false;
        try {
            firstAssigned = assignWindowToTile(active, target.decoded.tile);
        } catch (error) {
            void error;
        }
        if (!firstAssigned) {
            this.diagnostic("move-swap-failed:first-write");
            return;
        }
        if (!this.swapRevalidates(scope, active, occupant, source, target, direction, "before-second")) {
            this.swapSecondWriteFailed(scope, active, source);
            return;
        }
        let secondAssigned = false;
        try {
            secondAssigned = assignWindowToTile(occupant, source.decoded.tile);
        } catch (error) {
            void error;
        }
        if (!secondAssigned) {
            this.swapSecondWriteFailed(scope, active, source);
            return;
        }
        if (!this.swapDecodesFinal(scope, active, occupant, source, target)) {
            this.swapSecondWriteFailed(scope, active, source);
            return;
        }
        this.diagnostic("move-swap-completed");
    }

    // Re-derives active identity, exact scope/root, both occupant associations,
    // and both leaf realizations immediately before a guarded swap write. The
    // expected leaf contents depend on the phase: before the first write the
    // source leaf holds only the active window and the target leaf only the
    // occupant; before the second write the source leaf is empty and the target
    // leaf briefly holds both (the pinned setTileCompatibility contract
    // evacuates-then-adds, so the destination leaf transiently double-occupies).
    private swapRevalidates(
        scope: CurrentScope,
        active: WindowCapability,
        occupant: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
        direction: Direction,
        phase: "before-first" | "before-second",
    ): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, scope.scope) ||
            !windowInScope(active, freshScope) ||
            !windowInScope(occupant, freshScope)
        ) {
            return false;
        }
        const topology = this.topologyForScope(freshScope);
        if (
            topology === null ||
            active.tile === null ||
            !isTile(active.tile) ||
            occupant.tile === null ||
            !isTile(occupant.tile) ||
            occupant.tile !== target.decoded.tile
        ) {
            return false;
        }
        const expectedActiveTile = phase === "before-first" ? source.decoded.tile : target.decoded.tile;
        if (active.tile !== expectedActiveTile) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, source.decoded.tile);
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        if (freshSource === null || freshTarget === null || freshSource.leaf.isLayout || freshTarget.leaf.isLayout) {
            return false;
        }
        if (phase === "before-first") {
            if (freshSource.windows.length !== 1 || windowIndex(freshSource.windows, active) < 0) {
                return false;
            }
            if (freshTarget.windows.length !== 1 || windowIndex(freshTarget.windows, occupant) < 0) {
                return false;
            }
        } else {
            if (freshSource.windows.length !== 0) {
                return false;
            }
            if (
                freshTarget.windows.length !== 2 ||
                windowIndex(freshTarget.windows, active) < 0 ||
                windowIndex(freshTarget.windows, occupant) < 0
            ) {
                return false;
            }
        }
        if (
            active === occupant ||
            topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1 ||
            topology.filter((entry) => windowIndex(entry.windows, occupant) >= 0).length !== 1
        ) {
            return false;
        }
        if (phase === "before-first") {
            const freshCandidates = topology
                .filter(
                    (entry) => !entry.leaf.isLayout && entry.leaf !== freshSource.leaf,
                )
                .map((entry) => entry.leaf);
            return findNeighborLeaf(freshCandidates, freshSource.leaf, direction) === freshTarget.leaf;
        }
        return true;
    }

    // Fresh decoded final postcondition: the occupant occupies the original
    // source leaf and the active source the target leaf, each leaf holding
    // exactly one window. No topology method is called.
    private swapDecodesFinal(
        scope: CurrentScope,
        active: WindowCapability,
        occupant: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
    ): boolean {
        const topology = this.topologyForScope(scope);
        if (topology === null || active.tile !== target.decoded.tile || occupant.tile !== source.decoded.tile) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, source.decoded.tile);
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        if (freshSource === null || freshTarget === null || freshSource.leaf.isLayout || freshTarget.leaf.isLayout) {
            return false;
        }
        return (
            freshSource.windows.length === 1 &&
            windowIndex(freshSource.windows, occupant) >= 0 &&
            freshTarget.windows.length === 1 &&
            windowIndex(freshTarget.windows, active) >= 0
        );
    }

    // Second-write failure leaves the source in the target leaf (possible
    // stranded window): report the fixed diagnostic, then attempt exactly one
    // best-effort restoration of the source to its original leaf and report the
    // verified outcome. No rollback claim beyond that single guarded write.
    private swapSecondWriteFailed(scope: CurrentScope, active: WindowCapability, source: OperationLeaf): void {
        this.diagnostic("move-swap-failed:second-write");
        const restored = this.restoreSwapFirst(scope, active, source);
        if (restored && active.tile === source.decoded.tile) {
            this.diagnostic("move-swap-restored:verified");
        } else {
            this.diagnostic("move-swap-restored:unverified");
        }
    }

    // One guarded best-effort write returning the active source to its original
    // leaf after a failed second swap write. Active identity, exact scope,
    // fresh root/topology, original source leaf reachability/non-layout status,
    // and the active window's own association with an in-scope non-layout
    // decoded leaf are all re-derived first; any failure skips the write.
    private restoreSwapFirst(scope: CurrentScope, active: WindowCapability, source: OperationLeaf): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, scope.scope) ||
            !windowInScope(active, freshScope)
        ) {
            return false;
        }
        if (active.tile === null || !isTile(active.tile)) {
            return false;
        }
        const topology = this.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, source.decoded.tile);
        if (freshSource === null || freshSource.leaf.isLayout) {
            return false;
        }
        const freshActive = operationLeafForTile(topology, active.tile);
        if (freshActive === null || freshActive.leaf.isLayout || windowIndex(freshActive.windows, active) < 0) {
            return false;
        }
        let restored = false;
        try {
            restored = assignWindowToTile(active, source.decoded.tile);
        } catch (error) {
            void error;
        }
        return restored;
    }

    detachActiveWindow(): void {
        this.gate.run(() => {
            this.diagnostic("detach-invoked");
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("detach-rejected:no-active-window");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("detach-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("detach-rejected:active-window-eligibility");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`detach-rejected:${reason}`);
            });
            if (topology === null) {
                return;
            }
            if (active.tile === null) {
                this.diagnostic("detach-rejected:no-tile");
                return;
            }
            if (!isCustomTile(active.tile)) {
                this.diagnostic("detach-rejected:active-tile-association");
                return;
            }
            if (active.tile.isLayout) {
                this.diagnostic("detach-rejected:layout-tile");
                return;
            }
            const origin = operationLeafForTile(topology, active.tile);
            if (origin === null || windowIndex(origin.windows, active) < 0) {
                this.diagnostic("detach-rejected:occupancy-validity");
                return;
            }
            const originTile = active.tile;
            if (!this.detachRevalidates(scope, active, originTile)) {
                this.diagnostic("detach-rejected:assignment-stale");
                return;
            }
            let detached = false;
            try {
                detached = detachWindowFromTile(active);
            } catch (error) {
                void error;
                this.diagnostic("detach-rejected:assignment-failed");
                return;
            }
            if (!detached) {
                this.diagnostic("detach-rejected:assignment-failed");
                return;
            }
            if (active.tile !== null) {
                this.diagnostic("detach-failed:postcondition");
                return;
            }
            this.diagnostic("detach-completed");
            this.recordDetached(active);
            this.reflowAfterDetach(scope, originTile);
        }, (reason) => this.disabled(reason));
    }

    // Active window identity, scope, eligibility, and the exact tile
    // association are all re-derived immediately before the single detach
    // write, so any change between selection and the write rejects without a
    // write.
    private detachRevalidates(
        scope: CurrentScope,
        active: WindowCapability,
        originTile: TileCapability,
    ): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, scope.scope) ||
            !windowInScope(active, freshScope)
        ) {
            return false;
        }
        if (active.tile !== originTile || !isCustomTile(active.tile) || active.tile.isLayout) {
            return false;
        }
        const topology = this.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshOrigin = operationLeafForTile(topology, originTile);
        return freshOrigin !== null && windowIndex(freshOrigin.windows, active) >= 0;
    }

    // Assignment-only inverse of detach: one guarded `window.tile = target`
    // write for the active eligible floating window into the deterministic
    // first available empty non-layout leaf of the exact scope. Never changes
    // topology or another occupant.
    attachActiveWindow(): void {
        this.gate.run(() => {
            this.diagnostic("attach-invoked");
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("attach-rejected:no-active-window");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("attach-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("attach-rejected:active-window-eligibility");
                return;
            }
            if (active.tile !== null) {
                this.diagnostic("attach-rejected:already-assigned");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`attach-rejected:${reason}`);
            });
            if (topology === null) {
                return;
            }
            const target = this.firstEmptyLeaf(topology);
            if (target === null) {
                this.diagnostic("attach-rejected:no-available-tile");
                return;
            }
            if (!this.attachRevalidates(scope, active, target)) {
                this.diagnostic("attach-rejected:assignment-stale");
                return;
            }
            let assigned = false;
            try {
                assigned = assignWindowToTile(active, target.decoded.tile);
            } catch (error) {
                void error;
                this.diagnostic("attach-rejected:assignment-failed");
                return;
            }
            if (!assigned) {
                this.diagnostic("attach-rejected:assignment-failed");
                return;
            }
            if (active.tile !== target.decoded.tile) {
                this.diagnostic("attach-failed:postcondition");
                return;
            }
            this.diagnostic("attach-completed");
            this.detachedWindows.delete(active);
        }, (reason) => this.disabled(reason));
    }

    // Deterministic first available empty non-layout leaf in the exact decoded
    // traversal order. Layout and occupied leaves are skipped; valid explicitly
    // selected overlay leaves are ordinary authored tree leaves and participate
    // through the same traversal.
    private firstEmptyLeaf(topology: readonly OperationLeaf[]): OperationLeaf | null {
        for (const entry of topology) {
            if (
                entry.leaf.isLayout ||
                !isCustomTile(entry.decoded.tile) ||
                entry.windows.length !== 0
            ) {
                continue;
            }
            return entry;
        }
        return null;
    }

    // Active identity, scope, eligibility, unassigned source, exact
    // output/desktop root, target reachability, non-layout status, and
    // emptiness are all re-derived immediately before the single attach write.
    private attachRevalidates(
        scope: CurrentScope,
        active: WindowCapability,
        target: OperationLeaf,
    ): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, scope.scope) ||
            !windowInScope(active, freshScope)
        ) {
            return false;
        }
        if (active.tile !== null) {
            return false;
        }
        const topology = this.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        return (
            freshTarget !== null &&
            !freshTarget.leaf.isLayout &&
            isCustomTile(freshTarget.decoded.tile) &&
            freshTarget.windows.length === 0
        );
    }

    // Explicit assignment-only scope fill: the active normal eligible window
    // anchors the exact desktop/output scope whether it is tiled or floating.
    // Only existing empty authored Custom Tile leaves are filled, in
    // deterministic decoded traversal order, with eligible unassigned windows
    // from the proven windowList collection. No topology mutation, no
    // compaction or reflow, and no selected-overlay record is created.
    fillScope(): void {
        this.gate.run(() => {
            this.diagnostic("fill-invoked");
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("fill-rejected:no-active-window");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("fill-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("fill-rejected:active-window-eligibility");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`fill-rejected:${reason}`);
            });
            if (topology === null) {
                return;
            }
            const leaves = this.emptyAuthoredLeaves(topology);
            if (leaves.length === 0) {
                this.diagnostic("fill-inert:no-leaves");
                return;
            }
            const candidates = this.fillCandidates(scope, active);
            if (candidates === null) {
                this.diagnostic("fill-rejected:window-list-decode");
                return;
            }
            if (candidates.length === 0) {
                this.diagnostic("fill-inert:no-candidates");
                return;
            }
            const count = Math.min(leaves.length, candidates.length);
            const plan: FillWrite[] = [];
            for (let index = 0; index < count; index += 1) {
                const candidate = candidates[index];
                const leaf = leaves[index];
                if (candidate === undefined || leaf === undefined) {
                    this.diagnostic("fill-rejected:preflight");
                    return;
                }
                plan.push({ window: candidate, target: leaf.decoded.tile });
            }
            let writes = 0;
            for (const entry of plan) {
                if (!this.fillAssignmentRevalidates(scope, active, entry.window, entry.target)) {
                    this.diagnostic(
                        writes === 0 ? "fill-rejected:assignment-stale" : "fill-partial:assignment-stale",
                    );
                    return;
                }
                let assigned = false;
                try {
                    assigned = assignWindowToTile(entry.window, entry.target);
                } catch (error) {
                    void error;
                    this.diagnostic(
                        writes === 0 ? "fill-rejected:assignment-failed" : "fill-partial:assignment-failed",
                    );
                    return;
                }
                if (!assigned) {
                    this.diagnostic(
                        writes === 0 ? "fill-rejected:assignment-failed" : "fill-partial:assignment-failed",
                    );
                    return;
                }
                if (!isWindow(entry.window) || entry.window.tile !== entry.target) {
                    this.diagnostic(
                        writes === 0 ? "fill-failed:postcondition" : "fill-partial:postcondition",
                    );
                    return;
                }
                writes += 1;
            }
            this.diagnostic("fill-completed");
        }, (reason) => this.disabled(reason));
    }

    // Empty authored non-layout Custom Tile leaves in the exact decoded
    // traversal order. Layout tiles, occupied leaves, and generic (non-Custom)
    // tiles are skipped; valid selected-overlay leaves are ordinary authored
    // leaves and participate through the same traversal.
    private emptyAuthoredLeaves(topology: readonly OperationLeaf[]): readonly OperationLeaf[] {
        const leaves: OperationLeaf[] = [];
        for (const entry of topology) {
            if (
                entry.leaf.isLayout ||
                !isCustomTile(entry.decoded.tile) ||
                entry.windows.length !== 0
            ) {
                continue;
            }
            leaves.push(entry);
        }
        return leaves;
    }

    // Eligible unassigned exact-scope windows from the proven all-window
    // collection, in collection order. The active window is anchored first only
    // when it is itself present in that collection and eligible and unassigned;
    // a distinct active wrapper that is not in the collection is never injected
    // as a candidate.
    private fillCandidates(
        scope: CurrentScope,
        active: WindowCapability,
    ): readonly WindowCapability[] | null {
        const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return null;
        }
        this.decodedBoundary("workspace-window-list");
        const candidates: WindowCapability[] = [];
        for (const window of windows.value) {
            if (windowInScope(window, scope) && window.tile === null) {
                candidates.push(window);
            }
        }
        const anchorIndex = windowIndex(candidates, active);
        if (anchorIndex >= 0) {
            const anchor = candidates[anchorIndex];
            if (anchor !== undefined) {
                candidates.splice(anchorIndex, 1);
                candidates.unshift(anchor);
            }
        }
        return Object.freeze(candidates);
    }

    // Active identity, exact scope, eligibility, candidate identity/eligibility/
    // scope/still-unassigned state, and target reachability/non-layout/emptiness
    // are all re-derived immediately before every guarded write, so any change
    // between planning and the write stops the fill without claiming rollback.
    private fillAssignmentRevalidates(
        scope: CurrentScope,
        active: WindowCapability,
        candidate: WindowCapability,
        target: TileCapability,
    ): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, scope.scope) ||
            !windowInScope(active, freshScope) ||
            !windowInScope(candidate, freshScope) ||
            candidate.tile !== null
        ) {
            return false;
        }
        const topology = this.topologyForScope(freshScope);
        if (topology === null) {
            return false;
        }
        const freshTarget = operationLeafForTile(topology, target);
        return (
            freshTarget !== null &&
            !freshTarget.leaf.isLayout &&
            isCustomTile(freshTarget.decoded.tile) &&
            freshTarget.windows.length === 0
        );
    }

    private applyPreset(kind: PresetKind): void {
        this.gate.run(() => {
            this.diagnostic(`preset-invoked:${kind}`);
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("preset-rejected:no-active-window");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("preset-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("preset-rejected:active-window-eligibility");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`preset-rejected:${reason}`);
            });
            if (topology === null || active.tile === null || !isCustomTile(active.tile)) {
                if (topology !== null) {
                    this.diagnostic("preset-rejected:active-tile-association");
                }
                return;
            }
            const source = operationLeafForTile(topology, active.tile);
            if (
                source === null ||
                source.leaf.isLayout ||
                source.windows.length !== 1 ||
                !isCustomTile(source.decoded.tile)
            ) {
                this.diagnostic("preset-rejected:source-occupancy-validity");
                return;
            }
            const occupants = this.presetOccupants(topology, source, active, scope);
            if (occupants === null) {
                this.diagnostic("preset-rejected:occupancy-validity");
                return;
            }
            const compiled = buildPreset(kind, occupants.length);
            if (!compiled.ok) {
                this.diagnostic("preset-rejected:compile-failed");
                return;
            }
            const execution = executeBlueprintInstructions(compiled.value, source.decoded.tile, customTileSplitSeam);
            if (!execution.ok) {
                this.diagnostic(
                    execution.mutationPossible
                        ? "preset-failed:split-mutation-possible"
                        : "preset-failed:split-no-mutation",
                );
                return;
            }
            if (execution.leaves.length !== occupants.length) {
                this.diagnostic("preset-failed:split-mutation-possible");
                return;
            }
            for (let ordinal = 0; ordinal < occupants.length; ordinal += 1) {
                const occupant = occupants[ordinal];
                const leaf = execution.leaves[ordinal];
                if (occupant === undefined || leaf === undefined) {
                    this.diagnostic("preset-failed:assignment-stale:later");
                    return;
                }
                const stage = ordinalClass(ordinal);
                if (!this.presetAssignmentRevalidates(scope, active, occupant)) {
                    this.diagnostic(`preset-failed:assignment-stale:${stage}`);
                    return;
                }
                try {
                    if (!manageTile(leaf, occupant.window)) {
                        this.diagnostic(`preset-failed:assignment-failed:${stage}`);
                        return;
                    }
                } catch (error) {
                    void error;
                    this.diagnostic(`preset-failed:assignment-failed:${stage}`);
                    return;
                }
            }
            this.recordSelectedOverlay(scope, kind, source.decoded.tile, execution.leaves);
            this.diagnostic(`preset-applied:${kind}`);
        }, (reason) => this.disabled(reason));
    }

    // Record the selected overlay only after the whole preset realization
    // succeeded, keyed by the exact current desktop/output scope. A later
    // successful application on the same scope atomically replaces it.
    private recordSelectedOverlay(
        scope: CurrentScope,
        preset: PresetKind,
        root: TileCapability,
        leaves: readonly TileCapability[],
    ): void {
        let byDesktop = this.selectedOverlays.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map<string, SelectedOverlay>();
            this.selectedOverlays.set(scope.output, byDesktop);
        }
        byDesktop.set(scope.desktop.id, { scope, preset, root, leaves });
    }

    private selectedOverlayValid(overlay: SelectedOverlay): boolean {
        const root = this.environment.rootTile(overlay.scope.output, overlay.scope.desktop);
        if (!isCustomTile(root)) {
            return false;
        }
        const tiles = decodeTileTree(root);
        if (tiles === null || !tiles.some((tile) => tile === overlay.root)) {
            return false;
        }
        const realized = collectPresetLeaves(overlay.root);
        if (realized === null || realized.length !== overlay.leaves.length) {
            return false;
        }
        for (let index = 0; index < realized.length; index += 1) {
            if (realized[index] !== overlay.leaves[index]) {
                return false;
            }
        }
        return true;
    }

    // Entry point for a bounded assignment-only selected-overlay reflow after
    // a lifecycle change. Emits one fixed private diagnostic per distinct
    // outcome; "no-selection" stays silent so unrelated removals or additions
    // never claim a reflow. `candidate` supplies a newly added eligible window
    // that may fill the first trailing leaf only when the overlay has capacity.
    private runReflow(scope: CurrentScope, candidate?: WindowCapability): ReflowOutcome {
        const outcome = this.reflowSelectedOverlay(scope, candidate);
        switch (outcome.kind) {
            case "no-op":
                this.diagnostic("reflow-noop");
                break;
            case "no-capacity":
                this.diagnostic("reflow-no-capacity");
                break;
            case "completed":
                this.diagnostic("reflow-completed");
                break;
            case "rejected":
                this.diagnostic(`reflow-rejected:${outcome.reason}`);
                break;
            case "partial":
                this.diagnostic(`reflow-partial:${outcome.reason}`);
                break;
            case "no-selection":
                break;
        }
        return outcome;
    }

    private reflowSelectedOverlay(
        scope: CurrentScope,
        candidate?: WindowCapability,
    ): ReflowOutcome {
        const overlay = this.readSelectedOverlay(scope);
        if (overlay === null) {
            return { kind: "no-selection" };
        }
        if (overlay.leaves.length === 0) {
            return { kind: "rejected", reason: "topology-decode" };
        }
        // Deterministic occupants: ordinal leaf traversal only, omitting
        // windows that left the overlay, left scope, or were removed, and
        // preserving the current traversal order. Active-first ordering is
        // never rerun after a lifecycle event.
        const occupants: WindowCapability[] = [];
        const seen = new Set<WindowCapability>();
        for (const leaf of overlay.leaves) {
            const windows = decodeSequential(leaf.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
            if (!windows.ok) {
                return { kind: "rejected", reason: "topology-decode" };
            }
            for (const window of windows.value) {
                if (seen.has(window)) {
                    return { kind: "rejected", reason: "occupancy-validity" };
                }
                if (window.tile !== leaf || this.removedOccupants.has(window)) {
                    continue;
                }
                if (!windowInScope(window, scope)) {
                    return { kind: "rejected", reason: "occupancy-validity" };
                }
                seen.add(window);
                occupants.push(window);
            }
        }
        if (candidate !== undefined) {
            if (
                !windowInScope(candidate, scope) ||
                candidate.tile !== null ||
                seen.has(candidate) ||
                this.removedOccupants.has(candidate)
            ) {
                return { kind: "rejected", reason: "candidate-eligibility" };
            }
            if (occupants.length >= overlay.leaves.length) {
                return { kind: "no-capacity" };
            }
            occupants.push(candidate);
        }
        if (occupants.length > overlay.leaves.length) {
            return { kind: "rejected", reason: "capacity" };
        }
        // Build the complete assignment plan before any write, compacting
        // occupants to ordinal leaves and skipping already-correct entries.
        const plan: ReflowWrite[] = [];
        for (let index = 0; index < occupants.length; index += 1) {
            const occupant = occupants[index];
            const target = overlay.leaves[index];
            if (occupant === undefined || target === undefined) {
                return { kind: "rejected", reason: "capacity" };
            }
            if (occupant.tile === target) {
                continue;
            }
            const source = occupant.tile;
            if (source !== null && !isTile(source)) {
                return { kind: "rejected", reason: "source-validity" };
            }
            plan.push({ window: occupant, source, target });
        }
        if (plan.length === 0) {
            return { kind: "no-op" };
        }
        let writes = 0;
        for (const entry of plan) {
            if (!this.reflowAssignmentRevalidates(scope, entry.window, entry.source, entry.target)) {
                return writes === 0
                    ? { kind: "rejected", reason: "assignment-stale" }
                    : { kind: "partial", reason: "assignment-stale", writes };
            }
            let assigned = false;
            try {
                assigned = assignWindowToTile(entry.window, entry.target);
            } catch (error) {
                void error;
                return writes === 0
                    ? { kind: "rejected", reason: "assignment-failed" }
                    : { kind: "partial", reason: "assignment-failed", writes };
            }
            if (!assigned) {
                return writes === 0
                    ? { kind: "rejected", reason: "assignment-failed" }
                    : { kind: "partial", reason: "assignment-failed", writes };
            }
            writes += 1;
        }
        return { kind: "completed", writes };
    }

    // Re-derives identity, scope, current source, and target availability
    // immediately before each guarded write, so any change between planning
    // and the write stops the reflow without claiming rollback.
    private reflowAssignmentRevalidates(
        scope: CurrentScope,
        window: WindowCapability,
        source: TileCapability | null,
        target: TileCapability,
    ): boolean {
        if (!windowInScope(window, scope)) {
            return false;
        }
        if (window.tile !== source) {
            return false;
        }
        const overlay = this.readSelectedOverlay(scope);
        if (overlay === null) {
            return false;
        }
        return overlay.leaves.includes(target) && this.reflowTargetIsAvailable(target);
    }

    private reflowTargetIsAvailable(target: TileCapability): boolean {
        const windows = decodeSequential(target.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return false;
        }
        for (const occupant of windows.value) {
            if (!this.removedOccupants.has(occupant) && occupant.tile === target) {
                return false;
            }
        }
        return true;
    }

    private reflowAfterRemoval(window: WindowCapability): void {
        this.noteRemovedOccupant(window);
        const scope = this.scopeForWindow(window);
        if (scope === null) {
            // Without a decoded scope, act only on an overlay that still
            // identifies this exact wrapper. A settled removal with no such
            // association is inert rather than writing an unrelated scope.
            this.reflowSelectedScopesContaining(window);
            return;
        }
        if (this.selectedOverlays.get(scope.output)?.get(scope.desktop.id) === undefined) {
            return;
        }
        this.runReflow(scope);
    }

    private reflowAfterDetach(scope: CurrentScope, origin: TileCapability): void {
        const overlay = this.readSelectedOverlay(scope);
        if (overlay !== null && overlay.leaves.includes(origin)) {
            this.runReflow(scope);
        }
    }

    private reflowSelectedScopesContaining(window: WindowCapability): void {
        for (const byDesktop of this.selectedOverlays.values()) {
            for (const overlay of byDesktop.values()) {
                const current = this.readSelectedOverlay(overlay.scope);
                if (current === null) {
                    continue;
                }
                for (const leaf of current.leaves) {
                    const windows = decodeSequential(leaf.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
                    if (windows.ok && windows.value.includes(window)) {
                        this.runReflow(current.scope);
                        break;
                    }
                }
            }
        }
    }

    private noteRemovedOccupant(window: WindowCapability): void {
        if (this.removedOccupants.size >= MAX_SEQUENTIAL_LENGTH) {
            const stale = this.removedOccupants.values().next().value;
            if (stale !== undefined) {
                this.removedOccupants.delete(stale);
            }
        }
        this.removedOccupants.add(window);
    }

    private refillOrPlaceAutomatically(window: WindowCapability, scope: CurrentScope): void {
        const outcome = this.runReflow(scope, window);
        if (outcome.kind === "no-selection" || outcome.kind === "no-capacity") {
            // An already-tiled window is not a no-op; only a still-floating
            // window that cannot be placed emits the decisive reason.
            if (window.tile !== null) {
                return;
            }
            const placement = this.placeAutomatically(window, scope);
            if (placement.kind !== "managed") {
                this.diagnostic(`window-added-noop:${placement.kind}`);
            }
        }
    }

    // This returns the explicit realization input rather than tying executor
    // use to discovery, allowing future strategies to choose occupants first.
    private presetOccupants(
        topology: readonly OperationLeaf[],
        source: OperationLeaf,
        active: WindowCapability,
        scope: CurrentScope,
    ): readonly PresetOccupant[] | null {
        const sourceOccupant = targetOccupantForActive(source, active);
        if (sourceOccupant === null) {
            return null;
        }
        const seenLeaves = new Set<TileCapability>();
        const seenWindows = new Set<WindowCapability>();
        const ordered: PresetOccupant[] = [];
        for (const entry of topology) {
            if (entry.leaf.isLayout || seenLeaves.has(entry.decoded.tile)) {
                return null;
            }
            seenLeaves.add(entry.decoded.tile);
            for (const window of entry.windows) {
                if (
                    !windowInScope(window, scope) ||
                    window.tile !== entry.decoded.tile ||
                    seenWindows.has(window)
                ) {
                    return null;
                }
                seenWindows.add(window);
                ordered.push({ window, originTile: entry.decoded.tile });
            }
        }
        if (!seenWindows.has(sourceOccupant.window)) {
            return null;
        }
        const occupants: PresetOccupant[] = [{ window: sourceOccupant.window, originTile: source.decoded.tile }];
        for (const occupant of ordered) {
            if (occupant.window !== sourceOccupant.window) {
                occupants.push(occupant);
            }
        }
        return Object.freeze(occupants);
    }

    private presetAssignmentRevalidates(
        scope: CurrentScope,
        active: WindowCapability,
        occupant: PresetOccupant,
    ): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        return (
            freshScope !== null &&
            sameScope(freshScope.scope, scope.scope) &&
            windowInScope(active, freshScope) &&
            windowInScope(occupant.window, freshScope) &&
            occupant.window.tile === occupant.originTile
        );
    }

    // Active scope, source association, and target emptiness are re-derived
    // immediately before the single tile assignment, so any change between
    // selection and the write rejects without a write.
    private moveAssignmentRevalidates(
        scope: CurrentScope,
        active: WindowCapability,
        source: OperationLeaf,
        target: OperationLeaf,
        direction: Direction,
    ): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (
            freshScope === null ||
            !sameScope(freshScope.scope, scope.scope) ||
            !windowInScope(active, freshScope)
        ) {
            return false;
        }
        const topology = this.topologyForScope(freshScope);
        if (topology === null || active.tile === null || !isTile(active.tile)) {
            return false;
        }
        const freshSource = operationLeafForTile(topology, active.tile);
        if (
            freshSource === null ||
            freshSource.decoded.tile !== source.decoded.tile ||
            freshSource.leaf.isLayout ||
            freshSource.windows.length !== 1 ||
            windowIndex(freshSource.windows, active) < 0 ||
            topology.filter((entry) => windowIndex(entry.windows, active) >= 0).length !== 1
        ) {
            return false;
        }
        const freshTarget = operationLeafForTile(topology, target.decoded.tile);
        if (
            freshTarget === null ||
            freshTarget.leaf.isLayout ||
            freshTarget.windows.length !== 0
        ) {
            return false;
        }
        const freshCandidates = topology
            .filter((entry) => !entry.leaf.isLayout && entry.windows.length === 0)
            .map((entry) => entry.leaf);
        const freshTargetLeaf = findNeighborLeaf(freshCandidates, freshSource.leaf, direction);
        return freshTargetLeaf === freshTarget.leaf;
    }

    private clearPending(): void {
        const pending = this.pending.current;
        this.pending.clearForScopeChange();
        if (pending !== undefined) {
            pending.disconnect();
        }
    }

    private clearDrag(): void {
        this.drag.clearForScopeChange();
    }

    private handleScopeChange(): void {
        this.gate.run(() => {
            this.clearPending();
            this.clearDrag();
            this.attachExistingInteractiveWindows(false);
            this.engageCurrentScope();
        }, (reason) => this.disabled(reason));
    }

    private handleWindowRemoved(window: unknown): void {
        this.gate.run(() => {
            const pending = this.pending.current;
            if (
                pending !== undefined &&
                (pending.sourceWindow === window || pending.targetWindow === window)
            ) {
                this.clearPending();
            }
            if (this.drag.current?.window === window) {
                this.clearDrag();
            }
            if (isWindow(window)) {
                this.detachInteractiveWindow(window);
                this.cancelDeferredEligibility(window);
                this.detachedWindows.delete(window);
                this.reflowAfterRemoval(window);
                this.dwindleMaybeRemove(window);
            }
        }, (reason) => this.disabled(reason));
    }

    private handleWindowAdded(window: unknown): void {
        this.gate.run(() => {
            this.onceDiagnostic("window-added-observed");
            this.attachInteractiveWindow(window);
            const pending = this.pending.current;
            if (pending === undefined) {
                const scope = this.scopeForWindow(window);
                if (scope === null || !windowInScope(window, scope)) {
                    const reason = this.windowAddedRejection(window, scope);
                    if (reason === "desktop-scope-mismatch" && scope !== null && isWindow(window)) {
                        this.deferDesktopScopeReevaluation(window, scope);
                        return;
                    }
                    this.onceDiagnostic(`window-added-rejected:${reason}`);
                    return;
                }
                this.onceDiagnostic("window-added-eligible");
                this.placeEligibleAdded(window, scope);
                return;
            }
            try {
                this.completeKeyboardInsertion(window, pending);
            } finally {
                this.clearPending();
            }
        }, (reason) => this.disabled(reason));
    }

    // `desktop-scope-mismatch` is the one `windowAddedRejection` sub-code
    // that can be a timing artifact rather than genuine ineligibility
    // (unit-05/attempt-16): `window.desktops` may still be settling at the
    // exact `windowAdded` instant. Every other sub-code stays an immediate
    // terminal rejection. Bounded to exactly one short re-evaluation per
    // window; cancelled by `cancelDeferredEligibility` if the window closes
    // first, so nothing leaks or retries unboundedly.
    private deferDesktopScopeReevaluation(window: WindowCapability, scope: CurrentScope): void {
        if (this.deferredEligibility.size >= MAX_SEQUENTIAL_LENGTH || this.deferredEligibility.has(window)) {
            return;
        }
        this.onceDiagnostic(`window-added-deferred:${desktopScopeCheck(window, scope)}`);
        const cancel = this.environment.scheduleOnce(DESKTOP_SCOPE_REEVALUATION_DELAY_MS, () => {
            // The entry can already be gone: `handleWindowRemoved` cancels and
            // deletes it, or a later defer superseded it. Only this exact
            // pending operation may act, so an already-cancelled callback that
            // fires anyway is inert and cannot place a removed window.
            if (this.deferredEligibility.get(window) !== cancel) {
                return;
            }
            this.deferredEligibility.delete(window);
            this.reevaluateDesktopScope(window, scope);
        });
        this.deferredEligibility.set(window, cancel);
    }

    private reevaluateDesktopScope(window: WindowCapability, scope: CurrentScope): void {
        this.gate.run(() => {
            const freshScope = this.scopeForWindow(window);
            if (freshScope === null || !sameScope(freshScope.scope, scope.scope)) {
                this.onceDiagnostic("window-added-rejected-deferred:scope-changed");
                return;
            }
            this.onceDiagnostic(`window-added-reevaluated:${desktopScopeCheck(window, freshScope)}`);
            if (!windowInScope(window, freshScope)) {
                this.onceDiagnostic("window-added-rejected-deferred:desktop-scope-mismatch");
                return;
            }
            this.onceDiagnostic("window-added-eligible-deferred");
            this.placeEligibleAdded(window, freshScope);
        }, (reason) => this.disabled(reason));
    }

    private cancelDeferredEligibility(window: WindowCapability): void {
        const cancel = this.deferredEligibility.get(window);
        if (cancel === undefined) {
            return;
        }
        this.deferredEligibility.delete(window);
        cancel();
    }

    private windowAddedRejection(window: unknown, scope: CurrentScope | null): string {
        if (scope === null || !isWindow(window)) {
            return "scope-unavailable";
        }
        // `windowInScope`'s `window.output !== scope.output` check is unreachable here, so no sub-code exists for it.
        if (!window.normalWindow) {
            return "not-normal-window";
        }
        if (!window.managed) {
            return "not-managed";
        }
        if (!window.resizeable) {
            return "not-resizeable";
        }
        if (window.appletPopup) {
            return "applet-popup";
        }
        return "desktop-scope-mismatch";
    }

    private attachExistingInteractiveWindows(emitSummary: boolean): void {
        const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            this.diagnostic("drag-attach-skipped:window-list-decode-failed");
            return;
        }
        this.decodedBoundary("workspace-window-list");
        let attempted = 0;
        let ok = 0;
        let failed = 0;
        for (const window of windows.value) {
            const result = this.attachInteractiveWindow(window);
            if (result === null) {
                continue;
            }
            attempted += result.attempted;
            ok += result.ok;
            failed += result.failed;
        }
        if (emitSummary) {
            this.diagnostic(`drag-attach-summary:${attempted}:${ok}:${failed}`);
        }
    }

    private attachInteractiveWindow(
        window: unknown,
    ): { readonly attempted: number; readonly ok: number; readonly failed: number } | null {
        if (this.interactiveWindows.size >= MAX_SEQUENTIAL_LENGTH) {
            this.diagnostic("drag-attach-skipped:max-windows");
            return null;
        }
        if (!isWindow(window)) {
            this.diagnostic("drag-attach-skipped:not-window");
            return null;
        }
        if (this.interactiveWindows.has(window)) {
            this.diagnostic("drag-attach-skipped:duplicate");
            return null;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null) {
            this.diagnostic("drag-attach-skipped:no-scope");
            return null;
        }
        if (!windowInScope(window, scope)) {
            this.diagnostic("drag-attach-skipped:out-of-scope");
            return null;
        }
        const watched = this.environment.watchInteractiveWindow(
            window,
            () => this.handleInteractiveStarted(window),
            () => this.handleInteractiveFinished(window),
            () => this.handleInteractiveStepped(),
            () => this.handleMoveResizedChanged(),
            () => this.handleInteractiveInvalidated(window),
        );
        this.interactiveWindows.set(window, watched.disconnect);
        return { attempted: watched.ok + watched.failed, ok: watched.ok, failed: watched.failed };
    }

    private detachInteractiveWindow(window: WindowCapability): void {
        const disconnect = this.interactiveWindows.get(window);
        if (disconnect === undefined) {
            return;
        }
        this.interactiveWindows.delete(window);
        disconnect();
    }

    private handleInteractiveInvalidated(window: WindowCapability): void {
        this.gate.run(() => {
            if (this.drag.current?.window === window) {
                this.clearDrag();
            }
            this.detachInteractiveWindow(window);
        }, (reason) => this.disabled(reason));
    }

    private handleInteractiveStarted(window: WindowCapability): void {
        this.diagnostic("drag-started");
        this.gate.run(() => {
            if (this.drag.current !== undefined || !window.move || window.resize) {
                return;
            }
            const scope = this.scopeForWindow(window);
            if (scope === null || !windowInScope(window, scope) || window.tile === null || !isCustomTile(window.tile)) {
                return;
            }
            const topology = this.topologyForScope(scope);
            if (topology === null || !positiveGeometry(window.frameGeometry)) {
                return;
            }
            const origin = operationLeafForTile(topology, window.tile);
            if (origin === null || origin.leaf.isLayout || windowIndex(origin.windows, window) < 0) {
                return;
            }
            this.drag.set({
                scope,
                window,
                originTile: window.tile,
                originGeometry: {
                    x: window.frameGeometry.x,
                    y: window.frameGeometry.y,
                    width: window.frameGeometry.width,
                    height: window.frameGeometry.height,
                },
            });
            this.diagnostic("drag-origin-captured");
        }, (reason) => this.disabled(reason));
    }

    private handleInteractiveFinished(window: WindowCapability): void {
        this.gate.run(() => {
            const drag = this.drag.current;
            if (drag === undefined || drag.window !== window) {
                return;
            }
            try {
                this.completeDrag(drag);
            } finally {
                this.clearDrag();
            }
        }, (reason) => this.disabled(reason));
    }

    // Stepped keeps the signal attached for live delivery proof but must not
    // emit per-motion journal lines or mutate tiles; only Finished drives reflow.
    private handleInteractiveStepped(): void {}

    private handleMoveResizedChanged(): void {
        this.diagnostic("drag-move-resized-changed");
    }

    // Read the documented workspace cursor exactly once, at drag finish, under
    // safe validation. Returns the finite cursor point, or null when the read
    // throws or the value is not a finite point; each failure emits a one-time
    // fallback diagnostic and the caller falls back to the final frame center.
    private readCursorPoint(): Point | null {
        let value: unknown;
        try {
            value = this.environment.cursorPos();
        } catch (error) {
            void error;
            this.onceDiagnostic("drag-point-fallback:cursor-read-threw");
            return null;
        }
        if (!isPoint(value)) {
            this.onceDiagnostic("drag-point-fallback:cursor-not-a-point");
            return null;
        }
        return { x: value.x, y: value.y };
    }

    // Compact one-line JSON observability for the drop-only finish. Each stage
    // builds a plain-data payload and serializes it; any observation or
    // serialization error is swallowed into a fixed `drag-snapshot-failed`
    // diagnostic so observability never affects the guarded tiling operation.
    private dragSnapshot(stage: "before" | "target" | "after" | "final", produce: () => unknown): void {
        let data: unknown;
        try {
            data = produce();
        } catch (error) {
            void error;
            this.diagnostic(`drag-snapshot-failed:${stage}:observe`);
            return;
        }
        let payload: string;
        try {
            payload = JSON.stringify(data);
        } catch (error) {
            void error;
            this.diagnostic(`drag-snapshot-failed:${stage}:serialize`);
            return;
        }
        const prefix = stage === "target" ? "drag-target" : `drag-snapshot-${stage}`;
        this.diagnostic(`${prefix}:${payload}`);
    }

    private topologyLeavesData(topology: readonly OperationLeaf[]): unknown {
        return topology.map((entry) => ({
            id: entry.leaf.id,
            geometry: {
                x: entry.leaf.geometry.x,
                y: entry.leaf.geometry.y,
                width: entry.leaf.geometry.width,
                height: entry.leaf.geometry.height,
            },
            occupants: entry.refs.map((ref, index) => ({
                id: ref.id,
                caption: snapshotCaption(entry.windows[index]?.caption),
            })),
        }));
    }

    private dragSnapshotBefore(
        drag: ActiveDrag,
        topology: readonly OperationLeaf[] | null,
        topologyStatus: string | null,
        center: Point | null,
        pointSource: "cursor" | "frame-center" | null = null,
    ): void {
        this.dragSnapshot("before", () => {
            const geometry = drag.window.frameGeometry;
            const payload: Record<string, unknown> = {
                geometry: {
                    x: geometry.x,
                    y: geometry.y,
                    width: geometry.width,
                    height: geometry.height,
                },
                center: center === null ? null : { x: center.x, y: center.y },
                leaves: topology === null ? null : this.topologyLeavesData(topology),
            };
            if (pointSource !== null) {
                payload.pointSource = pointSource;
            }
            if (topology === null) {
                payload.topology = topologyStatus;
            }
            return payload;
        });
    }

    private dragTargetResolution(target: GeometryDropResolution): void {
        this.dragSnapshot("target", () => {
            if (target.kind === "resolved") {
                return {
                    kind: "resolved",
                    leaf: target.target.leaf.id,
                    center: { x: target.center.x, y: target.center.y },
                    pointSource: target.pointSource,
                    occupancy: target.empty ? "empty" : "occupied",
                };
            }
            if (target.kind === "center-unresolved") {
                return { kind: "center-unresolved" };
            }
            return {
                kind: target.kind,
                center: { x: target.center.x, y: target.center.y },
                pointSource: target.pointSource,
            };
        });
    }

    private dragSnapshotAfter(topology: readonly OperationLeaf[]): void {
        this.dragSnapshot("after", () => ({ leaves: this.topologyLeavesData(topology) }));
    }

    private dragSnapshotFinal(topology: readonly OperationLeaf[]): void {
        this.dragSnapshot("final", () => ({ leaves: this.topologyLeavesData(topology) }));
    }

    private restoreOrigin(drag: ActiveDrag): boolean {
        const scope = this.scopeForWindow(drag.window);
        if (
            scope === null ||
            !sameScope(scope.scope, drag.scope.scope) ||
            !windowInScope(drag.window, scope) ||
            !isCustomTile(drag.originTile) ||
            drag.window.tile === drag.originTile
        ) {
            return false;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null || operationLeafForTile(topology, drag.originTile) === null) {
            return false;
        }
        if (!manageTile(drag.originTile, drag.window)) {
            return false;
        }
        this.diagnostic("drag-origin-restored");
        return true;
    }

    private completeDrag(drag: ActiveDrag): void {
        // Distinctive drag-hook entry log emitted before any decision or bail
        // logic, so a live drag either leaves a trail here or is provably not
        // reaching the finish hook at all.
        this.diagnostic("drag-finished");
        const scope = this.scopeForWindow(drag.window);
        if (scope === null) {
            this.dragSnapshotBefore(drag, null, "scope-unavailable", null);
            this.bailDrag("drag-bail:scope-unavailable", drag);
            return;
        }
        if (!sameScope(scope.scope, drag.scope.scope)) {
            this.dragSnapshotBefore(drag, null, "scope-changed", null);
            this.bailDrag("drag-bail:scope-changed", drag);
            return;
        }
        if (!windowInScope(drag.window, scope)) {
            this.dragSnapshotBefore(drag, null, "window-out-of-scope", null);
            this.bailDrag("drag-bail:window-out-of-scope", drag);
            return;
        }
        if (!isCustomTile(drag.originTile)) {
            this.dragSnapshotBefore(drag, null, "origin-tile-not-custom", null);
            this.bailDrag("drag-bail:origin-tile-not-custom", drag);
            return;
        }
        if (drag.window.tile === drag.originTile && sameGeometry(drag.window.frameGeometry, drag.originGeometry)) {
            this.dragSnapshotBefore(drag, null, "unchanged", null);
            this.diagnostic("drag-unchanged");
            return;
        }
        let topologyRejection: TopologyRejection | null = null;
        const topology = this.topologyForScope(scope, (reason) => {
            topologyRejection = reason;
        });
        if (topology === null) {
            this.dragSnapshotBefore(drag, null, topologyRejection ?? "unknown", null);
            this.bailDrag(`drag-bail:topology-unavailable:${topologyRejection ?? "unknown"}`, drag);
            return;
        }
        if (!positiveGeometry(drag.window.frameGeometry)) {
            this.dragSnapshotBefore(drag, topology, null, null);
            this.bailDrag("drag-bail:geometry-invalid", drag);
            return;
        }
        const cursorPoint = this.readCursorPoint();
        const frameCenter = rectCenter(drag.window.frameGeometry);
        const center = cursorPoint ?? frameCenter;
        const pointSource: "cursor" | "frame-center" = cursorPoint !== null ? "cursor" : "frame-center";
        this.dragSnapshotBefore(drag, topology, null, center, pointSource);
        const origin = operationLeafForTile(topology, drag.originTile);
        if (origin === null) {
            this.bailDrag("drag-bail:origin-unresolved", drag);
            return;
        }
        if (origin.leaf.isLayout) {
            this.bailDrag("drag-bail:origin-is-layout", drag);
            return;
        }
        this.recoverGeometryDrop(drag, scope, topology, origin, center, pointSource);
    }

    // The OperationLeaf of a native Shift-drop target, or null unless the
    // dragged window's current tile is a non-layout custom-tile leaf holding
    // exactly the dragged window plus one other eligible in-scope occupant,
    // with the dragged window appearing in no other leaf.
    private nativeDropTarget(
        drag: ActiveDrag,
        scope: CurrentScope,
        topology: readonly OperationLeaf[],
    ): OperationLeaf | null {
        if (drag.window.tile === drag.originTile || !isCustomTile(drag.window.tile) || drag.window.tile.isLayout) {
            return null;
        }
        const target = operationLeafForTile(topology, drag.window.tile);
        if (target === null || target.leaf.isLayout || !isCustomTile(target.decoded.tile)) {
            return null;
        }
        if (windowIndex(target.windows, drag.window) < 0 || target.windows.length !== 2) {
            return null;
        }
        if (topology.filter((entry) => windowIndex(entry.windows, drag.window) >= 0).length !== 1) {
            return null;
        }
        const occupant = target.windows.find((window) => window !== drag.window);
        if (occupant === undefined || !windowInScope(occupant, scope)) {
            return null;
        }
        return target;
    }

    // Finish-only reflow of every changed drag. The drop target and split
    // direction are derived authoritatively from the dragged window's final
    // frame geometry against the freshly decoded tile tree, excluding the
    // origin leaf, so a plain floating drop, an origin-still-associated drop
    // (KWin's unmanage lagging the finish hook), and a native Shift drop all
    // converge on the same reflow. Native overlap state, when present, is
    // validated only as a safety precondition and never selects the target or
    // direction. Structural safety: the finish dispatch performs exactly one
    // structural call, the position-directed split; the vacated origin's
    // collapse is then deferred to the established one-shot event-loop yield,
    // so the origin is never removed before the split.
    private recoverGeometryDrop(
        drag: ActiveDrag,
        scope: CurrentScope,
        topology: readonly OperationLeaf[],
        origin: OperationLeaf,
        center: Point | null,
        pointSource: "cursor" | "frame-center",
    ): void {
        const native = this.nativeDropTarget(drag, scope, topology);
        const target = this.geometryDropTarget(topology, origin, center, pointSource);
        this.dragTargetResolution(target);
        if (target.kind !== "resolved") {
            this.bailDrag(dragGeometryBail(target), drag);
            return;
        }
        if (native !== null && native.leaf !== target.target.leaf) {
            // KWin managed the dragged window into a tile that the final frame
            // geometry does not back: inconsistent state, never reflow it.
            this.bailDrag("drag-bail:geometry-native-mismatch", drag);
            return;
        }
        if (native !== null) {
            this.diagnostic("drag-native-overlap");
        }
        const draggedIndex = windowIndex(target.target.windows, drag.window);
        let draggedRef: WindowRef;
        if (draggedIndex >= 0) {
            const ref = target.target.refs[draggedIndex];
            if (ref === undefined) {
                this.bailDrag("drag-bail:geometry-plan-rejected:ref-unresolved", drag);
                return;
            }
            draggedRef = ref;
        } else {
            draggedRef = {
                id: "window-dragged",
                normal: drag.window.normalWindow,
                managed: drag.window.managed,
            };
        }
        const plan = planGeometryDrop({
            scope: scope.scope,
            originLeaf: origin.leaf,
            targetLeaf: target.target.leaf,
            draggedWindow: draggedRef,
            pointer: target.center,
            record: {
                scope: scope.scope,
                originLeafId: origin.leaf.id,
                windowId: draggedRef.id,
                geometry: drag.originGeometry,
            },
        });
        if (!plan.ok) {
            this.bailDrag(`drag-bail:geometry-plan-rejected:${plan.reason.kind}`, drag);
            return;
        }
        if (plan.value.kind === "geometry-drop-empty") {
            this.diagnostic("drag-empty-target");
            this.applyEmptyDrop(drag, scope, target.target);
            return;
        }
        this.diagnostic("drag-geometry-target");
        this.applyDropSplit(drag, scope, target.target, plan.value.direction);
    }

    // The non-layout leaf (occupied or empty) under the chosen resolver point
    // (the documented workspace cursor when finite, else the dragged window's
    // final frame geometry center), excluding the origin leaf, or a distinct
    // bail branch when the point resolves nowhere. The smallest eligible leaf
    // wins by the same ordering rule as the classic cursor target selection.
    // An empty leaf resolves as a direct-placement target, not a bail.
    private geometryDropTarget(
        topology: readonly OperationLeaf[],
        origin: OperationLeaf,
        center: Point | null,
        pointSource: "cursor" | "frame-center",
    ): GeometryDropResolution {
        if (center === null) {
            return { kind: "center-unresolved" };
        }
        const leaf = pickDropLeaf(topology.map((entry) => entry.leaf), center);
        if (leaf === null) {
            return { kind: "no-target-leaf", center, pointSource };
        }
        if (leaf.id === origin.leaf.id) {
            return { kind: "target-is-origin", center, pointSource };
        }
        for (const entry of topology) {
            if (entry.leaf === leaf) {
                return { kind: "resolved", target: entry, center, pointSource, empty: entry.windows.length === 0 };
            }
        }
        return { kind: "leaf-not-in-topology", center, pointSource };
    }

    private bailDrag(reason: string, drag: ActiveDrag): void {
        this.diagnostic(reason);
        this.restoreOrigin(drag);
    }

    // Direct placement of the dragged window into a resolved empty non-layout
    // target leaf: a single guarded manage with no split and no occupied-leaf
    // reflow, then the vacated origin's collapse is deferred to the established
    // one-shot yield exactly like the split path.
    private applyEmptyDrop(drag: ActiveDrag, scope: CurrentScope, target: OperationLeaf): void {
        let managed = false;
        try {
            managed = manageTile(target.decoded.tile, drag.window);
        } catch (error) {
            void error;
        }
        if (!managed) {
            this.bailDrag("drag-bail:empty-placement-failed", drag);
            return;
        }
        this.diagnostic("drag-empty-placement");
        this.deferRemovalCollapse(drag.window, scope, drag.originTile, true);
    }

    // Split a resolved drop target leaf into the direction-derived children and
    // manage the original occupant onto the opposite child and the dragged
    // window onto the selected child, then defer the vacated origin's collapse
    // to the established one-shot yield. Shared by the native Shift-drop and
    // plain geometry-drop paths.
    private applyDropSplit(
        drag: ActiveDrag,
        scope: CurrentScope,
        target: OperationLeaf,
        direction: Direction,
    ): void {
        const occupant = target.windows.find((window) => window !== drag.window);
        if (occupant === undefined || !windowInScope(occupant, scope)) {
            this.bailDrag("drag-bail:target-occupant-invalid", drag);
            return;
        }
        if (!this.splitDropTarget(target, occupant, drag, direction)) {
            return;
        }
        this.diagnostic("drag-overlap-split-completed");
        this.deferRemovalCollapse(drag.window, scope, drag.originTile, true, {
            dragged: drag.window,
            occupant,
        });
    }

    // Split a drop target leaf into the direction-derived children and manage
    // the original occupant onto the opposite child and the dragged window
    // onto the selected child. Shared by every changed-drag reflow (plain
    // floating, origin-still-associated, and native Shift). A malformed split
    // result or a failed manage disables the gate, matching the established
    // drag contract.
    private splitDropTarget(
        target: OperationLeaf,
        occupant: WindowCapability,
        drag: ActiveDrag,
        direction: Direction,
    ): boolean {
        if (!isCustomTile(target.decoded.tile)) {
            this.gate.disable("drag-split-result-invalid", (reason) => this.disabled(reason));
            return false;
        }
        const split = splitCustomTile(target.decoded.tile, splitDirection(direction));
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (decoded.ok) {
            this.decodedBoundary("split-result");
        }
        const axis = direction === "left" || direction === "right" ? "x" : "y";
        const children = decoded.ok ? orderedChildren(decoded.value, axis) : null;
        if (children === null) {
            this.gate.disable("drag-split-result-invalid", (reason) => this.disabled(reason));
            return false;
        }
        const first = children[0];
        const second = children[1];
        const selected = direction === "left" || direction === "up" ? first : second;
        const opposite = selected === first ? second : first;
        const occupantManaged = manageTile(opposite, occupant);
        const draggedManaged = occupantManaged && manageTile(selected, drag.window);
        if (!occupantManaged || !draggedManaged) {
            this.gate.disable("drag-manage-failed", (reason) => this.disabled(reason));
            return false;
        }
        return true;
    }

    private scopeForWindow(window: unknown): CurrentScope | null {
        if (!isWindow(window) || !isOutput(window.output)) {
            return null;
        }
        const desktop = this.environment.currentDesktopForOutput(window.output);
        if (!isVirtualDesktop(desktop)) {
            return null;
        }
        return {
            output: window.output,
            desktop,
            scope: { output: window.output, desktopId: desktop.id },
        };
    }

    private topologyForScope(
        scope: CurrentScope,
        onRejected?: (reason: TopologyRejection) => void,
    ): readonly OperationLeaf[] | null {
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isTile(root)) {
            onRejected?.("root-lookup");
            return null;
        }
        const leaves = decodeLeaves(root, (kind) => this.decodedBoundary(kind));
        if (leaves === null) {
            onRejected?.("topology-decode");
            return null;
        }
        return makeOperationLeaves(leaves);
    }

    private completeKeyboardInsertion(window: unknown, pending: PendingKeyboard): void {
        const active = this.environment.activeWindow();
        const activeScope = this.scopeForWindow(active);
        const scope = this.scopeForWindow(window);
        if (
            activeScope === null ||
            scope === null ||
            !sameScope(activeScope.scope, pending.scope.scope) ||
            !sameScope(scope.scope, pending.scope.scope) ||
            !windowInScope(active, activeScope) ||
            !windowInScope(window, scope) ||
            !windowInScope(pending.targetWindow, scope) ||
            active.tile !== pending.targetTile
        ) {
            return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            return;
        }
        const target = operationLeafForTile(topology, pending.targetTile);
        if (target === null || target.leaf.isLayout || !isCustomTile(target.decoded.tile)) {
            return;
        }
        const targetIndex = windowIndex(target.windows, pending.targetWindow);
        if (targetIndex < 0) {
            return;
        }
        for (const occupant of target.windows) {
            if (!windowInScope(occupant, scope)) {
                return;
            }
        }
        const focused = target.refs[targetIndex];
        if (focused === undefined) {
            return;
        }
        const plan = planKeyboardInsertion({
            scope: scope.scope,
            direction: pending.direction,
            focusedLeaf: target.leaf,
            focusedWindow: focused,
            incoming: { id: "incoming", normal: window.normalWindow, managed: window.managed },
            record: { scope: scope.scope, leafId: target.leaf.id, windowId: focused.id },
        });
        if (!plan.ok) {
            return;
        }
        // Left/right split horizontally, up/down vertically. The requested
        // side receives the incoming window; the focused occupant keeps the
        // opposite child.
        const split = splitCustomTile(target.decoded.tile, splitDirection(pending.direction));
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (!decoded.ok) {
            this.gate.disable("keyboard-split-result-invalid", (reason) => this.disabled(reason));
            return;
        }
        this.decodedBoundary("split-result");
        const axis = pending.direction === "left" || pending.direction === "right" ? "x" : "y";
        const children = decoded.ok ? orderedChildren(decoded.value, axis) : null;
        if (children === null) {
            this.gate.disable("keyboard-split-child-selection-failed", (reason) => this.disabled(reason));
            return;
        }
        const first = children[0];
        const second = children[1];
        // Smallest source-proven child ordering: the revalidated source
        // occupant is assigned to its child first, then the incoming window is
        // placed on the requested side. The split has already mutated topology,
        // so a first-assignment stop leaves the split mutated with nothing
        // reassigned and a second-assignment stop leaves the source correctly
        // tiled in its new half; no rollback is claimed either way.
        const occupantChild = pending.direction === "left" || pending.direction === "up" ? second : first;
        const incomingChild = occupantChild === first ? second : first;
        if (!manageTile(occupantChild, pending.targetWindow)) {
            this.diagnostic("keyboard-failed:first-assignment");
            return;
        }
        if (!manageTile(incomingChild, window)) {
            this.diagnostic("keyboard-failed:second-assignment");
            return;
        }
        this.diagnostic("keyboard-completed");
    }

    // Returns the placement outcome. Managed-scope dwindle ownership reuses
    // this deterministic empty-leaf placement so a full owned tree keeps the
    // same guarded assignment and diagnostic as generic automatic placement.
    private placeAutomatically(window: WindowCapability, scope: CurrentScope): AutomaticPlacementOutcome {
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            return { kind: "topology-unavailable" };
        }
        const plan = planAutomaticPlacement({
            scope: scope.scope,
            window: { id: "incoming", normal: window.normalWindow, managed: window.managed },
            leaves: topology.map((entry) => entry.leaf),
        });
        if (!plan.ok) {
            return { kind: "no-empty-leaf" };
        }
        for (const entry of topology) {
            if (entry.leaf === plan.value.leaf) {
                if (manageTile(entry.decoded.tile, window)) {
                    this.diagnostic("automatic-placement-managed");
                    return { kind: "managed" };
                }
                return { kind: "assignment-failed" };
            }
        }
        return { kind: "no-empty-leaf" };
    }

    // ---- Automatic session-local managed-scope dwindle ownership ----

    // Re-anchor ownership to the current scope after controller start or a
    // screens/current-desktop change. The anchor is the active eligible
    // in-scope window, else the first eligible in-scope window in the proven
    // window collection. A scope with no owned windows is never managed.
    private engageCurrentScope(): void {
        const anchor = this.ownershipAnchor();
        if (anchor === null) {
            return;
        }
        const scope = this.scopeForWindow(anchor);
        if (scope === null) {
            return;
        }
        this.ensureManaged(scope);
    }

    private ownershipAnchor(): WindowCapability | null {
        const active = this.environment.activeWindow();
        if (isWindow(active)) {
            const scope = this.scopeForWindow(active);
            if (scope !== null && windowInScope(active, scope)) {
                return active;
            }
        }
        const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return null;
        }
        this.decodedBoundary("workspace-window-list");
        for (const window of windows.value) {
            const scope = this.scopeForWindow(window);
            if (scope !== null && windowInScope(window, scope)) {
                return window;
            }
        }
        return null;
    }

    private managedRecord(scope: CurrentScope): ManagedScope | null {
        return this.managedScopes.get(scope.output)?.get(scope.desktop.id) ?? null;
    }

    private isOwned(scope: CurrentScope): boolean {
        const record = this.managedRecord(scope);
        return record !== null && !record.inert;
    }

    private isInert(scope: CurrentScope): boolean {
        const record = this.managedRecord(scope);
        return record !== null && record.inert;
    }

    private setManaged(scope: CurrentScope): void {
        let byDesktop = this.managedScopes.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map<string, ManagedScope>();
            this.managedScopes.set(scope.output, byDesktop);
        }
        byDesktop.set(scope.desktop.id, { scope, inert: false });
    }

    // A failed or damaged scope becomes inert for this session only: the
    // record is retained so it is never retried, while other scopes and the
    // generic placement paths keep working.
    private markInert(scope: CurrentScope, reason: string): void {
        let byDesktop = this.managedScopes.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map<string, ManagedScope>();
            this.managedScopes.set(scope.output, byDesktop);
        }
        byDesktop.set(scope.desktop.id, { scope, inert: true });
        this.diagnostic(`ownership-inert:${reason}`);
    }

    // Adopt session-local ownership of the anchored scope with ratio-free
    // dwindle. A valid selected overlay takes precedence and leaves the scope
    // overlay-managed. The owned population is every eligible in-scope window
    // from the proven window collection excluding explicitly detached windows.
    // When the scope's tree already realizes the dwindle blueprint for that
    // count it is adopted unchanged; otherwise a full reconstruction starts:
    // a synchronous removals-only collapse to a single leaf followed by a
    // non-timer event-loop yield before the deferred split reconstruction.
    private ensureManaged(scope: CurrentScope): void {
        if (this.isOwned(scope) || this.isInert(scope)) {
            return;
        }
        if (this.readSelectedOverlay(scope) !== null) {
            return;
        }
        const population = this.ownedPopulation(scope);
        if (population.length === 0) {
            return;
        }
        this.setManaged(scope);
        if (this.dwindleMatches(scope, population)) {
            this.diagnostic("ownership-taken");
            return;
        }
        this.startReconstruction(scope);
    }

    // The owned population of a scope: eligible in-scope windows from the
    // proven window collection, excluding windows explicitly detached by the
    // detach action. Floating non-detached windows count because the dwindle
    // takeover owns and tiles every eligible window in the managed scope.
    private ownedPopulation(scope: CurrentScope): readonly WindowCapability[] {
        const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return [];
        }
        this.decodedBoundary("workspace-window-list");
        const owned: WindowCapability[] = [];
        for (const window of windows.value) {
            if (windowInScope(window, scope) && !this.detachedWindows.has(window)) {
                owned.push(window);
            }
        }
        return owned;
    }

    // Whether the scope's current tree already realizes the ratio-free dwindle
    // blueprint for the owned population. A population of one is realized by
    // exactly one usable leaf (a non-layout tile or a zero-child layout root)
    // occupied by the sole owned window, regardless of the root wrapper; higher
    // counts require the exact dwindle chain with alternating orientation. In
    // every case the occupancy must be a bijection between the usable leaves
    // and the population: each leaf holds exactly one owned window whose
    // recorded `tile` is that leaf, and every owned window occupies exactly one
    // leaf. An empty population is never realized, so an empty owned scope
    // never matches.
    private dwindleMatches(scope: CurrentScope, population: readonly WindowCapability[]): boolean {
        const count = population.length;
        if (count === 0) {
            return false;
        }
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root)) {
            return false;
        }
        if (count === 1) {
            const leaves = decodeUsableLeaves(root);
            if (leaves === null || leaves.length !== 1) {
                return false;
            }
            return dwindleBijectionTreeMatches(scope, root, population);
        }
        const blueprint = buildDwindleBlueprint(count);
        if (!blueprint.ok) {
            return false;
        }
        if (!dwindleNodeMatches(root, blueprint.value, 0)) {
            return false;
        }
        return dwindleBijectionTreeMatches(scope, root, population);
    }

    // Full dwindle reconstruction, phase registration: record the owned scope
    // as awaiting its first one-shot event-loop yield and arm it. No structural
    // call happens here; the removals-only collapse runs at the first yield
    // callback and the splits-only rebuild at the second. A valid selected
    // overlay or an inert scope drops the pending reconstruction without
    // acting. A later request while a reconstruction is already pending starts
    // no second one: it re-arms the current phase's yield so a lost callDBus
    // reply (scripting.cpp:361-364 never invokes the callback on an error
    // reply) cannot strand the scope in a collapsed or un-rebuilt state. Each
    // such re-arm counts against the current phase's bounded budget; once the
    // budget is exhausted the scope fails closed and becomes inert instead of
    // retrying forever, while the phase and pending-identity guards keep every
    // stale or duplicate callback inert.
    private startReconstruction(scope: CurrentScope): void {
        const existing = this.pendingRebuilds.get(scope.output)?.get(scope.desktop.id);
        if (existing !== undefined) {
            existing.rearmCount += 1;
            if (existing.rearmCount > MAX_YIELD_REARM_PER_PHASE) {
                this.markInert(scope, "rearm-budget-exhausted");
                this.dropPendingRebuild(scope, existing);
                return;
            }
            if (!this.armRebuildYield(scope, existing)) {
                this.markInert(scope, "rearm-yield-arm-failed");
                this.dropPendingRebuild(scope, existing);
            }
            return;
        }
        const pending: PendingRebuild = { scope, phase: "awaiting-collapse", rearmCount: 0 };
        let byDesktop = this.pendingRebuilds.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map<string, PendingRebuild>();
            this.pendingRebuilds.set(scope.output, byDesktop);
        }
        byDesktop.set(scope.desktop.id, pending);
        if (!this.armRebuildYield(scope, pending)) {
            this.markInert(scope, "initial-yield-arm-failed");
            this.dropPendingRebuild(scope, pending);
            return;
        }
        this.diagnostic("ownership-pending");
    }

    // Arm exactly one one-shot event-loop yield for the pending rebuild's
    // current phase. The callback captures the phase it was armed for and is
    // inert unless the same pending record is still current and still in that
    // phase, so a duplicate or stale callback can never collapse, split, or
    // assign twice. A failed arm fails the scope closed rather than stranding
    // it.
    private armRebuildYield(scope: CurrentScope, pending: PendingRebuild): boolean {
        const armedFor = pending.phase;
        let armed = false;
        try {
            armed = this.environment.yieldOnce(() => {
                if (this.pendingRebuilds.get(scope.output)?.get(scope.desktop.id) !== pending) {
                    return;
                }
                if (pending.phase !== armedFor) {
                    return;
                }
                this.settleScopeRebuild(scope, pending);
            });
        } catch (error) {
            void error;
            return false;
        }
        return armed;
    }

    // Guarded collapse of an owned scope to a single leaf through the guarded
    // reset seam: every occupant is unmanaged before the first removal, each
    // removal is one `CustomTile.remove()`, and the root is freshly decoded
    // after every removal. No removal result is ever an acknowledgement.
    private collapseOwnedScope(scope: CurrentScope): boolean {
        const seam: ResetSeam<TileCapability, WindowCapability> = {
            snapshot: () => this.resetSnapshot(scope),
            unmanage: (_tile, window) => detachWindowFromTile(window),
            remove: (tile) => isCustomTile(tile) && removeCustomTile(tile),
        };
        const result = collapseToRootLeaf(seam);
        return result.ok;
    }

    // Fresh decoded snapshot of the whole scope tree for the guarded reset
    // seam. The root and every reachable tile are re-resolved from the
    // environment each call; no handle is retained across removals.
    private resetSnapshot(scope: CurrentScope): ResetSnapshot<TileCapability, WindowCapability> | null {
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isTile(root)) {
            return null;
        }
        const tiles = decodeTileTree(root);
        if (tiles === null) {
            return null;
        }
        const entries: ResetTile<TileCapability, WindowCapability>[] = [];
        for (const tile of tiles) {
            const children = decodeSequential(tile.tiles, isTile, MAX_SEQUENTIAL_LENGTH);
            if (!children.ok) {
                return null;
            }
            let occupants: readonly WindowCapability[] = [];
            if (!tile.isLayout) {
                const decoded = decodeSequential(tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
                if (!decoded.ok) {
                    return null;
                }
                occupants = decoded.value;
            }
            entries.push({ tile, children: children.value, occupants, removable: tile.canBeRemoved });
        }
        return { root, tiles: entries };
    }

    // Full dwindle reconstruction phase dispatch: re-validate everything fresh
    // (scope ownership, selected-overlay precedence, owned population, and the
    // live dwindle match), then either drop the pending rebuild or perform the
    // phase's one structural dispatch. The awaiting-collapse dispatch is a
    // synchronous removals-only collapse that arms the second yield; the
    // awaiting-split dispatch is a synchronous splits-only rebuild that drops
    // the pending record. Every callback re-resolves the scope, root, and
    // window membership fresh and never touches a recorded child tile handle.
    private settleScopeRebuild(scope: CurrentScope, pending: PendingRebuild): void {
        if (this.isInert(scope) || !this.isOwned(scope)) {
            this.dropPendingRebuild(scope, pending);
            return;
        }
        if (this.readSelectedOverlay(scope) !== null) {
            this.dropPendingRebuild(scope, pending);
            return;
        }
        const population = this.ownedPopulation(scope);
        if (population.length === 0) {
            this.dropPendingRebuild(scope, pending);
            return;
        }
        if (this.dwindleMatches(scope, population)) {
            this.dropPendingRebuild(scope, pending);
            return;
        }
        if (pending.phase === "awaiting-collapse") {
            // Phase one: a synchronous homogeneous removals-only collapse to a
            // single leaf with a fresh whole-root decode after every removal.
            // The split reconstruction then waits for the second yield.
            if (!this.collapseOwnedScope(scope)) {
                this.markInert(scope, "collapse-failed");
                this.dropPendingRebuild(scope, pending);
                return;
            }
            pending.phase = "awaiting-split";
            pending.rearmCount = 0;
            this.diagnostic("ownership-collapsed");
            if (!this.armRebuildYield(scope, pending)) {
                this.markInert(scope, "split-yield-arm-failed");
                this.dropPendingRebuild(scope, pending);
            }
            return;
        }
        // Phase two: the splits-only dwindle rebuild in one synchronous batch.
        if (this.rebuildDwindle(scope, population)) {
            this.diagnostic("ownership-taken");
        } else {
            this.markInert(scope, "rebuild-failed");
        }
        this.dropPendingRebuild(scope, pending);
    }

    // Fresh resolution of a compiled blueprint path to the live custom tile:
    // the scope root is re-resolved from the environment and the tree is
    // re-decoded on every call, so the returned handle is valid only until the
    // next structural call and is never retained across one.
    private dwindleTileAtPath(scope: CurrentScope, path: BlueprintPath): CustomTileCapability | null {
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root)) {
            return null;
        }
        let current: CustomTileCapability = root;
        for (const segment of path) {
            if (segment === "root") {
                continue;
            }
            const children = decodeSequential(current.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
            if (!children.ok) {
                return null;
            }
            const child = segment === "left" ? children.value[0] : children.value[1];
            if (child === undefined) {
                return null;
            }
            current = child;
        }
        return current;
    }

    // Full dwindle reconstruction, phase two body: a single synchronous
    // splits-only batch realizing the ratio-free dwindle blueprint for the
    // current owned population on the freshly resolved single-leaf root, then
    // guarded assignments of the population to the ordinal leaves. Every split
    // re-resolves the scope root and fresh-decodes the tree around the call,
    // and the split return value is validated and discarded rather than
    // retained, so no tile handle survives from one structural call to the
    // next. The whole split reconstruction finishes in one dispatch, never one
    // frame per tile.
    private rebuildDwindle(
        scope: CurrentScope,
        population: readonly WindowCapability[],
    ): boolean {
        if (population.length === 0) {
            return false;
        }
        const compiled = buildPreset("dwindle", population.length);
        if (!compiled.ok) {
            return false;
        }
        for (const instruction of compiled.value.splits) {
            const target = this.dwindleTileAtPath(scope, instruction.targetPath);
            if (target === null) {
                return false;
            }
            let split: unknown;
            try {
                split = splitCustomTile(target, layoutDirectionFor(instruction.orientation));
            } catch (error) {
                void error;
                return false;
            }
            const decoded = decodeSequential(split, isCustomTile, 2);
            if (!decoded.ok || decoded.value.length !== 2) {
                return false;
            }
            // The split result is validated and then discarded: the next split
            // and the final leaf realization re-resolve the root and re-decode.
        }
        const leaves: TileCapability[] = [];
        for (const leafPath of compiled.value.leafPaths) {
            const leaf = this.dwindleTileAtPath(scope, leafPath.path);
            if (leaf === null) {
                return false;
            }
            leaves.push(leaf);
        }
        if (leaves.length !== population.length) {
            return false;
        }
        for (let index = 0; index < population.length; index += 1) {
            const window = population[index];
            const leaf = leaves[index];
            if (window === undefined || leaf === undefined) {
                return false;
            }
            let assigned = false;
            try {
                assigned = assignWindowToTile(window, leaf);
            } catch (error) {
                void error;
                return false;
            }
            if (!assigned) {
                return false;
            }
        }
        return true;
    }

    private dropPendingRebuild(scope: CurrentScope, pending: PendingRebuild): void {
        const byDesktop = this.pendingRebuilds.get(scope.output);
        if (byDesktop?.get(scope.desktop.id) === pending) {
            byDesktop.delete(scope.desktop.id);
            if (byDesktop.size === 0) {
                this.pendingRebuilds.delete(scope.output);
            }
            if (pending.dragFinalSnapshot) {
                const finalTopology = this.topologyForScope(scope);
                if (finalTopology !== null) {
                    this.dragSnapshotFinal(finalTopology);
                }
            }
        }
    }

    private recordDetached(window: WindowCapability): void {
        if (this.detachedWindows.size >= MAX_SEQUENTIAL_LENGTH) {
            const stale = this.detachedWindows.values().next().value;
            if (stale !== undefined) {
                this.detachedWindows.delete(stale);
            }
        }
        this.detachedWindows.add(window);
    }

    // Re-establish the dwindle invariant for an owned scope after a managed
    // count change: when the current tree no longer realizes the dwindle
    // blueprint for the current population, start a full reconstruction. A
    // scope with no owned population or an authoritative valid overlay is
    // untouched. The scope root is decoded exactly once per check and shared by
    // the occupancy-bijection predicate and the canonical-shape predicate.
    private dwindleEnsureInvariant(scope: CurrentScope): void {
        if (!this.isOwned(scope) || this.isInert(scope)) {
            return;
        }
        if (this.readSelectedOverlay(scope) !== null) {
            return;
        }
        const population = this.ownedPopulation(scope);
        if (population.length === 0) {
            return;
        }
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root) || !dwindleBijectionTreeMatches(scope, root, population)) {
            this.diagnostic("ownership-invariant:bijection-failed");
            this.startReconstruction(scope);
            return;
        }
        if (!this.dwindleShapeMatches(root, population)) {
            this.diagnostic("ownership-accepted:non-canonical:bijection-intact");
        }
    }

    // Canonical dwindle-shape predicate for the already-resolved scope root:
    // whether the tree realizes the ratio-free dwindle blueprint for the
    // population count. A population of one is realized by exactly one usable
    // leaf (a non-layout tile or a zero-child layout root); higher counts
    // require the exact dwindle chain with alternating orientation. Only the
    // shape is checked here; occupancy is the separate bijection predicate. The
    // root is never re-read.
    private dwindleShapeMatches(root: CustomTileCapability, population: readonly WindowCapability[]): boolean {
        const count = population.length;
        if (count === 1) {
            const leaves = decodeUsableLeaves(root);
            return leaves !== null && leaves.length === 1;
        }
        const blueprint = buildDwindleBlueprint(count);
        if (!blueprint.ok) {
            return false;
        }
        return dwindleNodeMatches(root, blueprint.value, 0);
    }

    // The deepest right-spine non-layout custom tile under the scope root (the
    // dwindle insertion point) with its depth. The dwindle chain recurses into
    // the last decoded child of every layout, so the insertion point is that
    // spine's terminal leaf. Freshly decoded each call; no handle is retained
    // across structural calls.
    private deepestLeaf(
        scope: CurrentScope,
    ): { readonly tile: CustomTileCapability; readonly depth: number } | null {
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root)) {
            return null;
        }
        // A tree with exactly one usable leaf is functionally dwindle(1)
        // regardless of the root wrapper: a one-child layout is promoted on
        // KWin and a zero-child layout root is itself the sole usable leaf.
        // Its insertion point is the whole scope at the root: splitting the
        // root horizontally grows dwindle(1) into dwindle(2) with the previous
        // occupant in one child.
        const usable = decodeUsableLeaves(root);
        if (usable === null) {
            return null;
        }
        if (usable.length === 1) {
            return { tile: root, depth: 0 };
        }
        const walk = (tile: CustomTileCapability, depth: number): { readonly tile: CustomTileCapability; readonly depth: number } | null => {
            if (tile.isLayout) {
                const children = decodeSequential(tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
                if (!children.ok || children.value.length === 0) {
                    return null;
                }
                const last = children.value[children.value.length - 1];
                if (last === undefined) {
                    return null;
                }
                return walk(last, depth + 1);
            }
            return { tile, depth };
        };
        return walk(root, 0);
    }

    // Dispatch an eligible added window to the owned-scope dwindle path or the
    // generic overlay/automatic-placement path. A not-yet-owned, not-inert
    // scope is adopted first: the window's scope is the current desktop of its
    // output, so this re-establishes ownership when the current desktop had no
    // window at the earlier `currentDesktopChanged` notification and was left
    // unmanaged. Adoption goes through `ensureManaged` (dwindle match or the
    // two-phase reconstruction), never a direct remove or split.
    private placeEligibleAdded(window: WindowCapability, scope: CurrentScope): void {
        if (!this.isOwned(scope) && !this.isInert(scope)) {
            this.ensureManaged(scope);
        }
        if (this.isOwned(scope)) {
            this.dwindleAdd(window, scope);
        } else {
            this.refillOrPlaceAutomatically(window, scope);
        }
    }

    // Owned-scope add: a valid selected overlay wins and its reflow (with the
    // established generic fallback) handles the window. Without an overlay the
    // window is placed into a retained empty leaf through the same guarded
    // automatic placement, and only when no empty leaf exists does a single
    // splits-only dwindle insertion split the deepest leaf. No removal is ever
    // part of an add dispatch.
    private dwindleAdd(window: WindowCapability, scope: CurrentScope): void {
        const outcome = this.runReflow(scope, window);
        if (outcome.kind !== "no-selection" && outcome.kind !== "no-capacity") {
            return;
        }
        if (outcome.kind === "no-capacity") {
            this.placeAutomatically(window, scope);
            return;
        }
        if (window.tile !== null) {
            return;
        }
        if (this.placeAutomatically(window, scope).kind === "managed") {
            return;
        }
        this.dwindleInsert(window, scope);
        this.dwindleEnsureInvariant(scope);
    }

    // One dwindle insertion: split the deepest leaf with depth-derived
    // orientation, keep its sole eligible occupant on the first child, and
    // assign the incoming window to the second child. The split is the only
    // structural call; its result is freshly decoded before any assignment.
    // A structural or decode failure marks the scope inert; a strict
    // geometry-order rejection is a capacity failure that leaves the scope
    // retryable.
    private dwindleInsert(window: WindowCapability, scope: CurrentScope): void {
        if (this.pendingRebuilds.get(scope.output)?.get(scope.desktop.id) !== undefined) {
            // A reconstruction is already pending for this scope: leave the
            // incoming window floating and let the pending rebuild re-resolve
            // the fresh population (which includes it) on its next dispatch.
            // Never mutate topology or damage the scope mid-reconstruction.
            return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            this.markInert(scope, "insert-topology-failed");
            return;
        }
        if (window.tile !== null) {
            return;
        }
        const deepest = this.deepestLeaf(scope);
        if (deepest === null) {
            this.markInert(scope, "insert-deepest-leaf-failed");
            return;
        }
        // The occupant list of the insertion leaf. When the insertion tile is
        // the layout root of a functionally single-leaf tree, the occupant
        // lives in the tree's only non-layout leaf, or in the root itself when
        // the root is a zero-child layout (the sole usable leaf).
        const insertion = this.insertionLeafWindows(scope, topology, deepest);
        if (insertion === null) {
            this.markInert(scope, "insert-leaf-resolution-failed");
            return;
        }
        const occupants = insertion.windows.filter(
            (value) => windowInScope(value, scope) && value.tile === insertion.tile,
        );
        // A scope reduced to N=0 keeps an empty zero-child layout root as its
        // sole usable leaf (deepestLeaf and insertionLeafWindows resolve it
        // directly). The first eligible incoming window becomes the root's
        // occupant through one guarded compatibility assignment, and never a
        // split. A fresh decoded invariant check after the write accepts either
        // live realization of the singleton (the window directly on the
        // zero-child root, or a one-child layout root with the window in its
        // sole leaf), matching the count-one dwindle match; any other outcome
        // marks the scope inert.
        if (insertion.windows.length === 0 && insertion.tile.isLayout) {
            let assigned = false;
            try {
                assigned = assignWindowToTile(window, insertion.tile);
            } catch (error) {
                void error;
            }
            if (!assigned || !this.dwindleMatches(scope, this.ownedPopulation(scope))) {
                this.markInert(scope, "occupied-root-assign-failed");
                return;
            }
            this.diagnostic("ownership-add-occupied-root");
            return;
        }
        if (occupants.length !== 1) {
            this.markInert(scope, "insert-occupant-count-mismatch");
            return;
        }
        const occupant = occupants[0];
        if (occupant === undefined) {
            this.markInert(scope, "insert-occupant-missing");
            return;
        }
        const orientation: Orientation = deepest.depth % 2 === 0 ? "horizontal" : "vertical";
        let split: unknown;
        try {
            split = splitCustomTile(deepest.tile, layoutDirectionFor(orientation));
        } catch (error) {
            void error;
            this.markInert(scope, "insert-split-threw");
            return;
        }
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (!decoded.ok || decoded.value.length !== 2) {
            this.markInert(scope, "insert-split-decode-failed");
            return;
        }
        this.decodedBoundary("split-result");
        const axis = orientation === "horizontal" ? "x" : "y";
        const children = orderedChildren(decoded.value, axis);
        if (children === null) {
            // KWin minimum tile geometry can yield an empty split child, so a
            // strict geometry-order rejection is a capacity failure, not a
            // damaged tree. Leave the impossible incoming insertion unmanaged
            // and keep the scope retryable on a later lifecycle event instead
            // of making it session-inert.
            this.diagnostic("ownership-add-failed:no-child-geometry");
            return;
        }
        let occupantAssigned = false;
        let incomingAssigned = false;
        try {
            occupantAssigned = assignWindowToTile(occupant, children[0]);
            incomingAssigned = occupantAssigned && assignWindowToTile(window, children[1]);
        } catch (error) {
            void error;
        }
        if (!occupantAssigned || !incomingAssigned) {
            this.diagnostic("ownership-add-failed:assignment");
            return;
        }
        this.diagnostic("ownership-add-split");
    }

    // The decoded occupant list of the dwindle insertion leaf for a freshly
    // resolved deepest leaf, with the leaf tile the occupants belong to. A
    // non-layout deepest leaf resolves through the operation topology; a
    // layout root with a single non-layout child falls back to that sole
    // leaf; a zero-child layout root is itself the sole usable leaf and its
    // own window list carries the occupant. Null on a damaged tree that
    // cannot resolve an insertion leaf.
    private insertionLeafWindows(
        scope: CurrentScope,
        topology: readonly OperationLeaf[],
        deepest: { readonly tile: CustomTileCapability; readonly depth: number },
    ): { readonly tile: TileCapability; readonly windows: readonly WindowCapability[] } | null {
        const operationLeaf = operationLeafForTile(topology, deepest.tile);
        if (operationLeaf !== null) {
            return { tile: operationLeaf.decoded.tile, windows: operationLeaf.windows };
        }
        const leaves = topology.filter((entry) => !entry.leaf.isLayout);
        const sole = leaves[0];
        if (leaves.length === 1 && sole !== undefined) {
            return { tile: sole.decoded.tile, windows: sole.windows };
        }
        if (!deepest.tile.isLayout) {
            return null;
        }
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (root !== deepest.tile) {
            return null;
        }
        const decoded = decodeSequential(deepest.tile.windows, isWindow, MAX_SEQUENTIAL_LENGTH);
        return decoded.ok ? { tile: deepest.tile, windows: decoded.value } : null;
    }

    // Owned-scope removal: after the established overlay reflow, a provably
    // freed leaf of an owned scope collapses with exactly one guarded remove
    // and a fresh whole-root decode. Detached windows (`window.tile === null`),
    // a leaf that still holds another eligible window, and the root itself are
    // all excluded, so no dispatch that removes ever also splits.
    //
    // Live KWin 6.7.3 delivers `windowRemoved` while the removed window is
    // still listed in its former leaf's `windows` array (unit-19c), so the
    // leaf is not yet provably freed at the notification. A removal whose
    // leaf still lists the window is deferred to one one-shot event-loop
    // yield; its settle callback re-resolves the scope root and fresh-decodes
    // before any structural call, so the collapse runs only once KWin has
    // evacuated the leaf.
    private dwindleRemove(window: WindowCapability, scope: CurrentScope): void {
        if (this.readSelectedOverlay(scope) !== null) {
            return;
        }
        if (window.tile === null || !isTile(window.tile)) {
            return;
        }
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isTile(root) || window.tile === root) {
            return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            this.markInert(scope, "remove-topology-failed");
            return;
        }
        const leaf = operationLeafForTile(topology, window.tile);
        if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
            return;
        }
        if (windowIndex(leaf.windows, window) >= 0) {
            // KWin still lists the removed window here. Defer the collapse to
            // a later event-loop turn so the leaf evacuation settles first.
            this.deferRemovalCollapse(window, scope, leaf.decoded.tile);
            return;
        }
        if (leaf.windows.some((value) => value !== window && windowInScope(value, scope))) {
            return;
        }
        this.collapseFreedLeaf(scope, topology, leaf.decoded.tile);
    }

    // Arm exactly one one-shot event-loop yield that settles the deferred
    // removal on a later event-loop turn. The callback re-validates the scope
    // and leaf fresh, so it is inert when the scope stopped being owned, a
    // valid overlay appeared, or the leaf was already collapsed elsewhere. It
    // never re-arms itself, so a removal that never settles leaves the scope
    // intact instead of retrying forever.
    private deferRemovalCollapse(
        window: WindowCapability,
        scope: CurrentScope,
        leafTile: TileCapability,
        afterDragSnapshot = false,
        reflowLeaves?: ReflowLeaves,
    ): void {
        let armed = false;
        try {
            armed = this.environment.yieldOnce(() => {
                this.settleRemovalCollapse(window, scope, leafTile, afterDragSnapshot, reflowLeaves);
            });
        } catch (error) {
            void error;
        }
        if (!armed) {
            this.markInert(scope, "removal-yield-arm-failed");
            return;
        }
        this.diagnostic("ownership-remove-deferred");
    }

    // Deferred removal collapse body. Runs on a later event-loop turn, after
    // KWin has evacuated the removed window from its former leaf. Everything
    // is re-validated and re-resolved fresh: the captured leaf handle is used
    // only to identify the leaf by object identity inside a fresh whole-root
    // decode, never to touch stale children. A leaf that still lists the
    // window, a leaf that holds another eligible occupant, or a leaf that is
    // gone from the fresh tree are all left untouched.
    private settleRemovalCollapse(
        window: WindowCapability,
        scope: CurrentScope,
        leafTile: TileCapability,
        afterDragSnapshot: boolean,
        reflowLeaves?: ReflowLeaves,
    ): void {
        if (this.isInert(scope) || !this.isOwned(scope)) {
            return;
        }
        if (this.readSelectedOverlay(scope) !== null) {
            return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            this.markInert(scope, "settle-topology-failed");
            return;
        }
        const leaf = operationLeafForTile(topology, leafTile);
        if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
            if (afterDragSnapshot) {
                this.dragSnapshotAfter(topology);
            }
            return;
        }
        if (windowIndex(leaf.windows, window) >= 0) {
            if (afterDragSnapshot) {
                this.dragSnapshotAfter(topology);
            }
            return;
        }
        if (leaf.windows.some((value) => value !== window && windowInScope(value, scope))) {
            if (afterDragSnapshot) {
                this.dragSnapshotAfter(topology);
            }
            return;
        }
        const after = this.collapseFreedLeaf(scope, topology, leaf.decoded.tile);
        if (afterDragSnapshot && after !== null) {
            // Normalize the two reflow leaves to equal 50/50 relative geometry
            // after the settled origin collapse, before the final snapshot so
            // the reported ratios are the ones the user sees.
            const finalTopology = this.normalizeReflowLeaves(scope, reflowLeaves, after);
            this.dragSnapshotAfter(finalTopology);
            // The collapse may have queued a full reconstruction (the freed
            // leaf's removal left the tree non-dwindle). Its settle then emits
            // one drag-snapshot-final of the rebuilt tree, after the after
            // snapshot above.
            const pending = this.pendingRebuilds.get(scope.output)?.get(scope.desktop.id);
            if (pending !== undefined) {
                pending.dragFinalSnapshot = true;
            }
        }
    }

    // The OperationLeaf holding a window in a fresh topology, resolved from the
    // window's current `tile` association. The window is a stable identity
    // carried across a yield; only its live tile read is used, so no stale tile
    // wrapper is ever retained.
    private leafForWindow(
        topology: readonly OperationLeaf[],
        window: WindowCapability,
    ): OperationLeaf | null {
        if (window.tile === null || !isTile(window.tile)) {
            return null;
        }
        return operationLeafForTile(topology, window.tile);
    }

    // Equalize the two reflow leaves created by a drop split to 50/50 relative
    // geometry, after the settled origin collapse. Both leaves are re-resolved
    // from the fresh post-collapse topology by their window occupants; when they
    // are current siblings under a common layout parent that they tile along the
    // parent's split axis, one guarded relativeGeometry write moves only the
    // shared edge to the midpoint (the documented source setter adjusts the
    // sibling's shared edge; source-derived, not live-proven here). A fresh
    // decode then proves the two leaves are equal within the documented
    // tolerance before `drag-reflow-normalized` is claimed. Every unsafe shape
    // emits a one-shot `drag-reflow-normalize-skipped:<reason>` and leaves the
    // topology untouched; a write or post-decode failure emits
    // `drag-reflow-normalize-failed:<reason>` and preserves the existing safe
    // behavior. No remove, split, timer, or other structural call runs here.
    private normalizeReflowLeaves(
        scope: CurrentScope,
        reflowLeaves: ReflowLeaves | undefined,
        topology: readonly OperationLeaf[],
    ): readonly OperationLeaf[] {
        if (reflowLeaves === undefined) {
            return topology;
        }
        const draggedLeaf = this.leafForWindow(topology, reflowLeaves.dragged);
        const occupantLeaf = this.leafForWindow(topology, reflowLeaves.occupant);
        if (
            draggedLeaf === null ||
            occupantLeaf === null ||
            draggedLeaf.decoded.tile === occupantLeaf.decoded.tile ||
            draggedLeaf.leaf.isLayout ||
            occupantLeaf.leaf.isLayout
        ) {
            this.diagnostic("drag-reflow-normalize-skipped:leaf-resolution");
            return topology;
        }
        const parent = draggedLeaf.decoded.tile.parent;
        if (parent === null || !isTile(parent) || !isCustomTile(parent) || !parent.isLayout) {
            this.diagnostic("drag-reflow-normalize-skipped:no-layout-parent");
            return topology;
        }
        if (occupantLeaf.decoded.tile.parent !== parent) {
            this.diagnostic("drag-reflow-normalize-skipped:not-siblings");
            return topology;
        }
        const axis: SplitAxis | null =
            parent.layoutDirection === HORIZONTAL_LAYOUT_DIRECTION
                ? "x"
                : parent.layoutDirection === VERTICAL_LAYOUT_DIRECTION
                    ? "y"
                    : null;
        if (axis === null) {
            this.diagnostic("drag-reflow-normalize-skipped:floating-parent");
            return topology;
        }
        const draggedGeometry = draggedLeaf.decoded.tile.relativeGeometry;
        const occupantGeometry = occupantLeaf.decoded.tile.relativeGeometry;
        const plan = planEqualSplit(parent.relativeGeometry, draggedGeometry, occupantGeometry, axis);
        if (plan === null) {
            this.diagnostic("drag-reflow-normalize-skipped:geometry-incompatible");
            return topology;
        }
        const draggedNear = axis === "x" ? draggedGeometry.x : draggedGeometry.y;
        const occupantNear = axis === "x" ? occupantGeometry.x : occupantGeometry.y;
        const firstTile = draggedNear <= occupantNear ? draggedLeaf.decoded.tile : occupantLeaf.decoded.tile;
        const written = setTileRelativeGeometry(firstTile, plan.first);
        if (!written) {
            this.diagnostic("drag-reflow-normalize-failed:write");
            return topology;
        }
        const fresh = this.topologyForScope(scope);
        if (fresh === null) {
            this.diagnostic("drag-reflow-normalize-failed:post-decode");
            return topology;
        }
        const freshDragged = this.leafForWindow(fresh, reflowLeaves.dragged);
        const freshOccupant = this.leafForWindow(fresh, reflowLeaves.occupant);
        if (
            freshDragged === null ||
            freshOccupant === null ||
            !equalAlongAxis(freshDragged.decoded.tile.relativeGeometry, freshOccupant.decoded.tile.relativeGeometry, axis)
        ) {
            this.diagnostic("drag-reflow-normalize-failed:mismatch");
            return fresh;
        }
        this.diagnostic("drag-reflow-normalized");
        return fresh;
    }

    // Exactly one guarded `CustomTile.remove()` of a provably-freed decoded
    // leaf, a fresh whole-root decode immediately afterwards, and a strict
    // one-fewer-leaf postcondition. The invariant check that follows may start
    // or re-arm a deferred reconstruction, but never a split in this dispatch.
    private collapseFreedLeaf(
        scope: CurrentScope,
        topology: readonly OperationLeaf[],
        leafTile: CustomTileCapability,
    ): readonly OperationLeaf[] | null {
        let removed = false;
        try {
            removed = removeCustomTile(leafTile);
        } catch (error) {
            void error;
        }
        if (!removed) {
            this.markInert(scope, "leaf-remove-failed");
            return null;
        }
        const after = this.topologyForScope(scope);
        if (after === null || after.length !== topology.length - 1) {
            this.markInert(scope, "leaf-collapse-verify-failed");
            return null;
        }
        this.diagnostic("ownership-remove-collapsed");
        // A changed managed count may leave the tree non-dwindle (for example
        // removing the first chain window's leaf leaves a single-child root);
        // the invariant check starts a reconstruction in this same removals-only
        // dispatch and defers the split reconstruction.
        this.dwindleEnsureInvariant(scope);
        return after;
    }

    private dwindleMaybeRemove(window: WindowCapability): void {
        const scope = this.scopeForWindow(window);
        if (scope === null || !this.isOwned(scope)) {
            return;
        }
        this.dwindleRemove(window, scope);
    }
}
