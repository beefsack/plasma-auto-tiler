import {
    FeatureGate,
    MAX_SEQUENTIAL_LENGTH,
    TransientState,
    assignWindowToTile,
    decodeSequential,
    desktopNumber,
    detachWindowFromTile,
    isCustomTile,
    isNativelyMaximized,
    isOutput,
    isPoint,
    isRect,
    isTile,
    isVirtualDesktop,
    isWindow,
    manageTile,
    removeCustomTile,
    sameScope,
    setTileRelativeGeometry,
    setWindowOnAllDesktops,
    splitCustomTile,
    unmanageTile,
    writeWindowDesktops,
    writeWindowFrameGeometry,
    type CustomTileCapability,
    type OutputCapability,
    type RectCapability,
    type TileCapability,
    type VirtualDesktopCapability,
    type WindowCapability,
} from "./boundary";
import { customTileSplitSeam, orderCustomTilesByAxis } from "./custom-tile-split";
import { type Blueprint, type Orientation } from "./layout-blueprint";
import { executeBlueprintInstructions } from "./layout-executor";
import { type BlueprintPath } from "./layout-instructions";
import {
    compareLeaves,
    equalAlongAxis,
    findNeighborLeaf,
    pickDropLeaf,
    planAutomaticPlacement,
    planEqualSplit,
    planGeometryDrop,
    planKeyboardInsertion,
    rectCenter,
    RELATIVE_GEOMETRY_EPSILON,
    type Leaf,
    type Direction,
    type Point,
    type Scope,
    type SplitAxis,
    type WindowRef,
} from "./logic";
import { buildPreset, presetBlueprint, PRESET_KINDS, type PresetKind } from "./preset-catalog";
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
// KWin tile minimumSize default is QSizeF(0.15, 0.15) in working-area-relative
// units (src/tiles/tile.h:179, pinned v6.7.3). A position-directed 50/50 drop
// split produces two equal halves; when either half falls below this floor KWin
// clamps the children and corrupts the geometry, so the split must be refused.
const MINIMUM_TILE_FRACTION = 0.15;
// Fixed direct resize step: each Meta+Ctrl+H/J/K/L press moves the nearest
// relevant ancestor split's shared edge by this fraction of the parent extent.
const RESIZE_STEP_FRACTION = 0.05;
// src/scripting/workspace_wrapper.h ClientAreaOption ordering: PlacementArea=0,
// MovementArea=1, MaximizeArea=2, MaximizeFullArea=3, FullScreenArea=4,
// WorkArea=5, FullArea=6, ScreenArea=7. WorkArea is the per-output working area
// (screen minus panel struts), the reference extent of the tile minimum size.
const WORK_AREA_CLIENT_AREA_OPTION = 5;
// Default float geometry is 60% x 60% of the current output work area,
// centered within it (roadmap floating-windows default geometry).
const FLOAT_WORK_AREA_FRACTION = 0.6;
// A newly-mapped window's `desktops` value can still be settling at the
// exact `windowAdded` instant (unit-05/attempt-16 live evidence). One short,
// bounded re-evaluation gives it a chance to settle before being treated as
// permanently out of scope.
const DESKTOP_SCOPE_REEVALUATION_DELAY_MS = 50;
const GROUP_OUTLINE_DURATION_MS = 700;
// Bounded re-drive budget per pending reconstruction phase. A lifecycle event
// while a reconstruction is pending re-arms that phase's one-shot yield so a
// single lost callDBus reply cannot strand a collapsed scope. A bound is still
// required: if every ListNames reply is lost, unlimited re-arms would leave a
// collapsed awaiting-split scope retrying forever instead of reaching the
// session-local inert state.
const MAX_YIELD_REARM_PER_PHASE = 2;

// ==== Binding profile catalog and validation (Unit 01) ====
//
// Typed profile/action/sequence catalog for the three reference-WM baselines.
// Every row is classified: `exact` is the reference WM's own shipped default
// for that action; `canonical-example` is a canonical shipped example config
// (bspwm ships no WM-enforced bindings, so its `examples/sxhkdrc` is the
// baseline); `compatibility-alias` is a project-added parity binding the
// reference does not ship; `deferred` is deliberately unbound in this change.
// Rows never silently displace an exact row of the same profile; the validator
// rejects such in-profile duplicate sequences.

export type ProfileKey = "cosmic" | "hyprland" | "bspwm";
export type RowClassification =
    | "exact"
    | "canonical-example"
    | "compatibility-alias"
    | "deferred"
    // Present in the catalog as a truthful component requirement (needs a KWin
    // capability, an external Plasma component, or a workspace-mode unit), but
    // never a registered or resolvable sequence in this change.
    | "component-requirement";

// Classifications that never register and never resolve to a live sequence.
export const UNRESOLVABLE_CLASSIFICATIONS: ReadonlyArray<RowClassification> = Object.freeze([
    "deferred",
    "component-requirement",
]);

export interface CatalogRow {
    readonly actionId: string;
    readonly shortcutId: string;
    readonly text: string;
    readonly sequence: string;
    readonly classification: RowClassification;
    readonly reference: string;
}

export interface ProfileCatalog {
    readonly key: ProfileKey;
    readonly name: string;
    readonly rows: readonly CatalogRow[];
}

// Selected-profile config key read through the KWin `readConfig` seam.
// Absent or invalid selects the cosmic default; invalid also emits a
// diagnostic. Only the selected baseline's own rows drive registration in this
// unit; the user-override > baseline > profile-default precedence is a model
// seam, not a KGlobalAccel migration (spec I).
export const DEFAULT_PROFILE: ProfileKey = "cosmic";
export const SHORTCUT_PROFILE_CONFIG_KEY = "shortcutProfile";
export const PROFILE_KEYS: readonly ProfileKey[] = Object.freeze(["cosmic", "hyprland", "bspwm"]);

// ==== Workspace mode configuration (Unit 04) ====
//
// `workspaceMode` selects the multi-output workspace model (spec D): each
// output owns an independent local set (`per-output-local`), desktops are
// global with per-output ordered assignment (`global-unique`), or one shared
// set synchronized across every output (`shared`). The mode dispatch itself is
// Unit 05; this unit establishes the parsed configuration plus the session-only
// output/workspace state every mode needs. Missing/empty selects the default
// without a diagnostic; an invalid value falls back to the default with a
// diagnostic. Deterministic and pure for the tests.
export type WorkspaceMode = "per-output-local" | "global-unique" | "shared";
export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "per-output-local";
export const WORKSPACE_MODE_CONFIG_KEY = "workspaceMode";
export const WORKSPACE_MODES: readonly WorkspaceMode[] = Object.freeze([
    "per-output-local",
    "global-unique",
    "shared",
]);

export function parseWorkspaceMode(value: unknown): {
    readonly mode: WorkspaceMode;
    readonly diagnostics: readonly string[];
} {
    if (typeof value === "string" && (WORKSPACE_MODES as readonly string[]).includes(value)) {
        return { mode: value as WorkspaceMode, diagnostics: Object.freeze([]) };
    }
    if (value === undefined || value === null || value === "") {
        return { mode: DEFAULT_WORKSPACE_MODE, diagnostics: Object.freeze([]) };
    }
    return {
        mode: DEFAULT_WORKSPACE_MODE,
        diagnostics: Object.freeze(["workspace-mode-invalid:fallback-per-output-local"]),
    };
}

// ==== Tiling algorithm configuration ====
//
// `tilingAlgorithm` selects the preset the automatic takeover builds when it
// adopts a scope: dwindle (the historical automatic shape) or one of the
// balanced presets. The value is read once at startup; a valid preset drives
// the takeover's shape match and reconstruction, while every manual preset
// shortcut keeps its own fixed preset. Missing/empty selects the dwindle
// default without a diagnostic; an invalid value falls back to the default
// with a diagnostic. Deterministic and pure for the tests.
export type TilingAlgorithm = PresetKind;
export const DEFAULT_TILING_ALGORITHM: TilingAlgorithm = "dwindle";
export const TILING_ALGORITHM_CONFIG_KEY = "tilingAlgorithm";
export const TILING_ALGORITHMS: readonly TilingAlgorithm[] = PRESET_KINDS;

export function parseTilingAlgorithm(value: unknown): {
    readonly algorithm: TilingAlgorithm;
    readonly diagnostics: readonly string[];
} {
    if (typeof value === "string" && (TILING_ALGORITHMS as readonly string[]).includes(value)) {
        return { algorithm: value as TilingAlgorithm, diagnostics: Object.freeze([]) };
    }
    if (value === undefined || value === null || value === "") {
        return { algorithm: DEFAULT_TILING_ALGORITHM, diagnostics: Object.freeze([]) };
    }
    return {
        algorithm: DEFAULT_TILING_ALGORITHM,
        diagnostics: Object.freeze(["tiling-algorithm-invalid:fallback-dwindle"]),
    };
}

// ==== Automatic split target configuration ====
//
// `automaticSplitTarget` selects which occupied leaf a newly opened window is
// automatically tiled into: `dwindle` preserves the current automatic split
// intent, `largest` selects the occupied leaf with the greatest area, and
// `active` selects the active occupied leaf. The value is read once at startup;
// selection itself is a later unit. Missing/empty selects the dwindle default
// without a diagnostic; an invalid value falls back to the default with a
// diagnostic. Deterministic and pure for the tests.
export type AutomaticSplitTarget = "dwindle" | "largest" | "active";
export const DEFAULT_AUTOMATIC_SPLIT_TARGET: AutomaticSplitTarget = "dwindle";
export const AUTOMATIC_SPLIT_TARGET_CONFIG_KEY = "automaticSplitTarget";
export const AUTOMATIC_SPLIT_TARGETS: readonly AutomaticSplitTarget[] = Object.freeze([
    "dwindle",
    "largest",
    "active",
]);

export function parseAutomaticSplitTarget(value: unknown): {
    readonly target: AutomaticSplitTarget;
    readonly diagnostics: readonly string[];
} {
    if (typeof value === "string" && (AUTOMATIC_SPLIT_TARGETS as readonly string[]).includes(value)) {
        return { target: value as AutomaticSplitTarget, diagnostics: Object.freeze([]) };
    }
    if (value === undefined || value === null || value === "") {
        return { target: DEFAULT_AUTOMATIC_SPLIT_TARGET, diagnostics: Object.freeze([]) };
    }
    return {
        target: DEFAULT_AUTOMATIC_SPLIT_TARGET,
        diagnostics: Object.freeze(["automatic-split-target-invalid:fallback-dwindle"]),
    };
}

// ==== Drag destination outline configuration ====
//
// `dropOutlinePreview` remains an inert startup seam in this unit. KConfigXT
// supplies a Boolean, and missing values resolve to the disabled default.
export const DEFAULT_DROP_OUTLINE_PREVIEW = false;
export const DROP_OUTLINE_PREVIEW_CONFIG_KEY = "dropOutlinePreview";

export function parseDropOutlinePreview(value: unknown): {
    readonly enabled: boolean;
    readonly diagnostics: readonly string[];
} {
    if (typeof value === "boolean") {
        return { enabled: value, diagnostics: Object.freeze([]) };
    }
    if (value === undefined || value === null || value === "") {
        return { enabled: DEFAULT_DROP_OUTLINE_PREVIEW, diagnostics: Object.freeze([]) };
    }
    return {
        enabled: DEFAULT_DROP_OUTLINE_PREVIEW,
        diagnostics: Object.freeze(["drop-outline-preview-invalid:fallback-false"]),
    };
}

// ==== Automatic split target selection seam ====
//
// Deterministic strategy-specific intended-leaf selection for the future
// automatic-insertion path. An isolated seam: it chooses only the intended
// occupied leaf a strategy prefers and never mutates topology, preflights
// splittability, or resolves a fallback. The existing nearest-splittable
// fallback and no-candidate behavior keep applying to the chosen intended leaf
// unchanged, and split orientation stays the established depth-derived rule,
// so this seam changes only which occupied leaf is the intended target.

// A candidate intended target: an opaque tile identity the caller resolves to
// its real tile, the depth that derives the split orientation, the pure leaf
// data for stable ordering and area decisions, and whether the leaf holds an
// eligible in-scope occupant.
export interface AutomaticSplitCandidate {
    readonly tile: object;
    readonly depth: number;
    readonly leaf: Leaf;
    readonly occupied: boolean;
}

// The resolved selection context. `dwindle` is the deepest-right-spine intent,
// `candidates` are the scope's usable leaves in stable compareLeaves order, and
// `active` is the active tiled window's leaf candidate when one is available
// (otherwise null). In-scope eligibility is this seam's concern: the active
// leaf qualifies only when it resolves to one of the scope's candidate leaves.
// Occupancy (`occupied`) is decided by this seam.
export interface AutomaticSplitSelectionContext {
    readonly dwindle: AutomaticSplitCandidate;
    readonly candidates: readonly AutomaticSplitCandidate[];
    readonly active: AutomaticSplitCandidate | null;
}

// Pure intended-leaf selection:
// - `dwindle` preserves the deepest-right-spine intent unchanged.
// - `largest` selects the eligible occupied candidate with the greatest leaf
//   area; equal areas resolve to the earlier stable compareLeaves ordinal.
// - `active` selects the active tiled window's leaf when it is available,
//   eligible (occupied), and resolves to a candidate in the same ownership
//   scope; otherwise the dwindle intent.
// Returns null only when the strategy yields no eligible occupied intended leaf
// (`largest` with no occupied candidate), which the caller's existing
// no-candidate behavior floats without mutating topology.
export function selectAutomaticSplitTarget(
    strategy: AutomaticSplitTarget,
    context: AutomaticSplitSelectionContext,
): AutomaticSplitCandidate | null {
    switch (strategy) {
        case "dwindle":
            return context.dwindle;
        case "largest":
            return selectLargestOccupied(context.candidates);
        case "active":
            return activeLeafInScope(context) ?? context.dwindle;
    }
}

