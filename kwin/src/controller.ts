import {
    FeatureGate,
    MAX_SEQUENTIAL_LENGTH,
    TransientState,
    assignWindowToTile,
    decodeSequential,
    detachWindowFromTile,
    hasWindowInteractionSignals,
    hasWindowScopeSignals,
    isCustomTile,
    isOutput,
    isPoint,
    isTile,
    isVirtualDesktop,
    isWindow,
    manageTile,
    sameScope,
    splitCustomTile,
    type CustomTileCapability,
    type OutputCapability,
    type RectCapability,
    type TileCapability,
    type VirtualDesktopCapability,
    type WindowCapability,
    type WindowInteractionSignals,
    type WindowScopeSignals,
} from "./boundary";
import { customTileSplitSeam } from "./custom-tile-split";
import { executeBlueprintInstructions } from "./layout-executor";
import {
    findNeighborLeaf,
    pickTargetLeaf,
    planAutomaticPlacement,
    planDragPlacement,
    planKeyboardInsertion,
    type Leaf,
    type Direction,
    type Scope,
    type WindowRef,
} from "./logic";
import { buildPreset, type PresetKind } from "./preset-catalog";

const MAX_TILES = MAX_SEQUENTIAL_LENGTH;
const HORIZONTAL_LAYOUT_DIRECTION = 1;
const VERTICAL_LAYOUT_DIRECTION = 2;
const DIAGNOSTIC_PREFIX = "plasma-auto-tiler:";
// A newly-mapped window's `desktops` value can still be settling at the
// exact `windowAdded` instant (unit-05/attempt-16 live evidence). One short,
// bounded re-evaluation gives it a chance to settle before being treated as
// permanently out of scope.
const DESKTOP_SCOPE_REEVALUATION_DELAY_MS = 50;

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
        window: WindowInteractionSignals,
        started: () => void,
        finished: () => void,
        invalidated: () => void,
    ) => () => void;
    readonly onPendingTargetChanged: (window: WindowScopeSignals, handler: () => void) => () => void;
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
    readonly disconnect: () => void;
}

interface ActiveDrag {
    readonly scope: CurrentScope;
    readonly window: WindowCapability;
    readonly originTile: CustomTileCapability;
    readonly originGeometry: RectCapability;
}

