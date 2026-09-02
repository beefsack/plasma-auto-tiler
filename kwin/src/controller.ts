import {
    FeatureGate,
    MAX_SEQUENTIAL_LENGTH,
    TransientState,
    assignWindowToTile,
    decodeSequential,
    detachWindowFromTile,
    isCustomTile,
    isNativelyMaximized,
    isOutput,
    isRect,
    isTile,
    isVirtualDesktop,
    isWindow,
    manageTile,
    removeCustomTile,
    setTileRelativeGeometry,
    sameScope,
    splitCustomTile,
    unmanageTile,
    writeWindowDesktops,
    writeWindowFrameGeometry,
    type CustomTileCapability,
    type OutputCapability,
    type RectCapability,
    type StructuralMutationReporter,
    type TileCapability,
    type VirtualDesktopCapability,
    type WindowCapability,
} from "./boundary";
import { customTileSplitSeam } from "./custom-tile-split";
import { type Orientation } from "./layout-blueprint";
import { executeBlueprintInstructions } from "./layout-executor";
import { type BlueprintPath } from "./layout-instructions";
import {
    dragGeometryBail,
    layoutDirectionFor,
    parentHasSameSplitAxis,
    positiveGeometry,
    sameGeometry,
    splitDirection,
} from "./controller-geometry";
import {
    collectPresetLeaves,
    decodeLeaves,
    decodeTileTree,
    decodeUsableLeaves,
    dwindleBijectionTreeMatches,
    dwindleLeafDepths,
    makeOperationLeaves,
    ordinalClass,
    operationLeafForTile,
    presetNodeMatches,
    targetOccupantForActive,
    windowInScope,
    windowIndex,
    type OperationLeaf,
} from "./controller-topology";
import {
    desktopScopeCheck,
    ensureTrailingEmptyDesktop,
    orderedDesktops,
    SessionOutputKeys,
    snapshotCaption,
} from "./controller-workspace-state";
export {
    ensureTrailingEmptyDesktop,
    SessionOutputKeys,
    outputTuple,
} from "./controller-workspace-state";
export type {
    TrailingEmptyDomainRequest,
    TrailingEmptyDomainResult,
} from "./controller-workspace-state";
import {
    compareLeaves,
    equalAlongAxis,
    pickDropLeaf,
    planAutomaticPlacement,
    planEqualSplit,
    planGeometryDrop,
    rectCenter,
    type Direction,
    type Scope,
    type SplitAxis,
} from "./logic";
import { buildPreset, presetBlueprint, type PresetKind } from "./preset-catalog";
export * from "./controller-config";
import {
    DEFAULT_AUTOMATIC_SPLIT_TARGET,
    AUTOMATIC_SPLIT_TARGET_CONFIG_KEY,
    DEFAULT_DROP_OUTLINE_PREVIEW,
    DEFAULT_TILING_ALGORITHM,
    DEFAULT_WORKSPACE_MODE,
    DROP_OUTLINE_PREVIEW_CONFIG_KEY,
    TILING_ALGORITHM_CONFIG_KEY,
    WORKSPACE_MODE_CONFIG_KEY,
    parseAutomaticSplitTarget,
    parseDropOutlinePreview,
    parseTilingAlgorithm,
    parseWorkspaceMode,
} from "./controller-config";
import {
    selectAutomaticSplitTarget,
    type AutomaticSplitCandidate,
    type AutomaticSplitSelectionContext,
    type AutomaticSplitTarget,
    type TilingAlgorithm,
    type WorkspaceMode,
} from "./controller-config";
import {
    collapseToRootLeaf,
    type ResetSeam,
    type ResetSnapshot,
    type ResetTile,
} from "./topology-reset";
import {
    createInputActions,
    type InputActions,
    type PendingKeyboard as InputPendingKeyboard,
} from "./controller-input-actions";
import {
    createCosmicDirectionalMovementStrategy,
    type DirectionalMovementStrategy,
} from "./directional-movement-strategy";
import { createWindowActions, type WindowActions } from "./controller-window-actions";
import {
    createReflowObservers,
    type CurrentScope,
    type ReflowObservers,
    type SelectedOverlay,
} from "./controller-reflow-observers";
import {
    createInteractiveDragController,
    type InteractiveDragController,
} from "./controller-interactive-drag";
import {
    createLayoutDomain,
    type LayoutDomain,
    type ManagedScope as LayoutManagedScope,
    type PendingRebuild as LayoutPendingRebuild,
} from "./controller-layout-domain";
import {
    createWorkspaceDomain,
    type WorkspaceDomain,
} from "./controller-workspace-domain";
export type { CurrentScope, SelectedOverlay } from "./controller-reflow-observers";

const DIAGNOSTIC_PREFIX = "plasma-auto-tiler:";
// KWin tile minimumSize default is QSizeF(0.15, 0.15) in working-area-relative
// units (src/tiles/tile.h:179, pinned v6.7.3). A position-directed 50/50 drop
// split produces two equal halves; when either half falls below this floor KWin
// clamps the children and corrupts the geometry, so the split must be refused.
// Fixed direct resize step: each Meta+Ctrl+H/J/K/L press moves the nearest
// relevant ancestor split's shared edge by this fraction of the parent extent.
// src/scripting/workspace_wrapper.h ClientAreaOption ordering: PlacementArea=0,
// MovementArea=1, MaximizeArea=2, MaximizeFullArea=3, FullScreenArea=4,
// WorkArea=5, FullArea=6, ScreenArea=7. WorkArea is the per-output working area
// (screen minus panel struts), the reference extent of the tile minimum size.
const WORK_AREA_CLIENT_AREA_OPTION = 5;
// Default float geometry is 60% x 60% of the current output work area,
// centered within it (roadmap floating-windows default geometry).
const GROUP_OUTLINE_DURATION_MS = 700;
// Bounded re-drive budget per pending reconstruction phase. A lifecycle event
// while a reconstruction is pending re-arms that phase's one-shot yield so a
// single lost callDBus reply cannot strand a collapsed scope. A bound is still
// required: if every ListNames reply is lost, unlimited re-arms would leave a
// collapsed awaiting-split scope retrying forever instead of reaching the
// session-local inert state.

// Session output identity and key allocation live in controller-workspace-state.ts.

type BoundaryKind = "workspace-window-list" | "tile-children" | "tile-occupancy" | "split-result";

type TopologyRejection = "root-lookup" | "topology-decode";

export interface ControllerEnvironment {
    readonly activeWindow: () => unknown;
    readonly setActiveWindow: (window: WindowCapability) => void;
    readonly currentDesktopForOutput: (output: OutputCapability) => unknown;
    readonly rootTile: (output: OutputCapability, desktop: VirtualDesktopCapability) => unknown;
    readonly windowList: () => unknown;
    readonly cursorPos: () => unknown;
    readonly clientArea: (option: number, output: OutputCapability, desktop: VirtualDesktopCapability) => unknown;
    readonly onWindowAdded: (handler: (window: unknown) => void) => void;
    readonly onWindowRemoved: (handler: (window: unknown) => void) => void;
    readonly onScreensChanged: (handler: () => void) => void;
    // The workspace `currentDesktopChanged(previous, current, output)` signal.
    // The handler carries all three arguments so the output is preserved across
    // the typed boundary (spec F); it is authoritative for which output switched.
    readonly onCurrentDesktopChanged: (
        handler: (previous: unknown, current: unknown, output: unknown) => void,
    ) => void;
    // Dynamic virtual-desktop surface. Every method may throw when the
    // underlying KWin surface is absent or rejects the call; the workspace
    // commands catch and log a specific failure without affecting startup.
    readonly desktops: () => unknown;
    readonly screens: () => unknown;
    // Read-only `workspace.activeScreen` (spec D common): the output that
    // currently has keyboard focus, used as the active output for keyboard
    // workspace navigation when no window is focused. May return null or throw
    // on surfaces that cannot expose the property.
    readonly activeScreen: () => unknown;
    readonly currentDesktop: () => unknown;
    readonly createDesktop: (position: number, name: string) => unknown;
    readonly removeDesktop: (desktop: VirtualDesktopCapability) => unknown;
    readonly setCurrentDesktop: (desktop: VirtualDesktopCapability) => void;
    // Per-output current-desktop write (documented KWin scripting API,
    // workspace `setCurrentDesktopForScreen(desktop, output)`). Independent per
    // output; used for workspace navigation/follow on the affected output.
    readonly setCurrentDesktopForScreen: (
        desktop: VirtualDesktopCapability,
        output: OutputCapability,
    ) => void;
    readonly onDesktopsChanged: (handler: () => void) => void;
    readonly watchInteractiveWindow: (
        window: WindowCapability,
        started: () => void,
        finished: () => void,
        stepped: (geometry: RectCapability) => void,
        moveResizedChanged: () => void,
        invalidated: () => void,
    ) => { readonly disconnect: () => void; readonly ok: number; readonly failed: number };
    // Feature-detected `fullScreenChanged` attachment. Mirrors the interactive
    // attach seam: a missing binding counts as failed and is logged, never a
    // startup failure.
    readonly watchFullscreen: (
        window: WindowCapability,
        changed: () => void,
    ) => { readonly disconnect: () => void; readonly ok: number; readonly failed: number };
    // Optional feature-detected `maximizedChanged` attachment used to observe a
    // real native unmaximize transition of a startup-native-maximized record.
    // Mirrors the fullscreen attach seam: a missing binding is skipped, never
    // a startup failure. Absent on surfaces that cannot expose the signal.
    readonly watchMaximize?: (
        window: WindowCapability,
        changed: () => void,
    ) => { readonly disconnect: () => void; readonly ok: number; readonly failed: number };
    readonly onPendingTargetChanged: (window: WindowCapability, handler: () => void) => () => void;
    // Geometry-only outline rectangle surface bound at kwin/src/entry.ts:227-230
    // to KWin workspace `showOutline(x, y, w, h)` / `hideOutline()` slots.
    // The drag destination preview lifecycle and group flash use this seam.
    readonly showOutline: (x: number, y: number, w: number, h: number) => void;
    readonly hideOutline: () => void;
    // Named one-shot event-loop yield used to defer dwindle reconstruction
    // between the removals-only collapse and the splits-only rebuild. Returns
    // whether the yield was armed: a false return means the caller must fail
    // closed rather than strand. The callback is guaranteed to fire at most
    // once per successful arm on a real later event-loop turn, never
    // synchronously, and holds no timer and relies on no signal.
    readonly yieldOnce: (callback: () => void) => boolean;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => () => void;
    readonly readConfig: (key: string, defaultValue: unknown) => unknown;
    readonly log: (message: string) => void;
    readonly onControllerCreated?: (controller: TileController) => void;
}

// These are private composition seams for the later source split. They expose
// operations on controller-owned state rather than the state collections or a
// controller-shaped context.
interface ScopeResolutionCapability {
    readonly scopeForWindow: (window: unknown) => CurrentScope | null;
    readonly topologyForScope: (
        scope: CurrentScope,
        onRejected?: (reason: TopologyRejection) => void,
    ) => readonly OperationLeaf[] | null;
}

interface StructuralMutationCapability {
    readonly report: StructuralMutationReporter;
    readonly flush: () => void;
}

interface PendingKeyboardState {
    readonly current: () => PendingKeyboard | undefined;
    readonly replace: (pending: PendingKeyboard) => void;
    readonly clear: () => void;
}

interface FloatingWindowState {
    readonly isFloating: (window: WindowCapability) => boolean;
    readonly floatingScope: (window: WindowCapability) => Scope | undefined;
    readonly markFloating: (window: WindowCapability, scope: Scope) => void;
    readonly clearFloating: (window: WindowCapability) => void;
    readonly isSticky: (window: WindowCapability) => boolean;
    readonly markSticky: (window: WindowCapability) => void;
    readonly clearSticky: (window: WindowCapability) => void;
    readonly isDetached: (window: WindowCapability) => boolean;
    readonly markDetached: (window: WindowCapability) => void;
    readonly clearDetached: (window: WindowCapability) => void;
}

interface WindowCoverState {
    readonly fullscreenRecord: (window: WindowCapability) => FullscreenRecord | undefined;
    readonly setFullscreenRecord: (window: WindowCapability, record: FullscreenRecord) => void;
    readonly clearFullscreenRecord: (window: WindowCapability) => void;
    readonly maximizeRecord: (window: WindowCapability) => MaximizeRecord | undefined;
    readonly setMaximizeRecord: (window: WindowCapability, record: MaximizeRecord) => void;
    readonly clearMaximizeRecord: (window: WindowCapability) => void;
}

interface PendingMoveState {
    readonly hasPendingMove: (window: WindowCapability) => boolean;
    readonly markPendingMove: (window: WindowCapability) => void;
    readonly clearPendingMove: (window: WindowCapability) => void;
}

interface WorkspaceModeState {
    readonly workspaceMode: () => WorkspaceMode;
}

interface DesktopChangeState {
    readonly currentDesktopChangeOutput: () => OutputCapability | null;
}

// Session-local managed-scope ownership record for automatic ratio-free
// dwindle. A scope becomes managed by the controller takeover on start or
// scope change and stays owned for the session unless it becomes inert: a
// failed or damaged scope is never retried in that session. No identity
// survives restart or hotplug.
export interface ManagedScope extends LayoutManagedScope {}

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

export interface PendingRebuild extends LayoutPendingRebuild {}

// A deferred script-owned trailing-empty creation request. A user Meta+Shift+0
// (move) or Meta+0 (focus/create) request that would have to create the
// trailing empty while a live drag, pending reconstruction, or unsettled move
// makes the desktop list unsafe to mutate is queued instead of acting, and is
// retried through the existing settle seams (drag finish, reconstruction drop,
// adoption, desktopsChanged). Every request is re-validated against current
// context before it runs so a stale request can never act after the context
// changed. Meta+0 shares this bounded drain: the whole focus/create invocation
// defers while a drag, reconstruction, or unsettled move is live, never acting
// or navigating mid-mutation.

// The resolved dwindle insertion split: the leaf to split, its depth in the
// current tree, and its sole eligible occupant. The split axis comes from the
// selected leaf's geometry at insertion time.
interface DwindleInsertionTarget {
    readonly tile: CustomTileCapability;
    readonly depth: number;
    readonly occupant: WindowCapability;
}

type PendingKeyboard = InputPendingKeyboard;

// Session-local fullscreen cover-and-restore record. A managed tiled window
// that enters fullscreen preserves its exact tile and scope (wasTiled true) and
// is restored to that slot on exit; a created/floating fullscreen window
// carries no preserved slot (wasTiled false) and exits through the normal
// newly-eligible management path. No record is retained across restarts.
interface FullscreenRecord {
    readonly scope: CurrentScope | null;
    readonly preservedTile: TileCapability | null;
    readonly wasTiled: boolean;
}

// Session-local tiled-maximize cover-and-restore record. Maximize writes the
// window's frame geometry to its workspace work area while keeping the exact
// tile assignment intact (geometry-cover seam): the scope and preserved tile
// are recorded so exit can restore the tile geometry through a fresh topology.
// The record is per window plus its owning desktop, never sticky, and no
// record survives restart. `kind` separates the two record classes that share
// this map: a controller-managed tiled cover (Meta+M, always tiled with a
// preserved slot, restored by the toggle) and a startup-native maximized
// record (a window found already natively maximized at startup, tiled or
// untiled, preserved unmanaged until a real native unmaximize).
interface MaximizeRecord {
    readonly scope: CurrentScope | null;
    readonly preservedTile: TileCapability | null;
    readonly kind: "cover" | "startup";
}

// The two windows occupying the two leaves a reflow split produced: the
// dragged window and the split target's original occupant. Retained only as
// stable window identity across the deferred origin-collapse yield; their
// tiles are re-resolved from a fresh topology, never retained as stale
// wrappers.
// Why a finish-only drop resolved no geometry target. `resolved` carries the
// winning OperationLeaf plus whether it is empty (direct-placement target) or
// occupied (split target); every other variant is a distinct bail branch whose
// center point (when resolvable) is the decisive live value. `pointSource`
// records whether that point came from the documented workspace cursor or the
// final frame center fallback.
// Outcome of a deterministic empty-leaf automatic placement. `managed` records
// the single guarded manage; every failure variant is a distinct reason for a
// decisive no-op diagnostic in the generic (non-owned) fallback path.
type AutomaticPlacementOutcome =
    | { readonly kind: "managed" }
    | { readonly kind: "topology-unavailable" }
    | { readonly kind: "no-empty-leaf" }
    | { readonly kind: "assignment-failed" };

// Fixed, privacy-safe error description for workspace-command failure logging.
// The controller's own boundary seams throw errors whose messages are authored
// here ("kwin-workspace-surface-missing:..."), so the message is safe to log
// and is the specific failure reason a live operator needs.
function describeWorkspaceFailure(error: unknown): string {
    if (error instanceof Error) {
        return error.message === "" ? error.name : error.message;
    }
    return String(error);
}

interface PresetOccupant {
    readonly window: WindowCapability;
    readonly originTile: TileCapability;
}