// Resolve the active tiled window's leaf to the selection scope's candidate.
// The active leaf is in the same ownership scope only when its tile matches one
// of the scope candidate tiles; a foreign-scope active window resolves to null.
// An in-scope active leaf qualifies only when it is occupied.
function activeLeafInScope(
    context: AutomaticSplitSelectionContext,
): AutomaticSplitCandidate | null {
    if (context.active === null) {
        return null;
    }
    for (const candidate of context.candidates) {
        if (candidate.tile === context.active.tile) {
            return candidate.occupied ? candidate : null;
        }
    }
    return null;
}

function selectLargestOccupied(
    candidates: readonly AutomaticSplitCandidate[],
): AutomaticSplitCandidate | null {
    let best: AutomaticSplitCandidate | null = null;
    for (const candidate of candidates) {
        if (!candidate.occupied) {
            continue;
        }
        if (best === null) {
            best = candidate;
            continue;
        }
        const area = candidate.leaf.geometry.width * candidate.leaf.geometry.height;
        const bestArea = best.leaf.geometry.width * best.leaf.geometry.height;
        if (area > bestArea || (area === bestArea && compareLeaves(candidate.leaf, best.leaf) < 0)) {
            best = candidate;
        }
    }
    return best;
}

// ==== Session output identity (Unit 04) ====
//
// The physical output ID (spec B/E) is the ordered tuple of the four scriptable
// Output properties. Delimiting with NUL makes the tuple unambiguous when a
// field is empty or itself contains the separator.
export function outputTuple(output: OutputCapability): string {
    return [output.manufacturer, output.model, output.serialNumber, output.name].join("\u0000");
}

// Session-local deterministic output key registry (spec E). Keys are derived
// from the ordered (manufacturer, model, serialNumber, name) tuple and assigned
// in first-seen order. A rebuild matches each output against the earliest
// unconsumed slot with the same tuple, so a surviving output keeps its key and
// a colliding tuple (two outputs indistinguishable by the scriptable API) gets
// a distinct first-seen key. Keys are session-only and never persisted.
//
// Resolution is tuple-based, never dependent on QJS object identity: KWin can
// expose the same physical output through distinct wrappers (workspace.screens,
// a window's `output` property, `workspace.activeScreen`), so a foreign wrapper
// resolves through the current rebuild's tuple map. A stale or unknown output
// (no matching current rebuild entry) resolves to undefined and is reported
// once per session.
export class SessionOutputKeys {
    private readonly slots: Array<{ readonly key: string; readonly tuple: string }> = [];
    private readonly byOutput = new Map<OutputCapability, string>();
    // Current rebuild's known tuples in first-seen slot order (spec E). The
    // first entry is the deterministic resolution for a colliding tuple.
    private readonly tupleKeys = new Map<string, string[]>();
    // Tuples already reported as unknown/stale this session (diagnostics dedupe).
    private readonly reportedUnknown = new Set<string>();
    private next = 0;

    constructor(
        private readonly reportUnknown?: (tuple: string) => void,
    ) {}

    rebuild(outputs: readonly OutputCapability[]): void {
        this.byOutput.clear();
        this.tupleKeys.clear();
        const consumed = new Set<number>();
        for (const output of outputs) {
            const tuple = outputTuple(output);
            let matchedIndex = -1;
            let entry: { readonly key: string; readonly tuple: string } | undefined;
            for (let index = 0; index < this.slots.length; index += 1) {
                if (consumed.has(index)) {
                    continue;
                }
                const candidate = this.slots[index];
                if (candidate !== undefined && candidate.tuple === tuple) {
                    matchedIndex = index;
                    entry = candidate;
                    break;
                }
            }
            if (entry === undefined) {
                matchedIndex = this.slots.length;
                entry = { key: `output-${this.next}`, tuple };
                this.next += 1;
                this.slots.push(entry);
            }
            consumed.add(matchedIndex);
            this.byOutput.set(output, entry.key);
            const keys = this.tupleKeys.get(tuple);
            if (keys === undefined) {
                this.tupleKeys.set(tuple, [entry.key]);
            } else if (!keys.includes(entry.key)) {
                keys.push(entry.key);
            }
        }
    }

    keyFor(output: OutputCapability): string | undefined {
        const direct = this.byOutput.get(output);
        if (direct !== undefined) {
            return direct;
        }
        // A distinct wrapper of a currently connected output matches by the
        // physical tuple. A colliding tuple resolves deterministically to the
        // first-seen current key; the rebuild's slots already disambiguated
        // the outputs at first-seen order (spec E collision).
        const tuple = outputTuple(output);
        const keys = this.tupleKeys.get(tuple);
        if (keys !== undefined && keys.length > 0) {
            return keys[0];
        }
        // Stale (disconnected) or never-seen output: safe undefined resolution,
        // reported once per session tuple.
        if (!this.reportedUnknown.has(tuple)) {
            this.reportedUnknown.add(tuple);
            this.reportUnknown?.(tuple);
        }
        return undefined;
    }
}

const COSMIC_REF = "[C-KR] cosmic-comp data/keybindings.ron";
const HYPRLAND_REF = "[H-Ex] Hyprland example/hyprland.lua";
const BSPWM_REF = "[B1-EX] bspwm examples/sxhkdrc";

const HJKL_KEYS: ReadonlyArray<readonly [Direction, string]> = Object.freeze([
    ["left", "H"],
    ["down", "J"],
    ["up", "K"],
    ["right", "L"],
]);
const ARROW_KEYS: ReadonlyArray<readonly [Direction, string]> = Object.freeze([
    ["left", "Left"],
    ["down", "Down"],
    ["up", "Up"],
    ["right", "Right"],
]);

// `Meta+Shift+<digit>` never reaches a registered KWin action on QWERTY-family
// layouts (US and most others): KWin's compositor input path
// (`Xkb::modifiersRelevantForGlobalShortcuts`, src/xkb.cpp) strips the Shift
// bit from the delivered global-shortcut event whenever the keysym transition
// for that physical key "consumes" Shift, which is exactly the digit-row
// behaviour on these layouts (Shift+5 delivers the `percent` keysym, not
// `5`); the letter-only exemption in that function (BUG 370341) does not
// cover digits. The event actually delivered is therefore `Meta+<symbol>`
// (e.g. `Meta+percent`), never matching a `Meta+Shift+5` registration, and
// `QKeySequence`'s single-character portable-text parsing
// (`QKeySequencePrivate::decodeString`) confirms `"%"` parses to the exact
// same key code XKB delivers. This map is a best-effort compatibility alias
// for the standard US/QWERTY-family shift row (`!@#$%^&*()`); it is not a
// layout-independent fix (no keyboard-layout or scancode/keysym-level
// registration surface is exposed to KWin JS scripts), so a layout whose
// shift-row symbols differ from this set (e.g. UK GB's Shift+3 `£`) is not
// covered by the alias and still depends on the canonical `Meta+Shift+<digit>`
// registration, which itself only matches layouts where the digit is truly on
// the shifted level (e.g. AZERTY).
const SHIFT_DIGIT_SYMBOL_ALIAS: ReadonlyMap<number, string> = Object.freeze(
    new Map<number, string>([
        [1, "!"],
        [2, "@"],
        [3, "#"],
        [4, "$"],
        [5, "%"],
        [6, "^"],
        [7, "&"],
        [8, "*"],
        [9, "("],
        [0, ")"],
    ]),
);
const SHIFT_DIGIT_ALIAS_REFERENCE =
    "[PAT-Shift] Meta+<shifted-symbol> compatibility alias for QWERTY-family " +
    "layouts; see kwin/src/controller.ts SHIFT_DIGIT_SYMBOL_ALIAS";

function catalogRow(
    actionId: string,
    shortcutId: string,
    text: string,
    sequence: string,
    classification: RowClassification,
    reference: string,
): CatalogRow {
    return Object.freeze({ actionId, shortcutId, text, sequence, classification, reference });
}

// A directional family: HJKL (no suffix) or arrow (`-arrow` suffix) rows for
// the given action prefix. Arrow rows are distinct action IDs so each alias
// registers under a distinct shortcut ID.
function directional(
    actionPrefix: string,
    textPrefix: string,
    modifiers: string,
    suffix: "" | "arrow",
    keys: ReadonlyArray<readonly [Direction, string]>,
    classification: RowClassification,
    reference: string,
): readonly CatalogRow[] {
    return keys.map(([direction, key]) =>
        catalogRow(
            `${actionPrefix}-${direction}${suffix === "" ? "" : `-${suffix}`}`,
            `plasma-auto-tiler-${actionPrefix}-${direction}${suffix === "" ? "" : `-${suffix}`}`,
            `${textPrefix} ${direction}${suffix === "" ? "" : ` (${suffix})`}`,
            `${modifiers}+${key}`,
            classification,
            reference,
        ),
    );
}

function workspaceRows(
    classification: RowClassification,
    reference: string,
): readonly CatalogRow[] {
    const rows: CatalogRow[] = [];
    for (let index = 1; index <= 9; index += 1) {
        rows.push(
            catalogRow(
                `workspace-${index}`,
                `plasma-auto-tiler-workspace-${index}`,
                `Focus workspace ${index}`,
                `Meta+${index}`,
                classification,
                reference,
            ),
        );
    }
    for (let index = 1; index <= 9; index += 1) {
        rows.push(
            catalogRow(
                `move-workspace-${index}`,
                `plasma-auto-tiler-move-workspace-${index}`,
                `Move window to workspace ${index}`,
                `Meta+Shift+${index}`,
                classification,
                reference,
            ),
        );
        rows.push(
            catalogRow(
                `move-workspace-${index}-symbol`,
                `plasma-auto-tiler-move-workspace-${index}-symbol`,
                `Move window to workspace ${index} (shifted-symbol alias)`,
                `Meta+${symbolForDigit(index)}`,
                "compatibility-alias",
                SHIFT_DIGIT_ALIAS_REFERENCE,
            ),
        );
    }
    return rows;
}

// Looks up the QWERTY-family shifted symbol for a digit; throws on an
// unmapped digit so a catalog typo fails loudly at module load rather than
// silently registering an empty sequence.
function symbolForDigit(digit: number): string {
    const symbol = SHIFT_DIGIT_SYMBOL_ALIAS.get(digit);
    if (symbol === undefined) {
        throw new Error(`symbolForDigit: no shifted-symbol alias mapped for digit ${digit}`);
    }
    return symbol;
}

// The Meta+0 row is present in every profile catalog and registers as the
// stable `plasma-auto-tiler-workspace-0` shortcut unless an exact in-profile
// sequence collision exists (the validator rejects duplicates). It focuses or
// creates the mode-defined trailing empty (spec C/D); the upstream reference
// actions it maps to are `LastWorkspace` (COSMIC), `focus workspace 10`
// (Hyprland), and `bspc desktop -f '^10'` (bspwm example).
function workspaceZeroRow(reference: string, classification: RowClassification): CatalogRow {
    return catalogRow(
        "workspace-0",
        "plasma-auto-tiler-workspace-0",
        "Focus or create the trailing empty workspace",
        "Meta+0",
        classification,
        reference,
    );
}

function moveWorkspaceZeroRow(reference: string, classification: RowClassification = "exact"): CatalogRow {
    return catalogRow(
        "move-workspace-0",
        "plasma-auto-tiler-move-workspace-append",
        "Move window to a newly appended workspace",
        "Meta+Shift+0",
        classification,
        reference,
    );
}

// Shifted-symbol alias for `move-workspace-0` (see SHIFT_DIGIT_SYMBOL_ALIAS).
function moveWorkspaceZeroSymbolRow(): CatalogRow {
    return catalogRow(
        "move-workspace-0-symbol",
        "plasma-auto-tiler-move-workspace-append-symbol",
        "Move window to a newly appended workspace (shifted-symbol alias)",
        `Meta+${symbolForDigit(0)}`,
        "compatibility-alias",
        SHIFT_DIGIT_ALIAS_REFERENCE,
    );
}

const COSMIC_ROWS: readonly CatalogRow[] = Object.freeze([
    ...directional("focus", "Focus window", "Meta", "", HJKL_KEYS, "exact", `${COSMIC_REF} Focus(Left/Down/Up/Right)`),
    ...directional("focus", "Focus window", "Meta", "arrow", ARROW_KEYS, "exact", `${COSMIC_REF} Focus(Left/Down/Up/Right)`),
    ...directional("move", "Move window", "Meta+Shift", "", HJKL_KEYS, "exact", `${COSMIC_REF} Move(Left/Down/Up/Right)`),
    ...directional("move", "Move window", "Meta+Shift", "arrow", ARROW_KEYS, "exact", `${COSMIC_REF} Move(Left/Down/Up/Right)`),
    catalogRow("float-toggle", "plasma-auto-tiler-float-toggle", "Float or tile active window", "Meta+G", "exact", `${COSMIC_REF} ToggleWindowFloating`),
    catalogRow("maximize", "plasma-auto-tiler-maximize", "Maximize active window in its workspace", "Meta+M", "exact", `${COSMIC_REF} Maximize`),
    ...workspaceRows("exact", `${COSMIC_REF} Workspace(N) / MoveToWorkspace(N)`),
    moveWorkspaceZeroRow(`${COSMIC_REF} MoveToLastWorkspace`),
    moveWorkspaceZeroSymbolRow(),
    workspaceZeroRow(`${COSMIC_REF} Super+0 LastWorkspace`, "exact"),
    catalogRow("previous-workspace-up", "plasma-auto-tiler-previous-workspace-up", "Previous workspace", "Meta+Ctrl+Up", "component-requirement", `${COSMIC_REF} PreviousWorkspace (needs a workspace-mode unit)`),
    catalogRow("previous-workspace-left", "plasma-auto-tiler-previous-workspace-left", "Previous workspace", "Meta+Ctrl+Left", "component-requirement", `${COSMIC_REF} PreviousWorkspace (needs a workspace-mode unit)`),
    catalogRow("previous-workspace-h", "plasma-auto-tiler-previous-workspace-h", "Previous workspace", "Meta+Ctrl+H", "component-requirement", `${COSMIC_REF} PreviousWorkspace (needs a workspace-mode unit)`),
    catalogRow("previous-workspace-k", "plasma-auto-tiler-previous-workspace-k", "Previous workspace", "Meta+Ctrl+K", "component-requirement", `${COSMIC_REF} PreviousWorkspace (needs a workspace-mode unit)`),
    catalogRow("next-workspace-down", "plasma-auto-tiler-next-workspace-down", "Next workspace", "Meta+Ctrl+Down", "component-requirement", `${COSMIC_REF} NextWorkspace (needs a workspace-mode unit)`),
    catalogRow("next-workspace-right", "plasma-auto-tiler-next-workspace-right", "Next workspace", "Meta+Ctrl+Right", "component-requirement", `${COSMIC_REF} NextWorkspace (needs a workspace-mode unit)`),
    catalogRow("next-workspace-j", "plasma-auto-tiler-next-workspace-j", "Next workspace", "Meta+Ctrl+J", "component-requirement", `${COSMIC_REF} NextWorkspace (needs a workspace-mode unit)`),
    catalogRow("next-workspace-l", "plasma-auto-tiler-next-workspace-l", "Next workspace", "Meta+Ctrl+L", "component-requirement", `${COSMIC_REF} NextWorkspace (needs a workspace-mode unit)`),
    catalogRow("fullscreen", "plasma-auto-tiler-fullscreen", "Toggle fullscreen active window", "Meta+F11", "component-requirement", `${COSMIC_REF} Fullscreen (needs a KWin capability component)`),
    catalogRow("resize-mode-outwards", "plasma-auto-tiler-resize-mode-outwards", "Enter split resize mode (grow)", "Meta+R", "exact", `${COSMIC_REF} Resizing(Outwards)`),
    catalogRow("resize-mode-inwards", "plasma-auto-tiler-resize-mode-inwards", "Enter split resize mode (shrink)", "Meta+Shift+R", "exact", `${COSMIC_REF} Resizing(Inwards)`),
    catalogRow("group-toggle", "plasma-auto-tiler-group-toggle", "Toggle stacking group", "Meta+S", "component-requirement", `${COSMIC_REF} ToggleStacking (reserved; needs a stacking component)`),
]);