// One guarded `window.tile` assignment produced by reflow planning. `source`
// is the occupant's current tile at plan time (null only for an untiled
// addition candidate); `target` is the exact ordinal overlay leaf.
interface ReflowWrite {
    readonly window: WindowCapability;
    readonly source: TileCapability | null;
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

function splitDirection(direction: Direction): number {
    return direction === "left" || direction === "right"
        ? HORIZONTAL_LAYOUT_DIRECTION
        : VERTICAL_LAYOUT_DIRECTION;
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
            this.attachExistingInteractiveWindows();
            const insertionRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-insert-right",
                "Insert next window right of focused leaf",
                "Meta+Alt+Right",
                () => this.armKeyboardInsertion(),
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
            const detachRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-detach",
                "Detach window from tile",
                "Meta+Shift+Space",
                () => this.detachActiveWindow(),
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
            if (
                !insertionRegistered ||
                !leftRegistered ||
                !downRegistered ||
                !upRegistered ||
                !rightRegistered ||
                !moveLeftRegistered ||
                !moveDownRegistered ||
                !moveUpRegistered ||
                !moveRightRegistered ||
                !detachRegistered ||
                !columnsRegistered ||
                !rowsRegistered ||
                !gridRegistered
            ) {
                this.gate.disable("shortcut-registration-failed", (reason) => this.disabled(reason));
                return;
            }
            this.diagnostic("shortcut-registered");
            this.diagnostic("startup-handlers-ready");
        }, (reason) => this.disabled(reason));
    }

    armKeyboardInsertion(): void {
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
            if (targetOccupant === null || !hasWindowScopeSignals(targetOccupant.window)) {
                this.diagnostic("keyboard-rejected:target-occupancy-validity");
                return;
            }
            const disconnect = this.environment.onPendingTargetChanged(targetOccupant.window, () => this.clearPending());
            this.pending.set({ scope, sourceWindow: active, targetWindow: targetOccupant.window, targetTile: active.tile, disconnect });
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
                        entry.windows.length === 0 &&
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
            if (target === null || target.leaf.isLayout || target.windows.length !== 0) {
                this.diagnostic("move-rejected:target-occupancy-validity");
                return;
            }
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
        }, (reason) => this.disabled(reason));
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
            this.placeAutomatically(window, scope);
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
            this.attachExistingInteractiveWindows();
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
                this.reflowAfterRemoval(window);
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
                this.refillOrPlaceAutomatically(window, scope);
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
            this.refillOrPlaceAutomatically(window, freshScope);
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

    private attachExistingInteractiveWindows(): void {
        const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return;
        }
        this.decodedBoundary("workspace-window-list");
        for (const window of windows.value) {
            this.attachInteractiveWindow(window);
        }
    }

    private attachInteractiveWindow(window: unknown): void {
        if (this.interactiveWindows.size >= MAX_SEQUENTIAL_LENGTH || !isWindow(window)) {
            return;
        }
        const scope = this.scopeForWindow(window);
        if (
            scope === null ||
            !windowInScope(window, scope) ||
            !hasWindowInteractionSignals(window) ||
            this.interactiveWindows.has(window)
        ) {
            return;
        }
        const disconnect = this.environment.watchInteractiveWindow(
            window,
            () => this.handleInteractiveStarted(window),
            () => this.handleInteractiveFinished(window),
            () => this.handleInteractiveInvalidated(window),
        );
        this.interactiveWindows.set(window, disconnect);
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
        const scope = this.scopeForWindow(drag.window);
        if (
            scope === null ||
            !sameScope(scope.scope, drag.scope.scope) ||
            !windowInScope(drag.window, scope) ||
            !isCustomTile(drag.originTile)
        ) {
            this.restoreOrigin(drag);
            return;
        }
        if (drag.window.tile === drag.originTile && sameGeometry(drag.window.frameGeometry, drag.originGeometry)) {
            this.diagnostic("drag-unchanged");
            return;
        }
        const cursor = this.environment.cursorPos();
        const topology = this.topologyForScope(scope);
        if (topology === null || !isPoint(cursor) || !positiveGeometry(drag.window.frameGeometry)) {
            this.restoreOrigin(drag);
            return;
        }
        const origin = operationLeafForTile(topology, drag.originTile);
        if (origin === null || origin.leaf.isLayout || windowIndex(origin.windows, drag.window) < 0) {
            this.restoreOrigin(drag);
            return;
        }
        const targetLeaf = pickTargetLeaf(topology.map((entry) => entry.leaf), cursor);
        if (targetLeaf === null) {
            this.restoreOrigin(drag);
            return;
        }
        let target: OperationLeaf | null = null;
        for (const entry of topology) {
            if (entry.leaf === targetLeaf) {
                target = entry;
                break;
            }
        }
        if (
            target === null ||
            target.windows.length !== 1 ||
            !isCustomTile(target.decoded.tile)
        ) {
            this.restoreOrigin(drag);
            return;
        }
        const targetWindow = target.windows[0];
        const targetRef = target.refs[0];
        if (targetWindow === undefined || targetRef === undefined || !windowInScope(targetWindow, scope)) {
            this.restoreOrigin(drag);
            return;
        }
        const draggedIndex = windowIndex(origin.windows, drag.window);
        const draggedRef = origin.refs[draggedIndex];
        if (draggedRef === undefined) {
            this.restoreOrigin(drag);
            return;
        }
        const plan = planDragPlacement({
            scope: scope.scope,
            originLeaf: origin.leaf,
            draggedWindow: draggedRef,
            targetLeaf: target.leaf,
            pointer: cursor,
            record: {
                scope: scope.scope,
                originLeafId: origin.leaf.id,
                windowId: draggedRef.id,
                geometry: drag.originGeometry,
            },
        });
        if (!plan.ok || plan.value.kind !== "drag-direction") {
            this.restoreOrigin(drag);
            return;
        }
        const direction = plan.value.direction;
        const split = splitCustomTile(target.decoded.tile, splitDirection(direction));
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (decoded.ok) {
            this.decodedBoundary("split-result");
        }
        const axis = direction === "left" || direction === "right" ? "x" : "y";
        const children = decoded.ok ? orderedChildren(decoded.value, axis) : null;
        if (children === null) {
            this.gate.disable("drag-split-result-invalid", (reason) => this.disabled(reason));
            return;
        }
        const first = children[0];
        const second = children[1];
        const selected = direction === "left" || direction === "up" ? first : second;
        const opposite = selected === first ? second : first;
        const targetManaged = manageTile(opposite, targetWindow);
        const draggedManaged = targetManaged && manageTile(selected, drag.window);
        if (!targetManaged || !draggedManaged) {
            this.gate.disable("drag-manage-failed", (reason) => this.disabled(reason));
            return;
        }
        this.diagnostic("drag-split-completed");
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
            focusedLeaf: target.leaf,
            focusedWindow: focused,
            incoming: { id: "incoming", normal: window.normalWindow, managed: window.managed },
            record: { scope: scope.scope, leafId: target.leaf.id, windowId: focused.id },
        });
        if (!plan.ok) {
            return;
        }
        const split = splitCustomTile(target.decoded.tile, HORIZONTAL_LAYOUT_DIRECTION);
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (!decoded.ok) {
            this.gate.disable("keyboard-split-result-invalid", (reason) => this.disabled(reason));
            return;
        }
        this.decodedBoundary("split-result");
        const children = orderedChildren(decoded.value, "x");
        if (children === null) {
            this.gate.disable("keyboard-split-child-selection-failed", (reason) => this.disabled(reason));
            return;
        }
        const left = children[0];
        const right = children[1];
        if (!manageTile(left, pending.targetWindow)) {
            return;
        }
        if (!manageTile(right, window)) {
            return;
        }
        this.diagnostic("keyboard-completed");
    }

    private placeAutomatically(window: WindowCapability, scope: CurrentScope): void {
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            return;
        }
        const plan = planAutomaticPlacement({
            scope: scope.scope,
            window: { id: "incoming", normal: window.normalWindow, managed: window.managed },
            leaves: topology.map((entry) => entry.leaf),
        });
        if (!plan.ok) {
            return;
        }
        for (const entry of topology) {
            if (entry.leaf === plan.value.leaf) {
                if (manageTile(entry.decoded.tile, window)) {
                    this.diagnostic("automatic-placement-managed");
                }
                return;
            }
        }
    }
}
