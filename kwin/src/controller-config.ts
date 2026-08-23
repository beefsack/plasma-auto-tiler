import { compareLeaves, type Direction, type Leaf } from "./logic";
import { PRESET_KINDS, type PresetKind } from "./preset-catalog";

export type ProfileKey = "cosmic" | "hyprland" | "bspwm";
export type RowClassification =
    | "exact"
    | "canonical-example"
    | "compatibility-alias"
    | "deferred"
    | "component-requirement";

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

export const DEFAULT_PROFILE: ProfileKey = "cosmic";
export const SHORTCUT_PROFILE_CONFIG_KEY = "shortcutProfile";
export const PROFILE_KEYS: readonly ProfileKey[] = Object.freeze(["cosmic", "hyprland", "bspwm"]);

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

export interface AutomaticSplitCandidate {
    readonly tile: object;
    readonly depth: number;
    readonly leaf: Leaf;
    readonly occupied: boolean;
}

export interface AutomaticSplitSelectionContext {
    readonly dwindle: AutomaticSplitCandidate;
    readonly candidates: readonly AutomaticSplitCandidate[];
    readonly active: AutomaticSplitCandidate | null;
}

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

function symbolForDigit(digit: number): string {
    const symbol = SHIFT_DIGIT_SYMBOL_ALIAS.get(digit);
    if (symbol === undefined) {
        throw new Error(`symbolForDigit: no shifted-symbol alias mapped for digit ${digit}`);
    }
    return symbol;
}

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

export function validateProfile(catalog: ProfileCatalog): ProfileValidation {
    const duplicateSequences: SequenceConflict[] = [];
    const sequenceOwners = new Map<string, string>();
    for (const row of catalog.rows) {
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