const HYPRLAND_ROWS: readonly CatalogRow[] = Object.freeze([
    ...directional("focus", "Focus window", "Meta", "arrow", ARROW_KEYS, "exact", `${HYPRLAND_REF} mainMod+left/right/up/down focus`),
    ...directional("focus", "Focus window", "Meta", "", HJKL_KEYS, "compatibility-alias", `${HYPRLAND_REF} no HJKL default; project parity alias`),
    ...directional("move", "Move window", "Meta+Shift", "", HJKL_KEYS, "compatibility-alias", `${HYPRLAND_REF} no keyboard move default; project parity alias`),
    ...directional("move", "Move window", "Meta+Shift", "arrow", ARROW_KEYS, "compatibility-alias", `${HYPRLAND_REF} no keyboard move default; project parity alias`),
    catalogRow("float-toggle", "plasma-auto-tiler-float-toggle", "Float or tile active window", "Meta+V", "exact", `${HYPRLAND_REF} mainMod+V togglefloating`),
    ...workspaceRows("exact", `${HYPRLAND_REF} mainMod+1..9 focus workspace / mainMod+SHIFT+1..9 movetoworkspace`),
    moveWorkspaceZeroRow(`${HYPRLAND_REF} mainMod+SHIFT+0 movetoworkspace 10`),
    moveWorkspaceZeroSymbolRow(),
    workspaceZeroRow(`${HYPRLAND_REF} mainMod+0 focus workspace 10`, "exact"),
]);

const BSPWM_ROWS: readonly CatalogRow[] = Object.freeze([
    ...directional("focus", "Focus window", "Meta", "", HJKL_KEYS, "canonical-example", `${BSPWM_REF} super+{h,j,k,l} bspc node -f {west,south,north,east}`),
    ...directional("move", "Move window", "Meta+Shift", "", HJKL_KEYS, "canonical-example", `${BSPWM_REF} super+shift+{h,j,k,l} bspc node -s`),
    ...directional("focus", "Focus window", "Meta", "arrow", ARROW_KEYS, "compatibility-alias", `${BSPWM_REF} ships no arrow focus; project parity alias`),
    ...directional("move", "Move window", "Meta+Shift", "arrow", ARROW_KEYS, "compatibility-alias", `${BSPWM_REF} arrow row is move-floating (super+{Left,Down,Up,Right} bspc node -v), not the tiled move/swap action; project parity alias`),
    ...workspaceRows("canonical-example", `${BSPWM_REF} super+{1-9} bspc desktop -f / super+shift+{1-9} bspc node -d`),
    moveWorkspaceZeroRow(`${BSPWM_REF} super+shift+0 bspc node -d '^10'`, "canonical-example"),
    moveWorkspaceZeroSymbolRow(),
    workspaceZeroRow(`${BSPWM_REF} super+0 bspc desktop -f '^10'`, "canonical-example"),
    catalogRow("previous-workspace", "plasma-auto-tiler-previous-workspace", "Previous workspace", "Meta+BracketLeft", "component-requirement", `${BSPWM_REF} super+bracketleft bspc desktop -f prev.local (needs a workspace-mode unit)`),
    catalogRow("next-workspace", "plasma-auto-tiler-next-workspace", "Next workspace", "Meta+BracketRight", "component-requirement", `${BSPWM_REF} super+bracketright bspc desktop -f next.local (needs a workspace-mode unit)`),
    catalogRow("float-toggle", "plasma-auto-tiler-float-toggle", "Float or tile active window", "Meta+S", "canonical-example", `${BSPWM_REF} super+s bspc node -t floating`),
    catalogRow("fullscreen", "plasma-auto-tiler-fullscreen", "Toggle fullscreen active window", "Meta+F", "component-requirement", `${BSPWM_REF} super+f bspc node -t fullscreen (needs a KWin capability component)`),
    ...directional("resize-expand", "Resize window", "Meta+Alt", "", HJKL_KEYS, "canonical-example", `${BSPWM_REF} super+alt+{h,j,k,l} bspc node -z`),
    ...directional("resize-contract", "Resize window", "Meta+Alt+Shift", "", HJKL_KEYS, "canonical-example", `${BSPWM_REF} super+alt+shift+{h,j,k,l} bspc node -z`),
]);

export const PROFILE_CATALOGS: Readonly<Record<ProfileKey, ProfileCatalog>> = Object.freeze({
    cosmic: Object.freeze({ key: "cosmic", name: "COSMIC", rows: COSMIC_ROWS }),
    hyprland: Object.freeze({ key: "hyprland", name: "Hyprland", rows: HYPRLAND_ROWS }),
    bspwm: Object.freeze({ key: "bspwm", name: "bspwm", rows: BSPWM_ROWS }),
});

// Action IDs with an implemented controller callback in this unit. Only rows
// whose actionId is in this set are registered from the selected catalog; all
// other catalog rows are explicit component requirements, never registered as
// false equivalents. Rows classified `component-requirement` (`fullscreen`,
// `previous-workspace*`, `next-workspace*`, and the reserved `group-toggle`)
// need either a KWin capability, an external Plasma component, or a
// workspace-mode unit and are never registered or sequence-resolvable; the
// `workspace-0` Meta+0 row is implemented and registered. Kept beside
// `profileActions` in `start()` so the registration contract stays in one place
// and tests can derive the exact expected registered set from the catalog.
// ES2017-safe derivation of the registered action ID set: Array.prototype.flatMap
// is ES2019 and this KWin QJSEngine rejects it, so explicit loops preserve the
// exact insertion order without the unsupported built-in.
function registeredProfileActionIdList(): string[] {
    const ids: string[] = [];
    for (const family of ["focus", "move"]) {
        for (const direction of ["left", "down", "up", "right"]) {
            ids.push(`${family}-${direction}`, `${family}-${direction}-arrow`);
        }
    }
    ids.push("float-toggle", "maximize", "resize-mode-outwards", "resize-mode-inwards");
    for (const kind of ["expand", "contract"]) {
        for (const direction of ["left", "down", "up", "right"]) {
            ids.push(`resize-${kind}-${direction}`);
        }
    }
    ids.push("move-workspace-0", "move-workspace-0-symbol", "workspace-0");
    for (let index = 1; index <= 9; index += 1) {
        ids.push(`workspace-${index}`, `move-workspace-${index}`, `move-workspace-${index}-symbol`);
    }
    return ids;
}

export const REGISTERED_PROFILE_ACTION_IDS: ReadonlySet<string> = Object.freeze(
    new Set(registeredProfileActionIdList()),
);

// Absent/null/empty selects the cosmic default without a diagnostic; a valid
// profile name selects its own catalog; anything else selects cosmic with a
// diagnostic. Deterministic and pure for the tests.
export function selectProfile(value: unknown): {
    readonly profile: ProfileCatalog;
    readonly diagnostics: readonly string[];
} {
    if (typeof value === "string" && (PROFILE_KEYS as readonly string[]).includes(value)) {
        return { profile: PROFILE_CATALOGS[value as ProfileKey], diagnostics: Object.freeze([]) };
    }
    if (value === undefined || value === null || value === "") {
        return { profile: PROFILE_CATALOGS.cosmic, diagnostics: Object.freeze([]) };
    }
    return { profile: PROFILE_CATALOGS.cosmic, diagnostics: Object.freeze(["profile-invalid:fallback-cosmic"]) };
}

export interface SequenceConflict {
    readonly sequence: string;
    readonly actionIds: readonly [string, string];
}

export interface ShortcutIdConflict {
    readonly shortcutId: string;
    readonly actionIds: readonly [string, string];
}

export interface ProfileValidation {
    readonly ok: boolean;
    readonly duplicateSequences: readonly SequenceConflict[];
    readonly shortcutIdConflicts: readonly ShortcutIdConflict[];
}

// Deterministic in-profile validator. Deferred and component-requirement rows
// are never active sequences and do not participate. Every duplicate effective
// sequence names both conflicting action IDs, and every duplicate shortcut name
// reports its conflicting action IDs, so registration failures stay
// attributable. A shipped profile that also bound `Meta+0` to another row would
// be rejected here, which is the exact in-profile collision guard for the
// stable `plasma-auto-tiler-workspace-0` registration.
export function validateProfile(catalog: ProfileCatalog): ProfileValidation {
    const duplicateSequences: SequenceConflict[] = [];
    const sequenceOwners = new Map<string, string>();
    for (const row of catalog.rows) {
        // Deferred and component-requirement rows never register, so they have
        // no effective sequence and cannot collide.
        if (row.classification === "deferred" || row.classification === "component-requirement") {
            continue;
        }
        const owner = sequenceOwners.get(row.sequence);
        if (owner !== undefined) {
            duplicateSequences.push({ sequence: row.sequence, actionIds: [owner, row.actionId] });
        } else {
            sequenceOwners.set(row.sequence, row.actionId);
        }
    }
    const shortcutIdConflicts: ShortcutIdConflict[] = [];
    const idOwners = new Map<string, string>();
    for (const row of catalog.rows) {
        const owner = idOwners.get(row.shortcutId);
        if (owner !== undefined) {
            shortcutIdConflicts.push({ shortcutId: row.shortcutId, actionIds: [owner, row.actionId] });
        } else {
            idOwners.set(row.shortcutId, row.actionId);
        }
    }
    return {
        ok: duplicateSequences.length === 0 && shortcutIdConflicts.length === 0,
        duplicateSequences: Object.freeze(duplicateSequences),
        shortcutIdConflicts: Object.freeze(shortcutIdConflicts),
    };
}

// Registration-time catalog diagnostics: one per duplicate effective sequence
// and one per duplicate shortcut ID, each naming both conflicting action IDs.
// Pure and deterministic for the tests; every shipped profile emits none.
export function catalogValidationDiagnostics(catalog: ProfileCatalog): readonly string[] {
    const validation = validateProfile(catalog);
    const diagnostics: string[] = [];
    for (const conflict of validation.duplicateSequences) {
        diagnostics.push(
            `shortcut-catalog-collision:${conflict.sequence}:${conflict.actionIds[0]}:${conflict.actionIds[1]}`,
        );
    }
    for (const conflict of validation.shortcutIdConflicts) {
        diagnostics.push(`shortcut-id-conflict:${conflict.shortcutId}:${conflict.actionIds[0]}:${conflict.actionIds[1]}`);
    }
    return Object.freeze(diagnostics);
}

// User-override seam. A value set here takes precedence over the selected
// profile baseline and over the cosmic profile default. It is a pure model
// layer: no KGlobalAccel introspection or migration is claimed or implemented
// in this change (spec I / plan Unit 01 acceptance 4).
export class ShortcutOverrides {
    private readonly values = new Map<string, string>();

    get(actionId: string): string | undefined {
        return this.values.get(actionId);
    }

    set(actionId: string, sequence: string): void {
        this.values.set(actionId, sequence);
    }

    clear(): void {
        this.values.clear();
    }

    get snapshot(): ReadonlyMap<string, string> {
        return new Map(this.values);
    }
}

// Precedence: user override > selected baseline > profile default (cosmic).
// Returns null only when no layer defines the action. Deferred and
// component-requirement rows are never resolvable: neither the unbound rows nor
// the unimplemented fullscreen/previous-workspace/next-workspace/group actions
// can be claimed as a live sequence by any layer. The implemented `workspace-0`
// Meta+0 row resolves like any exact/canonical row.
export function resolveSequence(
    profile: ProfileCatalog,
    actionId: string,
    overrides?: ShortcutOverrides,
): string | null {
    const override = overrides?.get(actionId);
    if (override !== undefined) {
        return override;
    }
    const baseline = profile.rows.find(
        (row) => row.actionId === actionId && !UNRESOLVABLE_CLASSIFICATIONS.includes(row.classification),
    );
    if (baseline !== undefined) {
        return baseline.sequence;
    }
    const fallback = PROFILE_CATALOGS[DEFAULT_PROFILE].rows.find(
        (row) => row.actionId === actionId && !UNRESOLVABLE_CLASSIFICATIONS.includes(row.classification),
    );
    return fallback === undefined ? null : fallback.sequence;
}

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
    readonly registerShortcut: (name: string, text: string, sequence: string, handler: () => void) => boolean;
    readonly readConfig: (key: string, defaultValue: unknown) => unknown;
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