export class TileController {
    private readonly gate = new FeatureGate(() => this.structuralMutation.flush());
    private notifiedEnabled = true;
    private readonly pending = new TransientState<PendingKeyboard>();
    private groupOutlineIdentity: object | null = null;
    private structuralMutationPending = false;
    // Per-window fullscreen watch disconnects and enter/exit records. Both are
    // bounded like the other identity sets so they cannot grow without limit.
    private readonly fullscreenWatches = new Map<WindowCapability, () => void>();
    private readonly fullscreenWindows = new Map<WindowCapability, FullscreenRecord>();
    // Per-window tiled-maximize cover records. A maximized window keeps its
    // tile assignment and covers the work area; the record carries the owning
    // desktop scope. Bounded like the other identity sets.
    private readonly maximizedWindows = new Map<WindowCapability, MaximizeRecord>();
    // Per-window `maximizedChanged` watch disconnects for startup-native
    // maximized records, observed to clear the classification on a real native
    // unmaximize. Bounded like the other identity sets.
    private readonly maximizeWatches = new Map<WindowCapability, () => void>();
    private readonly decodedBoundaries = new Set<BoundaryKind>();
    private readonly onceDiagnostics = new Set<string>();
    private readonly managedScopes = new Map<OutputCapability, Map<string, LayoutManagedScope>>();
    private readonly pendingRebuilds = new Map<OutputCapability, Map<string, LayoutPendingRebuild>>();
    // Per-output/per-desktop session-local managed-scope ownership for
    // automatic ratio-free dwindle. A scope is managed only when it holds
    // owned windows; a failed or damaged scope is recorded inert for the
    // session and never retried.
    // Deferred dwindle reconstructions awaiting their one-shot event-loop
    // yields between the removals-only collapse and the splits-only rebuild.
    // Explicitly detached windows (the detach action writes `window.tile` to
    // null) are excluded from the owned population and the dwindle rebuild.
    // Bounded like the other session identity sets so it cannot grow without limit.
    private readonly detachedWindows = new Set<WindowCapability>();
    // Session-local floating state. A floating window left its tile through
    // `tile.unmanage(window)` with its vacated leaf retained; it is excluded
    // from automatic placement, bijection, drag, and reconstruction window-set
    // comparisons. `floatScopes` records the exact scope where each floating
    // window's preserved leaf lives so invariant checks can tolerate the
    // vacated leaves. Sticky windows are always also floating. Bounded like the
    // other identity sets.
    private readonly floatingWindows = new Set<WindowCapability>();
    private readonly floatScopes = new Map<WindowCapability, Scope>();
    // Session-local sticky state: pinned across all workspaces, floating only.
    // A strict subset of `floatingWindows`; sticky implies floating.
    private readonly stickyWindows = new Set<WindowCapability>();
    // Last floated geometry per window for the session, restored on re-float
    // and across sticky toggles and a fullscreen round trip.
    private readonly floatGeometries = new Map<WindowCapability, RectCapability>();
    // Session-only script-owned virtual desktops (by desktop id). A desktop the
    // controller appended via Meta+0 / Meta+Shift+0 is owned for this session
    // only; no identity survives restart and pre-existing desktops are never
    // owned or removed. Cleanup may only ever remove owned desktops.
    private readonly ownedDesktopIds = new Set<string>();
    // Cross-workspace tile moves awaiting their destination adoption yield.
    // Cleanup is deferred while any move is unsettled so a desktop is never
    // removed under a window that is still being re-placed.
    private readonly pendingMoves = new Set<WindowCapability>();
    // Re-entrancy guard for desktop reconciliation: createDesktop and
    // removeDesktop both re-fire desktopsChanged synchronously, and a
    // mid-mutation list (desktop created but not yet owned, or partially
    // removed) must never re-drive a second reconcile. Reconciliation is
    // idempotent, so the guard only prevents a nested re-entry, never skips
    // owed work.
    private reconcilingDesktops = false;
    // Deferred Meta+Shift+0 trailing-empty creation windows. Bounded like the
    // other controller queues.
    // Deferred Meta+0 trailing-empty focus/creation outputs, drained through the
    // same bounded settle queue as the Meta+Shift+0 intents (spec F).
    // Parsed `workspaceMode` configuration (spec D). Set from readConfig at
    // startup; invalid input falls back to the default with a diagnostic. The
    // mode dispatch is Unit 05; this field is the parsed seam every mode reads.
    private workspaceMode: WorkspaceMode = DEFAULT_WORKSPACE_MODE;
    // Parsed `tilingAlgorithm` configuration. Set from readConfig at startup;
    // invalid input falls back to the dwindle default with a diagnostic. The
    // automatic takeover below builds its shape and reconstruction from this
    // value; manual preset shortcuts keep their fixed presets.
    private tilingAlgorithm: TilingAlgorithm = DEFAULT_TILING_ALGORITHM;
    // Parsed `automaticSplitTarget` configuration. Set from readConfig at
    // startup; invalid input falls back to the dwindle default with a
    // diagnostic. Target selection is a later unit; this field is the parsed
    // seam the automatic split reads.
    private automaticSplitTarget: AutomaticSplitTarget = DEFAULT_AUTOMATIC_SPLIT_TARGET;
    // Parsed but intentionally unused until the drag destination outline unit.
    private dropOutlinePreview = DEFAULT_DROP_OUTLINE_PREVIEW;
    // Deterministic session output keys (spec E). Rebuilt from `workspace.screens`
    // at startup and on screensChanged; never persisted. A stale or unknown
    // output wrapper is reported once per session tuple.
    private readonly outputKeys = new SessionOutputKeys(() => {
        this.diagnostic("workspace-output-key-unavailable");
    });
    // The output argument of the most recent `currentDesktopChanged` event
    // (spec F), preserved through the typed boundary. Session-only; the Unit 05
    // per-output scope re-resolution consumes it.
    private recentDesktopChangeOutput: OutputCapability | null = null;
    // Per-output-local mode (spec D1, Unit 05): outputKey -> ordered local
    // desktop id list. Logical workspace n on output X resolves to the nth id of
    // X's list; a same logical number on output Y is a distinct global desktop.
    // Session-only, rebuilt idempotently from the live global list on every
    // reconciliation, never persisted (spec E session persistence). Empty for
    // every non-per-output-local mode.
    private readonly localWorkspaces = new Map<string, string[]>();
    // The session's primary output key (the first-seen output). Pre-existing
    // (non-script-owned) desktops resolve into this output's local list only
    // (the single-output degeneracy of spec D1); a later output never adopts a
    // pre-existing desktop merely because it is visible (spec E hotplug).
    private localSessionPrimary: string | undefined;
    // Global-unique mode (spec D2, Unit 06): outputKey -> the ordered subset of
    // global desktops assigned to that output, with `globalUniqueInverse` as its
    // desktop id -> outputKey inverse. An assignment is script state, not a KWin
    // desktop property (spec F); every logical global desktop is assigned
    // exactly once. Subset order is derived from `x11DesktopNumber` ascending
    // at use, never from storage order (spec D2). Session-only, rebuilt
    // idempotently on every reconciliation, never persisted. Empty for every
    // non-global-unique mode.
    private readonly globalUniqueAssigned = new Map<string, string[]>();
    private readonly globalUniqueInverse = new Map<string, string>();
    // The session's primary output key in global-unique mode: pre-existing
    // desktops (including user-created ones) assign into this output's subset
    // only, so a later output never adopts a pre-existing desktop merely because
    // it is visible (spec E hotplug).
    private globalUniquePrimary: string | undefined;
    // Shared mode (spec D3, Unit 07): one global ordered shared desktop id set.
    // Logical workspace n maps to the nth id; no output owns a desktop (spec F
    // shared state). Rebuilt idempotently from the live global list on every
    // reconcile and navigation (never creates), so a rename/reorder never
    // changes it (spec E) and hotplug/disconnect leaves it intact. Session-only,
    // never persisted; empty for every non-shared mode.
    private readonly sharedWorkspaces: string[] = [];
    private groupOutlineGeometry: RectCapability | null = null;

    private readonly structuralMutation: StructuralMutationCapability;
    private readonly scopeResolution: ScopeResolutionCapability;
    private readonly pendingKeyboardState: PendingKeyboardState;
    private readonly floatingWindowState: FloatingWindowState;
    private readonly windowCoverState: WindowCoverState;
    private readonly interactiveDrag: InteractiveDragController;
    private readonly reflowObservers: ReflowObservers;
    private readonly pendingMoveState: PendingMoveState;
    private readonly workspaceModeState: WorkspaceModeState;
    private readonly desktopChangeState: DesktopChangeState;
    private readonly inputActions: InputActions;
    private readonly directionalMovementStrategy: DirectionalMovementStrategy;
    private readonly windowActions: WindowActions;
    private readonly layoutDomain: LayoutDomain;
    private readonly workspaceDomain: WorkspaceDomain;

    constructor(
        private readonly environment: ControllerEnvironment,
        private readonly onEnabledChanged?: (enabled: boolean) => void,
    ) {
        this.structuralMutation = {
            report: this.markStructuralMutation,
            flush: () => this.flushStructuralMutation(),
        };
        this.scopeResolution = {
            scopeForWindow: (window) => this.scopeForWindow(window),
            topologyForScope: (scope, onRejected) => this.topologyForScope(scope, onRejected),
        };
        this.pendingKeyboardState = {
            current: () => this.pending.current,
            replace: (pending) => this.pending.set(pending),
            clear: () => this.clearPending(),
        };
        this.floatingWindowState = {
            isFloating: (window) => this.floatingWindows.has(window),
            floatingScope: (window) => this.floatScopes.get(window),
            markFloating: (window, scope) => {
                this.floatingWindows.add(window);
                this.floatScopes.set(window, scope);
            },
            clearFloating: (window) => {
                this.floatingWindows.delete(window);
                this.floatScopes.delete(window);
            },
            isSticky: (window) => this.stickyWindows.has(window),
            markSticky: (window) => this.stickyWindows.add(window),
            clearSticky: (window) => this.stickyWindows.delete(window),
            isDetached: (window) => this.detachedWindows.has(window),
            markDetached: (window) => this.recordDetached(window),
            clearDetached: (window) => this.detachedWindows.delete(window),
        };
        this.windowCoverState = {
            fullscreenRecord: (window) => this.fullscreenWindows.get(window),
            setFullscreenRecord: (window, record) => this.fullscreenWindows.set(window, record),
            clearFullscreenRecord: (window) => this.fullscreenWindows.delete(window),
            maximizeRecord: (window) => this.maximizedWindows.get(window),
            setMaximizeRecord: (window, record) => this.maximizedWindows.set(window, record),
            clearMaximizeRecord: (window) => this.maximizedWindows.delete(window),
        };
        this.interactiveDrag = createInteractiveDragController({
            geometryHelpers: {
                dragGeometryBail,
                positiveGeometry,
                sameGeometry,
                splitDirection,
            },
            topologyHelpers: {
                operationLeafForTile,
                windowIndex,
            },
            planningHelpers: {
                equalAlongAxis,
                pickDropLeaf,
                planEqualSplit,
                planGeometryDrop,
                rectCenter,
            },
            tileHelpers: {
                decodeChildren: (tile) => customTileSplitSeam.decodeChildren(tile),
                setRelativeGeometry: setTileRelativeGeometry,
            },
            snapshotCaption,
            windowList: () => this.environment.windowList(),
            cursorPos: () => this.environment.cursorPos(),
            clientArea: (option, output, desktop) => this.environment.clientArea(option, output, desktop),
            watchInteractiveWindow: (window, started, finished, stepped, moveResizedChanged, invalidated) =>
                this.environment.watchInteractiveWindow(
                    window,
                    started,
                    finished,
                    stepped,
                    moveResizedChanged,
                    invalidated,
                ),
            showOutline: (x, y, width, height) => this.environment.showOutline(x, y, width, height),
            hideOutline: () => this.hideInteractiveOutline(),
            scheduleOnce: (delayMs, callback) => this.environment.scheduleOnce(delayMs, callback),
            scopeForWindow: (window) => this.scopeForWindow(window),
            topologyForScope: (scope, onRejected) => this.topologyForScope(scope, onRejected),
            windowInScope,
            isFloating: (window) => this.floatingWindows.has(window),
            isInert: (scope) => this.layoutDomain.isInert(scope),
            isMaximized: (window) => this.maximizedWindows.has(window),
            dropOutlinePreview: () => this.dropOutlinePreview,
            mutation: this.markStructuralMutation,
            decodedBoundary: (kind) => this.decodedBoundary(kind),
            diagnostic: (event) => this.diagnostic(event),
            onceDiagnostic: (event) => this.onceDiagnostic(event),
            runGuarded: (operation) => this.gate.run(operation, (reason) => this.disabled(reason)),
            disable: (reason) => this.gate.disable(reason, (disabledReason) => this.disabled(disabledReason)),
            deferRemovalCollapse: (window, scope, leafTile, afterDragSnapshot, onDragSettled) =>
                this.deferRemovalCollapse(window, scope, leafTile, afterDragSnapshot, onDragSettled),
            ensureInvariant: (scope) => this.presetEnsureInvariant(scope),
            afterFinished: () => {
                this.cleanupDesktops();
                this.workspaceDomain.drainPendingDesktopIntents();
            },
            onExistingWindow: (window) => {
                this.attachFullscreenWindow(window);
                if (window.fullScreen === true) {
                    this.enterFullscreen(window);
                }
                if (isNativelyMaximized(window)) {
                    this.recordStartupMaximize(window);
                }
            },
        });
        this.reflowObservers = createReflowObservers({
            rootTile: (output, desktop) => this.environment.rootTile(output, desktop),
            scopeForWindow: (window) => this.scopeForWindow(window),
            windowInScope,
            decodeTileTree,
            collectPresetLeaves,
            scopeHasFullscreen: (scope) => this.scopeHasFullscreen(scope),
            reflowTouchesMaximized: (scope, overlay) => this.reflowTouchesMaximized(scope, overlay),
            mutation: this.markStructuralMutation,
            diagnostic: (event) => this.diagnostic(event),
            onceDiagnostic: (event) => this.onceDiagnostic(event),
            desktopScopeCheck,
            scheduleOnce: (delayMs, callback) => this.environment.scheduleOnce(delayMs, callback),
            runGuarded: (operation) => this.gate.run(operation, (reason) => this.disabled(reason)),
            onEligibleDeferred: (window, scope) => {
                this.interactiveDrag.attach(window);
                this.layoutDomain.placeEligibleAdded(window, scope);
                this.cleanupDesktops();
                this.workspaceDomain.drainPendingDesktopIntents();
            },
        });
        this.layoutDomain = createLayoutDomain({
            environment: {
                yieldOnce: (callback) => this.environment.yieldOnce(callback),
            },
            scope: {
                scopeForWindow: (window) => this.scopeForWindow(window),
                topologyForScope: (scope) => this.topologyForScope(scope),
            },
            reflow: {
                afterAddition: (window, scope) => this.reflowObservers.afterAddition(window, scope),
                readSelectedOverlay: (scope) => this.reflowObservers.readSelectedOverlay(scope),
            },
            placement: {
                placeAutomatically: (window, scope) => this.placeAutomatically(window, scope),
                dwindleInsert: (window, scope) => this.dwindleInsert(window, scope),
            },
            state: {
                isFloating: (window) => this.floatingWindows.has(window),
                scopeHasFloating: (scope) => this.scopeHasFloating(scope),
                scopeHasFullscreen: (scope) => this.scopeHasFullscreen(scope),
                scopeHasMaximized: (scope) => this.scopeHasMaximized(scope),
            },
            ownership: {
                managedRecord: (scope) => this.managedRecord(scope),
                setManaged: (scope) => this.setManaged(scope),
                markInert: (scope, reason) => this.markInert(scope, reason),
                pendingForScope: (scope) => this.pendingRebuilds.get(scope.output)?.get(scope.desktop.id),
                setPendingRebuild: (scope, pending) => {
                    let byDesktop = this.pendingRebuilds.get(scope.output);
                    if (byDesktop === undefined) {
                        byDesktop = new Map<string, LayoutPendingRebuild>();
                        this.pendingRebuilds.set(scope.output, byDesktop);
                    }
                    byDesktop.set(scope.desktop.id, pending);
                },
                dropPendingRebuild: (scope, pending) => {
                    const byDesktop = this.pendingRebuilds.get(scope.output);
                    if (byDesktop?.get(scope.desktop.id) !== pending) {
                        return;
                    }
                    byDesktop.delete(scope.desktop.id);
                    if (byDesktop.size === 0) {
                        this.pendingRebuilds.delete(scope.output);
                    }
                },
                hasPendingRebuilds: () => this.pendingRebuilds.size > 0,
            },
            structural: {
                flush: () => this.flushStructuralMutation(),
                ownedPopulation: (scope) => this.ownedPopulation(scope),
                presetMatches: (scope, population) => this.presetMatches(scope, population),
                collapseOwnedScope: (scope) => this.collapseOwnedScope(scope),
                rebuildPreset: (scope, population) => this.rebuildPreset(scope, population),
                presetEnsureInvariant: (scope) => this.presetEnsureInvariant(scope),
                dwindleRemove: (window, scope) => this.dwindleRemove(window, scope),
                settleRemovalCollapse: (window, scope, leaf, afterDragSnapshot, onDragSettled) =>
                    this.settleRemovalCollapse(window, scope, leaf, afterDragSnapshot, onDragSettled),
            },
            drag: {
                isLive: () => this.interactiveDrag.isLive(),
                markOwedInvariant: (scope) => this.interactiveDrag.markOwedInvariant(scope),
                dragSnapshotFinal: (topology) => this.interactiveDrag.dragSnapshotFinal(topology),
            },
            callbacks: {
                diagnostic: (event) => this.diagnostic(event),
                onceDiagnostic: (event) => this.onceDiagnostic(event),
                onSettled: () => {
                    this.cleanupDesktops();
                    this.workspaceDomain.drainPendingDesktopIntents();
                },
                onDeferredRemovalSettled: () => this.interactiveDrag.settleOwedInvariants(),
            },
        });
        this.workspaceDomain = createWorkspaceDomain({
            isEnabled: () => this.gate.isEnabled,
            mutationDeferred: () => this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0,
            finishMoveToTrailing: (window) => this.finishMoveToTrailing(window),
            finishWorkspaceZero: (output) => this.finishWorkspaceZero(output),
            diagnostic: (event) => this.diagnostic(event),
        });
        this.pendingMoveState = {
            hasPendingMove: (window) => this.pendingMoves.has(window),
            markPendingMove: (window) => this.pendingMoves.add(window),
            clearPendingMove: (window) => this.pendingMoves.delete(window),
        };
        this.workspaceModeState = {
            workspaceMode: () => this.workspaceMode,
        };
        this.desktopChangeState = {
            currentDesktopChangeOutput: () => this.recentDesktopChangeOutput,
        };
        this.inputActions = createInputActions({
            environment: this.environment,
            scope: this.scopeResolution,
            topologyHelpers: {
                operationLeafForTile,
                targetOccupantForActive,
                windowInScope,
                windowIndex,
            },
            geometryHelpers: {
                parentHasSameSplitAxis,
                splitDirection,
            },
            pending: this.pendingKeyboardState,
            floating: this.floatingWindowState,
            mutation: this.markStructuralMutation,
            diagnostics: {
                diagnostic: (event) => this.diagnostic(event),
                disable: (reason) => this.gate.disable(reason, (disabledReason) => this.disabled(disabledReason)),
                decodedBoundary: (kind) => this.decodedBoundary(kind),
            },
        });
        this.directionalMovementStrategy = createCosmicDirectionalMovementStrategy({
            moveActiveWindow: (direction) => this.inputActions.moveActiveWindow(direction),
        });
        this.windowActions = createWindowActions({
            environment: this.environment,
            scope: this.scopeResolution,
            topologyHelpers: {
                operationLeafForTile,
                windowInScope,
                windowIndex,
            },
            floating: this.floatingWindowState,
            geometry: {
                remembered: (window) => this.floatGeometries.get(window),
                remember: (window, geometry) => this.floatGeometries.set(window, geometry),
            },
            mutation: this.markStructuralMutation,
            callbacks: {
                afterDetach: (scope, origin) => this.reflowObservers.afterDetach(scope, origin),
                isMaximized: (window) => this.maximizedWindows.has(window),
                decodedBoundary: (kind) => this.decodedBoundary(kind),
            },
            diagnostics: { diagnostic: (event) => this.diagnostic(event) },
        });
        void this.showDropOutline;
        void this.hideDropOutline;
        this.environment.onControllerCreated?.(this);
    }

    get isEnabled(): boolean {
        return this.gate.isEnabled;
    }

    get hasPendingKeyboard(): boolean {
        return this.pending.current !== undefined;
    }

    get hasActiveDrag(): boolean {
        return this.interactiveDrag.hasActive();
    }

    // Read-only mode snapshot for tests: entry/inverse/switch/exit are
    // deterministic and observable without mutating topology or assignments.
    resizeModeSnapshot(): { readonly active: boolean; readonly direction: "outwards" | "inwards" } {
        return this.inputActions.resizeModeSnapshot();
    }

    // Parsed workspace mode (spec D). Read-only snapshot for tests and the
    // Unit 05 mode dispatch; the value is set once at startup.
    workspaceModeSnapshot(): WorkspaceMode {
        return this.workspaceModeState.workspaceMode();
    }

    // Parsed tiling algorithm. Read-only snapshot for tests; the value is set
    // once at startup and drives the automatic takeover shape.
    tilingAlgorithmSnapshot(): TilingAlgorithm {
        return this.tilingAlgorithm;
    }

    // Parsed automatic split target. Read-only snapshot for tests; the value is
    // set once at startup and drives the automatic split's chosen leaf.
    automaticSplitTargetSnapshot(): AutomaticSplitTarget {
        return this.automaticSplitTarget;
    }

    dropOutlinePreviewSnapshot(): boolean {
        return this.dropOutlinePreview;
    }

    // Deterministic session output key for the given output (spec E), or
    // undefined before any rebuild observed it. Session-only; never persisted.
    outputKeyFor(output: OutputCapability): string | undefined {
        return this.outputKeys.keyFor(output);
    }

    // The output argument of the most recent `currentDesktopChanged` event
    // (spec F), or null before any such event. Preserved through the typed
    // boundary for the Unit 05 per-output scope re-resolution.
    currentDesktopChangeOutput(): OutputCapability | null {
        return this.desktopChangeState.currentDesktopChangeOutput();
    }

    // Session-owned desktop id snapshot for tests and diagnostics: exactly the
    // desktop ids the script created this session. Pre-existing and user-owned
    // desktops are never present (spec B ownership).
    ownedDesktopIdSnapshot(): readonly string[] {
        return Object.freeze([...this.ownedDesktopIds]);
    }

    // Per-output-local mapping snapshot for tests: outputKey -> ordered local
    // desktop id list. Present only in per-output-local mode; read-only copies.
    localWorkspaceSnapshot(): Readonly<Record<string, readonly string[]>> {
        const snapshot: Record<string, readonly string[]> = {};
        for (const [key, ids] of this.localWorkspaces) {
            snapshot[key] = Object.freeze([...ids]);
        }
        return snapshot;
    }

    // Global-unique assignment snapshot (spec D2/F, Unit 06): outputKey ->
    // assigned global desktop id subset. Present only in global-unique mode;
    // read-only copies. The stored order is storage order; the semantic order
    // (x11DesktopNumber ascending) is derived at resolution.
    globalUniqueAssignmentSnapshot(): Readonly<Record<string, readonly string[]>> {
        const snapshot: Record<string, readonly string[]> = {};
        for (const [key, ids] of this.globalUniqueAssigned) {
            snapshot[key] = Object.freeze([...ids]);
        }
        return snapshot;
    }

    // Shared mapping snapshot for tests (spec D3/H.10-13): the ordered shared
    // desktop id set. Present only in shared mode; read-only copy.
    sharedWorkspaceSnapshot(): readonly string[] {
        return Object.freeze([...this.sharedWorkspaces]);
    }