// The resolved dwindle insertion split: the leaf to split, its depth-derived
// orientation (via `depth % 2`), and its sole eligible occupant.
interface DwindleInsertionTarget {
    readonly tile: CustomTileCapability;
    readonly depth: number;
    readonly occupant: WindowCapability;
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
    // Set once a changed drop has armed a deferred origin removal. The finish
    // dispatch must not settle owed invariants immediately in that case: the
    // origin is transiently empty until the removal settle completes, so a
    // check there would spuriously reconstruct.
    armedDeferredRemoval: boolean;
}

// The kind of interactive window gesture read from the live `move` / `resize`
// booleans at gesture start. KWin clears both booleans before emitting the
// finished signal, so the finish dispatch attributes bails from the kind
// captured here rather than a stale live read.
type InteractiveKind = "move" | "resize" | "unknown";

interface InteractiveWatch {
    readonly disconnect: () => void;
    kind: InteractiveKind;
}

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

// Order a decoded `workspace.desktops` list by ascending 1-based X11 desktop
// number when every entry carries one; otherwise preserve the given list order
// (positional order is the fallback index source). Identity is always the
// string `id`, never the number.
function orderedDesktops(desktops: readonly VirtualDesktopCapability[]): readonly VirtualDesktopCapability[] {
    const indexed = desktops.map((desktop, index) => ({ desktop, number: desktopNumber(desktop), index }));
    const allNumbered = indexed.every((entry) => entry.number !== null);
    const ordered = allNumbered
        ? indexed.slice().sort((a, b) => (a.number as number) - (b.number as number))
        : indexed.slice().sort((a, b) => a.index - b.index);
    return ordered.map((entry) => entry.desktop);
}

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

// Depth of every usable leaf beneath a scope root, keyed by tile identity, so
// a fallback insertion candidate can derive its own dwindle orientation the
// same way `deepestLeaf` derives the intended leaf's. Depth is the number of
// layout ancestors above the leaf; a non-layout root and a zero-child layout
// root are both depth zero. Null on a structural decode failure.
function dwindleLeafDepths(root: CustomTileCapability): Map<CustomTileCapability, number> | null {
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
// Child order is derived from relativeGeometry via orderCustomTilesByAxis, not
// from tiles[] array index: multi-ordinal native array order is unestablished
// (custom-tile-split.ts:18-23).
function collectPresetLeaves(root: TileCapability): readonly TileCapability[] | null {
    if (!isCustomTile(root)) {
        return null;
    }
    if (!root.isLayout) {
        return [root];
    }
    const children = decodeSequential(root.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
    if (!children.ok) {
        return null;
    }
    const axis: SplitAxis = root.layoutDirection === HORIZONTAL_LAYOUT_DIRECTION ? "x" : "y";
    const ordered = orderCustomTilesByAxis(children.value, axis);
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

// Structural preset-shape match: a live custom-tile subtree must realize the
// blueprint node with the node's own orientation (the deterministic
// orientation of the configured preset at that position). The two children are
// accepted in either decoded order because the executor's "left"/"right" path
// mapping follows the split-return order.
function presetNodeMatches(tile: CustomTileCapability, node: Blueprint): boolean {
    if (node.kind === "leaf") {
        return !tile.isLayout;
    }
    if (!tile.isLayout) {
        return false;
    }
    if (tile.layoutDirection !== layoutDirectionFor(node.orientation)) {
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

// ==== Trailing empty workspace invariant (COSMIC-style reuse) ====
//
// One shared, stateless helper enforcing "exactly one trailing empty
// desktop" for a single domain (one connected output's local list in
// per-output-local mode, or the one global list in global-unique/shared
// mode). The trailing empty is identified structurally on every call - the
// desktop at the literal last position of `orderedIds`, if it is currently
// empty - never cached across dispatches, matching spec.md's ban on any
// ownership/identity Set for this concept. `isEmpty`/`isVisible` let the
// caller compose this with the existing "empty AND invisible on every
// connected output" cleanup predicate (see `planDesktopCleanup`) without
// this helper reimplementing visibility semantics itself.

export interface TrailingEmptyDomainRequest {
    // Domain-ordered desktop ids, most-recent live snapshot, pre-removal.
    readonly orderedIds: readonly string[];
    readonly isEmpty: (id: string) => boolean;
    readonly isVisible: (id: string) => boolean;
    // Removes the desktop for id; returns whether it was actually removed.
    readonly removeDesktop: (id: string) => boolean;
    // Creates one new empty desktop in this domain; returns its id, or null
    // on failure (defensively treated as a no-op by the helper).
    readonly createDesktop: () => string | null;
}

export interface TrailingEmptyDomainResult {
    readonly removedIds: readonly string[];
    readonly appendedId: string | null;
}

// Enforces the trailing-empty invariant for one domain in a single pass:
// 1. Identify the current trailing empty structurally: the desktop at the
//    literal last position of `orderedIds`, only if it is currently empty
//    (otherwise there is no trailing empty to protect right now). Exclude it
//    from removal.
// 2. Remove every other id that is empty and invisible (identical
//    eligibility to today's existing cleanup rule - no new removal cases).
//    A non-trailing empty desktop earlier in domain order is removable even
//    if it happens to be the only other empty desktop; it is never treated
//    as "the" trailing empty.
// 3. Re-read the domain list *after* removal and check the invariant: an
//    empty desktop at the trailing (last) position. If present, done. If not
//    (occupied last desktop, or an empty domain), append exactly one new
//    empty desktop and stop.
// No loop, no debounce/timer: a dispatch against unchanged state removes
// and appends nothing, so repeated calls are idempotent.
export function ensureTrailingEmptyDesktop(
    request: TrailingEmptyDomainRequest,
): TrailingEmptyDomainResult {
    const { orderedIds, isEmpty, isVisible, removeDesktop, createDesktop } = request;
    const lastId = orderedIds[orderedIds.length - 1];
    const trailingEmptyId = lastId !== undefined && isEmpty(lastId) ? lastId : null;
    const removedIds: string[] = [];
    for (const id of orderedIds) {
        if (id === trailingEmptyId) {
            continue;
        }
        if (!isEmpty(id) || isVisible(id)) {
            continue;
        }
        if (removeDesktop(id)) {
            removedIds.push(id);
        }
    }
    const removed = new Set(removedIds);
    const remainingIds = orderedIds.filter((id) => !removed.has(id));
    const trailingId = remainingIds[remainingIds.length - 1];
    const trailingSatisfied = trailingId !== undefined && isEmpty(trailingId);
    if (trailingSatisfied) {
        return { removedIds, appendedId: null };
    }
    const appendedId = createDesktop();
    return { removedIds, appendedId };
}

export class TileController {
    private readonly gate = new FeatureGate(() => this.flushStructuralMutation());
    private readonly pending = new TransientState<PendingKeyboard>();
    private readonly drag = new TransientState<ActiveDrag>();
    private shownDropOutline: RectCapability | null = null;
    private groupOutlineIdentity: object | null = null;
    private structuralMutationPending = false;
    private readonly interactiveWindows = new Map<WindowCapability, InteractiveWatch>();
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
    // Scopes whose dwindle invariant check was deferred while a live drag was
    // in progress. Each scope owes exactly one later check, run once the
    // tracked drag window is no longer live-moving/resizing.
    private readonly owedInvariantScopes = new Map<OutputCapability, Map<string, CurrentScope>>();
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
    private readonly pendingDesktopIntents: WindowCapability[] = [];
    // Deferred Meta+0 trailing-empty focus/creation outputs, drained through the
    // same bounded settle queue as the Meta+Shift+0 intents (spec F).
    private readonly pendingWorkspaceZeroOutputs: OutputCapability[] = [];
    // COSMIC split resize mode (catalog `resize-mode-outwards`/`-inwards`).
    // KWin scripting cannot observe a held key or a bare next-key modal input,
    // so entry is a deterministic toggle and the mode is driven only through
    // the separately registered directional focus rows (spec I). While active,
    // those directional keys dispatch a resize step instead of a focus step.
    private resizeModeActive = false;
    private resizeModeDirection: "outwards" | "inwards" = "outwards";
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
    private sharedWorkspaces: string[] = [];

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

    // Read-only mode snapshot for tests: entry/inverse/switch/exit are
    // deterministic and observable without mutating topology or assignments.
    resizeModeSnapshot(): { readonly active: boolean; readonly direction: "outwards" | "inwards" } {
        return { active: this.resizeModeActive, direction: this.resizeModeDirection };
    }

    // Parsed workspace mode (spec D). Read-only snapshot for tests and the
    // Unit 05 mode dispatch; the value is set once at startup.
    workspaceModeSnapshot(): WorkspaceMode {
        return this.workspaceMode;
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
        return this.recentDesktopChangeOutput;
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
        this.hideDropOutline();
        this.diagnostic(`disabled:${reason}`);
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
            const profileActions: Record<string, () => void> = {
                "focus-left": () => this.focusOrResize("left"),
                "focus-down": () => this.focusOrResize("down"),
                "focus-up": () => this.focusOrResize("up"),
                "focus-right": () => this.focusOrResize("right"),
                "focus-left-arrow": () => this.focusOrResize("left"),
                "focus-down-arrow": () => this.focusOrResize("down"),
                "focus-up-arrow": () => this.focusOrResize("up"),
                "focus-right-arrow": () => this.focusOrResize("right"),
                "move-left": () => this.moveActiveWindow("left"),
                "move-down": () => this.moveActiveWindow("down"),
                "move-up": () => this.moveActiveWindow("up"),
                "move-right": () => this.moveActiveWindow("right"),
                "move-left-arrow": () => this.moveActiveWindow("left"),
                "move-down-arrow": () => this.moveActiveWindow("down"),
                "move-up-arrow": () => this.moveActiveWindow("up"),
                "move-right-arrow": () => this.moveActiveWindow("right"),
                "float-toggle": () => this.floatActiveWindow(),
                "maximize": () => this.maximizeActiveWindow(),
                "resize-mode-outwards": () => this.enterOrExitResizeMode("outwards"),
                "resize-mode-inwards": () => this.enterOrExitResizeMode("inwards"),
                "resize-expand-left": () => this.resizeActiveWindow("left", "outwards"),
                "resize-expand-down": () => this.resizeActiveWindow("down", "outwards"),
                "resize-expand-up": () => this.resizeActiveWindow("up", "outwards"),
                "resize-expand-right": () => this.resizeActiveWindow("right", "outwards"),
                "resize-contract-left": () => this.resizeActiveWindow("left", "inwards"),
                "resize-contract-down": () => this.resizeActiveWindow("down", "inwards"),
                "resize-contract-up": () => this.resizeActiveWindow("up", "inwards"),
                "resize-contract-right": () => this.resizeActiveWindow("right", "inwards"),
            };
            for (let index = 1; index <= 9; index += 1) {
                profileActions[`workspace-${index}`] = () => this.navigateWorkspace(index);
                profileActions[`move-workspace-${index}`] = () => this.moveActiveToWorkspace(index);
                profileActions[`move-workspace-${index}-symbol`] = () => this.moveActiveToWorkspace(index);
            }
            profileActions["move-workspace-0"] = () => this.moveActiveToWorkspace(0);
            profileActions["move-workspace-0-symbol"] = () => this.moveActiveToWorkspace(0);
            profileActions["workspace-0"] = () => this.workspaceZero();
            const selected = selectProfile(this.environment.readConfig(SHORTCUT_PROFILE_CONFIG_KEY, DEFAULT_PROFILE));
            for (const diagnostic of selected.diagnostics) {
                this.diagnostic(diagnostic);
            }
            // Deterministic catalog validation before any row registers: a
            // duplicate effective sequence or duplicate shortcut ID is a
            // catalog defect, reported with both conflicting action IDs. Every
            // shipped profile validates clean; these diagnostics exist so an
            // accidental collision is never silent.
            for (const diagnostic of catalogValidationDiagnostics(selected.profile)) {
                this.diagnostic(diagnostic);
            }
            // Catalog-driven registration of the selected profile's rows.
            // Deferred rows, component-requirement rows (unimplemented
            // fullscreen/previous-workspace/next-workspace/group), and rows
            // without a controller callback are never registered; every
            // registered alias keeps its distinct shortcut ID from the catalog,
            // including the implemented `workspace-0` row under the stable
            // `plasma-auto-tiler-workspace-0` ID. A false registerShortcut
            // result is reported per row as evidence of attempted registration
            // only - KWin-local registration never displaces or reassigns a
            // Plasma-global sequence and reports no activation collision (spec
            // H.15/H.16). Each row re-registers under the same stable shortcut
            // ID on reload/restart, so KGlobalAccel keeps the same row and any
            // user-customized sequence survives; this is a pure
            // model/diagnostic boundary, not KGlobalAccel introspection.
            // Rows that collide with Plasma-global bindings remain shadowed on
            // stock Plasma. Full takeover, displaced-action reassignment,
            // snapshot, collision detection, and rollback semantics are a
            // separately gated installer/KCM migration (plan Unit 03), never
            // claimed by this script-local layer. That migration must assign a
            // displaced Plasma action only to the selected reference
            // environment's documented equivalent and otherwise record it
            // unassigned, require an atomic snapshot with rollback, and demand
            // live evidence before claiming activation.
            const registrationResults: boolean[] = [];
            for (const row of selected.profile.rows) {
                if (row.classification === "deferred" || row.classification === "component-requirement") {
                    continue;
                }
                if (!REGISTERED_PROFILE_ACTION_IDS.has(row.actionId)) {
                    continue;
                }
                const callback = profileActions[row.actionId];
                if (callback === undefined) {
                    continue;
                }
                const registered = this.environment.registerShortcut(row.shortcutId, row.text, row.sequence, callback);
                registrationResults.push(registered);
                if (!registered) {
                    this.diagnostic(`shortcut-register-failed:${row.shortcutId}`);
                }
            }
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
            const stickyRegistered = this.environment.registerShortcut(
                "plasma-auto-tiler-sticky-toggle",
                "Toggle sticky floating on all desktops",
                "Meta+Shift+G",
                () => this.stickyActiveWindow(),
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
                !registrationResults.every((registered) => registered) ||
                !detachRegistered ||
                !attachRegistered ||
                !stickyRegistered ||
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
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
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
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("focus-rejected:fullscreen");
                return;
            }
            if (isWindow(active) && active.onAllDesktops === true) {
                this.diagnostic("focus-rejected:sticky");
                return;
            }
            if (isWindow(active) && isNativelyMaximized(active)) {
                this.diagnostic("focus-rejected:maximized");
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
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
                return;
            }
            if (isWindow(active) && active.onAllDesktops === true) {
                this.diagnostic("move-rejected:sticky");
                return;
            }
            if (isWindow(active) && isNativelyMaximized(active)) {
                this.diagnostic("move-rejected:maximized");
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
                    assigned = manageTile(target.decoded.tile, active, this.markStructuralMutation);
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

    // Directional focus dispatch, COSMIC resize-mode aware. While the catalog
    // resize mode is active the separately registered directional focus rows
    // drive a resize step instead of a focus step; otherwise they focus.
    // Exactly one directional shortcut fires per key press (each alias keeps a
    // distinct shortcut ID), so a resize step never runs twice for one press.
    private focusOrResize(direction: Direction): void {
        if (this.resizeModeActive) {
            this.resizeActiveWindow(direction, this.resizeModeDirection);
        } else {
            this.focusNeighbor(direction);
        }
    }

    // COSMIC split resize mode (spec C / catalog resize-mode-* rows). KWin
    // scripting cannot observe a held key or register an arbitrary next-key
    // modal input, so entry is a deterministic toggle: activating the same
    // binding again exits the mode, and activating the other binding switches
    // the direction (matching COSMIC's Resizing(Outwards)/Resizing(Inwards)
    // alternate/inverse meaning). While active the mode only consumes the
    // separately registered directional focus rows via `focusOrResize`.
    private enterOrExitResizeMode(mode: "outwards" | "inwards"): void {
        this.gate.run(() => {
            if (this.resizeModeActive && this.resizeModeDirection === mode) {
                this.resizeModeActive = false;
                this.diagnostic("resize-mode-exited");
                return;
            }
            const entering = !this.resizeModeActive;
            this.resizeModeDirection = mode;
            this.resizeModeActive = true;
            this.diagnostic(entering ? `resize-mode-entered:${mode}` : `resize-mode-switched:${mode}`);
        }, (reason) => this.disabled(reason));
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
        this.gate.run(() => {
            this.diagnostic("resize-invoked");
            const active = this.environment.activeWindow();
            if (active === null) {
                this.diagnostic("resize-rejected:no-active-window");
                return;
            }
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("resize-rejected:fullscreen");
                return;
            }
            if (isWindow(active) && active.onAllDesktops === true) {
                this.diagnostic("resize-rejected:sticky");
                return;
            }
            if (isWindow(active) && isNativelyMaximized(active)) {
                this.diagnostic("resize-rejected:maximized");
                return;
            }
            const scope = this.scopeForWindow(active);
            if (scope === null) {
                this.diagnostic("resize-rejected:desktop-output-scope");
                return;
            }
            if (!windowInScope(active, scope)) {
                this.diagnostic("resize-rejected:active-window-eligibility");
                return;
            }
            const topology = this.topologyForScope(scope, (reason) => {
                this.diagnostic(`resize-rejected:${reason}`);
            });
            if (topology === null) {
                return;
            }
            if (active.tile === null || !isTile(active.tile)) {
                this.diagnostic("resize-rejected:active-tile-association");
                return;
            }
            const focused = operationLeafForTile(topology, active.tile);
            if (
                focused === null ||
                focused.leaf.isLayout ||
                focused.windows.length === 0 ||
                windowIndex(focused.windows, active) < 0
            ) {
                this.diagnostic("resize-rejected:focused-occupancy-validity");
                return;
            }
            const axis: SplitAxis = direction === "left" || direction === "right" ? "x" : "y";
            const expectedLayoutDirection = axis === "x" ? HORIZONTAL_LAYOUT_DIRECTION : VERTICAL_LAYOUT_DIRECTION;
            const target = this.resolveResizeSplit(active.tile, expectedLayoutDirection, direction, mode);
            if (target === null) {
                this.diagnostic("resize-rejected:no-parent");
                return;
            }
            const parentGeometry = target.split.relativeGeometry;
            const parentExtent = axis === "x" ? parentGeometry.width : parentGeometry.height;
            const focusedGeometry = target.focused.relativeGeometry;
            const focusedExtent = axis === "x" ? focusedGeometry.width : focusedGeometry.height;
            if (!(parentExtent > 0) || !(focusedExtent > 0)) {
                this.diagnostic("resize-rejected:no-parent");
                return;
            }
            const delta = RESIZE_STEP_FRACTION * parentExtent;
            const focusedProposed = mode === "outwards" ? focusedExtent + delta : focusedExtent - delta;
            const neighborProposed = parentExtent - focusedProposed;
            if (focusedProposed <= 0 || neighborProposed <= 0) {
                this.diagnostic("resize-rejected:no-parent");
                return;
            }
            if (this.resizeWouldViolateMinimum(scope, target.split, focusedProposed, neighborProposed, axis)) {
                this.diagnostic("resize-rejected:at-floor");
                return;
            }
            // Only the shared edge changes: the near-side child keeps its
            // near edge fixed, the far-side child keeps its far edge fixed.
            const positionShift = target.focused === target.first ? 0 : mode === "outwards" ? -delta : delta;
            const focusedTarget: RectCapability =
                axis === "x"
                    ? { x: focusedGeometry.x + positionShift, y: focusedGeometry.y, width: focusedProposed, height: focusedGeometry.height }
                    : { x: focusedGeometry.x, y: focusedGeometry.y + positionShift, width: focusedGeometry.width, height: focusedProposed };
            const written = setTileRelativeGeometry(target.focused, focusedTarget);
            if (!written) {
                this.diagnostic("resize-rejected:write-failed");
                return;
            }
            // Fresh whole-root decode: the tree still decodes and the active
            // window still occupies its leaf, proving no structural or
            // occupancy drift. The split still has the same two ordered
            // children, and both child extents match the proposal within the
            // documented tolerance, proving the shared edge moved as intended
            // (a clamped or refused sibling adjustment reports a mismatch).
            const fresh = this.topologyForScope(scope);
            if (fresh === null) {
                this.diagnostic("resize-rejected:post-decode");
                return;
            }
            const freshActive = operationLeafForTile(fresh, active.tile);
            if (freshActive === null || freshActive.leaf.isLayout || windowIndex(freshActive.windows, active) < 0) {
                this.diagnostic("resize-rejected:postcondition");
                return;
            }
            const freshChildren = decodeSequential(target.split.tiles, isCustomTile, 2);
            if (!freshChildren.ok) {
                this.diagnostic("resize-rejected:postcondition");
                return;
            }
            const freshOrdered = orderCustomTilesByAxis(freshChildren.value, axis);
            const freshFirst = freshOrdered?.[0];
            const freshSecond = freshOrdered?.[1];
            if (
                freshOrdered === null ||
                freshOrdered.length !== 2 ||
                freshFirst !== target.first ||
                freshSecond !== target.second
            ) {
                this.diagnostic("resize-rejected:postcondition");
                return;
            }
            const freshFocusedGeometry = target.focused.relativeGeometry;
            const freshNeighborGeometry = target.neighbor.relativeGeometry;
            const freshFocusedExtent = axis === "x" ? freshFocusedGeometry.width : freshFocusedGeometry.height;
            const freshNeighborExtent = axis === "x" ? freshNeighborGeometry.width : freshNeighborGeometry.height;
            if (
                Math.abs(freshFocusedExtent - focusedProposed) > RELATIVE_GEOMETRY_EPSILON ||
                Math.abs(freshNeighborExtent - neighborProposed) > RELATIVE_GEOMETRY_EPSILON
            ) {
                this.diagnostic("resize-rejected:postcondition");
                return;
            }
            this.diagnostic("resize-completed");
        }, (reason) => this.disabled(reason));
    }

    // COSMIC resize target resolution: the nearest matching-orientation
    // ancestor split where the current positioned node (the focused leaf,
    // then each climbed ancestor) is a direct child and has a sibling on the
    // mode-mapped pressed side. Outwards uses the sibling in the pressed
    // direction (grow); inwards uses the sibling opposite the pressed
    // direction (the flipped edge, shrink). A node at the outer edge of a
    // matching split climbs to the next ancestor, exactly like cosmic-comp
    // (shell/layout/tiling/mod.rs resize()); no climb target returns null.
    private resolveResizeSplit(
        focusedTile: TileCapability,
        expectedLayoutDirection: number,
        direction: Direction,
        mode: "outwards" | "inwards",
    ): { readonly split: CustomTileCapability; readonly first: CustomTileCapability; readonly second: CustomTileCapability; readonly focused: CustomTileCapability; readonly neighbor: CustomTileCapability } | null {
        const axis: SplitAxis = direction === "left" || direction === "right" ? "x" : "y";
        let node: object | null = focusedTile;
        while (node !== null) {
            const parent: object | null = (node as TileCapability).parent;
            if (parent === null) {
                return null;
            }
            if (isCustomTile(parent) && parent.isLayout && parent.layoutDirection === expectedLayoutDirection) {
                const decoded = decodeSequential(parent.tiles, isCustomTile, 2);
                if (decoded.ok) {
                    const ordered = orderCustomTilesByAxis(decoded.value, axis);
                    const first = ordered?.[0];
                    const second = ordered?.[1];
                    if (ordered !== null && ordered.length === 2 && first !== undefined && second !== undefined) {
                        const side = first === node ? "first" : second === node ? "second" : null;
                        if (side !== null) {
                            const pressedTowardNeighbor =
                                (side === "first" && (direction === "right" || direction === "down")) ||
                                (side === "second" && (direction === "left" || direction === "up"));
                            if ((mode === "outwards") === pressedTowardNeighbor) {
                                return {
                                    split: parent,
                                    first,
                                    second,
                                    focused: side === "first" ? first : second,
                                    neighbor: side === "first" ? second : first,
                                };
                            }
                        }
                    }
                }
            }
            if (!isTile(node)) {
                return null;
            }
            node = parent;
        }
        return null;
    }

    // Whether the proposed post-step child extents (screen-relative along the
    // split axis) fall below KWin's minimum tile size. The floor is
    // MINIMUM_TILE_FRACTION of the per-output working area extent on the axis,
    // scaled to screen-relative units through the split's own absolute extent.
    // An unreadable working area never refuses: the preflight must not invent a
    // floor it cannot prove.
    private resizeWouldViolateMinimum(
        scope: CurrentScope,
        split: CustomTileCapability,
        firstProposed: number,
        secondProposed: number,
        axis: SplitAxis,
    ): boolean {
        const workArea = this.environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop);
        if (!isRect(workArea)) {
            return false;
        }
        const workExtent = axis === "x" ? workArea.width : workArea.height;
        if (!(workExtent > 0)) {
            return false;
        }
        const absoluteExtent = axis === "x" ? split.absoluteGeometry.width : split.absoluteGeometry.height;
        const relativeExtent = axis === "x" ? split.relativeGeometry.width : split.relativeGeometry.height;
        if (!(absoluteExtent > 0) || !(relativeExtent > 0)) {
            return false;
        }
        const scale = absoluteExtent / relativeExtent;
        const floor = MINIMUM_TILE_FRACTION * workExtent;
        return firstProposed * scale < floor || secondProposed * scale < floor;
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
        if (active.fullScreen === true) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (target.leaf.isLayout || target.windows.length !== 1) {
            this.diagnostic("move-rejected:swap-occupancy-validity");
            return;
        }
        const occupant = target.windows[0];
        if (occupant === undefined || !windowInScope(occupant, scope)) {
            this.diagnostic("move-rejected:swap-occupant-ineligible");
            return;
        }
        if (occupant.fullScreen === true) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (!this.swapRevalidates(scope, active, occupant, source, target, direction, "before-first")) {
            this.diagnostic("move-swap-rejected:stale");
            return;
        }
        let firstAssigned = false;
        try {
            firstAssigned = assignWindowToTile(active, target.decoded.tile, this.markStructuralMutation);
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
            secondAssigned = assignWindowToTile(occupant, source.decoded.tile, this.markStructuralMutation);
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
            restored = assignWindowToTile(active, source.decoded.tile, this.markStructuralMutation);
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
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
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
            // A floating (including sticky) window must be tiled through the
            // single authoritative float-to-tile transition, which clears the
            // all-desktop pin before the tile write and clears the floating
            // state after it. The legacy assignment write below must never tile
            // a window that remains tracked floating/sticky.
            if (this.isFloating(active)) {
                this.tileFloatingActive(scope, active);
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
                assigned = assignWindowToTile(active, target.decoded.tile, this.markStructuralMutation);
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

    // Shared active-window guard for the float/sticky actions: every rejection
    // is an explicit reason log, and fullscreen windows are ignored through the
    // established fullscreen diagnostic. Returns the re-validated active window
    // and its scope, or null after emitting exactly one rejection reason.
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
        if (scope === null) {
            this.diagnostic(`${action}-rejected:desktop-output-scope`);
            return null;
        }
        return { active, scope };
    }

    // Meta+G float/tile toggle. Floating leaves the tile tree intact: the
    // vacated leaf is retained (unmanage never collapses), the window leaves
    // the placement population, and its centered 60% work-area geometry (or the
    // session-remembered one, bounded to the work area) is written. Tiling back
    // uses the established `tile.manage()` adoption into the first available
    // empty leaf; capacity (no available leaf) and floor (assignment) failures
    // leave it floating with the exact reason logged. A sticky window being
    // tiled first clears its all-desktop pin because sticky implies floating.
    floatActiveWindow(): void {
        this.gate.run(() => {
            this.diagnostic("float-invoked");
            const guard = this.activeActionGuard("float");
            if (guard === null) {
                return;
            }
            if (this.maximizedWindows.has(guard.active)) {
                // Floating a maximized window is refused before any mutation:
                // restoring then floating is two separate writes with no
                // demonstrated rollback, so the maximize state stays intact
                // rather than risking a partial un-maximized intermediate.
                this.diagnostic("float-rejected:maximized");
                return;
            }
            if (guard.active.tile !== null) {
                if (!isCustomTile(guard.active.tile) || guard.active.tile.isLayout) {
                    this.diagnostic("float-rejected:active-tile-association");
                    return;
                }
                this.floatTiledActive(guard.scope, guard.active);
                return;
            }
            this.tileFloatingActive(guard.scope, guard.active);
        }, (reason) => this.disabled(reason));
    }

    // Float an already-tiled active window. Re-derives active identity, scope,
    // and the exact tile association immediately before the single unmanage
    // write, then writes the float geometry. No structural call is ever made.
    private floatTiledActive(scope: CurrentScope, active: WindowCapability): void {
        const originTile = active.tile;
        if (originTile === null || !isCustomTile(originTile) || originTile.isLayout) {
            this.diagnostic("float-rejected:active-tile-association");
            return;
        }
        if (!this.floatRevalidates(scope, active, originTile)) {
            this.diagnostic("float-rejected:assignment-stale");
            return;
        }
        let unmanaged = false;
        try {
            unmanaged = unmanageTile(originTile, active);
        } catch (error) {
            void error;
            this.diagnostic("float-rejected:assignment-failed");
            return;
        }
        if (!unmanaged) {
            this.diagnostic("float-rejected:assignment-failed");
            return;
        }
        if (active.tile !== null) {
            this.diagnostic("float-failed:postcondition");
            return;
        }
        this.floatingWindows.add(active);
        this.floatScopes.set(active, scope.scope);
        if (!this.writeFloatGeometry(active, scope)) {
            this.diagnostic("float-geometry-failed");
        }
        this.diagnostic("float-completed");
    }

    private floatRevalidates(scope: CurrentScope, active: WindowCapability, originTile: TileCapability): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, scope.scope)) {
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

    // Tile a floating active window through the established safe adoption
    // `tile.manage()` into the deterministic first available empty non-layout
    // leaf. Every failure path - topology, capacity (no available leaf), stale
    // revalidation, and floor (assignment) - leaves the float unchanged with
    // the exact reason. A sticky window's all-desktop pin is cleared before any
    // tile write, so a failed clear leaves it sticky floating (never tiled). If
    // the clear succeeds but the subsequent `tile.manage` fails, the pin and
    // sticky tracking are restored before returning so the failed transition
    // leaves the original sticky floating state intact; a failed restore is
    // logged with its own reason. Only after a successful manage does the
    // infallible floating/sticky state cleanup run.
    private tileFloatingActive(scope: CurrentScope, active: WindowCapability): void {
        const topology = this.topologyForScope(scope, (reason) => {
            this.diagnostic(`tile-failed:${reason}`);
        });
        if (topology === null) {
            return;
        }
        const target = this.firstEmptyLeaf(topology);
        if (target === null) {
            this.diagnostic("tile-failed:no-available-leaf");
            return;
        }
        if (!this.tileFloatRevalidates(scope, active, target)) {
            this.diagnostic("tile-failed:assignment-stale");
            return;
        }
        let clearedSticky = false;
        if (this.isSticky(active)) {
            if (!this.clearSticky(active)) {
                this.diagnostic("tile-failed:sticky-clear-failed");
                return;
            }
            clearedSticky = true;
        }
        let managed = false;
        try {
            managed = manageTile(target.decoded.tile, active, this.markStructuralMutation);
        } catch (error) {
            void error;
        }
        if (!managed) {
            if (clearedSticky) {
                if (!this.pinSticky(active)) {
                    this.diagnostic("tile-failed:sticky-restore-failed");
                }
            }
            this.diagnostic("tile-failed:assignment-failed");
            return;
        }
        if (clearedSticky) {
            this.diagnostic("sticky-disabled");
        }
        this.rememberCurrentFloatGeometry(active);
        this.floatingWindows.delete(active);
        this.floatScopes.delete(active);
        this.detachedWindows.delete(active);
        this.diagnostic("tile-completed");
    }

    private tileFloatRevalidates(
        scope: CurrentScope,
        active: WindowCapability,
        target: OperationLeaf,
    ): boolean {
        if (this.environment.activeWindow() !== active) {
            return false;
        }
        const freshScope = this.scopeForWindow(active);
        if (freshScope === null || !sameScope(freshScope.scope, scope.scope)) {
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

    // Remember the live frame geometry at the moment a floating window tiles,
    // so a user resize while floating is the geometry restored on the next
    // float. Also called immediately before a fullscreen-exit restoration so a
    // user-adjusted float geometry survives the fullscreen round trip, not the
    // geometry recorded at the initial float. Read-only observation; a failed
    // or invalid read keeps the prior record.
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

    private clearSticky(window: WindowCapability): boolean {
        let cleared = false;
        try {
            cleared = setWindowOnAllDesktops(window, false);
        } catch (error) {
            void error;
        }
        if (!cleared) {
            return false;
        }
        this.stickyWindows.delete(window);
        return true;
    }

    private pinSticky(window: WindowCapability): boolean {
        let pinned = false;
        try {
            pinned = setWindowOnAllDesktops(window, true);
        } catch (error) {
            void error;
        }
        if (!pinned) {
            return false;
        }
        this.stickyWindows.add(window);
        return true;
    }

    // Meta+Shift+G sticky toggle. Sticky implies floating: enabling on a tiled
    // window floats it first (unmanage + float geometry) then pins it across
    // all desktops via the documented writable `onAllDesktops`. Disabling
    // clears the pin but the window remains floating. Never touches keepAbove
    // or any equivalent.
    stickyActiveWindow(): void {
        this.gate.run(() => {
            this.diagnostic("sticky-invoked");
            const guard = this.activeActionGuard("sticky");
            if (guard === null) {
                return;
            }
            const { active, scope } = guard;
            if (this.isSticky(active)) {
                if (!this.clearSticky(active)) {
                    this.diagnostic("sticky-failed:on-all-desktops-write");
                    return;
                }
                this.diagnostic("sticky-disabled");
                return;
            }
            if (this.maximizedWindows.has(active)) {
                // Sticky implies floating, which is refused on a maximized
                // window before any mutation: restoring then floating and
                // pinning is a multi-step write sequence with no demonstrated
                // rollback, so the maximize state stays intact rather than
                // risking a partial un-maximized intermediate.
                this.diagnostic("sticky-rejected:maximized");
                return;
            }
            if (!this.isFloating(active)) {
                if (active.tile !== null) {
                    if (!isCustomTile(active.tile) || active.tile.isLayout) {
                        this.diagnostic("sticky-rejected:active-tile-association");
                        return;
                    }
                    this.floatTiledActive(scope, active);
                    if (!this.isFloating(active)) {
                        return;
                    }
                } else {
                    if (!this.writeFloatGeometry(active, scope)) {
                        this.diagnostic("sticky-rejected:float-geometry-failed");
                        return;
                    }
                    this.floatingWindows.add(active);
                    this.floatScopes.set(active, scope.scope);
                    this.diagnostic("float-completed");
                }
            }
            if (!this.pinSticky(active)) {
                this.diagnostic("sticky-failed:on-all-desktops-write");
                return;
            }
            this.diagnostic("sticky-enabled");
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
            if (isWindow(active) && active.fullScreen === true) {
                this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
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
                    assigned = assignWindowToTile(entry.window, entry.target, this.markStructuralMutation);
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
            if (
                windowInScope(window, scope) &&
                window.tile === null &&
                !this.isFloating(window)
            ) {
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
        if (this.scopeHasFullscreen(scope)) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return { kind: "no-op" };
        }
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
        if (this.reflowTouchesMaximized(scope, overlay)) {
            this.diagnostic("maximize:ignored reflow while maximized");
            return { kind: "no-op" };
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
                assigned = assignWindowToTile(entry.window, entry.target, this.markStructuralMutation);
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
        this.hideDropOutline();
        this.drag.clearForScopeChange();
    }

    // Whether the tracked drag window is currently live-moving or
    // live-resizing, per the documented Window live state (`move` / `resize`).
    // This is the authoritative active-drag signal: the captured-origin latch is
    // never used on its own to decide that a drag is still in progress.
    private trackedDragLive(): boolean {
        const drag = this.drag.current;
        return drag !== undefined && (drag.window.move || drag.window.resize);
    }

    // Record exactly one owed invariant check for a scope whose check was
    // deferred by a live drag. A scope that already owes a check is neither
    // re-marked nor re-logged, keeping the diagnostic non-noisy.
    private markOwedInvariant(scope: CurrentScope): void {
        let byDesktop = this.owedInvariantScopes.get(scope.output);
        if (byDesktop === undefined) {
            byDesktop = new Map<string, CurrentScope>();
            this.owedInvariantScopes.set(scope.output, byDesktop);
        }
        if (!byDesktop.has(scope.desktop.id)) {
            byDesktop.set(scope.desktop.id, scope);
            this.diagnostic("ownership-invariant-deferred:drag-live");
        }
    }

    // Run every owed invariant check exactly once, after the tracked drag is no
    // longer live. Owed scopes are cleared before their check runs so a
    // still-live drag re-marks rather than double-running.
    private settleOwedInvariants(): void {
        if (this.trackedDragLive() || this.owedInvariantScopes.size === 0) {
            return;
        }
        const owed: CurrentScope[] = [];
        for (const byDesktop of this.owedInvariantScopes.values()) {
            for (const scope of byDesktop.values()) {
                owed.push(scope);
            }
        }
        this.owedInvariantScopes.clear();
        for (const scope of owed) {
            this.presetEnsureInvariant(scope);
        }
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
            this.settleOwedInvariants();
            this.attachExistingInteractiveWindows(false);
            this.engageCurrentScope();
            // A current-desktop change can move the sole trailing owned empty
            // into or out of occupancy (for example a pager move onto it), so
            // reconcile. Cleanup defers while a drag or reconstruction is live.
            this.cleanupDesktops();
            this.drainPendingDesktopIntents();
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
                this.reflowAfterRemoval(window);
                this.dwindleMaybeRemove(window);
                // The fullscreen record stays alive through both removal paths:
                // removing any window (including the fullscreen window itself)
                // while a fullscreen window belongs to this scope must not
                // mutate or reconstruct the tree, and the reflow/dwindle guards
                // depend on `scopeHasFullscreen` still seeing this record.
                // Detach and cleanup run only after those paths have bailed.
                this.detachFullscreenWindow(window);
                this.fullscreenWindows.delete(window);
            }
            this.settleOwedInvariants();
            // A window removal can leave an owned desktop empty again, turning
            // the kept replacement plus the re-emptied desktop into excess, so
            // reconcile. Cleanup defers while a drag or reconstruction is live.
            this.cleanupDesktops();
            this.drainPendingDesktopIntents();
        }, (reason) => this.disabled(reason));
    }

    private handleWindowAdded(window: unknown): void {
        this.gate.run(() => {
            this.onceDiagnostic("window-added-observed");
            this.attachInteractiveWindow(window);
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
                            this.deferDesktopScopeReevaluation(window, scope);
                        } else {
                            this.onceDiagnostic(`window-added-rejected:${reason}`);
                        }
                    } else {
                        this.onceDiagnostic("window-added-eligible");
                        this.placeEligibleAdded(window, scope);
                    }
                } else {
                    try {
                        this.completeKeyboardInsertion(window, pending);
                    } finally {
                        this.clearPending();
                    }
                }
            }
            // A window arrival on the script-owned trailing empty makes it
            // occupied, so reconcile. Cleanup defers while a drag or
            // reconstruction is live and retries through the settle seams.
            this.cleanupDesktops();
            this.drainPendingDesktopIntents();
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
            // A deferred window arrival on the script-owned trailing empty also
            // makes it occupied, so reconcile here as well.
            this.cleanupDesktops();
            this.drainPendingDesktopIntents();
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
            this.attachFullscreenWindow(window);
            if (isWindow(window) && window.fullScreen === true) {
                this.enterFullscreen(window);
            }
            if (isWindow(window) && isNativelyMaximized(window)) {
                this.recordStartupMaximize(window);
            }
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
            (geometry) => this.handleInteractiveStepped(geometry),
            () => this.handleMoveResizedChanged(),
            () => this.handleInteractiveInvalidated(window),
        );
        this.interactiveWindows.set(window, { disconnect: watched.disconnect, kind: "unknown" });
        return { attempted: watched.ok + watched.failed, ok: watched.ok, failed: watched.failed };
    }

    private detachInteractiveWindow(window: WindowCapability): void {
        const watch = this.interactiveWindows.get(window);
        if (watch === undefined) {
            return;
        }
        this.interactiveWindows.delete(window);
        watch.disconnect();
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
        if (this.fullscreenWindows.has(window)) {
            return;
        }
        if (this.drag.current?.window === window) {
            this.clearDrag();
        }
        const scope = this.scopeForWindow(window);
        const preservedTile = window.tile;
        if (preservedTile !== null && isTile(preservedTile) && scope !== null) {
            this.fullscreenWindows.set(window, { scope, preservedTile, wasTiled: true });
            this.diagnostic("fullscreen:enter preserved");
            return;
        }
        this.fullscreenWindows.set(window, { scope, preservedTile: null, wasTiled: false });
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
                this.writeFloatGeometry(window, scope);
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
        this.placeEligibleAdded(window, scope);
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
                if (scope !== null && this.isOwned(scope)) {
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

    private handleInteractiveInvalidated(window: WindowCapability): void {
        this.gate.run(() => {
            if (this.drag.current?.window === window) {
                this.diagnostic("drag-bail:window-invalidated");
                this.clearDrag();
            }
            // A maximized window's own output/desktop lifecycle events must not
            // detach it or drive invariant settlement: the cover record owns
            // the workspace and the geometry cover stays until an explicit
            // un-maximize or a successful restore-first move.
            if (this.maximizedWindows.has(window)) {
                this.diagnostic("maximize:ignored lifecycle while maximized");
                return;
            }
            this.detachInteractiveWindow(window);
            this.settleOwedInvariants();
        }, (reason) => this.disabled(reason));
    }

    private handleInteractiveStarted(window: WindowCapability): void {
        this.diagnostic("drag-started");
        this.gate.run(() => {
            if (window.fullScreen === true) {
                this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
                return;
            }
            if (this.maximizedWindows.has(window)) {
                this.diagnostic("maximize:ignored lifecycle while maximized");
                return;
            }
            const watch = this.interactiveWindows.get(window);
            if (watch !== undefined) {
                watch.kind = window.resize ? "resize" : window.move ? "move" : "unknown";
            }
            if (this.drag.current !== undefined) {
                if (this.trackedDragLive()) {
                    this.diagnostic("drag-origin-capture-failed:already-active");
                    return;
                }
                // A stale captured record whose window is no longer
                // live-moving/resizing must not block a new drag.
                this.clearDrag();
                this.settleOwedInvariants();
            }
            if (window.resize) {
                this.diagnostic("drag-origin-capture-failed:resize");
                return;
            }
            if (!window.move) {
                this.diagnostic("drag-origin-capture-failed:not-move");
                return;
            }
            // Floating and sticky windows are excluded from drag/drop retile:
            // a move on one is ignored with an explicit reason before any scope
            // or tile capture.
            if (this.isFloating(window)) {
                this.diagnostic("drag-origin-capture-failed:floating");
                return;
            }
            const scope = this.scopeForWindow(window);
            if (scope === null || !windowInScope(window, scope)) {
                this.diagnostic("drag-origin-capture-failed:scope");
                return;
            }
            if (window.tile === null || !isCustomTile(window.tile)) {
                this.diagnostic("drag-origin-capture-failed:tile-association");
                return;
            }
            if (this.isInert(scope)) {
                this.diagnostic("drag-origin-capture-failed:scope-inert");
                return;
            }
            const topology = this.topologyForScope(scope);
            if (topology === null) {
                this.diagnostic("drag-origin-capture-failed:topology");
                return;
            }
            if (!positiveGeometry(window.frameGeometry)) {
                this.diagnostic("drag-origin-capture-failed:geometry-invalid");
                return;
            }
            const origin = operationLeafForTile(topology, window.tile);
            if (origin === null || origin.leaf.isLayout || windowIndex(origin.windows, window) < 0) {
                this.diagnostic("drag-origin-capture-failed:origin-occupancy");
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
                armedDeferredRemoval: false,
            });
            this.diagnostic("drag-origin-captured");
        }, (reason) => this.disabled(reason));
    }

    private handleInteractiveFinished(window: WindowCapability): void {
        this.gate.run(() => {
            if (window.fullScreen === true) {
                this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
                this.hideDropOutline();
                return;
            }
            if (this.maximizedWindows.has(window)) {
                this.diagnostic("maximize:ignored lifecycle while maximized");
                this.hideDropOutline();
                return;
            }
            const watch = this.interactiveWindows.get(window);
            const wasResize = watch?.kind === "resize";
            if (watch !== undefined) {
                watch.kind = "unknown";
            }
            const drag = this.drag.current;
            if (drag === undefined) {
                if (wasResize) {
                    this.diagnostic("drag-bail:no-tracked-drag:resize");
                } else {
                    this.diagnostic("drag-bail:no-tracked-drag");
                }
                return;
            }
            if (drag.window !== window) {
                this.diagnostic("drag-bail:window-mismatch");
                return;
            }
            try {
                this.completeDrag(drag);
            } finally {
                this.clearDrag();
            }
            // A drop that armed a deferred origin removal leaves the origin
            // transiently empty; its removal settle runs the owed recovery.
            if (!drag.armedDeferredRemoval) {
                this.settleOwedInvariants();
            }
            // Retry desktop cleanup deferred by the just-settled live drag: the
            // drag no longer tracks as live, so a previously deferred cleanup
            // is no longer blocked and nothing re-triggers it otherwise.
            this.cleanupDesktops();
            this.drainPendingDesktopIntents();
        }, (reason) => this.disabled(reason));
    }

    // Stepped derives a read-only destination cue only. Finished remains the
    // sole drag path that may change tile structure.
    private handleInteractiveStepped(geometry: RectCapability): void {
        this.gate.run(() => {
            if (!this.dropOutlinePreview) {
                return;
            }
            const drag = this.drag.current;
            if (drag === undefined) {
                return;
            }
            const scope = this.scopeForWindow(drag.window);
            if (
                scope === null ||
                !sameScope(scope.scope, drag.scope.scope) ||
                !windowInScope(drag.window, scope)
            ) {
                this.hideDropOutline();
                return;
            }
            const topology = this.topologyForScope(scope);
            if (topology === null) {
                this.hideDropOutline();
                return;
            }
            const origin = operationLeafForTile(topology, drag.originTile);
            if (origin === null || origin.leaf.isLayout) {
                this.hideDropOutline();
                return;
            }
            const originIndex = windowIndex(origin.windows, drag.window);
            const draggedRef = origin.refs[originIndex];
            if (originIndex < 0 || draggedRef === undefined) {
                this.hideDropOutline();
                return;
            }
            const cursorPoint = this.readCursorPoint();
            const center = cursorPoint ?? (isRect(geometry) && positiveGeometry(geometry) ? rectCenter(geometry) : null);
            const pointSource: "cursor" | "frame-center" = cursorPoint !== null ? "cursor" : "frame-center";
            const target = this.geometryDropTarget(topology, origin, center, pointSource);
            if (target.kind !== "resolved") {
                this.hideDropOutline();
                return;
            }
            const plan = planGeometryDrop({
                scope: scope.scope,
                originLeaf: origin.leaf,
                targetLeaf: target.target.leaf,
                draggedWindow: draggedRef,
                pointer: target.center,
                record: {
                    scope: drag.scope.scope,
                    originLeafId: origin.leaf.id,
                    windowId: draggedRef.id,
                    geometry: drag.originGeometry,
                },
            });
            if (!plan.ok || (plan.value.kind === "geometry-drop" && this.splitWouldViolateMinimum(scope, target.target, plan.value.direction))) {
                this.hideDropOutline();
                return;
            }
            this.showDropOutline(target.target.leaf.geometry);
        }, (reason) => this.disabled(reason));
    }

    private showDropOutline(geometry: RectCapability): void {
        if (this.shownDropOutline !== null && sameGeometry(this.shownDropOutline, geometry)) {
            return;
        }
        this.environment.showOutline(geometry.x, geometry.y, geometry.width, geometry.height);
        this.shownDropOutline = { ...geometry };
    }

    private hideDropOutline(): void {
        if (this.shownDropOutline === null) {
            return;
        }
        this.environment.hideOutline();
        this.shownDropOutline = null;
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
        if (this.shownDropOutline !== null) {
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
        this.environment.showOutline(geometry.x, geometry.y, geometry.width, geometry.height);
        this.environment.scheduleOnce(GROUP_OUTLINE_DURATION_MS, () => {
            if (this.groupOutlineIdentity !== identity || this.shownDropOutline !== null) {
                return;
            }
            this.environment.hideOutline();
            this.groupOutlineIdentity = null;
        });
    }

    private handleMoveResizedChanged(): void {
        this.diagnostic("drag-move-resized-changed");
        this.gate.run(() => {
            this.settleOwedInvariants();
        }, (reason) => this.disabled(reason));
    }

    // Read the documented workspace cursor exactly once for drag target recovery,
    // under safe validation. Returns the finite cursor point, or null when the
    // read throws or the value is not a finite point; each failure emits a one-time
    // fallback diagnostic and the caller falls back to the frame center.
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
        if (!manageTile(drag.originTile, drag.window, this.markStructuralMutation)) {
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
        if (drag.window.fullScreen === true) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
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
            managed = manageTile(target.decoded.tile, drag.window, this.markStructuralMutation);
        } catch (error) {
            void error;
        }
        if (!managed) {
            this.bailDrag("drag-bail:empty-placement-failed", drag);
            return;
        }
        this.diagnostic("drag-empty-placement");
        drag.armedDeferredRemoval = true;
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
        if (this.splitWouldViolateMinimum(scope, target, direction)) {
            this.bailDrag("drag-refused:undersized-split", drag);
            return;
        }
        if (!this.splitDropTarget(target, occupant, drag, direction)) {
            return;
        }
        this.diagnostic("drag-overlap-split-completed");
        drag.armedDeferredRemoval = true;
        this.deferRemovalCollapse(drag.window, scope, drag.originTile, true, {
            dragged: drag.window,
            occupant,
        });
    }

    // Whether the equal 50/50 drop split of the resolved target leaf along the
    // split direction would put either half below KWin's minimum tile size. The
    // floor is MINIMUM_TILE_FRACTION of the per-output working area extent on
    // the split axis (x for left/right, y for up/down). An unreadable working
    // area never refuses: the preflight must not invent a floor it cannot prove.
    private splitWouldViolateMinimum(scope: CurrentScope, target: OperationLeaf, direction: Direction): boolean {
        const axis: SplitAxis = direction === "left" || direction === "right" ? "x" : "y";
        return this.splitAxisWouldViolateMinimum(scope, target.leaf.geometry, axis);
    }

    // Whether an equal 50/50 split of a leaf with the given geometry along the
    // split axis would put either half below KWin's minimum tile size. The floor
    // is MINIMUM_TILE_FRACTION of the per-output working area extent on the
    // axis. An unreadable working area never refuses: the preflight must not
    // invent a floor it cannot prove.
    private splitAxisWouldViolateMinimum(scope: CurrentScope, geometry: RectCapability, axis: SplitAxis): boolean {
        const leafExtent = axis === "x" ? geometry.width : geometry.height;
        const workArea = this.environment.clientArea(WORK_AREA_CLIENT_AREA_OPTION, scope.output, scope.desktop);
        if (!isRect(workArea)) {
            return false;
        }
        const workExtent = axis === "x" ? workArea.width : workArea.height;
        if (!(workExtent > 0)) {
            return false;
        }
        return leafExtent / 2 < MINIMUM_TILE_FRACTION * workExtent;
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
        const split = splitCustomTile(target.decoded.tile, splitDirection(direction), this.markStructuralMutation);
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (decoded.ok) {
            this.decodedBoundary("split-result");
        }
        const axis = direction === "left" || direction === "right" ? "x" : "y";
        const children = decoded.ok ? orderCustomTilesByAxis(decoded.value, axis) : null;
        const first = children?.[0];
        const second = children?.[1];
        if (children === null || children.length !== 2 || first === undefined || second === undefined) {
            this.gate.disable("drag-split-result-invalid", (reason) => this.disabled(reason));
            return false;
        }
        const selected = direction === "left" || direction === "up" ? first : second;
        const opposite = selected === first ? second : first;
        const occupantManaged = manageTile(opposite, occupant, this.markStructuralMutation);
        const draggedManaged = occupantManaged && manageTile(selected, drag.window, this.markStructuralMutation);
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

    // ---- Floating and sticky window state ----

    private isFloating(window: WindowCapability): boolean {
        return this.floatingWindows.has(window);
    }

    private isSticky(window: WindowCapability): boolean {
        return this.stickyWindows.has(window);
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

    // Centered 60% x 60% of the working area, floored to integer pixels and
    // strictly inside it (60% of a positive rect always fits).
    private centeredFloatGeometry(workArea: RectCapability): RectCapability {
        const width = Math.floor(workArea.width * FLOAT_WORK_AREA_FRACTION);
        const height = Math.floor(workArea.height * FLOAT_WORK_AREA_FRACTION);
        return {
            x: Math.floor(workArea.x + (workArea.width - width) / 2),
            y: Math.floor(workArea.y + (workArea.height - height) / 2),
            width,
            height,
        };
    }

    // Clamp a remembered float geometry so the window stays fully inside the
    // current work area (bounded to it) when the output geometry changed.
    private boundFloatGeometry(geometry: RectCapability, workArea: RectCapability): RectCapability {
        const width = Math.min(geometry.width, workArea.width);
        const height = Math.min(geometry.height, workArea.height);
        const maxX = workArea.x + workArea.width - width;
        const maxY = workArea.y + workArea.height - height;
        const x = Math.min(Math.max(geometry.x, workArea.x), maxX);
        const y = Math.min(Math.max(geometry.y, workArea.y), maxY);
        return { x, y, width, height };
    }

    // Write the float geometry: the session-remembered geometry bounded to the
    // current work area, or the centered 60% default when none is remembered.
    // The written geometry is recorded for the session so re-float, sticky
    // toggles, and the fullscreen round trip restore it. Returns whether the
    // guarded write reported success; the record is kept even on a failed write
    // so the remembered size survives the fullscreen seam.
    private writeFloatGeometry(window: WindowCapability, scope: CurrentScope): boolean {
        const workArea = this.workAreaForScope(scope);
        if (workArea === null) {
            return false;
        }
        const remembered = this.floatGeometries.get(window);
        const geometry =
            remembered !== undefined ? this.boundFloatGeometry(remembered, workArea) : this.centeredFloatGeometry(workArea);
        const written = writeWindowFrameGeometry(window, geometry);
        this.floatGeometries.set(window, geometry);
        return written;
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
        if (window.fullScreen === true || active.fullScreen === true || pending.targetWindow.fullScreen === true) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
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
        const split = splitCustomTile(target.decoded.tile, splitDirection(pending.direction), this.markStructuralMutation);
        const decoded = decodeSequential(split, isCustomTile, 2);
        if (!decoded.ok) {
            this.gate.disable("keyboard-split-result-invalid", (reason) => this.disabled(reason));
            return;
        }
        this.decodedBoundary("split-result");
        const axis = pending.direction === "left" || pending.direction === "right" ? "x" : "y";
        const children = decoded.ok ? orderCustomTilesByAxis(decoded.value, axis) : null;
        const first = children?.[0];
        const second = children?.[1];
        if (children === null || children.length !== 2 || first === undefined || second === undefined) {
            this.gate.disable("keyboard-split-child-selection-failed", (reason) => this.disabled(reason));
            return;
        }
        // Smallest source-proven child ordering: the revalidated source
        // occupant is assigned to its child first, then the incoming window is
        // placed on the requested side. The split has already mutated topology,
        // so a first-assignment stop leaves the split mutated with nothing
        // reassigned and a second-assignment stop leaves the source correctly
        // tiled in its new half; no rollback is claimed either way.
        const occupantChild = pending.direction === "left" || pending.direction === "up" ? second : first;
        const incomingChild = occupantChild === first ? second : first;
        if (!manageTile(occupantChild, pending.targetWindow, this.markStructuralMutation)) {
            this.diagnostic("keyboard-failed:first-assignment");
            return;
        }
        if (!manageTile(incomingChild, window, this.markStructuralMutation)) {
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

    // Adopt session-local ownership of the anchored scope with the configured
    // preset (`tilingAlgorithm`). A valid selected overlay takes precedence and
    // leaves the scope overlay-managed. The owned population is every eligible
    // in-scope window from the proven window collection excluding explicitly
    // detached windows. When the scope's tree already realizes the preset
    // blueprint for that count it is adopted unchanged; otherwise a full
    // reconstruction starts: a synchronous removals-only collapse to a single
    // leaf followed by a non-timer event-loop yield before the deferred split
    // reconstruction.
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
        if (this.scopeHasFloating(scope)) {
            // A scope with floating windows preserves its tree as the user
            // left it: the vacated leaves must never be collapsed, so the
            // tree is adopted unchanged rather than reconstructed.
            this.diagnostic("ownership-taken");
            return;
        }
        if (this.presetMatches(scope, population)) {
            this.diagnostic("ownership-taken");
            return;
        }
        this.startReconstruction(scope);
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
        if (this.scopeHasFullscreen(scope)) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (this.scopeHasMaximized(scope)) {
            this.diagnostic("maximize:ignored reconstruction while maximized");
            return;
        }
        if (this.trackedDragLive()) {
            this.markOwedInvariant(scope);
            return;
        }
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
                try {
                    if (this.pendingRebuilds.get(scope.output)?.get(scope.desktop.id) !== pending) {
                        return;
                    }
                    if (pending.phase !== armedFor) {
                        return;
                    }
                    this.settleScopeRebuild(scope, pending);
                } finally {
                    this.flushStructuralMutation();
                }
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
        if (this.scopeHasFullscreen(scope)) {
            this.dropPendingRebuild(scope, pending);
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
        if (this.scopeHasMaximized(scope)) {
            this.dropPendingRebuild(scope, pending);
            this.diagnostic("maximize:ignored reconstruction while maximized");
            return;
        }
        if (this.trackedDragLive()) {
            this.markOwedInvariant(scope);
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
        if (this.presetMatches(scope, population)) {
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
        // Phase two: the splits-only preset rebuild in one synchronous batch.
        if (this.rebuildPreset(scope, population)) {
            this.diagnostic("ownership-taken");
        } else {
            this.markInert(scope, "rebuild-failed");
        }
        this.dropPendingRebuild(scope, pending);
    }

    // Fresh resolution of a compiled blueprint path to the live custom tile:
    // the scope root is re-resolved from the environment and the tree is
    // re-decoded on every call, so the returned handle is valid only until the
    // next structural call and is never retained across one. Per-segment child
    // selection is derived from relativeGeometry via orderCustomTilesByAxis,
    // not from tiles[] array index: multi-ordinal native array order is
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
            const children = decodeSequential(current.tiles, isCustomTile, MAX_SEQUENTIAL_LENGTH);
            if (!children.ok) {
                return null;
            }
            const axis: SplitAxis = current.layoutDirection === HORIZONTAL_LAYOUT_DIRECTION ? "x" : "y";
            const ordered = orderCustomTilesByAxis(children.value, axis);
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
    // and the split return value is validated and discarded rather than
    // retained, so no tile handle survives from one structural call to the
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
            let split: unknown;
            try {
                split = splitCustomTile(target, layoutDirectionFor(instruction.orientation), this.markStructuralMutation);
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
        // Retry desktop cleanup deferred by the pending reconstruction once the
        // last one reaches its settled or inert end state. Cleanup is a no-op
        // here unless something is genuinely removable, and it cannot recurse
        // back into reconstruction.
        if (this.pendingRebuilds.size === 0) {
            this.cleanupDesktops();
            this.drainPendingDesktopIntents();
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

    // Re-establish the configured preset invariant for an owned scope after a
    // managed count change: when the current tree no longer realizes the preset
    // blueprint for the current population, start a full reconstruction. A
    // scope with no owned population or an authoritative valid overlay is
    // untouched. The scope root is decoded exactly once per check and shared by
    // the occupancy-bijection predicate and the canonical-shape predicate.
    private presetEnsureInvariant(scope: CurrentScope): void {
        if (!this.isOwned(scope) || this.isInert(scope)) {
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
        if (this.trackedDragLive()) {
            this.markOwedInvariant(scope);
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
            this.startReconstruction(scope);
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
    // intended leaf tile with its own depth (which derives the split
    // orientation) or null when the strategy yields no eligible occupied
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

    // Dispatch an eligible added window to the owned-scope dwindle path or the
    // generic overlay/automatic-placement path. A not-yet-owned, not-inert
    // scope is adopted first: the window's scope is the current desktop of its
    // output, so this re-establishes ownership when the current desktop had no
    // window at the earlier `currentDesktopChanged` notification and was left
    // unmanaged. Adoption goes through `ensureManaged` (dwindle match or the
    // two-phase reconstruction), never a direct remove or split.
    private placeEligibleAdded(window: WindowCapability, scope: CurrentScope): void {
        if (this.isFloating(window)) {
            return;
        }
        if (this.scopeHasFullscreen(scope)) {
            this.diagnostic("fullscreen:ignored lifecycle while fullscreen");
            return;
        }
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
        this.presetEnsureInvariant(scope);
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
        // chosen leaf is the only changed target and retains its own
        // depth-derived orientation; the nearest-splittable fallback and
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
        // under its own depth-derived orientation without violating KWin's
        // minimum floor, select the eligible fallback candidate (or float the
        // newcomer alone when none exists) before any structural mutation.
        const intendedLeaf = operationLeafForTile(topology, intended.tile);
        const intendedGeometry = intendedLeaf?.leaf.geometry ?? intended.tile.absoluteGeometry;
        const intendedAxis: SplitAxis = intended.depth % 2 === 0 ? "x" : "y";
        let target: DwindleInsertionTarget;
        if (!this.splitAxisWouldViolateMinimum(scope, intendedGeometry, intendedAxis)) {
            target = { tile: intended.tile, depth: intended.depth, occupant };
        } else {
            const fallback = this.dwindleInsertionFallback(scope, topology, intended);
            if (fallback === null) {
                // No leaf can split under its own orientation: the newcomer
                // alone stays floating, the tree is untouched, and the scope
                // stays retryable rather than being marked inert.
                this.floatingWindows.add(window);
                this.floatScopes.set(window, scope.scope);
                this.diagnostic("ownership-add-refused:no-eligible-leaf");
                return;
            }
            target = fallback;
        }
        const orientation: Orientation = target.depth % 2 === 0 ? "horizontal" : "vertical";
        let split: unknown;
        try {
            split = splitCustomTile(target.tile, layoutDirectionFor(orientation), this.markStructuralMutation);
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
        const axis: SplitAxis = orientation === "horizontal" ? "x" : "y";
        const children = orderCustomTilesByAxis(decoded.value, axis);
        const firstChild = children?.[0];
        const secondChild = children?.[1];
        if (children === null || children.length !== 2 || firstChild === undefined || secondChild === undefined) {
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
    // leaf cannot split under its own dwindle orientation without violating
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
            const orientation: Orientation = depth % 2 === 0 ? "horizontal" : "vertical";
            const axis: SplitAxis = orientation === "horizontal" ? "x" : "y";
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
        reflowLeaves?: ReflowLeaves,
    ): void {
        let armed = false;
        try {
            armed = this.environment.yieldOnce(() => {
                try {
                    this.settleRemovalCollapse(window, scope, leafTile, afterDragSnapshot, reflowLeaves);
                    this.settleOwedInvariants();
                } finally {
                    this.flushStructuralMutation();
                }
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
        if (this.trackedDragLive()) {
            this.markOwedInvariant(scope);
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

    private dwindleMaybeRemove(window: WindowCapability): void {
        const scope = this.scopeForWindow(window);
        if (scope === null) {
            return;
        }
        if (this.isInert(scope)) {
            this.onceDiagnostic("ownership-inert-ignored:removal");
            return;
        }
        if (!this.isOwned(scope)) {
            return;
        }
        if (this.trackedDragLive()) {
            this.markOwedInvariant(scope);
            return;
        }
        this.dwindleRemove(window, scope);
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
            this.drainPendingDesktopIntents();
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
        this.sharedWorkspaces = resolved.map((desktop) => desktop.id);
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
    private workspaceZero(): void {
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
        if (this.workspaceMutationDeferred()) {
            if (output !== null) {
                this.deferWorkspaceZero(output);
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

    // Whether the desktop list must not be mutated right now: a live drag, a
    // pending reconstruction, or an unsettled cross-workspace move. Desktop
    // creation and removal are deferred in exactly these conditions and
    // retried through the existing settle/yield seams.
    private workspaceMutationDeferred(): boolean {
        return this.trackedDragLive() || this.pendingRebuilds.size > 0 || this.pendingMoves.size > 0;
    }

    // Queue a deferred Meta+Shift+0 trailing-empty creation request for later
    // execution. The queue is bounded and each entry is re-validated on
    // execution.
    private deferDesktopIntent(window: WindowCapability): void {
        if (this.pendingDesktopIntents.length < MAX_SEQUENTIAL_LENGTH) {
            this.pendingDesktopIntents.push(window);
        }
        this.diagnostic("workspace-create-deferred:move");
    }

    // Queue a deferred Meta+0 focus/creation request for the active output. The
    // queue is bounded and each entry is re-validated on execution; the output
    // is re-resolved against the current context then, never acted on stale.
    private deferWorkspaceZero(output: OutputCapability): void {
        if (
            this.pendingWorkspaceZeroOutputs.length < MAX_SEQUENTIAL_LENGTH &&
            !this.pendingWorkspaceZeroOutputs.includes(output)
        ) {
            this.pendingWorkspaceZeroOutputs.push(output);
        }
        this.diagnostic("workspace-zero-deferred");
    }

    // Run every queued trailing-empty creation request, in order, once the
    // desktop list is safe to mutate. A request that is still unsafe is kept
    // queued; a request whose context became stale is cancelled.
    private drainPendingDesktopIntents(): void {
        if (!this.gate.isEnabled) {
            return;
        }
        if (this.workspaceMutationDeferred()) {
            return;
        }
        const pending = this.pendingDesktopIntents.slice();
        this.pendingDesktopIntents.length = 0;
        for (const window of pending) {
            this.finishMoveToTrailing(window);
        }
        this.drainPendingWorkspaceZero();
    }

    // Run every queued Meta+0 request, in order, once the desktop list is safe
    // to mutate. A request still unsafe is kept queued; a request whose output
    // became stale fails safely on execution.
    private drainPendingWorkspaceZero(): void {
        if (!this.gate.isEnabled) {
            return;
        }
        if (this.workspaceMutationDeferred()) {
            return;
        }
        const pending = this.pendingWorkspaceZeroOutputs.slice();
        this.pendingWorkspaceZeroOutputs.length = 0;
        for (const output of pending) {
            this.finishWorkspaceZero(output);
        }
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
            if (this.workspaceMutationDeferred()) {
                this.deferDesktopIntent(window);
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
            if (this.workspaceMutationDeferred()) {
                this.deferDesktopIntent(window);
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
            if (this.workspaceMutationDeferred()) {
                this.deferDesktopIntent(window);
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
                    if (this.workspaceMutationDeferred()) {
                        this.deferDesktopIntent(active);
                        return;
                    }
                    target = this.resolveLocalTrailingEmpty(scope.output) ?? this.appendTrailingForOutput(scope.output);
                } else if (this.workspaceMode === "global-unique") {
                    if (this.workspaceMutationDeferred()) {
                        this.deferDesktopIntent(active);
                        return;
                    }
                    const liveForRebuild = this.liveDesktops();
                    if (liveForRebuild !== null) {
                        this.reconcileGlobalUnique(liveForRebuild);
                    }
                    target = this.resolveGlobalTrailingEmpty(scope.output) ?? this.appendDesktopForGlobalUnique(scope.output);
                } else {
                    if (this.workspaceMutationDeferred()) {
                        this.deferDesktopIntent(active);
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
        this.drainPendingDesktopIntents();
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
        this.pendingMoves.add(window);
        let armed = false;
        try {
            armed = this.environment.yieldOnce(() => {
                try {
                    this.pendingMoves.delete(window);
                    this.adoptMovedWindow(window, targetScope);
                } finally {
                    this.flushStructuralMutation();
                }
            });
        } catch (error) {
            void error;
        }
        if (!armed) {
            this.pendingMoves.delete(window);
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
            this.placeEligibleAdded(window, targetScope);
            if (window.tile !== null) {
                this.diagnostic("workspace-move-adopted");
            } else if (this.pendingRebuilds.get(targetScope.output)?.get(targetScope.desktop.id) !== undefined) {
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
        this.drainPendingDesktopIntents();
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
        if (this.trackedDragLive()) {
            this.diagnostic("workspace-cleanup-deferred:drag-live");
            return;
        }
        if (this.pendingRebuilds.size > 0) {
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
                removeDesktop: (id) => this.removeOwnedEmptyShared(id, desktops, visible),
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
        desktops: readonly VirtualDesktopCapability[],
        visible: ReadonlySet<string>,
    ): boolean {
        if (visible.has(id)) {
            return false;
        }
        const position = desktops.findIndex((desktop) => desktop.id === id);
        const desktop = desktops[position];
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
                    removeDesktop: (id) => this.removeOwnedEmptyDesktop(id, desktops, visible),
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
                this.removeOwnedEmptyDesktop(id, remaining, visible);
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
        desktops: readonly VirtualDesktopCapability[],
        visible: ReadonlySet<string>,
    ): boolean {
        if (visible.has(id)) {
            return false;
        }
        const position = desktops.findIndex((desktop) => desktop.id === id);
        const desktop = desktops[position];
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
                    removeDesktop: (id) => this.removeOwnedEmptyGlobalUnique(id, desktops, visible),
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
        desktops: readonly VirtualDesktopCapability[],
        visible: ReadonlySet<string>,
    ): boolean {
        if (visible.has(id)) {
            return false;
        }
        const position = desktops.findIndex((desktop) => desktop.id === id);
        const desktop = desktops[position];
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