    // Test seam for the spec D2/H.12 example: seed the global-unique
    // assignment/inverse from an explicit outputKey -> id subset mapping. The
    // deterministic session initialization cannot reach an arbitrary split of
    // pre-existing desktops (they all resolve to the session primary output,
    // spec E hotplug), so the spec's E=[1,2,4]/L=[3,5,6] case is constructed
    // through this seam. Session-only, never persisted, no user-facing config.
    // Inert unless global-unique mode is active, every referenced id is live,
    // and the mapping assigns every live desktop exactly once.
    seedGlobalUniqueAssignment(mapping: Readonly<Record<string, readonly string[]>>): void {
        if (this.workspaceMode !== "global-unique") {
            return;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        const liveIds = new Set(desktops.map((desktop) => desktop.id));
        const covered = new Set<string>();
        const subsets = new Map<string, string[]>();
        for (const [key, ids] of Object.entries(mapping)) {
            const list: string[] = [];
            for (const id of ids) {
                if (!liveIds.has(id) || covered.has(id)) {
                    return;
                }
                covered.add(id);
                list.push(id);
            }
            subsets.set(key, list);
        }
        if (covered.size !== liveIds.size) {
            return;
        }
        this.globalUniqueAssigned.clear();
        this.globalUniqueInverse.clear();
        for (const [key, ids] of subsets) {
            this.globalUniqueAssigned.set(key, [...ids]);
            for (const id of ids) {
                this.globalUniqueInverse.set(id, key);
            }
        }
    }

    readSelectedOverlay(scope: CurrentScope): SelectedOverlay | null {
        return this.reflowObservers.readSelectedOverlay(scope);
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
        this.interactiveDrag.clear();
        this.diagnostic(`disabled:${reason}`);
        const enabled = this.gate.isEnabled;
        if (enabled === this.notifiedEnabled) {
            return;
        }
        this.notifiedEnabled = enabled;
        try {
            this.onEnabledChanged?.(enabled);
        } catch (error) {
            void error;
        }
    }

    start(): void {
        this.gate.run(() => {
            this.environment.onWindowAdded((window) => this.handleWindowAdded(window));
            this.environment.onWindowRemoved((window) => this.handleWindowRemoved(window));
            this.environment.onScreensChanged(() => this.handleScreensChanged());
            this.environment.onCurrentDesktopChanged((previous, current, output) =>
                this.handleCurrentDesktopChanged(previous, current, output),
            );
            this.environment.onDesktopsChanged(() => this.handleDesktopsChanged());
            // Deterministic session output keys from the current screens, so
            // every mode sees a key for each output before any event fires.
            this.rebuildOutputKeys();
            // Parsed `workspaceMode` (spec D): the default is per-output-local;
            // a valid value selects its own mode; anything else falls back with
            // a diagnostic. Parsed before the first reconciliation so the
            // startup cleanup builds the selected mode's mapping, never the
            // default's.
            const mode = parseWorkspaceMode(
                this.environment.readConfig(WORKSPACE_MODE_CONFIG_KEY, DEFAULT_WORKSPACE_MODE),
            );
            for (const diagnostic of mode.diagnostics) {
                this.diagnostic(diagnostic);
            }
            this.workspaceMode = mode.mode;
            // Parsed `tilingAlgorithm`: the default is dwindle; a valid value
            // selects its own preset; anything else falls back with a
            // diagnostic. Parsed before the first takeover so the startup
            // ownership adoption builds the selected preset's shape, never the
            // default's.
            const algorithm = parseTilingAlgorithm(
                this.environment.readConfig(TILING_ALGORITHM_CONFIG_KEY, DEFAULT_TILING_ALGORITHM),
            );
            for (const diagnostic of algorithm.diagnostics) {
                this.diagnostic(diagnostic);
            }
            this.tilingAlgorithm = algorithm.algorithm;
            // Parsed `automaticSplitTarget`: the default is dwindle; a valid
            // value selects its own target; anything else falls back with a
            // diagnostic. Parsed before the first automatic split so the chosen
            // leaf intent is the selected target's, never the default's.
            const target = parseAutomaticSplitTarget(
                this.environment.readConfig(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, DEFAULT_AUTOMATIC_SPLIT_TARGET),
            );
            for (const diagnostic of target.diagnostics) {
                this.diagnostic(diagnostic);
            }
            this.automaticSplitTarget = target.target;
            const outlinePreview = parseDropOutlinePreview(
                this.environment.readConfig(DROP_OUTLINE_PREVIEW_CONFIG_KEY, DEFAULT_DROP_OUTLINE_PREVIEW),
            );
            for (const diagnostic of outlinePreview.diagnostics) {
                this.diagnostic(diagnostic);
            }
            this.dropOutlinePreview = outlinePreview.enabled;
            // Build the per-mode mapping and its one trailing empty per
            // connected output from the current screens/desktops before any
            // keyboard or lifecycle event resolves a workspace.
            this.cleanupDesktops();
            this.adoptStartupFloatingWindows();
            this.interactiveDrag.attachExisting(true);
            this.diagnostic("startup-handlers-ready");
            this.engageCurrentScope();
        }, (reason) => this.disabled(reason));
    }

    // Each directional insertion action arms exactly one pending insertion from
    // the active eligible in-scope occupant of the focused non-layout leaf. A
    // re-arm atomically replaces the source and the recorded direction, so a
    // later arm always supersedes an earlier one.
    armKeyboardInsertion(direction: Direction): void {
        this.gate.run(() => this.inputActions.armKeyboardInsertion(direction), (reason) => this.disabled(reason));
        return;
    }

    moveActiveWindow(direction: Direction): void {
        this.gate.run(() => this.directionalMovementStrategy.move(direction), (reason) => this.disabled(reason));
        return;
    }

    focusOrResize(direction: Direction): void {
        this.gate.run(() => this.inputActions.focusOrResize(direction), (reason) => this.disabled(reason));
    }

    enterOrExitResizeMode(mode: "outwards" | "inwards"): void {
        this.gate.run(() => this.inputActions.enterOrExitResizeMode(mode), (reason) => this.disabled(reason));
    }

    // One safe split-resize step of the active window. `mode` is outwards
    // (COSMIC Resizing(Outwards), bspwm resize-expand): the focused window
    // grows toward the pressed direction. `mode` is inwards (Resizing(Inwards),
    // bspwm resize-contract): the focused window shrinks, the shared edge on
    // the opposite side moving inward.
    //
    // The nearest matching-orientation ancestor where the focused leaf has a
    // sibling on the mode-mapped pressed side is resolved (COSMIC nested-split
    // rule, cosmic-comp shell/layout/tiling/mod.rs resize()); the shared edge
    // moves by RESIZE_STEP_FRACTION of that ancestor's extent. Exactly one
    // guarded Tile.relativeGeometry write on the focused tile is made: the
    // documented CustomTile::setRelativeGeometry source setter adjusts the
    // adjacent sibling's shared edge and refuses atomically when the sibling
    // would fall below its minimum (customtile.cpp:53-177, kwin-api-surface.md
    // 153-158). A fresh whole-root decode and a two-extent postcondition prove
    // the result before `resize-completed` is claimed; there is no window
    // geometry write, no structural call, and no dual-write rollback path.
    public resizeActiveWindow(direction: Direction, mode: "outwards" | "inwards"): void {
        this.gate.run(() => this.inputActions.resizeActiveWindow(direction, mode), (reason) => this.disabled(reason));
        return;
    }

    detachActiveWindow(): void {
        this.gate.run(() => this.windowActions.detachActiveWindow(), (reason) => this.disabled(reason));
        return;
    }


    // Assignment-only inverse of detach: one guarded `window.tile = target`
    // write for the active eligible floating window into the deterministic
    // first available empty non-layout leaf of the exact scope. Never changes
    // topology or another occupant.
    attachActiveWindow(): void {
        this.gate.run(() => this.windowActions.attachActiveWindow(), (reason) => this.disabled(reason));
        return;
    }

    floatActiveWindow(): void {
        this.gate.run(() => this.windowActions.floatActiveWindow(), (reason) => this.disabled(reason));
        return;
    }

    stickyActiveWindow(): void {
        this.gate.run(() => this.windowActions.stickyActiveWindow(), (reason) => this.disabled(reason));
        return;
    }

    fillScope(): void {
        this.gate.run(() => this.windowActions.fillScope(), (reason) => this.disabled(reason));
        return;
    }

    applyPreset(kind: PresetKind): void {
        this.gate.run(() => {
            this.diagnostic(`preset-invoked:${kind}`);
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("preset-rejected:no-active-window");
                return;
            }
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
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
            const execution = executeBlueprintInstructions(compiled.value, source.decoded.tile, {
                split: (tile, orientation) =>
                    splitCustomTile(tile, layoutDirectionFor(orientation), this.markStructuralMutation),
                decodeChildren: customTileSplitSeam.decodeChildren,
            });
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
                    if (!manageTile(leaf, occupant.window, this.markStructuralMutation)) {
                        this.diagnostic(`preset-failed:assignment-failed:${stage}`);
                        return;
                    }
                } catch (error) {
                    void error;
                    this.diagnostic(`preset-failed:assignment-failed:${stage}`);
                    return;
                }
            }
            this.reflowObservers.recordSelectedOverlay(scope, kind, source.decoded.tile, execution.leaves);
            this.diagnostic(`preset-applied:${kind}`);
        }, (reason) => this.disabled(reason));
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

    private clearPending(): void {
        const pending = this.pending.current;
        this.pending.clearForScopeChange();
        if (pending !== undefined) {
            pending.disconnect();
        }
    }

    private clearDrag(): void {
        this.interactiveDrag.clear();
    }

    private showDropOutline(geometry: RectCapability): void {
        this.interactiveDrag.showDropOutline(geometry);
    }

    private hideDropOutline(): void {
        this.interactiveDrag.hideDropOutline();
    }

    private hideInteractiveOutline(): void {
        const groupGeometry = this.groupOutlineGeometry;
        if (groupGeometry !== null) {
            this.environment.showOutline(groupGeometry.x, groupGeometry.y, groupGeometry.width, groupGeometry.height);
            return;
        }
        this.environment.hideOutline();
    }

    // screensChanged -> rebuild the deterministic session output keys, then
    // re-anchor ownership and reconcile (spec F). A removed output's keys stay
    // in the registry so a re-plug with the same tuple is matched again. In
    // shared mode a newly connected output is synchronized onto the current
    // shared workspace; disconnect never deletes a desktop (spec D3/E).
    private handleScreensChanged(): void {
        this.rebuildOutputKeys();
        this.handleScopeChange();
        if (this.gate.isEnabled) {
            this.synchronizeSharedCurrent();
        }
    }

    // currentDesktopChanged(previous, current, output) -> re-resolve the
    // affected output's scope (spec F). The signal's output argument is
    // authoritative for which output switched; it is preserved here (through
    // the typed boundary) so the Unit 05 per-mode dispatch can consume it
    // without re-wiring the seam. Until that dispatch exists the single-output
    // behavior is unchanged.
    private handleCurrentDesktopChanged(previous: unknown, current: unknown, output: unknown): void {
        if (isOutput(output)) {
            this.recentDesktopChangeOutput = output;
        }
        this.handleScopeChange();
        void previous;
        void current;
    }

    private handleScopeChange(): void {
        this.gate.run(() => {
            this.clearPending();
            this.clearDrag();
            this.interactiveDrag.settleOwedInvariants();
            this.interactiveDrag.attachExisting(false);
            this.engageCurrentScope();
            // A current-desktop change can move the sole trailing owned empty
            // into or out of occupancy (for example a pager move onto it), so
            // reconcile. Cleanup defers while a drag or reconstruction is live.
            this.cleanupDesktops();
            this.workspaceDomain.drainPendingDesktopIntents();
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
            if (this.interactiveDrag.current()?.window === window) {
                this.interactiveDrag.clear();
            }
            if (isWindow(window)) {
                this.interactiveDrag.detach(window);
                this.reflowObservers.cancelDeferredEligibility(window);
                this.detachedWindows.delete(window);
                // Floating close cleanup only drops session state; it never
                // removes or collapses a tile (the floating window left its
                // leaf through unmanage and owns no tile of its own).
                this.floatingWindows.delete(window);
                this.floatScopes.delete(window);
                this.stickyWindows.delete(window);
                this.floatGeometries.delete(window);
                // Maximize close cleanup: the record is cleared before the
                // normal removal/reflow paths so closing a maximized window
                // proceeds with ordinary tile removal and collapse. Other
                // maximized windows in the same scope still exclude
                // reconstruction through their own live records.
                this.maximizedWindows.delete(window);
                this.detachMaximizeWindow(window);
                this.reflowObservers.afterRemoval(window);
                this.layoutDomain.dwindleMaybeRemove(window);
                // The fullscreen record stays alive through both removal paths:
                // removing any window (including the fullscreen window itself)
                // while a fullscreen window belongs to this scope must not
                // mutate or reconstruct the tree, and the reflow/dwindle guards
                // depend on `scopeHasFullscreen` still seeing this record.
                // Detach and cleanup run only after those paths have bailed.
                this.detachFullscreenWindow(window);
                this.fullscreenWindows.delete(window);
            }
            this.interactiveDrag.settleOwedInvariants();
            // A window removal can leave an owned desktop empty again, turning
            // the kept replacement plus the re-emptied desktop into excess, so
            // reconcile. Cleanup defers while a drag or reconstruction is live.
            this.cleanupDesktops();
            this.workspaceDomain.drainPendingDesktopIntents();
        }, (reason) => this.disabled(reason));
    }

    private handleWindowAdded(window: unknown): void {
        this.gate.run(() => {
            this.onceDiagnostic("window-added-observed");
            this.interactiveDrag.attach(window);
            this.attachFullscreenWindow(window);
            if (isWindow(window) && window.fullScreen === true) {
                this.enterFullscreen(window);
            } else {
                const pending = this.pending.current;
                if (pending === undefined) {
                    const scope = this.scopeForWindow(window);
                    if (scope === null || !windowInScope(window, scope)) {
                        const reason = this.windowAddedRejection(window, scope);
                        if (reason === "desktop-scope-mismatch" && scope !== null && isWindow(window)) {
                            this.reflowObservers.deferDesktopScopeReevaluation(window, scope);
                        } else {
                            this.onceDiagnostic(`window-added-rejected:${reason}`);
                        }
                    } else {
                        this.onceDiagnostic("window-added-eligible");
                        this.layoutDomain.placeEligibleAdded(window, scope);
                    }
                } else {
                    try {
                        this.inputActions.completeKeyboardInsertion(window, pending);
                    } finally {
                        this.clearPending();
                    }
                }
            }
            // A window arrival on the script-owned trailing empty makes it
            // occupied, so reconcile. Cleanup defers while a drag or
            // reconstruction is live and retries through the settle seams.
            this.cleanupDesktops();
            this.workspaceDomain.drainPendingDesktopIntents();
        }, (reason) => this.disabled(reason));
    }

    // `desktop-scope-mismatch` is deferred by the reflow/observer domain so a
    // newly mapped window can settle its desktop membership once.
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

    // Startup adoption of already-all-desktops windows as session-local sticky
    // floating windows. The session-only heuristic (a window pinned across all
    // desktops before the controller started, either by KWin's own pinning or a
    // previous session) is recorded as sticky floating so it is never re-tiled
    // by placement or reconstruction. This is narrowly appropriate: no mutation
    // happens here (no geometry write, no pin change), and ordinary startup
    // windows use normal placement. An already tile-managed all-desktops window
    // is never classified both tiled and sticky/floating: it is declined with
    // an explicit diagnostic and left untouched (no pin clear, no adoption) so
    // startup performs no structural mutation on a window KWin already owns.
    private adoptStartupFloatingWindows(): void {
        const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return;
        }
        this.decodedBoundary("workspace-window-list");
        for (const window of windows.value) {
            if (window.onAllDesktops !== true) {
                continue;
            }
            if (
                !window.normalWindow ||
                !window.managed ||
                !window.resizeable ||
                window.appletPopup
            ) {
                continue;
            }
            const scope = this.scopeForWindow(window);
            if (scope === null) {
                continue;
            }
            if (window.tile !== null) {
                this.onceDiagnostic("startup-sticky-declined:tile-managed");
                continue;
            }
            this.floatingWindows.add(window);
            this.stickyWindows.add(window);
            this.floatScopes.set(window, scope.scope);
            this.onceDiagnostic("startup-sticky-float");
        }
    }

    // ---- Fullscreen cover-and-restore passthrough ----

    // Attach the documented `fullScreenChanged` notify signal for a managed
    // normal window. Attachment is feature-detected through the environment
    // seam exactly like the interactive signals: a missing binding is logged
    // as failed but never fails startup. Bounded and deduplicated per window.
    private attachFullscreenWindow(window: unknown): void {
        if (this.fullscreenWatches.size >= MAX_SEQUENTIAL_LENGTH) {
            return;
        }
        if (!isWindow(window) || this.fullscreenWatches.has(window)) {
            return;
        }
        if (!window.normalWindow || !window.managed || window.appletPopup) {
            return;
        }
        const watched = this.environment.watchFullscreen(window, () => this.handleFullscreenChanged(window));
        this.fullscreenWatches.set(window, watched.disconnect);
    }

    private detachFullscreenWindow(window: WindowCapability): void {
        const disconnect = this.fullscreenWatches.get(window);
        if (disconnect === undefined) {
            return;
        }
        this.fullscreenWatches.delete(window);
        disconnect();
    }

    private handleFullscreenChanged(window: WindowCapability): void {
        this.gate.run(() => {
            if (window.fullScreen === true) {
                this.enterFullscreen(window);
            } else {
                if (this.interactiveDrag.current()?.window === window) {
                    this.interactiveDrag.clear();
                }
                this.exitFullscreen(window);
            }
        }, (reason) => this.disabled(reason));
    }

    // Enter: preserve the exact tile for a managed tiled window without any
    // mutation (cover is KWin-owned); a created/floating fullscreen window is
    // recorded unmanaged. A window already fullscreen is not re-recorded. A
    // live drag on the entering window is dropped so finish cannot complete a
    // half-captured drop.
    private enterFullscreen(window: WindowCapability): void {
        if (this.windowCoverState.fullscreenRecord(window) !== undefined) {
            return;
        }
            if (this.interactiveDrag.current()?.window === window) {
                this.interactiveDrag.clear();
        }
        const scope = this.scopeForWindow(window);
        const preservedTile = window.tile;
        if (preservedTile !== null && isTile(preservedTile) && scope !== null) {
            this.windowCoverState.setFullscreenRecord(window, { scope, preservedTile, wasTiled: true });
            this.diagnostic("fullscreen:enter preserved");
            return;
        }
        this.windowCoverState.setFullscreenRecord(window, { scope, preservedTile: null, wasTiled: false });
        this.diagnostic("fullscreen:enter unmanaged");
    }

    private exitFullscreen(window: WindowCapability): void {
        const record = this.fullscreenWindows.get(window);
        if (record === undefined) {
            return;
        }
        this.fullscreenWindows.delete(window);
        if (record.wasTiled) {
            this.restoreFullscreenSlot(window, record);
        } else if (!this.maximizedWindows.has(window)) {
            this.newlyManageAfterFullscreen(window);
        }
        // A maximized window that survived the fullscreen round trip is
        // re-covered to its workspace work area: the maximize record and
        // classification are preserved through fullscreen, and KWin restores
        // the pre-fullscreen cover geometry which this re-asserts idempotently.
        if (this.maximizedWindows.has(window)) {
            this.recoverMaximize(window);
        }
    }

    // Restore the preserved slot through the safe `tile.manage(window)` attach
    // API only. Every unsafe precondition is a distinct non-destructive bail:
    // no reconstruction and no mutation when the scope changed, the assignment
    // drifted, or the preserved tile is gone from the live topology. The
    // preserved tile is never touched directly: it is re-resolved as the fresh
    // entry tile of the live topology and that fresh handle is managed.
    private restoreFullscreenSlot(window: WindowCapability, record: FullscreenRecord): void {
        if (record.preservedTile === null || record.scope === null) {
            this.diagnostic("fullscreen:exit restore failed:no-preserved-slot");
            return;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null || !sameScope(scope.scope, record.scope.scope)) {
            this.diagnostic("fullscreen:exit restore failed:scope-changed");
            return;
        }
        if (window.tile === record.preservedTile) {
            this.diagnostic("fullscreen:exit restored");
            return;
        }
        if (window.tile !== null) {
            this.diagnostic("fullscreen:exit restore failed:assignment-changed");
            return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            this.diagnostic("fullscreen:exit restore failed:topology-unavailable");
            return;
        }
        const preservedLeaf = topology.find((entry) => entry.decoded.tile === record.preservedTile);
        if (preservedLeaf === undefined) {
            this.diagnostic("fullscreen:exit restore failed:tile-missing");
            return;
        }
        if (preservedLeaf.windows.some((occupant) => occupant !== window)) {
            this.diagnostic("fullscreen:exit restore failed:leaf-occupied");
            return;
        }
        if (!manageTile(preservedLeaf.decoded.tile, window, this.markStructuralMutation)) {
            this.diagnostic("fullscreen:exit restore failed:assignment-failed");
            return;
        }
        this.diagnostic("fullscreen:exit restored");
    }

    // Exit from a created/floating fullscreen window: manage under the normal
    // newly-eligible semantics. A persisted user float state (the explicit
    // detach set) blocks re-management and leaves the window floating; there is
    // no broader float feature implemented.
    private newlyManageAfterFullscreen(window: WindowCapability): void {
        // A floating window (including sticky) must survive a fullscreen round
        // trip as floating: never re-place it, and restore its remembered float
        // geometry so the cover-and-restore seam does not leave it at a tiled
        // size. The fullscreen record for a floating window was `wasTiled:
        // false`, so this branch runs before any placement.
        if (this.isFloating(window)) {
            const scope = this.scopeForWindow(window);
            if (scope !== null) {
                // KWin's fullscreen cover-and-restore has already restored the
                // pre-fullscreen frame geometry here; snapshot it into the
                // remembered float geometry so the restoration that follows
                // preserves the user's adjusted size, then re-apply it.
                this.rememberCurrentFloatGeometry(window);
                this.windowActions.writeFloatGeometry(window, scope);
            }
            this.diagnostic("fullscreen:exit restored float");
            return;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null || !windowInScope(window, scope)) {
            this.diagnostic("fullscreen:exit restore failed:ineligible");
            return;
        }
        if (this.detachedWindows.has(window)) {
            this.diagnostic("fullscreen:exit restore failed:persisted-float");
            return;
        }
        this.layoutDomain.placeEligibleAdded(window, scope);
        this.diagnostic("fullscreen:exit newly managed");
    }

    // Whether any fullscreen window belongs to this scope. While such a window
    // is fullscreen the scope must not be reconstructed or structurally
    // mutated: a preserved-tiled window's slot survives untouched until exit,
    // and an untiled fullscreen window must never be tiled by a rebuild.
    private scopeHasFullscreen(scope: CurrentScope): boolean {
        for (const [window, record] of this.fullscreenWindows) {
            if (window.fullScreen !== true) {
                continue;
            }
            const currentScope = this.scopeForWindow(window);
            if (currentScope !== null && sameScope(currentScope.scope, scope.scope)) {
                return true;
            }
            if (currentScope === null && record.scope !== null && sameScope(record.scope.scope, scope.scope)) {
                return true;
            }
        }
        return false;
    }

    // ---- Maximize cover-and-restore (geometry-cover seam) ----

    // Meta+M toggle. Maximize is the geometry-cover seam: the window's frame
    // geometry is written to its workspace work area while its exact tile
    // assignment and the tree are preserved; un-maximize restores the tile
    // geometry. Maximize is per window plus its owning desktop and never
    // sticky. Fullscreen is distinct and takes precedence: a fullscreen active
    // window is a specific no-op, and a maximized window that entered fullscreen
    // keeps its maximize record and is re-covered on fullscreen exit.
    maximizeActiveWindow(): void {
        this.gate.run(() => {
            this.diagnostic("maximize-invoked");
            const active = this.environment.activeWindow();
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("maximize-ignored:fullscreen");
                return;
            }
            const guard = this.activeActionGuard("maximize");
            if (guard === null) {
                return;
            }
            if (this.isSticky(guard.active)) {
                this.diagnostic("maximize-rejected:sticky");
                return;
            }
            if (this.maximizedWindows.has(guard.active)) {
                const record = this.maximizedWindows.get(guard.active);
                // A startup-native-maximized record is not a controller cover:
                // it must not be cleared through the toggle, which would
                // simulate the native unmaximize transition only the real
                // `maximizedChanged` signal may produce. Any other record class
                // proceeds through the ordinary restore path.
                if (record !== undefined && record.kind === "startup") {
                    this.diagnostic("maximize-rejected:startup-native");
                    return;
                }
                this.exitMaximize(guard.active);
                return;
            }
            this.enterMaximize(guard.scope, guard.active);
        }, (reason) => this.disabled(reason));
    }

    // Enter: validate the exact tile association through a fresh topology,
    // then write the workspace work-area geometry. No structural call is ever
    // made; the tree and tile slot stay exactly as they were.
    private enterMaximize(scope: CurrentScope, window: WindowCapability): void {
        if (this.maximizedWindows.has(window)) {
            return;
        }
        if (window.tile === null || !isCustomTile(window.tile) || window.tile.isLayout) {
            this.diagnostic("maximize-rejected:not-tiled");
            return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            this.diagnostic("maximize-failed:topology-unavailable");
            return;
        }
        const leaf = operationLeafForTile(topology, window.tile);
        if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
            this.diagnostic("maximize-rejected:tile-association");
            return;
        }
        if (windowIndex(leaf.windows, window) < 0) {
            this.diagnostic("maximize-rejected:occupancy");
            return;
        }
        const workArea = this.workAreaForScope(scope);
        if (workArea === null) {
            this.diagnostic("maximize-failed:work-area-unavailable");
            return;
        }
        if (!writeWindowFrameGeometry(window, workArea)) {
            this.diagnostic("maximize-failed:geometry-write");
            return;
        }
        this.maximizedWindows.set(window, { scope, preservedTile: window.tile, kind: "cover" });
        this.diagnostic("maximize:enter preserved");
        this.diagnostic("maximize:enter covered");
    }

    // Startup recording of an already-maximized window (the read-only
    // `maximizeMode` binding, guarded through `isNativelyMaximized`, never
    // written by the controller). No mutation happens: the record alone
    // preserves the window's state and tree by excluding the scope from
    // reconstruction and placement. A tiled window keeps its exact tile slot;
    // an untiled window stays unmanaged until a real native unmaximize
    // transition clears the classification. The startup record is distinct
    // from a controller-managed cover (`kind: "startup"`), so the toggle
    // refuses it and only the native maximize transition may clear it.
    private recordStartupMaximize(window: WindowCapability): void {
        const scope = this.scopeForWindow(window);
        if (scope === null) {
            return;
        }
        if (this.maximizedWindows.has(window)) {
            return;
        }
        const tile = window.tile;
        const preservedTile = tile !== null && isTile(tile) ? tile : null;
        this.maximizedWindows.set(window, { scope, preservedTile, kind: "startup" });
        this.attachMaximizeWindow(window);
        this.diagnostic("maximize:startup recorded");
    }

    // Attach the documented `maximizedChanged` notify signal for a startup
    // record so the classification clears on a real native unmaximize
    // transition instead of persisting forever. Attachment is feature-detected
    // through the optional environment seam: a missing binding is skipped
    // (the classification then simply persists) but never fails startup.
    // Bounded and deduplicated per window.
    private attachMaximizeWindow(window: WindowCapability): void {
        if (this.maximizeWatches.size >= MAX_SEQUENTIAL_LENGTH) {
            return;
        }
        if (this.maximizeWatches.has(window)) {
            return;
        }
        const watchMaximize = this.environment.watchMaximize;
        if (watchMaximize === undefined) {
            return;
        }
        const watched = watchMaximize(window, () => this.handleMaximizeChanged(window));
        this.maximizeWatches.set(window, watched.disconnect);
    }

    private detachMaximizeWindow(window: WindowCapability): void {
        const disconnect = this.maximizeWatches.get(window);
        if (disconnect === undefined) {
            return;
        }
        this.maximizeWatches.delete(window);
        disconnect();
    }

    // A real native maximize transition (KWin emitted `maximizedChanged`).
    // Only a startup-kind record is observed: when the window is no longer
    // natively maximized the classification clears through the same
    // exit/restore seam, which unblocks the scope and lets the window become
    // managed normally. A tiled startup window falls through to the shared
    // restore path; an untiled one simply clears. Any other record class and
    // any transition that leaves the window maximized is ignored.
    private handleMaximizeChanged(window: WindowCapability): void {
        this.gate.run(() => {
            const record = this.maximizedWindows.get(window);
            if (record === undefined || record.kind !== "startup") {
                return;
            }
            if (isNativelyMaximized(window)) {
                return;
            }
            if (this.exitMaximize(window)) {
                // The startup classification cleared: the scope is no longer
                // deferred, so settle its invariant immediately instead of
                // waiting for an unrelated lifecycle event. A window made
                // eligible by the clear is adopted through the same
                // reconciliation used elsewhere; this never invents unsafe
                // structural mutation.
                const scope = this.scopeForWindow(window);
                if (scope !== null && this.layoutDomain.isOwned(scope)) {
                    this.presetEnsureInvariant(scope);
                }
            }
        }, (reason) => this.disabled(reason));
    }

    // Exit: restore the tile geometry through the safe geometry seam and a
    // fresh topology. Every unsafe precondition is a distinct non-destructive
    // bail that leaves the record and cover untouched: no reconstruction and no
    // mutation. A window detached from its preserved tile while maximized is
    // re-attached through the safe `tile.manage(window)` attach seam first.
    // Returns whether the restore completed; a false return means the caller
    // must bail out of the operation that requested it.
    private exitMaximize(window: WindowCapability): boolean {
        const record = this.maximizedWindows.get(window);
        if (record === undefined) {
            return true;
        }
        if (this.interactiveDrag.current()?.window === window) {
            this.interactiveDrag.clear();
        }
        if (record.kind === "startup") {
            // A startup-native-maximized record is cleared only by a real
            // native unmaximize transition observed through `maximizedChanged`
            // (the Meta+M toggle refuses startup records, so this path is
            // reached solely from the native signal). An untiled startup window
            // has no tile geometry to restore: the classification simply
            // clears, which unblocks the scope and lets the window become
            // managed normally. A tiled startup window falls through to the
            // shared restore path below.
            if (record.preservedTile === null || record.scope === null) {
                this.maximizedWindows.delete(window);
                this.diagnostic("maximize:exit cleared");
                return true;
            }
        } else if (record.scope === null || record.preservedTile === null) {
            return true;
        }
        if (window.fullScreen === true) {
            this.diagnostic("maximize:exit restore failed:fullscreen");
            return false;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null || !sameScope(scope.scope, record.scope.scope)) {
            this.diagnostic("maximize:exit restore failed:scope-changed");
            return false;
        }
        if (window.tile !== null && window.tile !== record.preservedTile) {
            this.diagnostic("maximize:exit restore failed:assignment-changed");
            return false;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            this.diagnostic("maximize:exit restore failed:topology-unavailable");
            return false;
        }
        const leaf = operationLeafForTile(topology, record.preservedTile);
        if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
            this.diagnostic("maximize:exit restore failed:tile-missing");
            return false;
        }
        if (window.tile === null) {
            if (leaf.windows.some((occupant) => occupant !== window)) {
                this.diagnostic("maximize:exit restore failed:leaf-occupied");
                return false;
            }
            if (!manageTile(leaf.decoded.tile, window, this.markStructuralMutation)) {
                this.diagnostic("maximize:exit restore failed:assignment-failed");
                return false;
            }
        }
        if (!writeWindowFrameGeometry(window, leaf.decoded.tile.absoluteGeometry)) {
            this.diagnostic("maximize:exit restore failed:geometry-write");
            return false;
        }
        this.maximizedWindows.delete(window);
        this.diagnostic("maximize:exit restored");
        return true;
    }

    // Re-assert the work-area cover after a fullscreen exit. The maximize
    // record survived the fullscreen round trip; the re-cover is idempotent
    // because KWin already restored the pre-fullscreen cover geometry. Any
    // validation failure is a silent non-destructive skip: the record stays and
    // the next un-maximize runs the full bail analysis.
    private recoverMaximize(window: WindowCapability): void {
        const record = this.maximizedWindows.get(window);
        if (record === undefined || record.scope === null || record.preservedTile === null) {
            return;
        }
        if (window.fullScreen === true) {
            return;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null || !sameScope(scope.scope, record.scope.scope)) {
            return;
        }
        if (window.tile !== record.preservedTile) {
            return;
        }
        const workArea = this.workAreaForScope(scope);
        if (workArea === null) {
            return;
        }
        if (writeWindowFrameGeometry(window, workArea)) {
            this.diagnostic("maximize:re-covered");
        } else {
            this.diagnostic("maximize:re-cover-failed:geometry-write");
        }
    }

    // Whether a genuinely tiled maximized window belongs to this scope. Used
    // to defer whole-scope reconstruction and insertion while a maximized
    // window's preserved tile lives in the scope: reconstruction collapses and
    // rebuilds every leaf, while insertion can mutate deferred topology. An untiled
    // startup-maximized record (`preservedTile === null`) preserves no slot, so
    // it never blocks reconstruction of the scope: the window stays unmanaged
    // while unrelated scope reconstruction proceeds. This is a narrow
    // operation-specific refusal for reconstruction only, never a generic
    // scope-wide lifecycle block: unrelated window addition/removal and
    // leaf-level placement proceed (guarded by the precise per-window checks
    // in `runReflow` and `dwindleInsert`). Fullscreen windows are skipped
    // because the fullscreen cover already excludes the scope.
    private scopeHasMaximized(scope: CurrentScope): boolean {
        for (const [window, record] of this.maximizedWindows) {
            if (window.fullScreen === true || record.preservedTile === null) {
                continue;
            }
            const currentScope = this.scopeForWindow(window);
            if (currentScope !== null && sameScope(currentScope.scope, scope.scope)) {
                return true;
            }
            if (currentScope === null && record.scope !== null && sameScope(record.scope.scope, scope.scope)) {
                return true;
            }
        }
        return false;
    }

    // Whether a selected-overlay reflow would reassign a maximized window:
    // true when a live maximized window's current tile is one of the overlay
    // leaves, so the compacting reflow could move it off its preserved slot.
    // Other overlay reflows that never touch the maximized window proceed.
    private reflowTouchesMaximized(scope: CurrentScope, overlay: SelectedOverlay): boolean {
        for (const [window, record] of this.maximizedWindows) {
            if (window.fullScreen === true) {
                continue;
            }
            const currentScope = this.scopeForWindow(window);
            const inScope =
                (currentScope !== null && sameScope(currentScope.scope, scope.scope)) ||
                (currentScope === null && record.scope !== null && sameScope(record.scope.scope, scope.scope));
            if (!inScope || !isTile(window.tile)) {
                continue;
            }
            if (overlay.leaves.includes(window.tile)) {
                return true;
            }
        }
        return false;
    }

    private markStructuralMutation = (): void => {
        this.structuralMutationPending = true;
    };

    private flushStructuralMutation(): void {
        if (!this.structuralMutationPending) {
            return;
        }
        this.structuralMutationPending = false;
        this.flashFocusedGroup();
    }

    private flashFocusedGroup(): void {
        if (this.interactiveDrag.isOutlineShown()) {
            return;
        }
        const focused = this.environment.activeWindow();
        if (
            !isWindow(focused) ||
            focused.tile === null ||
            !isCustomTile(focused.tile) ||
            focused.tile.isLayout
        ) {
            return;
        }
        const parent = focused.tile.parent;
        if (parent === null || !isCustomTile(parent) || !parent.isLayout || !positiveGeometry(parent.absoluteGeometry)) {
            return;
        }
        const identity = {};
        this.groupOutlineIdentity = identity;
        const geometry = parent.absoluteGeometry;
        this.groupOutlineGeometry = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
        this.environment.showOutline(geometry.x, geometry.y, geometry.width, geometry.height);
        try {
            this.environment.scheduleOnce(GROUP_OUTLINE_DURATION_MS, () => {
                if (this.groupOutlineIdentity !== identity) {
                    return;
                }
                if (this.interactiveDrag.isOutlineShown()) {
                    this.groupOutlineIdentity = null;
                    this.groupOutlineGeometry = null;
                    return;
                }
                this.environment.hideOutline();
                this.groupOutlineIdentity = null;
                this.groupOutlineGeometry = null;
            });
        } catch (error) {
            void error;
            this.groupOutlineIdentity = null;
            this.groupOutlineGeometry = null;
            this.environment.hideOutline();
            this.diagnostic("group-outline-schedule-failed");
        }
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

    private splitAxisWouldViolateMinimum(scope: CurrentScope, geometry: RectCapability, axis: SplitAxis): boolean {
        const leafExtent = axis === "x" ? geometry.width : geometry.height;
        const workArea = this.environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop);
        if (!isRect(workArea)) {
            return false;
        }
        const workExtent = axis === "x" ? workArea.width : workArea.height;
        return workExtent > 0 && leafExtent / 2 < 0.15 * workExtent;
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

    // ---- Floating and sticky window state ----

    private isFloating(window: WindowCapability): boolean {
        return this.floatingWindowState.isFloating(window);
    }

    private isSticky(window: WindowCapability): boolean {
        return this.floatingWindowState.isSticky(window);
    }

    // Floating windows whose preserved leaf lives in this exact scope. Sticky
    // windows keep their float-scope record at the scope where they were
    // floated, so this still counts them after they were pinned across
    // desktops. The dwindle bijection and invariant checks use this to tolerate
    // the vacated preserved leaves instead of collapsing them.
    private scopeFloatingCount(scope: CurrentScope): number {
        let count = 0;
        for (const window of this.floatingWindows) {
            const record = this.floatScopes.get(window);
            if (record !== undefined && sameScope(record, scope.scope)) {
                count += 1;
            }
        }
        return count;
    }

    private scopeHasFloating(scope: CurrentScope): boolean {
        return this.scopeFloatingCount(scope) > 0;
    }

    // Per-output working area for the exact scope through the documented
    // workspace `clientArea(WorkArea, output, desktop)` seam (source-pinned
    // enum WorkArea = 5). Returns null when the read throws or the area is not
    // a positive finite rect, so no unvalidated geometry is ever derived.
    private workAreaForScope(scope: CurrentScope): RectCapability | null {
        let value: unknown;
        try {
            value = this.environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop);
        } catch (error) {
            void error;
            return null;
        }
        if (!isRect(value) || value.width <= 0 || value.height <= 0) {
            return null;
        }
        return value;
    }

    private rememberCurrentFloatGeometry(window: WindowCapability): void {
        try {
            const geometry = window.frameGeometry;
            if (isRect(geometry) && positiveGeometry(geometry)) {
                this.floatGeometries.set(window, geometry);
            }
        } catch (error) {
            void error;
        }
    }

    private activeActionGuard(action: string): { readonly active: WindowCapability; readonly scope: CurrentScope } | null {
        const active = this.environment.activeWindow();
        if (active === null) {
            this.diagnostic(`${action}-rejected:no-active-window`);
            return null;
        }
        if (isWindow(active) && active.fullScreen === true) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return null;
        }
        if (!isWindow(active)) {
            this.diagnostic(`${action}-rejected:not-a-window`);
            return null;
        }
        if (!active.normalWindow) {
            this.diagnostic(`${action}-rejected:not-normal-window`);
            return null;
        }
        if (!active.managed) {
            this.diagnostic(`${action}-rejected:not-managed`);
            return null;
        }
        if (!active.resizeable) {
            this.diagnostic(`${action}-rejected:not-resizeable`);
            return null;
        }
        if (active.appletPopup) {
            this.diagnostic(`${action}-rejected:applet-popup`);
            return null;
        }
        const scope = this.scopeForWindow(active);
        return scope === null ? (this.diagnostic(`${action}-rejected:desktop-output-scope`), null) : { active, scope };
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
                if (manageTile(entry.decoded.tile, window, this.markStructuralMutation)) {
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
        this.layoutDomain.ensureManaged(scope);
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

    // The owned population of a scope: eligible in-scope windows from the
    // proven window collection, excluding windows explicitly detached by the
    // detach action and floating/sticky windows. Floating windows are never
    // part of the placement population, the tree bijection, or the
    // reconstruction window-set comparisons; their vacated preserved leaves are
    // tolerated by the invariant checks through `scopeFloatingCount`. An
    // untiled maximized window (a startup record with no preserved tile) is
    // likewise excluded: it stays unmanaged and out of the population, so
    // scope reconstruction for the remaining windows proceeds without ever
    // placing it. A tiled maximized window keeps its preserved slot and is a
    // normal leaf occupant, so it stays in the population.
    private ownedPopulation(scope: CurrentScope): readonly WindowCapability[] {
        const windows = decodeSequential(this.environment.windowList(), isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return [];
        }
        this.decodedBoundary("workspace-window-list");
        const owned: WindowCapability[] = [];
        for (const window of windows.value) {
            if (
                windowInScope(window, scope) &&
                !this.detachedWindows.has(window) &&
                !this.isFloating(window)
            ) {
                const maximize = this.maximizedWindows.get(window);
                if (maximize !== undefined && maximize.preservedTile === null) {
                    continue;
                }
                owned.push(window);
            }
        }
        return owned;
    }

    // Whether the scope's current tree already realizes the configured preset
    // blueprint for the owned population. A population of one is realized by
    // exactly one usable leaf (a non-layout tile or a zero-child layout root)
    // occupied by the sole owned window, regardless of the root wrapper; higher
    // counts require the exact preset tree with its deterministic branch
    // orientations. In every case the occupancy must be a bijection between
    // the usable leaves and the population: each leaf holds exactly one owned
    // window whose recorded `tile` is that leaf, and every owned window
    // occupies exactly one leaf. An empty population is never realized, so an
    // empty owned scope never matches.
    private presetMatches(scope: CurrentScope, population: readonly WindowCapability[]): boolean {
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
        const blueprint = presetBlueprint(this.tilingAlgorithm, count);
        if (!blueprint.ok) {
            return false;
        }
        if (!presetNodeMatches(root, blueprint.value)) {
            return false;
        }
        return dwindleBijectionTreeMatches(scope, root, population);
    }

    // Guarded collapse of an owned scope to a single leaf through the guarded
    // reset seam: every occupant is unmanaged before the first removal, each
    // removal is one `CustomTile.remove()`, and the root is freshly decoded
    // after every removal. No removal result is ever an acknowledgement.
    private collapseOwnedScope(scope: CurrentScope): boolean {
        const seam: ResetSeam<TileCapability, WindowCapability> = {
            snapshot: () => this.resetSnapshot(scope),
            unmanage: (_tile, window) => detachWindowFromTile(window),
            remove: (tile) => isCustomTile(tile) && removeCustomTile(tile, this.markStructuralMutation),
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

    // Fresh resolution of a compiled blueprint path to the live custom tile:
    // the scope root is re-resolved from the environment and the tree is
    // re-decoded on every call, so the returned handle is valid only until the
    // next structural call and is never retained across one. Per-segment child
    // selection is derived by the split adapter from relativeGeometry, not
    // from tiles[] array index: multi-ordinal native array order is
    // unestablished (custom-tile-split.ts:18-23).
    private presetTileAtPath(scope: CurrentScope, path: BlueprintPath): CustomTileCapability | null {
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root)) {
            return null;
        }
        let current: CustomTileCapability = root;
        for (const segment of path) {
            if (segment === "root") {
                continue;
            }
            const ordered = customTileSplitSeam.decodeChildren(current);
            if (ordered === null || ordered.length !== 2) {
                return null;
            }
            const child = segment === "left" ? ordered[0] : ordered[1];
            if (child === undefined) {
                return null;
            }
            current = child;
        }
        return current;
    }

    // Full preset reconstruction, phase two body: a single synchronous
    // splits-only batch realizing the configured preset blueprint for the
    // current owned population on the freshly resolved single-leaf root, then
    // guarded assignments of the population to the ordinal leaves. Every split
    // re-resolves the scope root and fresh-decodes the tree around the call,
    // and the native split return value is discarded, so no tile handle
    // survives from one structural call to the
    // next. The whole split reconstruction finishes in one dispatch, never one
    // frame per tile.
    private rebuildPreset(
        scope: CurrentScope,
        population: readonly WindowCapability[],
    ): boolean {
        if (population.length === 0) {
            return false;
        }
        const compiled = buildPreset(this.tilingAlgorithm, population.length);
        if (!compiled.ok) {
            return false;
        }
        for (const instruction of compiled.value.splits) {
            const target = this.presetTileAtPath(scope, instruction.targetPath);
            if (target === null) {
                return false;
            }
            try {
                splitCustomTile(target, layoutDirectionFor(instruction.orientation), this.markStructuralMutation);
            } catch (error) {
                void error;
                return false;
            }
            const children = customTileSplitSeam.decodeChildren(target);
            if (children === null || children.length !== 2) {
                return false;
            }
            // The target is re-resolved and re-decoded for the next split and
            // the final leaf realization.
        }
        const leaves: TileCapability[] = [];
        for (const leafPath of compiled.value.leafPaths) {
            const leaf = this.presetTileAtPath(scope, leafPath.path);
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
                assigned = assignWindowToTile(window, leaf, this.markStructuralMutation);
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

    private recordDetached(window: WindowCapability): void {
        if (this.detachedWindows.size >= MAX_SEQUENTIAL_LENGTH) {
            const stale = this.detachedWindows.values().next().value;
            if (stale !== undefined) {
                this.detachedWindows.delete(stale);
            }
        }
        this.detachedWindows.add(window);
    }

    // Re-establish the configured preset invariant for an owned scope after a
    // managed count change: when the current tree no longer realizes the preset
    // blueprint for the current population, start a full reconstruction. A
    // scope with no owned population or an authoritative valid overlay is
    // untouched. The scope root is decoded exactly once per check and shared by
    // the occupancy-bijection predicate and the canonical-shape predicate.
    private presetEnsureInvariant(scope: CurrentScope): void {
        if (!this.layoutDomain.isOwned(scope) || this.layoutDomain.isInert(scope)) {
            return;
        }
        if (this.readSelectedOverlay(scope) !== null) {
            return;
        }
        if (this.scopeHasFullscreen(scope)) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (this.scopeHasMaximized(scope)) {
            this.diagnostic("maximize:ignored reconstruction while maximized");
            return;
        }
        if (this.interactiveDrag.isLive()) {
            this.interactiveDrag.markOwedInvariant(scope);
            return;
        }
        const population = this.ownedPopulation(scope);
        if (population.length === 0) {
            return;
        }
        if (this.scopeHasFloating(scope)) {
            // Floating windows vacated preserved leaves that must never be
            // collapsed: the mismatch they cause is by design, so the tree is
            // accepted as the user left it instead of being reconstructed.
            this.diagnostic("ownership-invariant:float-preserved");
            return;
        }
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root) || !dwindleBijectionTreeMatches(scope, root, population)) {
            this.diagnostic("ownership-invariant:bijection-failed");
            this.layoutDomain.startReconstruction(scope);
            return;
        }
        if (!this.presetShapeMatches(root, population)) {
            this.diagnostic("ownership-accepted:non-canonical:bijection-intact");
        }
    }

    // Canonical preset-shape predicate for the already-resolved scope root:
    // whether the tree realizes the configured preset blueprint for the
    // population count. A population of one is realized by exactly one usable
    // leaf (a non-layout tile or a zero-child layout root); higher counts
    // require the exact preset tree with its deterministic branch
    // orientations. Only the shape is checked here; occupancy is the separate
    // bijection predicate. The root is never re-read.
    private presetShapeMatches(root: CustomTileCapability, population: readonly WindowCapability[]): boolean {
        const count = population.length;
        if (count === 1) {
            const leaves = decodeUsableLeaves(root);
            return leaves !== null && leaves.length === 1;
        }
        const blueprint = presetBlueprint(this.tilingAlgorithm, count);
        if (!blueprint.ok) {
            return false;
        }
        return presetNodeMatches(root, blueprint.value);
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

    // Resolve the configured automatic split target to the intended occupied
    // leaf for an owned-scope automatic insertion. The candidate set is the
    // scope's usable leaves in stable compareLeaves order, the dwindle intent
    // is the deepest-right-spine leaf, and the active leaf qualifies only when
    // the active window's tile is one of those candidates. Returns the
    // intended leaf tile with its own depth or null when the strategy yields no
    // eligible occupied
    // intended leaf. Any structural degradation preserves the dwindle intent
    // unchanged.
    private automaticSplitIntended(
        scope: CurrentScope,
        deepest: { readonly tile: CustomTileCapability; readonly depth: number },
    ): { readonly tile: CustomTileCapability; readonly depth: number } | null {
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root)) {
            return null;
        }
        const depths = dwindleLeafDepths(root);
        const usable = decodeUsableLeaves(root);
        if (depths === null || usable === null) {
            return deepest;
        }
        const candidates: AutomaticSplitCandidate[] = [];
        for (let index = 0; index < usable.length; index += 1) {
            const entry = usable[index];
            if (entry === undefined) {
                continue;
            }
            const tile = entry.tile;
            if (!isCustomTile(tile)) {
                continue;
            }
            const depth = depths.get(tile);
            if (depth === undefined) {
                return deepest;
            }
            const occupants = entry.windows.filter(
                (value) => windowInScope(value, scope) && value.tile === tile,
            );
            candidates.push({
                tile,
                depth,
                leaf: {
                    id: `tile-${index}`,
                    isLayout: tile.isLayout,
                    geometry: tile.absoluteGeometry,
                    windows: [],
                },
                occupied: occupants.length === 1,
            });
        }
        candidates.sort((a, b) => compareLeaves(a.leaf, b.leaf));
        let active: AutomaticSplitCandidate | null = null;
        const activeWindow = this.environment.activeWindow();
        if (isWindow(activeWindow) && activeWindow.tile !== null) {
            for (const candidate of candidates) {
                if (candidate.tile === activeWindow.tile) {
                    active = candidate;
                    break;
                }
            }
        }
        const context: AutomaticSplitSelectionContext = {
            dwindle:
                candidates.find((candidate) => candidate.tile === deepest.tile) ?? {
                    tile: deepest.tile,
                    depth: deepest.depth,
                    leaf: {
                        id: "tile-dwindle",
                        isLayout: deepest.tile.isLayout,
                        geometry: deepest.tile.absoluteGeometry,
                        windows: [],
                    },
                    occupied: false,
                },
            candidates,
            active,
        };
        const selected = selectAutomaticSplitTarget(this.automaticSplitTarget, context);
        return selected === null ? null : { tile: selected.tile as CustomTileCapability, depth: selected.depth };
    }

    // One dwindle insertion: split the selected leaf along its longest axis,
    // keep its sole eligible occupant on the first child, and
    // assign the incoming window to the second child. The split is the only
    // structural call; its result is freshly decoded before any assignment.
    // A structural or decode failure marks the scope inert; a strict
    // geometry-order rejection is a capacity failure that leaves the scope
    // retryable.
    private dwindleInsert(window: WindowCapability, scope: CurrentScope): void {
        if (this.layoutDomain.hasPendingRebuild(scope)) {
            // A reconstruction is already pending for this scope: leave the
            // incoming window floating and let the pending rebuild re-resolve
            // the fresh population (which includes it) on its next dispatch.
            // Never mutate topology or damage the scope mid-reconstruction.
            return;
        }
        if (this.scopeHasFullscreen(scope)) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
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
        if (this.scopeHasMaximized(scope)) {
            // A genuinely tiled maximized window's preserved slot lives in
            // this scope and reconstruction is deferred: refuse the split so
            // additions cannot mutate the deferred topology into an inert
            // state, and leave the incoming window for the deferred
            // reconstruction to re-resolve.
            this.diagnostic("maximize:ignored insert while maximized");
            return;
        }
        // Resolve the configured `automaticSplitTarget` to the intended
        // occupied leaf before any structural call. The accepted selector
        // decides between the dwindle deepest-right-spine intent, the largest
        // eligible occupied leaf, and the active in-scope occupied leaf. The
        // chosen leaf is the only changed target and supplies its longest-axis
        // orientation; the nearest-splittable fallback and
        // no-candidate floating behavior below apply relative to it. A null
        // selection (`largest` with no occupied leaf) floats the newcomer
        // alone and leaves the tree untouched.
        const intended = this.automaticSplitIntended(scope, deepest);
        if (intended === null) {
            this.floatingWindows.add(window);
            this.floatScopes.set(window, scope.scope);
            this.diagnostic("ownership-add-refused:no-eligible-leaf");
            return;
        }
        // The occupant list of the insertion leaf. When the insertion tile is
        // the layout root of a functionally single-leaf tree, the occupant
        // lives in the tree's only non-layout leaf, or in the root itself when
        // the root is a zero-child layout (the sole usable leaf).
        const insertion = this.insertionLeafWindows(scope, topology, intended);
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
                assigned = assignWindowToTile(window, insertion.tile, this.markStructuralMutation);
            } catch (error) {
                void error;
            }
            if (!assigned || !this.presetMatches(scope, this.ownedPopulation(scope))) {
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
        // Preflight the intended leaf before any split: when it cannot split
        // along its own longest axis without violating KWin's
        // minimum floor, select the eligible fallback candidate (or float the
        // newcomer alone when none exists) before any structural mutation.
        const intendedLeaf = operationLeafForTile(topology, intended.tile);
        const intendedGeometry = intendedLeaf?.leaf.geometry ?? intended.tile.absoluteGeometry;
        const intendedAxis: SplitAxis = intendedGeometry.width >= intendedGeometry.height ? "x" : "y";
        let target: DwindleInsertionTarget;
        if (!this.splitAxisWouldViolateMinimum(scope, intendedGeometry, intendedAxis)) {
            target = { tile: intended.tile, depth: intended.depth, occupant };
        } else {
            const fallback = this.dwindleInsertionFallback(scope, topology, intended);
            if (fallback === null) {
                // No leaf can split along its own longest axis: the newcomer
                // alone stays floating, the tree is untouched, and the scope
                // stays retryable rather than being marked inert.
                this.floatingWindows.add(window);
                this.floatScopes.set(window, scope.scope);
                this.diagnostic("ownership-add-refused:no-eligible-leaf");
                return;
            }
            target = fallback;
        }
        const targetGeometry = target.tile.absoluteGeometry;
        const targetAxis: SplitAxis = targetGeometry.width >= targetGeometry.height ? "x" : "y";
        if (parentHasSameSplitAxis(target.tile, targetAxis)) {
            this.floatingWindows.add(window);
            this.floatScopes.set(window, scope.scope);
            this.diagnostic("ownership-add-refused:same-axis-parent");
            return;
        }
        const orientation: Orientation = targetAxis === "x" ? "horizontal" : "vertical";
        try {
            splitCustomTile(target.tile, layoutDirectionFor(orientation), this.markStructuralMutation);
        } catch (error) {
            void error;
            this.markInert(scope, "insert-split-threw");
            return;
        }
        const decoded = decodeSequential(target.tile.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
        const children = customTileSplitSeam.decodeChildren(target.tile);
        if (!decoded.ok) {
            this.markInert(scope, "insert-split-decode-failed");
            return;
        }
        if (children === null) {
            if (decoded.value.length < 2) {
                this.markInert(scope, "insert-split-decode-failed");
                return;
            }
            // The live list decoded, but the adapter rejected its geometry,
            // including the zero-extent minimum-size case. This is retryable
            // capacity failure rather than a damaged structural decode.
            this.diagnostic("ownership-add-failed:no-child-geometry");
            return;
        }
        if (children.length !== 2) {
            this.markInert(scope, "insert-split-decode-failed");
            return;
        }
        this.decodedBoundary("split-result");
        const firstChild = children[0];
        const secondChild = children[1];
        if (firstChild === undefined || secondChild === undefined) {
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
            occupantAssigned = assignWindowToTile(target.occupant, firstChild, this.markStructuralMutation);
            incomingAssigned = occupantAssigned && assignWindowToTile(window, secondChild, this.markStructuralMutation);
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

    // Select the eligible fallback insertion leaf when the intended right-spine
    // leaf cannot split along its longest axis without violating
    // KWin's minimum floor. Candidates are the scope's usable leaves in stable
    // ascending compareLeaves order; the winner is the eligible leaf at the
    // minimum absolute index distance from the intended leaf, with the earlier
    // compareLeaves leaf winning an equal-distance tie. The intended leaf is
    // not required to be an endpoint. Null when no candidate can split.
    private dwindleInsertionFallback(
        scope: CurrentScope,
        topology: readonly OperationLeaf[],
        deepest: { readonly tile: CustomTileCapability; readonly depth: number },
    ): DwindleInsertionTarget | null {
        const root = this.environment.rootTile(scope.output, scope.desktop);
        if (!isCustomTile(root)) {
            return null;
        }
        const depths = dwindleLeafDepths(root);
        if (depths === null) {
            return null;
        }
        const candidates = [...topology].sort((a, b) => compareLeaves(a.leaf, b.leaf));
        const intendedIndex = candidates.findIndex((entry) => entry.decoded.tile === deepest.tile);
        const ranked = candidates
            .map((entry, index) => ({ entry, index, distance: Math.abs(index - intendedIndex) }))
            .filter((item) => item.entry.decoded.tile !== deepest.tile)
            .sort((a, b) => a.distance - b.distance || a.index - b.index);
        for (const item of ranked) {
            const entry = item.entry;
            if (!isCustomTile(entry.decoded.tile)) {
                continue;
            }
            const tile = entry.decoded.tile;
            const depth = depths.get(tile);
            if (depth === undefined) {
                continue;
            }
            const axis: SplitAxis = entry.leaf.geometry.width >= entry.leaf.geometry.height ? "x" : "y";
            if (this.splitAxisWouldViolateMinimum(scope, entry.leaf.geometry, axis)) {
                continue;
            }
            const occupants = entry.windows.filter(
                (value) => windowInScope(value, scope) && value.tile === tile,
            );
            if (occupants.length !== 1) {
                continue;
            }
            const occupant = occupants[0];
            if (occupant === undefined) {
                continue;
            }
            return { tile, depth, occupant };
        }
        return null;
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
        if (this.scopeHasFullscreen(scope)) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
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
        onDragSettled?: (topology: readonly OperationLeaf[], collapsed: boolean) => readonly OperationLeaf[],
    ): void {
        this.layoutDomain.deferRemovalCollapse(window, scope, leafTile, afterDragSnapshot, onDragSettled);
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
        onDragSettled?: (topology: readonly OperationLeaf[], collapsed: boolean) => readonly OperationLeaf[],
    ): void {
        if (this.layoutDomain.isInert(scope) || !this.layoutDomain.isOwned(scope)) {
            return;
        }
        if (this.interactiveDrag.isLive()) {
            this.interactiveDrag.markOwedInvariant(scope);
            return;
        }
        if (this.readSelectedOverlay(scope) !== null) {
            return;
        }
        if (this.scopeHasFullscreen(scope)) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        const topology = this.topologyForScope(scope);
        if (topology === null) {
            this.markInert(scope, "settle-topology-failed");
            return;
        }
        const leaf = operationLeafForTile(topology, leafTile);
        if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
            if (afterDragSnapshot) onDragSettled?.(topology, false);
            return;
        }
        if (windowIndex(leaf.windows, window) >= 0) {
            if (afterDragSnapshot) onDragSettled?.(topology, false);
            return;
        }
        if (leaf.windows.some((value) => value !== window && windowInScope(value, scope))) {
            if (afterDragSnapshot) onDragSettled?.(topology, false);
            return;
        }
        const after = this.collapseFreedLeaf(scope, topology, leaf.decoded.tile);
        if (afterDragSnapshot && after !== null) {
            onDragSettled?.(after, true);
            this.layoutDomain.markPendingDragFinalSnapshot(scope);
        }
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
            removed = removeCustomTile(leafTile, this.markStructuralMutation);
        } catch (error) {
            void error;
        }
        if (!removed) {
            this.markInert(scope, "leaf-remove-failed");
            return null;
        }
        const after = this.topologyForScope(scope);
        if (after === null) {
            this.markInert(scope, "leaf-collapse-verify-failed");
            return null;
        }
        if (after.length !== topology.length - 1) {
            // The remove reported success but the live leaf count did not drop
            // by exactly one. This is a recoverable count mismatch, not a
            // damaged tree: defer to the invariant recovery instead of marking
            // the scope inert, so the owed check re-settles the population.
            this.diagnostic("ownership-remove-failed:leaf-count");
            this.presetEnsureInvariant(scope);
            return null;
        }
        this.diagnostic("ownership-remove-collapsed");
        // A changed managed count may leave the tree non-dwindle (for example
        // removing the first chain window's leaf leaves a single-child root);
        // the invariant check starts a reconstruction in this same removals-only
        // dispatch and defers the split reconstruction.
        this.presetEnsureInvariant(scope);
        return after;
    }

    // ---- Dynamic virtual desktops ----

    // Ordered live desktop list, or null when the workspace surface is absent
    // or the list cannot be decoded. Ordering is 1-based X11 number ascending
    // with positional-order fallback; identity is always the string id.
    private liveDesktops(): readonly VirtualDesktopCapability[] | null {
        let value: unknown;
        try {
            value = this.environment.desktops();
        } catch (error) {
            this.diagnostic(`workspace-desktops-unavailable:${describeWorkspaceFailure(error)}`);
            return null;
        }
        const decoded = decodeSequential(value, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
        if (!decoded.ok) {
            this.diagnostic("workspace-desktops-unavailable:decode");
            return null;
        }
        return orderedDesktops(decoded.value);
    }

    private handleDesktopsChanged(): void {
        this.gate.run(() => {
            this.cleanupDesktops();
            this.workspaceDomain.drainPendingDesktopIntents();
        }, (reason) => this.disabled(reason));
    }

    // Rebuild the deterministic session output keys from `workspace.screens`
    // (spec E). A missing or undecodable screens surface is read-only and
    // silently skipped: no key changes, and startup/lifecycle is unaffected.
    private rebuildOutputKeys(): void {
        let raw: unknown;
        try {
            raw = this.environment.screens();
        } catch (error) {
            void error;
            return;
        }
        const decoded = decodeSequential(raw, isOutput, MAX_SEQUENTIAL_LENGTH);
        if (!decoded.ok) {
            return;
        }
        this.outputKeys.rebuild(decoded.value);
    }

    // Meta+1..9: navigate to the existing desktop at the given 1-based index.
    // An absent index is a specific no-op and never creates a desktop. In
    // per-output-local mode the target resolves against the active output's
    // local list and writes through the per-output seam only; in global-unique
    // mode it resolves the nth member of the active output's assigned subset
    // (spec D2). In shared mode it resolves the nth member of the shared set and
    // synchronizes every connected output (spec D3).
    navigateWorkspace(index: number): void {
        this.gate.run(() => {
            this.diagnostic(`workspace-navigate-invoked:${index}`);
            if (this.workspaceMode === "per-output-local") {
                this.navigateLocalWorkspace(index);
                return;
            }
            if (this.workspaceMode === "global-unique") {
                this.navigateGlobalUnique(index);
                return;
            }
            this.navigateShared(index);
        }, (reason) => this.disabled(reason));
    }

    // Per-output-local navigation (spec D1): resolve logical index n against the
    // focused window's output local list and write
    // `setCurrentDesktopForScreen(target, output)`; the other outputs are never
    // touched. With no focused window the active output is `workspace.activeScreen`
    // (spec D common), resolved through the typed seam; when that is unavailable
    // the migrated single-output global fallback is preserved, so a desktop
    // change never fails or recurses when focus is elsewhere. The mapping is
    // refreshed from the live list first (idempotent, never creates) so a
    // pre-existing desktop added since the last reconciliation still resolves.
    private navigateLocalWorkspace(index: number): void {
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        this.rebuildLocalMapping(desktops);
        const output = this.activeOutputForWorkspace();
        if (output !== null) {
            const key = this.outputKeys.keyFor(output);
            const list = key === undefined ? undefined : this.localWorkspaces.get(key);
            if (list === undefined) {
                return;
            }
            const id = list[index - 1];
            if (id === undefined) {
                this.diagnostic(`workspace-navigate-absent:${index}`);
                return;
            }
            const target = desktops.find((desktop) => desktop.id === id);
            if (target === undefined) {
                this.diagnostic(`workspace-navigate-absent:${index}`);
                return;
            }
            this.setCurrentDesktop(target, output);
            this.diagnostic(`workspace-navigate-completed:${index}`);
            return;
        }
        // No focused window and no decodable active screen: the migrated
        // single-output global active-screen fallback (safe no-op on an
        // unavailable activeScreen; `activeOutputForWorkspace` already reported
        // the unavailable seam).
        const target = desktops[index - 1];
        if (target === undefined) {
            this.diagnostic(`workspace-navigate-absent:${index}`);
            return;
        }
        this.setCurrentDesktop(target);
        this.diagnostic(`workspace-navigate-completed:${index}`);
    }

    // ---- shared workspace set (Unit 07, spec D3) ----
    //
    // One logical workspace set synchronized across every connected output:
    // logical number n maps to the nth member of the shared ordered desktop id
    // set, which is the ordered live global list (pre-existing and owned alike),
    // rebuilt idempotently on every reconcile. No output owns a desktop, so
    // navigation, move-follow, and move-append synchronize every output via
    // `setCurrentDesktopForScreen` (spec G native). Windows never transfer
    // outputs implicitly; a window's membership write is the only thing that
    // moves it.

    // Read-only rebuild of the shared set from the current live list. Never
    // creates or removes a desktop; a rename/reorder cannot change the set
    // (identity is the id string, spec E) and hotplug/disconnect leaves it
    // intact.
    private rebuildSharedMapping(desktops?: readonly VirtualDesktopCapability[]): void {
        if (this.workspaceMode !== "shared") {
            return;
        }
        const resolved = desktops ?? this.liveDesktops();
        if (resolved === null) {
            return;
        }
        this.sharedWorkspaces.length = 0;
        this.sharedWorkspaces.push(...resolved.map((desktop) => desktop.id));
    }

    // Shared navigation (spec D3): resolve logical index n against the shared
    // set and synchronize every connected output to that desktop. Absent n is a
    // specific no-op and never creates (spec D common).
    private navigateShared(index: number): void {
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        this.rebuildSharedMapping(desktops);
        const target = desktops[index - 1];
        if (target === undefined) {
            this.diagnostic(`workspace-navigate-absent:${index}`);
            return;
        }
        this.synchronizeShared(target);
        this.diagnostic(`workspace-navigate-completed:${index}`);
    }

    // Shared-mode synchronization (spec D3): set every currently connected
    // output's current desktop to `target` by iterating
    // `setCurrentDesktopForScreen` over `workspace.screens` (spec G native).
    // A throwing per-output write is reported and does not stop the remaining
    // outputs. When screens cannot be enumerated the single global active-screen
    // write falls back, so a desktop change never fails on an unavailable seam.
    // The write fires currentDesktopChanged, whose handler reconciles
    // idempotently; the reconciliation guard keeps the re-entry inert, so no
    // event loop is produced (spec F, Unit 07 risk).
    private synchronizeShared(target: VirtualDesktopCapability): void {
        let raw: unknown;
        try {
            raw = this.environment.screens();
        } catch (error) {
            void error;
            try {
                this.environment.setCurrentDesktop(target);
                this.diagnostic("workspace-navigate-set");
            } catch (setError) {
                this.diagnostic(`workspace-navigate-failed:${describeWorkspaceFailure(setError)}`);
            }
            return;
        }
        const screens = decodeSequential(raw, isOutput, MAX_SEQUENTIAL_LENGTH);
        if (!screens.ok || screens.value.length === 0) {
            try {
                this.environment.setCurrentDesktop(target);
                this.diagnostic("workspace-navigate-set");
            } catch (error) {
                this.diagnostic(`workspace-navigate-failed:${describeWorkspaceFailure(error)}`);
            }
            return;
        }
        for (const output of screens.value) {
            try {
                this.environment.setCurrentDesktopForScreen(target, output);
                this.diagnostic("workspace-navigate-set");
            } catch (error) {
                this.diagnostic(`workspace-navigate-failed:${describeWorkspaceFailure(error)}`);
            }
        }
    }

    // Hotplug in shared mode (spec D3/E): a newly connected output starts at the
    // current shared workspace. Synchronizing every connected output to the
    // current shared desktop brings a fresh output onto the shared workspace
    // without moving a window or deleting a desktop; disconnect never deletes a
    // desktop (cleanup keeps the shared trailing empty and current set). Inert
    // in every non-shared mode and when the current desktop is unreadable.
    private synchronizeSharedCurrent(): void {
        if (this.workspaceMode !== "shared") {
            return;
        }
        let current: unknown;
        try {
            current = this.environment.currentDesktop();
        } catch (error) {
            void error;
            return;
        }
        if (!isVirtualDesktop(current)) {
            return;
        }
        this.synchronizeShared(current);
    }

    // Meta+0 (spec C/D, `plasma-auto-tiler-workspace-0`): per-output-local
    // reuses the active output's existing trailing empty when one exists
    // (Q-Zero: a no-op when it is already the current desktop on that
    // output), creating only when none exists. global-unique (unit-03) reuses
    // the single global trailing empty the same way, applying the
    // cross-output swap when it is currently shown elsewhere; shared creates
    // the shared desktop and synchronizes every connected output. While a
    // drag, reconstruction, or unsettled move is live the whole invocation is
    // queued through the existing settle queue and completed after the settle
    // seam (spec F bounded drain).
    workspaceZero(): void {
        this.gate.run(() => {
            this.diagnostic("workspace-zero-invoked");
            const output = this.activeOutputForWorkspace();
            this.finishWorkspaceZero(output);
        }, (reason) => this.disabled(reason));
    }

    // Execute one Meta+0 request against the current context: always creates a
    // new desktop, never reuses an existing one. A live drag, pending
    // reconstruction, or unsettled move defers the whole invocation through the
    // existing settle queue (spec F bounded drain); the queued output is
    // re-resolved against the fresh context on execution. The active output is
    // resolved once per invocation (spec D common); per-output-local and
    // global-unique fail safely when no output key exists and act only on that
    // output, and shared is output-agnostic. Creation or set-current failure is
    // reported by the existing surfaces and never leaves a partial desktop
    // (non-destructive).
    private finishWorkspaceZero(output: OutputCapability | null): void {
        if (this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0) {
            if (output !== null) {
                this.workspaceDomain.deferWorkspaceZero(output);
            }
            return;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        if (this.workspaceMode === "shared") {
            this.finishSharedWorkspaceZero(desktops);
            return;
        }
        if (output === null) {
            this.diagnostic("workspace-zero-absent:no-active-output");
            return;
        }
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            this.diagnostic("workspace-zero-absent:output-key");
            return;
        }
        if (this.workspaceMode === "per-output-local") {
            this.finishLocalWorkspaceZero(output, desktops);
            return;
        }
        this.finishGlobalWorkspaceZero(output, desktops);
    }

    // global-unique Meta+0: reuse the active output's own structurally-
    // identified trailing empty (its own globalUniqueAssigned group, ordered
    // by x11DesktopNumber) when one exists. Never applies the cross-output
    // swap (globalUniqueSwapIfVisibleElsewhere) - a trailing empty is scoped
    // to its output's domain and is never reused from a different output.
    // Q-Zero: if it is already the current desktop on this output, the whole
    // invocation is a no-op. Only when no trailing empty exists does this
    // fall back to appendDesktopForGlobalUnique - the same creation primitive
    // enforceGlobalTrailingEmpty() uses.
    private finishGlobalWorkspaceZero(
        output: OutputCapability,
        desktops: readonly VirtualDesktopCapability[],
    ): void {
        this.reconcileGlobalUnique(desktops);
        const existing = this.resolveGlobalTrailingEmpty(output);
        if (existing !== null) {
            if (this.isCurrentOnOutput(output, existing.id)) {
                this.diagnostic("workspace-zero-no-op:already-there");
                return;
            }
            this.focusTrailingEmpty(existing, output);
            return;
        }
        const target = this.appendDesktopForGlobalUnique(output);
        if (target === null) {
            return;
        }
        this.focusTrailingEmpty(target, output);
    }

    // per-output-local Meta+0: rebuild the mapping, then reuse the output's
    // structurally-identified trailing empty when one exists. Q-Zero: if it
    // is already the current desktop on this output, the whole invocation is
    // a no-op (no unbounded growth from repeated presses). Otherwise it is
    // focused. Only when no trailing empty exists does this fall back to
    // appendTrailingForOutput - the same creation primitive
    // enforceLocalTrailingEmpties() uses, so there is exactly one append
    // path per output domain.
    private finishLocalWorkspaceZero(
        output: OutputCapability,
        desktops: readonly VirtualDesktopCapability[],
    ): void {
        this.rebuildLocalMapping(desktops);
        const existing = this.resolveLocalTrailingEmpty(output);
        if (existing !== null) {
            if (this.isCurrentOnOutput(output, existing.id)) {
                this.diagnostic("workspace-zero-no-op:already-there");
                return;
            }
            this.focusTrailingEmpty(existing, output);
            return;
        }
        const target = this.appendTrailingForOutput(output);
        if (target === null) {
            return;
        }
        this.focusTrailingEmpty(target, output);
    }

    // Shared-mode Meta+0: reuse the structurally-identified global trailing
    // empty (the whole live desktop list, since shared has no per-output
    // domain) when one exists, synchronizing every connected output to it.
    // Q-Zero: if it is already the shared current desktop, the whole
    // invocation is a no-op. Only when no trailing empty exists does this
    // fall back to appendDesktopForShared - the same creation primitive
    // enforceSharedTrailingEmpty() uses.
    private finishSharedWorkspaceZero(desktops: readonly VirtualDesktopCapability[]): void {
        this.rebuildSharedMapping(desktops);
        const existing = this.resolveSharedTrailingEmpty();
        if (existing !== null) {
            if (this.isCurrentShared(existing.id)) {
                this.diagnostic("workspace-zero-no-op:already-there");
                return;
            }
            this.diagnostic("workspace-zero-completed");
            this.synchronizeShared(existing);
            return;
        }
        const target = this.appendDesktopForShared();
        if (target === null) {
            return;
        }
        this.diagnostic("workspace-zero-completed");
        this.synchronizeShared(target);
    }

    // Focus the mode-defined trailing empty on the active output through the
    // per-output seam (per-output-local and global-unique).
    private focusTrailingEmpty(target: VirtualDesktopCapability, output: OutputCapability): void {
        this.setCurrentDesktop(target, output);
        this.diagnostic("workspace-zero-completed");
    }

    // Execute a deferred Meta+Shift+0 request: re-validate the captured window
    // against current context, ensure the trailing empty exists, then move the
    // window into it. A window that is no longer movable cancels the request.
    private finishMoveToTrailing(window: WindowCapability): void {
        if (!this.isWindowMovableToTrailing(window)) {
            this.diagnostic("workspace-move-deferred-cancelled:stale");
            return;
        }
        const scope = this.scopeForWindow(window);
        if (scope === null) {
            this.diagnostic("workspace-move-deferred-cancelled:scope");
            return;
        }
        let target: VirtualDesktopCapability | null;
        if (this.workspaceMode === "per-output-local") {
            this.rebuildLocalMapping();
            if (this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0) {
                this.workspaceDomain.deferDesktopIntent(window);
                return;
            }
            // Reuse the target output's existing trailing empty when one
            // exists; only create (via the same primitive
            // enforceLocalTrailingEmpties() uses) when it does not. The
            // existing target.id === scope.desktop.id check below already
            // handles "already there" as a no-op for both the reused and
            // freshly-created cases.
            target = this.resolveLocalTrailingEmpty(scope.output) ?? this.appendTrailingForOutput(scope.output);
        } else if (this.workspaceMode === "global-unique") {
            if (this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0) {
                this.workspaceDomain.deferDesktopIntent(window);
                return;
            }
            // Reuse the target output's own trailing empty (its own
            // globalUniqueAssigned group) when one exists; only create (via
            // the same primitive enforceGlobalTrailingEmpty() uses) when it
            // does not. Never applies the cross-output swap - a trailing
            // empty is never reused from a different output's domain. The
            // existing target.id === scope.desktop.id check further down
            // already handles "already there" as a no-op.
            const liveForRebuild = this.liveDesktops();
            if (liveForRebuild !== null) {
                this.reconcileGlobalUnique(liveForRebuild);
            }
            target = this.resolveGlobalTrailingEmpty(scope.output) ?? this.appendDesktopForGlobalUnique(scope.output);
        } else {
            if (this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0) {
                this.workspaceDomain.deferDesktopIntent(window);
                return;
            }
            target = this.resolveSharedTrailingEmpty() ?? this.appendDesktopForShared();
        }
        if (target === null) {
            return;
        }
        if (target.id === scope.desktop.id) {
            this.diagnostic("workspace-move-no-op:already-there");
            if (this.workspaceMode === "shared") {
                this.synchronizeShared(target);
            }
            return;
        }
        this.moveWindowToDesktop(window, scope, target);
        if (this.workspaceMode === "shared") {
            this.synchronizeShared(target);
        }
    }

    // Re-validate a deferred move's captured window: still a movable normal
    // managed window in a readable scope, and not sticky or fullscreen. The
    // scope is re-resolved from the current context so a desktop change during
    // the deferral is respected rather than acted on stale.
    private isWindowMovableToTrailing(window: WindowCapability): boolean {
        if (!isWindow(window) || window.fullScreen === true) {
            return false;
        }
        if (!window.normalWindow || !window.managed || !window.resizeable || window.appletPopup) {
            return false;
        }
        if (this.isSticky(window)) {
            return false;
        }
        const scope = this.scopeForWindow(window);
        return scope !== null && windowInScope(window, scope);
    }

    // Append one desktop through the createDesktop surface, re-enumerating the
    // live list to resolve the new desktop (no desktop lookup API exists). The
    // new desktop is recorded script-owned for this session only. The
    // reconciliation guard is held across the create so the synchronous
    // desktopsChanged re-entry cannot reconcile the not-yet-owned desktop.
    private appendDesktop(): VirtualDesktopCapability | null {
        const before = this.liveDesktops();
        if (before === null) {
            return null;
        }
        const beforeIds = new Set(before.map((desktop) => desktop.id));
        const guarding = !this.reconcilingDesktops;
        if (guarding) {
            this.reconcilingDesktops = true;
        }
        try {
            try {
                this.environment.createDesktop(before.length + 1, String(before.length + 1));
            } catch (error) {
                this.diagnostic(`workspace-append-create-failed:${describeWorkspaceFailure(error)}`);
                return null;
            }
            const after = this.liveDesktops();
            if (after === null) {
                this.diagnostic("workspace-append-created-unverified");
                return null;
            }
            const fresh = after.filter((desktop) => !beforeIds.has(desktop.id));
            const candidate = fresh.length === 1 ? fresh[0] : fresh[fresh.length - 1];
            if (candidate === undefined) {
                this.diagnostic("workspace-append-created-unresolved");
                return null;
            }
            this.ownedDesktopIds.add(candidate.id);
            this.diagnostic("workspace-created-owned");
            return candidate;
        } finally {
            if (guarding) {
                this.reconcilingDesktops = false;
            }
        }
    }

    // Meta+Shift+1..9 and Meta+Shift+0: move the focused window to the target
    // desktop then follow it. Index 0 appends first. A sticky window is a
    // specific no-op; fullscreen is refused by the active-action guard.
    moveActiveToWorkspace(index: number): void {
        this.gate.run(() => {
            this.diagnostic(`workspace-move-invoked:${index}`);
            const activeNow = this.environment.activeWindow();
            if (isWindow(activeNow) && activeNow.fullScreen === true) {
                this.diagnostic("workspace-move-refused:fullscreen");
                return;
            }
            // Moving a maximized window is refused before any mutation: restore
            // and move are separate writes with no demonstrated rollback, so
            // restoring first could strand the window un-maximized if the move
            // later failed. The maximize state stays intact.
            if (isWindow(activeNow) && this.maximizedWindows.has(activeNow)) {
                this.diagnostic("workspace-move-refused:maximized");
                return;
            }
            const guard = this.activeActionGuard("workspace-move");
            if (guard === null) {
                return;
            }
            const { active, scope } = guard;
            if (this.isSticky(active)) {
                this.diagnostic("workspace-move-refused:sticky");
                return;
            }
            if (this.workspaceMode === "per-output-local") {
                this.rebuildLocalMapping();
            }
            let target: VirtualDesktopCapability | null;
            if (index === 0) {
                // Move into the active output's existing trailing empty when
                // one exists (per-output-local, Q-Domain reuse; global-unique
                // reuses the active output's own trailing empty from its own
                // globalUniqueAssigned group the same way, never a different
                // output's; shared reuses the single global trailing empty
                // the same way, since it has no per-output domain), or a
                // brand-new script-owned desktop otherwise. When the desktop
                // list cannot be mutated yet (live drag, pending
                // reconstruction, unsettled move), the whole move is
                // deferred so no window moves before its required target
                // exists.
                if (this.workspaceMode === "per-output-local") {
                    if (this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0) {
                        this.workspaceDomain.deferDesktopIntent(active);
                        return;
                    }
                    target = this.resolveLocalTrailingEmpty(scope.output) ?? this.appendTrailingForOutput(scope.output);
                } else if (this.workspaceMode === "global-unique") {
                    if (this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0) {
                        this.workspaceDomain.deferDesktopIntent(active);
                        return;
                    }
                    const liveForRebuild = this.liveDesktops();
                    if (liveForRebuild !== null) {
                        this.reconcileGlobalUnique(liveForRebuild);
                    }
                    target = this.resolveGlobalTrailingEmpty(scope.output) ?? this.appendDesktopForGlobalUnique(scope.output);
                } else {
                    if (this.interactiveDrag.isLive() || this.layoutDomain.hasPendingRebuilds() || this.pendingMoves.size > 0) {
                        this.workspaceDomain.deferDesktopIntent(active);
                        return;
                    }
                    target = this.resolveSharedTrailingEmpty() ?? this.appendDesktopForShared();
                }
            } else {
                if (this.workspaceMode === "per-output-local") {
                    target = this.localTargetForOutput(scope.output, index);
                    if (target === null) {
                        this.diagnostic(`workspace-move-absent:${index}`);
                        return;
                    }
                } else if (this.workspaceMode === "global-unique") {
                    target = this.globalUniqueTargetForOutput(scope.output, index);
                    if (target === null) {
                        this.diagnostic(`workspace-move-absent:${index}`);
                        return;
                    }
                    // Move-follow applies the navigation swap first when the
                    // target is shown on another output (spec D2).
                    this.globalUniqueSwapIfVisibleElsewhere(target, scope.output);
                } else {
                    const desktops = this.liveDesktops();
                    if (desktops === null) {
                        return;
                    }
                    const entry = desktops[index - 1];
                    if (entry === undefined) {
                        this.diagnostic(`workspace-move-absent:${index}`);
                        return;
                    }
                    target = entry;
                }
            }
            if (target === null) {
                return;
            }
            if (target.id === scope.desktop.id) {
                this.diagnostic("workspace-move-no-op:already-there");
                if (this.workspaceMode === "shared") {
                    this.synchronizeShared(target);
                }
                return;
            }
            this.moveWindowToDesktop(active, scope, target);
            if (this.workspaceMode === "shared") {
                this.synchronizeShared(target);
            }
        }, (reason) => this.disabled(reason));
    }

    private moveWindowToDesktop(
        window: WindowCapability,
        sourceScope: CurrentScope,
        target: VirtualDesktopCapability,
    ): void {
        if (this.isFloating(window)) {
            this.moveFloatingWindow(window, target, sourceScope.output);
            return;
        }
        this.moveTiledWindow(window, sourceScope, target);
    }

    // Floating move: update desktop membership only, preserve floating state,
    // and never mutate the tile tree. The follow write goes to the window's
    // output, never the current active window (a deferred move can fire after
    // focus moved elsewhere).
    private moveFloatingWindow(
        window: WindowCapability,
        target: VirtualDesktopCapability,
        output: OutputCapability,
    ): void {
        if (!writeWindowDesktops(window, [target])) {
            this.diagnostic("workspace-move-failed:desktops-write");
            return;
        }
        this.diagnostic("workspace-move-floated");
        this.setCurrentDesktop(target, output);
        this.cleanupDesktops();
        this.workspaceDomain.drainPendingDesktopIntents();
    }

    // Tiled move: write the new membership, collapse the freed source leaf
    // through the removals-only pipeline, then defer the destination adoption
    // to a later event-loop turn so no remove and split share one structural
    // operation. The window is never lost: a failed destination placement
    // leaves it floating on the target.
    private moveTiledWindow(
        window: WindowCapability,
        sourceScope: CurrentScope,
        target: VirtualDesktopCapability,
    ): void {
        const targetScope: CurrentScope = {
            output: sourceScope.output,
            desktop: target,
            scope: { output: sourceScope.output, desktopId: target.id },
        };
        if (!writeWindowDesktops(window, [target])) {
            this.diagnostic("workspace-move-failed:desktops-write");
            return;
        }
        this.collapseMovedSourceLeaf(window, sourceScope);
        this.pendingMoveState.markPendingMove(window);
        let armed = false;
        try {
            armed = this.environment.yieldOnce(() => {
                try {
                    this.pendingMoveState.clearPendingMove(window);
                    this.adoptMovedWindow(window, targetScope);
                } finally {
                    this.flushStructuralMutation();
                }
            });
        } catch (error) {
            void error;
        }
        if (!armed) {
            this.pendingMoveState.clearPendingMove(window);
            this.adoptMovedWindow(window, targetScope);
            // The armed path's follow write (`setCurrentDesktop`) happens after
            // the collapse and the deferred adoption is scheduled; the
            // synchronous fallback runs the adoption inline and must still
            // honor move-follow on the moved window's output. Adoption runs
            // first so the destination placement is settled before the current
            // desktop switches to it.
            this.setCurrentDesktop(target, sourceScope.output);
            return;
        }
        this.diagnostic("workspace-move-pending");
        this.setCurrentDesktop(target, sourceScope.output);
    }

    // Collapse the source leaf a tiled window just vacated: one unmanage then
    // one removals-only leaf collapse. No split is ever performed here.
    private collapseMovedSourceLeaf(window: WindowCapability, sourceScope: CurrentScope): void {
        if (window.tile === null || !isCustomTile(window.tile) || window.tile.isLayout) {
            return;
        }
        const topology = this.topologyForScope(sourceScope);
        if (topology === null) {
            return;
        }
        const leaf = operationLeafForTile(topology, window.tile);
        if (leaf === null || leaf.leaf.isLayout || !isCustomTile(leaf.decoded.tile)) {
            return;
        }
        let unmanaged = false;
        try {
            unmanaged = unmanageTile(leaf.decoded.tile, window);
        } catch (error) {
            void error;
        }
        if (!unmanaged) {
            return;
        }
        this.collapseFreedLeaf(sourceScope, topology, leaf.decoded.tile);
    }

    // Destination adoption for a moved tiled window, on a later event-loop
    // turn: ordinary placement/adoption into the target scope. A window that is
    // still untiled afterwards is retained safely as floating on the target.
    private adoptMovedWindow(window: WindowCapability, targetScope: CurrentScope): void {
        if (!this.gate.isEnabled) {
            return;
        }
        try {
            if (window.tile !== null) {
                this.diagnostic("workspace-move-adopted-existing");
                return;
            }
            this.layoutDomain.placeEligibleAdded(window, targetScope);
            if (window.tile !== null) {
                this.diagnostic("workspace-move-adopted");
            } else if (this.layoutDomain.hasPendingRebuild(targetScope)) {
                this.diagnostic("workspace-move-adopted-deferred:reconstruction");
            } else {
                this.floatingWindows.add(window);
                this.floatScopes.set(window, targetScope.scope);
                this.diagnostic("workspace-move-adopt-failed:retained-floating");
            }
        } catch (error) {
            this.floatingWindows.add(window);
            this.floatScopes.set(window, targetScope.scope);
            this.diagnostic(`workspace-move-adopt-failed:${describeWorkspaceFailure(error)}`);
        }
        this.cleanupDesktops();
        this.workspaceDomain.drainPendingDesktopIntents();
    }

    // Navigate/follow to a desktop, written through the per-output seam on the
    // affected output when one is known (spec D1: navigation and move-follow
    // operate on the active output's current desktop via
    // setCurrentDesktopForScreen). With one output this is exactly the global
    // write, so the migrated behavior is unchanged; when no output is known
    // (no focused window), it falls back to the global active-screen write.
    // Callers that hold a scope pass its output explicitly so a deferred move
    // always follows on the moved window's output.
    private setCurrentDesktop(target: VirtualDesktopCapability, output?: OutputCapability): void {
        const resolved = output ?? this.activeOutput();
        if (resolved !== null) {
            try {
                this.environment.setCurrentDesktopForScreen(target, resolved);
                this.diagnostic("workspace-navigate-set");
                return;
            } catch (error) {
                this.diagnostic(`workspace-navigate-failed:${describeWorkspaceFailure(error)}`);
                return;
            }
        }
        try {
            this.environment.setCurrentDesktop(target);
            this.diagnostic("workspace-navigate-set");
        } catch (error) {
            this.diagnostic(`workspace-navigate-failed:${describeWorkspaceFailure(error)}`);
        }
    }

    // The active output for a workspace navigation: the focused window's output
    // when one exists, else null (the global active-screen fallback). The full
    // active-output selection (window output else workspace.activeScreen) is the
    // Unit 05 dispatch; this preserves the migrated single-output behavior.
    private activeOutput(): OutputCapability | null {
        const active = this.environment.activeWindow();
        if (isWindow(active) && isOutput(active.output)) {
            return active.output;
        }
        return null;
    }

    // The active output for keyboard workspace selection (spec D common): the
    // focused window's output when one exists, else `workspace.activeScreen`
    // when it is a valid output. Null only when neither is available; the
    // callers then preserve their safe fallback. A first connected screen is
    // never substituted for the active screen.
    private activeOutputForWorkspace(): OutputCapability | null {
        const focused = this.activeOutput();
        if (focused !== null) {
            return focused;
        }
        let raw: unknown;
        try {
            raw = this.environment.activeScreen();
        } catch (error) {
            void error;
            this.diagnostic("workspace-active-screen-unavailable");
            return null;
        }
        if (isOutput(raw)) {
            return raw;
        }
        this.diagnostic("workspace-active-screen-unavailable");
        return null;
    }

    // Rebuild each mode's mapping from the live desktop list, then enforce
    // that mode's removal/replenish authority. per-output-local enforces the
    // trailing-empty invariant (Q-Domain: one structurally-identified trailing
    // empty per connected output) via enforceLocalTrailingEmpties(), which
    // both removes eligible non-trailing empties and appends a replacement
    // trailing empty in the same domain-scoped pass. global-unique (unit-03)
    // enforces the same invariant for its single global domain via
    // enforceGlobalTrailingEmpty(). shared (unit-07) enforces the same
    // invariant for its own single global domain - the entire live desktop
    // list, since synchronizeShared already forces every output onto the
    // same current desktop and there is no per-output domain - via
    // enforceSharedTrailingEmpty(). Deferral keeps the list untouched while a
    // drag, reconstruction, or unsettled move is live, and the reconciliation
    // guard keeps create/remove re-entry inert.
    private cleanupDesktops(): void {
        if (!this.gate.isEnabled || this.reconcilingDesktops) {
            return;
        }
        if (this.interactiveDrag.isLive()) {
            this.diagnostic("workspace-cleanup-deferred:drag-live");
            return;
        }
        if (this.layoutDomain.hasPendingRebuilds()) {
            this.diagnostic("workspace-cleanup-deferred:reconstruction-pending");
            return;
        }
        if (this.pendingMoves.size > 0) {
            this.diagnostic("workspace-cleanup-deferred:move-unsettled");
            return;
        }
        const visibleSnapshot = this.visibleDesktopIds();
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        if (visibleSnapshot === null) {
            this.diagnostic("workspace-cleanup-deferred:output-visibility-unknown");
        }
        const occupiedSnapshot = this.occupiedDesktopIds();
        if (occupiedSnapshot === null) {
            this.diagnostic("workspace-cleanup-deferred:window-occupancy-unknown");
        }
        if (this.workspaceMode === "per-output-local") {
            this.reconcileLocalWorkspaces(desktops);
            this.enforceLocalTrailingEmpties();
            return;
        }
        if (this.workspaceMode === "global-unique") {
            this.reconcileGlobalUnique(desktops);
            this.enforceGlobalTrailingEmpty();
            return;
        }
        this.rebuildSharedMapping(desktops);
        this.enforceSharedTrailingEmpty();
        return;
    }

    // Shared-mode trailing-empty enforcement: the domain is the entire live
    // desktop list (Q-Domain: shared has one global trailing empty, no
    // per-output split - synchronizeShared already forces every output onto
    // the same current desktop, so there is no per-output domain to enforce
    // separately). Mirrors enforceGlobalTrailingEmpty()'s single-domain shape
    // (no loop over connectedOutputKeys - shared has exactly one domain).
    // Structurally self-contained: reads the live list directly rather than a
    // cached assignment map, so it needs no caller-side rebuild for freshness.
    private enforceSharedTrailingEmpty(): void {
        const visible = this.visibleDesktopIds();
        if (visible === null) {
            this.diagnostic("workspace-cleanup-deferred:output-visibility-unknown");
            return;
        }
        const occupied = this.occupiedDesktopIds();
        if (occupied === null) {
            this.diagnostic("workspace-cleanup-deferred:window-occupancy-unknown");
            return;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        const orderedIds = desktops.map((desktop) => desktop.id);
        this.reconcilingDesktops = true;
        try {
            ensureTrailingEmptyDesktop({
                orderedIds,
                isEmpty: (id) => !occupied.has(id),
                isVisible: (id) => visible.has(id),
                removeDesktop: (id) => this.removeOwnedEmptyShared(id, visible),
                createDesktop: () => this.appendDesktopForShared()?.id ?? null,
            });
        } finally {
            this.reconcilingDesktops = false;
        }
    }

    // Structurally identify the current global trailing empty, if any: the
    // desktop at the last position of the live desktop list, only when it is
    // currently empty. Recomputed fresh on every call from the live list and
    // occupancy snapshot - never cached, matching enforceSharedTrailingEmpty().
    // Returns null when there are no desktops, the last one is occupied, or
    // occupancy is unreadable; callers treat null as "no trailing empty to
    // reuse".
    private resolveSharedTrailingEmpty(): VirtualDesktopCapability | null {
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return null;
        }
        const last = desktops[desktops.length - 1];
        if (last === undefined) {
            return null;
        }
        const occupied = this.occupiedDesktopIds();
        if (occupied === null || occupied.has(last.id)) {
            return null;
        }
        return last;
    }

    // Whether the given id is already the shared current desktop (Q-Zero:
    // Meta+0 is a no-op when the trailing empty is already current). Shared
    // mode has one logical current desktop synchronized across every output,
    // so this reads the global current desktop, unlike isCurrentOnOutput's
    // per-output read.
    private isCurrentShared(id: string): boolean {
        let current: unknown;
        try {
            current = this.environment.currentDesktop();
        } catch (error) {
            void error;
            return false;
        }
        return isVirtualDesktop(current) && current.id === id;
    }

    // Append one desktop for shared mode and keep the shared mapping fresh
    // (Meta+0, Meta+Shift+0, and enforceSharedTrailingEmpty() paths).
    private appendDesktopForShared(): VirtualDesktopCapability | null {
        const created = this.appendDesktop();
        if (created !== null) {
            this.rebuildSharedMapping();
        }
        return created;
    }

    private removeOwnedEmptyShared(
        id: string,
        visible: ReadonlySet<string>,
    ): boolean {
        if (visible.has(id)) {
            return false;
        }
        const currentDesktops = this.liveDesktops();
        if (currentDesktops === null || currentDesktops.length <= 2) {
            return false;
        }
        const position = currentDesktops.findIndex((desktop) => desktop.id === id);
        const desktop = currentDesktops[position];
        if (desktop === undefined) {
            return false;
        }
        try {
            this.environment.removeDesktop(desktop);
            this.ownedDesktopIds.delete(id);
            this.rebuildSharedMapping();
            this.diagnostic(`workspace-cleanup-removed:${id}`);
            return true;
        } catch (error) {
            this.diagnostic(`workspace-cleanup-remove-failed:${describeWorkspaceFailure(error)}`);
            return false;
        }
    }

    // ---- per-output-local workspace mapping (Unit 05, spec D1) ----
    //
    // Each connected output owns an independent ordered local desktop id list;
    // logical workspace n resolves to the nth id of the active output's list.
    // The mapping is rebuilt idempotently from the live global list and is
    // keyed by the deterministic session output keys (spec E), so a desktop
    // rename/reorder never changes it and a surviving output keeps its mapping
    // across hotplug. Pre-existing (non-script-owned) desktops resolve into the
    // session's first-seen output's list only; the other outputs never adopt a
    // pre-existing desktop. Same-tuple outputs are disambiguated by first-seen
    // order, which is stable within a session but not across a plug/replug
    // reorder (documented limitation, spec E collision).

    // Per-output-local reconciliation: rebuild the per-output mapping from the
    // live desktop list. No creation or removal here - the mapping rebuild is
    // read-only; enforceLocalTrailingEmpties() (run unconditionally right
    // after by the caller) is the sole removal and trailing-replenish
    // authority.
    private reconcileLocalWorkspaces(desktops: readonly VirtualDesktopCapability[]): void {
        this.rebuildLocalMapping(desktops);
    }

    // Enforce the trailing-empty invariant (Q-Domain) for every connected
    // output's local domain in one cleanupDesktops pass. Each output's ordered
    // local list is its own domain; the trailing empty is identified
    // structurally by the shared ensureTrailingEmptyDesktop helper from a copy
    // of that domain's live list (never cached across dispatches, never an
    // identity/ownership Set). Removal reuses the existing
    // removeOwnedEmptyDesktop primitive (identical eligibility to the
    // ownership-independent cleanup rule, minus the structurally-protected
    // trailing entry); creation reuses appendDesktopForOutputKey, the same
    // primitive Meta+0/Meta+Shift+0 fall back to when no trailing empty
    // exists, so there is exactly one append code path per output domain. A
    // domain whose last entry is already empty is untouched (idempotent); a
    // domain with no desktops at all (a freshly connected output) gets its
    // first owned trailing empty here rather than waiting for a keyboard
    // shortcut.
    private enforceLocalTrailingEmpties(): void {
        const visible = this.visibleDesktopIds();
        if (visible === null) {
            this.diagnostic("workspace-cleanup-deferred:output-visibility-unknown");
            return;
        }
        const occupied = this.occupiedDesktopIds();
        if (occupied === null) {
            this.diagnostic("workspace-cleanup-deferred:window-occupancy-unknown");
            return;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        this.reconcilingDesktops = true;
        try {
            for (const key of this.connectedOutputKeys()) {
                const orderedIds = [...(this.localWorkspaces.get(key) ?? [])];
                ensureTrailingEmptyDesktop({
                    orderedIds,
                    isEmpty: (id) => !occupied.has(id),
                    isVisible: (id) => visible.has(id),
                    removeDesktop: (id) => this.removeOwnedEmptyDesktop(id, visible),
                    createDesktop: () => this.appendDesktopForOutputKey(key)?.id ?? null,
                });
            }
            // Orphaned desktops: any live desktop id left assigned to no
            // connected output's domain because its output disconnected
            // (rebuildLocalMapping drops a disconnected key's whole list, so
            // every id that was in it - script-owned or pre-existing -
            // belongs to no domain and the per-domain pass above can never
            // see it). Structural, ownership-independent, matching Q-Manual:
            // any empty desktop invisible on every connected output stays
            // cleanup-eligible, with no identity/ownership tracking. Iterates
            // the full live desktop list (never this.ownedDesktopIds, which
            // would leave a pre-existing/non-owned orphan permanently stuck -
            // the original ownedDesktopIds bug this change family fixed);
            // removeOwnedEmptyDesktop is itself already ownership-
            // independent and protects the last global desktop via its own
            // visibility/position checks. Re-reads the live desktop list
            // fresh (never the pre-loop `desktops` snapshot, which can still
            // list an id the per-domain loop above already removed).
            const assigned = new Set<string>();
            for (const ids of this.localWorkspaces.values()) {
                for (const id of ids) {
                    assigned.add(id);
                }
            }
            const remaining = this.liveDesktops() ?? [];
            for (const desktop of remaining) {
                const id = desktop.id;
                if (assigned.has(id) || occupied.has(id) || visible.has(id)) {
                    continue;
                }
                this.removeOwnedEmptyDesktop(id, visible);
            }
        } finally {
            this.reconcilingDesktops = false;
        }
    }

    // Structurally identify a connected output's current trailing empty, if
    // any: the desktop at the last position of its local list, only when it
    // is currently empty. Recomputed fresh on every call from the live
    // occupancy snapshot and the current local list - never cached, matching
    // enforceLocalTrailingEmpties(). Returns null when the output has no
    // local list yet, its last entry is occupied, or occupancy/desktop state
    // is unreadable; callers treat null as "no trailing empty to reuse".
    private resolveLocalTrailingEmpty(output: OutputCapability): VirtualDesktopCapability | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        const list = this.localWorkspaces.get(key) ?? [];
        const lastId = list[list.length - 1];
        if (lastId === undefined) {
            return null;
        }
        const occupied = this.occupiedDesktopIds();
        if (occupied === null || occupied.has(lastId)) {
            return null;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return null;
        }
        return desktops.find((desktop) => desktop.id === lastId) ?? null;
    }

    // Whether the given output's current desktop (per-output current, not the
    // global current) is already the given id (Q-Zero: Meta+0 is a no-op on
    // an output already showing its trailing empty).
    private isCurrentOnOutput(output: OutputCapability, id: string): boolean {
        let current: unknown;
        try {
            current = this.environment.currentDesktopForOutput(output);
        } catch (error) {
            void error;
            return false;
        }
        return isVirtualDesktop(current) && current.id === id;
    }

    // Read-only rebuild of the per-output-local mapping from the current live
    // screens/desktops. Never creates or removes a desktop, so navigation and
    // move resolution can refresh the mapping before resolving without ever
    // mutating on a no-op. Preserves each output's existing ordered list
    // (filtered to live ids) and resolves every non-script-owned desktop into
    // the session primary output's list.
    private rebuildLocalMapping(
        provided?: readonly VirtualDesktopCapability[],
    ): void {
        if (this.workspaceMode !== "per-output-local") {
            return;
        }
        const keys = this.connectedOutputKeys();
        if (keys.length === 0) {
            return;
        }
        const desktops = provided ?? this.liveDesktops();
        if (desktops === null) {
            return;
        }
        if (this.localSessionPrimary === undefined) {
            this.localSessionPrimary = keys[0];
        }
        const liveIds = new Set(desktops.map((desktop) => desktop.id));
        for (const key of [...this.localWorkspaces.keys()]) {
            if (!keys.includes(key)) {
                this.localWorkspaces.delete(key);
            }
        }
        for (const key of keys) {
            const list = this.localWorkspaces.get(key) ?? [];
            this.localWorkspaces.set(key, list.filter((id) => liveIds.has(id)));
        }
        const primary = this.localSessionPrimary;
        if (primary !== undefined && keys.includes(primary)) {
            const list = this.localWorkspaces.get(primary) ?? [];
            const assigned = new Set<string>();
            for (const ids of this.localWorkspaces.values()) {
                for (const id of ids) {
                    assigned.add(id);
                }
            }
            for (const desktop of desktops) {
                if (this.ownedDesktopIds.has(desktop.id)) {
                    continue;
                }
                if (assigned.has(desktop.id)) {
                    continue;
                }
                list.push(desktop.id);
            }
            this.localWorkspaces.set(primary, list);
        }
    }

    // Connected output keys in current screens order, from the deterministic
    // session keys. An unavailable screens surface yields no keys (read-only).
    private connectedOutputKeys(): string[] {
        let raw: unknown;
        try {
            raw = this.environment.screens();
        } catch (error) {
            void error;
            return [];
        }
        const decoded = decodeSequential(raw, isOutput, MAX_SEQUENTIAL_LENGTH);
        if (!decoded.ok) {
            return [];
        }
        const keys: string[] = [];
        for (const output of decoded.value) {
            const key = this.outputKeys.keyFor(output);
            if (key !== undefined) {
                keys.push(key);
            }
        }
        return keys;
    }

    // Remove one eligible empty desktop. Eligibility is structural: it must be
    // invisible on every connected output, regardless of ownership. An empty
    // desktop visible on any connected output, and the last remaining global
    // desktop, are never removed. Returns whether it was removed; a throwing
    // remove is reported and preserved. Always a plain removeDesktop call -
    // never a structural tiling mutation.
    private removeOwnedEmptyDesktop(
        id: string,
        visible: ReadonlySet<string>,
    ): boolean {
        if (visible.has(id)) {
            return false;
        }
        const currentDesktops = this.liveDesktops();
        if (currentDesktops === null || currentDesktops.length <= 2) {
            return false;
        }
        const position = currentDesktops.findIndex((desktop) => desktop.id === id);
        const desktop = currentDesktops[position];
        if (desktop === undefined) {
            return false;
        }
        try {
            this.environment.removeDesktop(desktop);
            this.ownedDesktopIds.delete(id);
            for (const list of this.localWorkspaces.values()) {
                const position = list.indexOf(id);
                if (position >= 0) {
                    list.splice(position, 1);
                }
            }
            this.diagnostic(`workspace-cleanup-removed:${id}`);
            return true;
        } catch (error) {
            this.diagnostic(`workspace-cleanup-remove-failed:${describeWorkspaceFailure(error)}`);
            return false;
        }
    }

    // Append one owned desktop and record it in the given output's local list
    // (Meta+Shift+0 path). Every script-owned desktop belongs to exactly one
    // output's list.
    private appendDesktopForOutputKey(key: string): VirtualDesktopCapability | null {
        const created = this.appendDesktop();
        if (created !== null) {
            const list = this.localWorkspaces.get(key) ?? [];
            list.push(created.id);
            this.localWorkspaces.set(key, list);
        }
        return created;
    }

    // The ordered local desktop id list of an output in per-output-local mode,
    // or null when the output has no key or list yet.
    private localListForOutput(output: OutputCapability): readonly string[] | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        return this.localWorkspaces.get(key) ?? null;
    }

    // The local desktop at 1-based logical index n of an output's list, or null
    // when absent or unresolvable. Never creates (absent n is a specific no-op).
    private localTargetForOutput(output: OutputCapability, index: number): VirtualDesktopCapability | null {
        const list = this.localListForOutput(output);
        if (list === null) {
            return null;
        }
        const id = list[index - 1];
        if (id === undefined) {
            return null;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return null;
        }
        return desktops.find((desktop) => desktop.id === id) ?? null;
    }

    // Append one owned desktop for an output's local list (Meta+Shift+0 path).
    private appendTrailingForOutput(output: OutputCapability): VirtualDesktopCapability | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        return this.appendDesktopForOutputKey(key);
    }

    // ---- global-unique workspace assignment (Unit 06, spec D2/F) ----
    //
    // Desktops are global and each output's ordered assigned subset is its
    // assigned global desktops ordered by `x11DesktopNumber` ascending. The
    // assignment and its inverse are script state, rebuilt idempotently on every
    // reconciliation: a disconnected output is unassigned, every live desktop is
    // assigned exactly once (unassigned pre-existing desktops go to the session
    // primary output, spec E hotplug), and each connected output retains exactly
    // one trailing empty in its own assigned subset. The trailing empty is the
    // literal last desktop in that output's `globalUniqueAssigned` group, only
    // if it is empty; it is never found by scanning backward. Cleanup is
    // ownership-independent: any empty desktop invisible on every connected
    // output is eligible, while an empty desktop visible on any connected output
    // and the last remaining global desktop are never removed.

    // The ordered assigned subset of a connected output key, filtered to live
    // desktops and sorted by x11DesktopNumber ascending (spec D2). The stored
    // list order is never trusted; order always derives from the live number.
    private globalUniqueOrdered(
        desktops: readonly VirtualDesktopCapability[],
        key: string,
    ): VirtualDesktopCapability[] {
        const ids = new Set(this.globalUniqueAssigned.get(key) ?? []);
        return desktops
            .filter((desktop) => ids.has(desktop.id))
            .sort((a, b) => (a.x11DesktopNumber ?? 0) - (b.x11DesktopNumber ?? 0));
    }

    // Assign `id` to `key`, removing it from any previous output's subset so
    // every logical global desktop stays assigned exactly once (spec D2).
    private assignGlobalUnique(id: string, key: string): void {
        const previous = this.globalUniqueInverse.get(id);
        if (previous !== undefined && previous !== key) {
            const priorList = this.globalUniqueAssigned.get(previous);
            if (priorList !== undefined) {
                const position = priorList.indexOf(id);
                if (position >= 0) {
                    priorList.splice(position, 1);
                }
            }
        }
        this.globalUniqueInverse.set(id, key);
        const list = this.globalUniqueAssigned.get(key) ?? [];
        if (!list.includes(id)) {
            list.push(id);
        }
        this.globalUniqueAssigned.set(key, list);
    }

    // Remove `id` from its assigned output's subset and from the inverse.
    private unassignGlobalUnique(id: string): void {
        const key = this.globalUniqueInverse.get(id);
        if (key === undefined) {
            return;
        }
        this.globalUniqueInverse.delete(id);
        const list = this.globalUniqueAssigned.get(key);
        if (list !== undefined) {
            const position = list.indexOf(id);
            if (position >= 0) {
                list.splice(position, 1);
            }
        }
    }

    // Global-unique navigation (spec D2): resolve the nth member of the active
    // output's assigned subset (ordered by x11DesktopNumber ascending) and
    // write `setCurrentDesktopForScreen` on the active output. Absent n is a
    // no-op and never creates. When the target is already shown on another
    // output the Hyprland `focusworkspaceoncurrentmonitor` swap applies first:
    // the target becomes the active output's current, the active output's prior
    // current desktop moves to the other output, and both desktops' assignments
    // follow (spec D2/F).
    private navigateGlobalUnique(index: number): void {
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        const output = this.globalUniqueActiveOutput();
        if (output === null) {
            return;
        }
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return;
        }
        const target = this.globalUniqueOrdered(desktops, key)[index - 1];
        if (target === undefined) {
            this.diagnostic(`workspace-navigate-absent:${index}`);
            return;
        }
        this.globalUniqueSwapIfVisibleElsewhere(target, output);
        this.setCurrentDesktop(target, output);
        this.diagnostic(`workspace-navigate-completed:${index}`);
    }

    // The active output for global-unique navigation (spec D common): the
    // focused window's output when one exists, else `workspace.activeScreen`
    // through the typed seam. Null only when neither is available; navigation
    // then no-ops rather than substituting a first screen for the active screen.
    private globalUniqueActiveOutput(): OutputCapability | null {
        return this.activeOutputForWorkspace();
    }

    // The navigation swap (spec D2): when `target` is the current desktop of a
    // different output, swap the two outputs' currents and assignments so the
    // target moves to the active output and the active output's prior current
    // desktop moves to the other output. One assigned current desktop per
    // affected output is preserved. Inert when the target is not shown on any
    // other output, when the active output's prior current is unreadable, or
    // when the write throws (reported, non-destructive).
    private globalUniqueSwapIfVisibleElsewhere(target: VirtualDesktopCapability, active: OutputCapability): void {
        let raw: unknown;
        try {
            raw = this.environment.screens();
        } catch (error) {
            void error;
            return;
        }
        const screens = decodeSequential(raw, isOutput, MAX_SEQUENTIAL_LENGTH);
        if (!screens.ok) {
            return;
        }
        let activeCurrent: VirtualDesktopCapability | null = null;
        for (const other of screens.value) {
            if (other === active) {
                continue;
            }
            let current: unknown;
            try {
                current = this.environment.currentDesktopForOutput(other);
            } catch (error) {
                void error;
                continue;
            }
            if (!isVirtualDesktop(current) || current.id !== target.id) {
                continue;
            }
            if (activeCurrent === null) {
                try {
                    const prior = this.environment.currentDesktopForOutput(active);
                    if (isVirtualDesktop(prior)) {
                        activeCurrent = prior;
                    }
                } catch (error) {
                    void error;
                }
            }
            if (activeCurrent === null || activeCurrent.id === target.id) {
                return;
            }
            const activeKey = this.outputKeys.keyFor(active);
            const otherKey = this.outputKeys.keyFor(other);
            if (activeKey === undefined || otherKey === undefined) {
                return;
            }
            this.assignGlobalUnique(target.id, activeKey);
            this.assignGlobalUnique(activeCurrent.id, otherKey);
            try {
                this.environment.setCurrentDesktopForScreen(target, active);
                this.environment.setCurrentDesktopForScreen(activeCurrent, other);
                this.diagnostic("workspace-navigate-swap");
            } catch (error) {
                this.diagnostic(`workspace-navigate-swap-failed:${describeWorkspaceFailure(error)}`);
            }
            return;
        }
    }

    // The 1-based nth member of an output's assigned subset, or null when absent
    // or unresolvable. Never creates (absent n is a specific no-op).
    private globalUniqueTargetForOutput(
        output: OutputCapability,
        index: number,
    ): VirtualDesktopCapability | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return null;
        }
        return this.globalUniqueOrdered(desktops, key)[index - 1] ?? null;
    }

    // Append one owned desktop and assign it to the given output key
    // (Meta+0, Meta+Shift+0, and enforceGlobalTrailingEmpty() paths).
    private appendDesktopForGlobalUniqueKey(key: string): VirtualDesktopCapability | null {
        const created = this.appendDesktop();
        if (created !== null) {
            this.assignGlobalUnique(created.id, key);
        }
        return created;
    }

    // Append one owned desktop and assign it to the given output (Meta+0 and
    // Meta+Shift+0 paths).
    private appendDesktopForGlobalUnique(output: OutputCapability): VirtualDesktopCapability | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        return this.appendDesktopForGlobalUniqueKey(key);
    }

    // Global-unique reconciliation: rebuild the per-output assignment mapping
    // from the live desktop list. No creation or removal here - the mapping
    // rebuild is read-only; enforceGlobalTrailingEmpty() (run unconditionally
    // right after by the caller) is the sole removal and trailing-replenish
    // authority.
    private reconcileGlobalUnique(desktops: readonly VirtualDesktopCapability[]): void {
        this.rebuildGlobalUniqueMapping(desktops);
    }

    // Rebuild global-unique assignment from the current live desktop list. A
    // switch cleanup uses this separately from capacity reconciliation so every
    // candidate is planned against a fresh mode mapping.
    private rebuildGlobalUniqueMapping(desktops: readonly VirtualDesktopCapability[]): string[] | null {
        const keys = this.connectedOutputKeys();
        if (keys.length === 0) {
            return null;
        }
        const connected = new Set(keys);
        if (this.globalUniquePrimary === undefined || !connected.has(this.globalUniquePrimary)) {
            this.globalUniquePrimary = keys[0];
        }
        for (const key of [...this.globalUniqueAssigned.keys()]) {
            if (!connected.has(key)) {
                for (const id of [...(this.globalUniqueAssigned.get(key) ?? [])]) {
                    this.unassignGlobalUnique(id);
                }
                this.globalUniqueAssigned.delete(key);
            }
        }
        for (const desktop of desktops) {
            if (this.globalUniqueInverse.has(desktop.id)) {
                continue;
            }
            if (this.globalUniquePrimary === undefined) {
                continue;
            }
            this.assignGlobalUnique(desktop.id, this.globalUniquePrimary);
        }
        for (const key of keys) {
            const list = this.globalUniqueAssigned.get(key);
            if (list === undefined) {
                continue;
            }
            const liveIds = new Set(desktops.map((desktop) => desktop.id));
            const filtered = list.filter((id) => liveIds.has(id));
            if (filtered.length !== list.length) {
                this.globalUniqueAssigned.set(key, filtered);
            }
        }
        return keys;
    }

    // Global-unique trailing-empty enforcement: the domain is each connected
    // output's own globalUniqueAssigned group, ordered by x11DesktopNumber
    // ascending via globalUniqueOrdered - one trailing empty per connected
    // output, not one shared global trailing empty. Removes every other
    // empty+invisible desktop within a group and appends a replacement only
    // when that group's last position is not empty, via the shared
    // ensureTrailingEmptyDesktop helper, mirroring
    // enforceLocalTrailingEmpties(). No orphan sweep is needed here (unlike
    // per-output-local): rebuildGlobalUniqueMapping() unconditionally folds
    // every live desktop not yet assigned into the primary output's group
    // whenever at least one output is connected, so every live desktop
    // always belongs to exactly one connected output's group.
    private enforceGlobalTrailingEmpty(): void {
        const visible = this.visibleDesktopIds();
        if (visible === null) {
            this.diagnostic("workspace-cleanup-deferred:output-visibility-unknown");
            return;
        }
        const occupied = this.occupiedDesktopIds();
        if (occupied === null) {
            this.diagnostic("workspace-cleanup-deferred:window-occupancy-unknown");
            return;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return;
        }
        this.reconcilingDesktops = true;
        try {
            for (const key of this.connectedOutputKeys()) {
                const orderedIds = this.globalUniqueOrdered(desktops, key).map((desktop) => desktop.id);
                ensureTrailingEmptyDesktop({
                    orderedIds,
                    isEmpty: (id) => !occupied.has(id),
                    isVisible: (id) => visible.has(id),
                    removeDesktop: (id) => this.removeOwnedEmptyGlobalUnique(id, visible),
                    createDesktop: () => this.appendDesktopForGlobalUniqueKey(key)?.id ?? null,
                });
            }
        } finally {
            this.reconcilingDesktops = false;
        }
    }

    // Structurally identify a connected output's own trailing empty, if any:
    // the desktop at the last position of its own globalUniqueAssigned group
    // (ordered by x11DesktopNumber via globalUniqueOrdered), only when it is
    // currently empty. Recomputed fresh on every call - never cached,
    // matching enforceGlobalTrailingEmpty(). Never looks at any other
    // output's group. Returns null when the output has no key, its group is
    // empty, its last entry is occupied, or state is unreadable; callers
    // treat null as "no trailing empty to reuse".
    private resolveGlobalTrailingEmpty(output: OutputCapability): VirtualDesktopCapability | null {
        const key = this.outputKeys.keyFor(output);
        if (key === undefined) {
            return null;
        }
        const desktops = this.liveDesktops();
        if (desktops === null) {
            return null;
        }
        const ordered = this.globalUniqueOrdered(desktops, key);
        const last = ordered[ordered.length - 1];
        if (last === undefined) {
            return null;
        }
        const occupied = this.occupiedDesktopIds();
        if (occupied === null || occupied.has(last.id)) {
            return null;
        }
        return last;
    }

    // Remove one eligible empty desktop and unassign it. Eligibility is
    // structural: it must be invisible on every connected output, regardless of
    // ownership. An empty desktop visible on any connected output, and the last
    // remaining global desktop, are never removed. Plain removeDesktop only -
    // never a structural tiling mutation. A throwing remove is reported and
    // preserved.
    private removeOwnedEmptyGlobalUnique(
        id: string,
        visible: ReadonlySet<string>,
    ): boolean {
        if (visible.has(id)) {
            return false;
        }
        const currentDesktops = this.liveDesktops();
        if (currentDesktops === null || currentDesktops.length <= 2) {
            return false;
        }
        const position = currentDesktops.findIndex((desktop) => desktop.id === id);
        const desktop = currentDesktops[position];
        if (desktop === undefined) {
            return false;
        }
        try {
            this.environment.removeDesktop(desktop);
            this.ownedDesktopIds.delete(id);
            this.unassignGlobalUnique(id);
            this.diagnostic(`workspace-cleanup-removed:${id}`);
            return true;
        } catch (error) {
            this.diagnostic(`workspace-cleanup-remove-failed:${describeWorkspaceFailure(error)}`);
            return false;
        }
    }

    // Desktop ids currently visible on any output (per-output current desktop)
    // plus the global current desktop. Returns null unless every read is valid,
    // so cleanup never removes from a partial visibility snapshot.
    private visibleDesktopIds(): Set<string> | null {
        let raw: unknown;
        try {
            raw = this.environment.screens();
        } catch (error) {
            return null;
        }
        const screens = decodeSequential(raw, isOutput, MAX_SEQUENTIAL_LENGTH);
        if (!screens.ok || screens.value.length === 0) {
            return null;
        }
        const visible = new Set<string>();
        for (const output of screens.value) {
            let current: unknown;
            try {
                current = this.environment.currentDesktopForOutput(output);
            } catch (error) {
                return null;
            }
            if (!isVirtualDesktop(current)) {
                return null;
            }
            visible.add(current.id);
        }
        try {
            const global = this.environment.currentDesktop();
            if (!isVirtualDesktop(global)) {
                return null;
            }
            visible.add(global.id);
        } catch (error) {
            return null;
        }
        return visible;
    }

    // Desktop ids that hold at least one non-sticky window. Returns null unless
    // the entire window list and every non-sticky membership list are readable.
    private occupiedDesktopIds(): Set<string> | null {
        const occupied = new Set<string>();
        let raw: unknown;
        try {
            raw = this.environment.windowList();
        } catch (error) {
            return null;
        }
        const windows = decodeSequential(raw, isWindow, MAX_SEQUENTIAL_LENGTH);
        if (!windows.ok) {
            return null;
        }
        for (const window of windows.value) {
            if (window.onAllDesktops === true) {
                continue;
            }
            const members = decodeSequential(window.desktops, isVirtualDesktop, MAX_SEQUENTIAL_LENGTH);
            if (!members.ok) {
                return null;
            }
            for (const desktop of members.value) {
                occupied.add(desktop.id);
            }
        }
        return occupied;
    }
}
