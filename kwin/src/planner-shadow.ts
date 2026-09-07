// POC2 KWin read-only planner shadow query (manually-started one-shot probe).
//
// Boundary: pure bounded normalizer, guarded native reader, plus async
// callDBus client. This module never imports the controller, tray, boundary,
// or any native mutation seam (manage/unmanage/split/geometry writes). It
// transmits only opaque logical DTO values; native captions, geometry,
// handles, tile types, and KWin terms are never read for transport (identity
// is object reference only) and never serialized. All failures are fixed
// redacted strings; native values are never echoed into logs or reasons.
//
// Production startup never runs this probe: the ordinary entry point
// (src/entry.ts) must not import or construct it. The manually-started
// project-owned probe lives in the separate entry
// (src/planner-shadow-probe-entry.ts), built only via the manual
// `build:planner-probe` script and loaded by hand. It never wires to
// production shortcuts or actions.
//
// KWin scripting offers no owner-loss signal on this seam: a D-Bus error
// reply logs without invoking the callback, so an absent service surfaces
// only as a one-flight timeout. No owner-loss/unload notifier is offered
// here; tests prove the timeout path instead of faking runtime owner events.

export const PLANNER_SERVICE = "org.plasmaautotiler.Planner";
export const PLANNER_OBJECT = "/org/plasmaautotiler/Planner";
export const PLANNER_INTERFACE = "org.plasmaautotiler.Planner1";
export const PLANNER_METHOD = "EvaluateMove";

export const PLANNER_CONTRACT_VERSION = 1;
export const PLANNER_MAX_REQUEST_BYTES = 64 * 1024;
export const PLANNER_MAX_REPLY_BYTES = 64 * 1024;
export const PLANNER_TIMEOUT_MS = 2000;
export const PLANNER_MAX_CORRELATION_LEN = 128;
export const PLANNER_MAX_GENERATION_LEN = 64;
export const PLANNER_MAX_REVISION = 1000000;

export const SHADOW_OUTPUT_ID = "source";
export const SHADOW_WORKSPACE_ID = "workspace-1";
export const SHADOW_ROOT_ID = "root";
export const SHADOW_LEAF_IDS: readonly string[] = Object.freeze(["leaf-a", "leaf-b"]);
export const SHADOW_WINDOW_IDS: readonly string[] = Object.freeze(["window-a", "window-b"]);

// Fixed vertical-slice probe direction for the R2a advisory slice.
export const SHADOW_PROBE_DIRECTION = "right";

const LOG_PREFIX = "plasma-auto-tiler:planner-shadow";

export type ShadowDirection = "left" | "right" | "up" | "down";

export type ShadowCapabilitySnake =
    | "swap_neighbor"
    | "wrap_perpendicular"
    | "wrap_siblings"
    | "insert_child"
    | "split_group_child"
    | "reparent_leaf"
    | "cross_output_transfer";

export type ShadowCapabilities = Record<ShadowCapabilitySnake, boolean>;

export const SHADOW_CAPABILITIES: ShadowCapabilities = Object.freeze({
    swap_neighbor: true,
    wrap_perpendicular: false,
    wrap_siblings: false,
    insert_child: false,
    split_group_child: false,
    reparent_leaf: false,
    cross_output_transfer: false,
});

const KNOWN_RULES: readonly string[] = Object.freeze(["R1", "R2a", "R2b", "R2c", "R3", "R4"]);
const KNOWN_CAPABILITIES_KEBAB: readonly string[] = Object.freeze([
    "swap-neighbor",
    "wrap-perpendicular",
    "wrap-siblings",
    "insert-child",
    "split-group-child",
    "reparent-leaf",
    "cross-output-transfer",
]);
const KNOWN_PRECONDITIONS: readonly string[] = Object.freeze([
    "focused-leaf-occupied-by-focused-window",
    "neighbor-leaf-occupied",
    "container-is-direct-parent",
    "target-group-membership",
    "parent-group-membership",
    "source-root-membership-and-adjacent-same-workspace-output",
    "adapter-must-verify-postconditions",
]);
const KNOWN_OPERATION_KINDS: readonly string[] = Object.freeze([
    "wrap-perpendicular",
    "swap-neighbor",
    "insert-into-group",
    "split-group-child",
    "wrap-neighbor",
    "escape-parent",
    "cross-output",
]);
const KNOWN_NOOP_REASONS: readonly string[] = Object.freeze([
    "boundary",
    "no-adjacent-output",
    "single-root-leaf",
]);
const KNOWN_REJECTION_KINDS: readonly string[] = Object.freeze([
    "malformed-topology",
    "unsupported-topology",
    "focused-leaf-not-found",
]);
const KNOWN_AXES: readonly string[] = Object.freeze(["horizontal", "vertical"]);

function kebabToSnake(capability: string): ShadowCapabilitySnake | null {
    switch (capability) {
        case "swap-neighbor":
            return "swap_neighbor";
        case "wrap-perpendicular":
            return "wrap_perpendicular";
        case "wrap-siblings":
            return "wrap_siblings";
        case "insert-child":
            return "insert_child";
        case "split-group-child":
            return "split_group_child";
        case "reparent-leaf":
            return "reparent_leaf";
        case "cross-output-transfer":
            return "cross_output_transfer";
        default:
            return null;
    }
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const alnum =
            (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        if (!(alnum || code === 45 || code === 95 || code === 46)) {
            return false;
        }
    }
    return true;
}

function isCorrelationId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= PLANNER_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > PLANNER_MAX_GENERATION_LEN) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const ok = (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45;
        if (!ok) {
            return false;
        }
    }
    return true;
}

function isRevision(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= PLANNER_MAX_REVISION
    );
}

function isDirection(value: unknown): value is ShadowDirection {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export interface ShadowLeafInput {
    readonly tile: object;
    readonly window: object | null;
}

export interface ShadowNormalizeInput {
    readonly leaves: readonly ShadowLeafInput[];
    readonly focusedTile: object;
    readonly focusedWindow: object;
    readonly direction: ShadowDirection;
    readonly correlationId: string;
    readonly generation: string;
    readonly revision: number;
    readonly capabilities?: Readonly<Partial<Record<ShadowCapabilitySnake, boolean>>>;
    // Anchored native identities for fresh revalidation. Never serialized;
    // reference equality is required so root/output/workspace replacement or
    // reassociation fails closed even when leaves remain.
    readonly root: object;
    readonly output: object;
    readonly workspace: object;
    readonly desktop: object;
}

export interface NormalizedShadowBundle {
    readonly requestJson: string;
    readonly correlationId: string;
    readonly generation: string;
    readonly revision: number;
    readonly capabilities: ShadowCapabilities;
    readonly snapshotIds: readonly string[];
    readonly focusedLeafId: string;
    readonly focusedWindowId: string;
    readonly direction: ShadowDirection;
    // Native object identities anchored at normalize time. Never serialized;
    // the drift comparator requires reference equality so a positional
    // fixed-id mapping can never false-accept swapped or replaced natives.
    // Root/output/workspace/desktop refs close root replacement and
    // output/workspace reassociation even when ordered leaves still match.
    readonly tileIdentities: readonly object[];
    readonly windowIdentities: ReadonlyArray<object | null>;
    readonly focusedTileRef: object;
    readonly focusedWindowRef: object;
    readonly rootRef: object;
    readonly outputRef: object;
    readonly workspaceRef: object;
    readonly desktopRef: object;
}

export type NormalizeResult =
    | { readonly ok: true; readonly bundle: NormalizedShadowBundle }
    | { readonly ok: false; readonly reason: string };

function resolveCapabilities(
    override: Readonly<Partial<Record<ShadowCapabilitySnake, boolean>>> | undefined,
): ShadowCapabilities | null {
    if (override === undefined) {
        return { ...SHADOW_CAPABILITIES };
    }
    const resolved: Record<string, boolean> = {};
    const keys: readonly ShadowCapabilitySnake[] = [
        "swap_neighbor",
        "wrap_perpendicular",
        "wrap_siblings",
        "insert_child",
        "split_group_child",
        "reparent_leaf",
        "cross_output_transfer",
    ];
    for (const key of keys) {
        const value = Object.prototype.hasOwnProperty.call(override, key)
            ? override[key]
            : SHADOW_CAPABILITIES[key];
        if (typeof value !== "boolean") {
            return null;
        }
        resolved[key] = value;
    }
    // POC2 selected slice is R2a swap-neighbor advisory only: the declared
    // set must be precisely swap_neighbor true with every other capability
    // false. Any deviation fails closed so an R2b/structural plan can never
    // be declared supportable.
    if (
        resolved["swap_neighbor"] !== true ||
        resolved["wrap_perpendicular"] !== false ||
        resolved["wrap_siblings"] !== false ||
        resolved["insert_child"] !== false ||
        resolved["split_group_child"] !== false ||
        resolved["reparent_leaf"] !== false ||
        resolved["cross_output_transfer"] !== false
    ) {
        return null;
    }
    return resolved as ShadowCapabilities;
}

// Pure bounded active single-output/single-workspace <=2 direct-leaf root
// snapshot normalizer. Native values are object references only; positional
// opaque logical ids are emitted. No captions, geometry, handles, tile types,
// or KWin terms are read or transmitted.
export function normalizeShadowRequest(input: ShadowNormalizeInput): NormalizeResult {
    if (!isRecord(input)) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    if (
        !isCorrelationId(input.correlationId) ||
        !isGeneration(input.generation) ||
        !isRevision(input.revision)
    ) {
        return { ok: false, reason: "shadow-invalid-identity" };
    }
    if (!isDirection(input.direction)) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    // Anchor actual native identities. Missing/non-object root, output,
    // workspace, or desktop fails closed so replacement/reassociation can
    // never normalize behind identical ordered leaves.
    if (
        typeof input.root !== "object" ||
        input.root === null ||
        typeof input.output !== "object" ||
        input.output === null ||
        typeof input.workspace !== "object" ||
        input.workspace === null ||
        typeof input.desktop !== "object" ||
        input.desktop === null
    ) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const leaves = input.leaves;
    if (!Array.isArray(leaves) || leaves.length < 1 || leaves.length > 2) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const capabilities = resolveCapabilities(input.capabilities);
    if (capabilities === null) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    let focusedIndex = -1;
    const seenTiles = new Set<object>();
    const seenWindows = new Set<object>();
    const tileIdentities: object[] = [];
    const windowIdentities: Array<object | null> = [];
    for (let index = 0; index < leaves.length; index += 1) {
        const leaf = leaves[index];
        if (!isRecord(leaf) || typeof leaf.tile !== "object" || leaf.tile === null) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        const tile = leaf.tile as object;
        if (seenTiles.has(tile)) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        seenTiles.add(tile);
        tileIdentities.push(tile);
        const occupant = (leaf as { window: unknown }).window;
        if (occupant !== null && occupant !== undefined) {
            if (typeof occupant !== "object" || occupant === null) {
                return { ok: false, reason: "shadow-unsupported-topology" };
            }
            const windowObject = occupant as object;
            if (seenWindows.has(windowObject) || seenTiles.has(windowObject)) {
                return { ok: false, reason: "shadow-unsupported-topology" };
            }
            seenWindows.add(windowObject);
            windowIdentities.push(windowObject);
        } else if (occupant !== null) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        } else {
            windowIdentities.push(null);
        }
        if (tile === input.focusedTile) {
            focusedIndex = index;
        }
    }
    if (focusedIndex < 0) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    const focusedLeaf = leaves[focusedIndex];
    if (focusedLeaf === undefined) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    const focusedOccupant = (focusedLeaf as { window: unknown }).window;
    if (focusedOccupant === null || focusedOccupant === undefined || focusedOccupant !== input.focusedWindow) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    const leafIds: string[] = [];
    const windowIds: string[] = [];
    for (let index = 0; index < leaves.length; index += 1) {
        const leafId = SHADOW_LEAF_IDS[index];
        const windowId = SHADOW_WINDOW_IDS[index];
        if (leafId === undefined || windowId === undefined) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        leafIds.push(leafId);
        windowIds.push(windowId);
    }
    const focusedLeafId = leafIds[focusedIndex];
    const focusedWindowId = windowIds[focusedIndex];
    if (focusedLeafId === undefined || focusedWindowId === undefined) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    const tree =
        leaves.length === 1
            ? { kind: "leaf", id: leafIds[0] }
            : {
                  kind: "group",
                  id: SHADOW_ROOT_ID,
                  axis: "horizontal",
                  children: leaves.map((_leaf, index) => ({ kind: "leaf", id: leafIds[index] })),
              };
    const windows: Array<Record<string, string>> = [];
    for (let index = 0; index < leaves.length; index += 1) {
        const leaf = leaves[index];
        if (leaf !== undefined && (leaf as { window: unknown }).window !== null) {
            windows.push({
                window: windowIds[index] as string,
                leaf: leafIds[index] as string,
                output: SHADOW_OUTPUT_ID,
                workspace: SHADOW_WORKSPACE_ID,
            });
        }
    }
    const request = {
        v: PLANNER_CONTRACT_VERSION,
        correlation_id: input.correlationId,
        generation: input.generation,
        revision: input.revision,
        snapshot: {
            outputs: [
                {
                    id: SHADOW_OUTPUT_ID,
                    workspace: SHADOW_WORKSPACE_ID,
                    tree,
                    adjacent: {},
                },
            ],
            windows,
        },
        intent: {
            source_output: SHADOW_OUTPUT_ID,
            focused_leaf: focusedLeafId,
            focused_window: focusedWindowId,
            direction: input.direction,
        },
        capabilities: {
            swap_neighbor: capabilities.swap_neighbor,
            wrap_perpendicular: capabilities.wrap_perpendicular,
            wrap_siblings: capabilities.wrap_siblings,
            insert_child: capabilities.insert_child,
            split_group_child: capabilities.split_group_child,
            reparent_leaf: capabilities.reparent_leaf,
            cross_output_transfer: capabilities.cross_output_transfer,
        },
    };
    let requestJson = "";
    try {
        requestJson = JSON.stringify(request);
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    if (requestJson.length > PLANNER_MAX_REQUEST_BYTES) {
        return { ok: false, reason: "shadow-oversized" };
    }
    const snapshotIds =
        leaves.length === 1
            ? Object.freeze([SHADOW_OUTPUT_ID, leafIds[0] as string])
            : Object.freeze([SHADOW_OUTPUT_ID, SHADOW_ROOT_ID, ...(leafIds as string[])]);
    return {
        ok: true,
        bundle: {
            requestJson,
            correlationId: input.correlationId,
            generation: input.generation,
            revision: input.revision,
            capabilities,
            snapshotIds,
            focusedLeafId,
            focusedWindowId,
            direction: input.direction,
            tileIdentities: Object.freeze(tileIdentities),
            windowIdentities: Object.freeze(windowIdentities),
            focusedTileRef: input.focusedTile,
            focusedWindowRef: input.focusedWindow,
            rootRef: input.root,
            outputRef: input.output,
            workspaceRef: input.workspace,
            desktopRef: input.desktop,
        },
    };
}

// Load-scoped probe identity: one valid generation per script load with
// internally monotonic revisions and unique correlations. The probe entry
// creates exactly one session per load; every manual one-shot run allocates
// its identity from it.
export interface ShadowSessionIdentity {
    readonly correlationId: string;
    readonly generation: string;
    readonly revision: number;
}

export interface ShadowSession {
    readonly generation: string;
    nextIdentity(): ShadowSessionIdentity;
}

function randomShadowGeneration(): string {
    let suffix = "fallback";
    try {
        suffix = `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x100000000).toString(36)}`;
    } catch (error) {
        void error;
        suffix = "fallback";
    }
    const candidate = `probe-${suffix}`;
    return candidate.length <= PLANNER_MAX_GENERATION_LEN
        ? candidate
        : candidate.slice(0, PLANNER_MAX_GENERATION_LEN);
}

export function createShadowSession(generation?: string): ShadowSession {
    let currentGeneration =
        typeof generation === "string" && isGeneration(generation)
            ? generation
            : randomShadowGeneration();
    if (!isGeneration(currentGeneration)) {
        currentGeneration = "probe-fallback";
    }
    const startGeneration = currentGeneration;
    let revision = -1;
    const session: ShadowSession = {
        get generation(): string {
            return currentGeneration;
        },
        nextIdentity(): ShadowSessionIdentity {
            if (revision >= PLANNER_MAX_REVISION) {
                currentGeneration = randomShadowGeneration();
                if (!isGeneration(currentGeneration)) {
                    currentGeneration = "probe-fallback";
                }
                revision = 0;
            } else {
                revision += 1;
            }
            return {
                correlationId: `${currentGeneration}-r${revision}`,
                generation: currentGeneration,
                revision,
            };
        },
    };
    void startGeneration;
    return session;
}

// Minimal KWin workspace surface for the read-only probe, using only declared
// scripting APIs (workspace.activeWindow/activeScreen,
// currentDesktopForScreen, rootTile; Window.output/Window.tile;
// Tile.isLayout/tiles/windows). Unknown-typed so stub workspaces and the
// ambient Workspace both fit without speculative declarations.
export interface ShadowKWinWorkspace {
    readonly activeWindow: unknown;
    readonly activeScreen: unknown;
    currentDesktopForScreen(output: object): unknown;
    rootTile(output: object, desktop: object): unknown;
}

// Live native snapshot without transport identity: object references only,
// fixed probe direction. The probe entry combines this with a session
// identity before normalizing. Root/output/workspace/desktop refs anchor
// fresh revalidation so replacement/reassociation fails closed.
export interface ShadowNativeSnapshot {
    readonly leaves: readonly ShadowLeafInput[];
    readonly focusedTile: object;
    readonly focusedWindow: object;
    readonly direction: ShadowDirection;
    readonly root: object;
    readonly output: object;
    readonly workspace: object;
    readonly desktop: object;
}

export type NativeSnapshotResult =
    | { readonly ok: true; readonly snapshot: ShadowNativeSnapshot }
    | { readonly ok: false; readonly reason: string };

function readNativeProp(value: object, property: string): unknown {
    try {
        return Reflect.get(value, property);
    } catch (error) {
        void error;
        return undefined;
    }
}

// Bounded array-like decode for KWin QList boundaries (array-likes whose
// indexed reads resolve). Elements must be non-null objects; only reference
// identity is observed, never strings, geometry, or handles.
function decodeNativeRefs(value: unknown, maxLength: number): readonly object[] | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    let length: unknown = undefined;
    try {
        length = Reflect.get(value, "length");
    } catch (error) {
        void error;
        return null;
    }
    if (
        typeof length !== "number" ||
        !Number.isInteger(length) ||
        length < 0 ||
        length > maxLength
    ) {
        return null;
    }
    const elements: object[] = [];
    for (let index = 0; index < length; index += 1) {
        let element: unknown = undefined;
        try {
            element = Reflect.get(value, String(index));
        } catch (error) {
            void error;
            return null;
        }
        if (typeof element !== "object" || element === null) {
            return null;
        }
        elements.push(element);
    }
    return elements;
}

function isNativeLayoutFlag(value: unknown): boolean {
    return value === true;
}

// Read-only live snapshot of the actual current KWin state: active window,
// active output/current workspace, root tile, and bounded <=2 direct-leaf
// topology with object identities preserved. Fixed probe direction. Fails
// closed on any unsupported root, tree shape, or occupancy. Reads only
// object references and the isLayout discriminant plus the numeric layout
// direction (1 horizontal, 2 vertical); never serializes or logs
// captions, geometry, handles, tile types, or KWin terms. The two-leaf POC2
// slice constrains to exactly horizontal (direction 1): any other layout
// direction fails closed so a hardcoded horizontal group can never
// misrepresent a vertical native.
export function readShadowNativeSnapshot(workspace: unknown): NativeSnapshotResult {
    if (typeof workspace !== "object" || workspace === null) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const surface = workspace as ShadowKWinWorkspace;
    let activeWindow: unknown = undefined;
    try {
        activeWindow = surface.activeWindow;
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    if (typeof activeWindow === "function") {
        try {
            activeWindow = (activeWindow as () => unknown)();
        } catch (error) {
            void error;
            return { ok: false, reason: "shadow-invalid-intent" };
        }
    }
    if (typeof activeWindow !== "object" || activeWindow === null) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    const focusedWindow = activeWindow as object;
    const windowOutput = readNativeProp(focusedWindow, "output");
    let output: object | null = null;
    if (typeof windowOutput === "object" && windowOutput !== null) {
        output = windowOutput;
    } else {
        let activeScreen: unknown = undefined;
        try {
            activeScreen = surface.activeScreen;
        } catch (error) {
            void error;
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        if (typeof activeScreen !== "object" || activeScreen === null) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        output = activeScreen;
    }
    if (typeof surface.currentDesktopForScreen !== "function") {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    let desktop: unknown = undefined;
    try {
        desktop = surface.currentDesktopForScreen(output);
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (typeof desktop !== "object" || desktop === null) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (typeof surface.rootTile !== "function") {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    let root: unknown = undefined;
    try {
        root = surface.rootTile(output, desktop);
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (typeof root !== "object" || root === null) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const focusedTileValue = readNativeProp(focusedWindow, "tile");
    if (typeof focusedTileValue !== "object" || focusedTileValue === null) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    const focusedTile = focusedTileValue as object;
    const rootObject = root as object;
    const outputObject = output;
    const desktopObject = desktop as object;
    const workspaceObject = workspace as object;
    const rootIsLayout = readNativeProp(rootObject, "isLayout");
    if (typeof rootIsLayout !== "boolean") {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    // Single-leaf root: the root itself is the only occupied leaf.
    if (!isNativeLayoutFlag(rootIsLayout)) {
        const rootTiles = decodeNativeRefs(readNativeProp(root, "tiles"), 0);
        const rootWindows = decodeNativeRefs(readNativeProp(root, "windows"), 1);
        if (rootTiles === null || rootTiles.length !== 0 || rootWindows === null || rootWindows.length !== 1) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        const occupant = rootWindows[0];
        if (occupant === undefined || occupant !== focusedWindow || root !== focusedTile) {
            return { ok: false, reason: "shadow-invalid-intent" };
        }
        const leaves = Object.freeze([{ tile: rootObject, window: focusedWindow }]);
        return {
            ok: true,
            snapshot: {
                leaves,
                focusedTile: rootObject,
                focusedWindow,
                direction: SHADOW_PROBE_DIRECTION,
                root: rootObject,
                output: outputObject,
                workspace: workspaceObject,
                desktop: desktopObject,
            },
        };
    }
    // Layout root: no direct windows, exactly two non-layout direct leaves,
    // each occupied by exactly one window. POC2 constrains to exactly
    // horizontal: the numeric layout direction must read exactly 1. A 2
    // (vertical), missing, or unexpected value fails closed; the value is
    // never serialized or logged.
    const rootLayoutDirection = readNativeProp(rootObject, "layoutDirection");
    if (rootLayoutDirection !== 1) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const rootWindows = decodeNativeRefs(readNativeProp(root, "windows"), 0);
    if (rootWindows === null || rootWindows.length !== 0) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const children = decodeNativeRefs(readNativeProp(root, "tiles"), 2);
    if (children === null || children.length !== 2) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const first = children[0];
    const second = children[1];
    if (first === undefined || second === undefined || first === second) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const decoded: ShadowLeafInput[] = [];
    for (const child of [first, second]) {
        if (readNativeProp(child, "isLayout") !== false) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        const childTiles = decodeNativeRefs(readNativeProp(child, "tiles"), 0);
        if (childTiles === null || childTiles.length !== 0) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        const childWindows = decodeNativeRefs(readNativeProp(child, "windows"), 1);
        if (childWindows === null || childWindows.length !== 1) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        const occupant = childWindows[0];
        if (occupant === undefined) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        decoded.push({ tile: child, window: occupant });
    }
    let focusedFound = false;
    for (const leaf of decoded) {
        if (leaf.tile === focusedTile) {
            focusedFound = true;
            if (leaf.window !== focusedWindow) {
                return { ok: false, reason: "shadow-invalid-intent" };
            }
        }
    }
    if (!focusedFound) {
        return { ok: false, reason: "shadow-invalid-intent" };
    }
    return {
        ok: true,
        snapshot: {
            leaves: Object.freeze(decoded),
            focusedTile,
            focusedWindow,
            direction: SHADOW_PROBE_DIRECTION,
            root: rootObject,
            output: outputObject,
            workspace: workspaceObject,
            desktop: desktopObject,
        },
    };
}

export interface ShadowReplyExpectation {
    readonly correlationId: string;
    readonly generation: string;
    readonly revision: number;
    readonly capabilities: ShadowCapabilities;
    readonly snapshotIds: readonly string[];
}

export type ShadowReply =
    | {
          readonly outcome: "planned";
          readonly rule: string;
          readonly capability: string;
          readonly preconditions: readonly string[];
          readonly operation: Record<string, unknown>;
      }
    | { readonly outcome: "noop"; readonly reason: string }
    | { readonly outcome: "rejected"; readonly kind: string };

export type ReplyValidation =
    | { readonly ok: true; readonly reply: ShadowReply }
    | { readonly ok: false; readonly reason: string };

function contains(haystack: readonly string[], needle: unknown): boolean {
    return typeof needle === "string" && haystack.indexOf(needle) >= 0;
}

function isNonNegativeInteger(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// Collects every opaque id reference an operation carries and requires each
// to resolve against the request snapshot ids. Enum-valued strings (rule,
// axis, insertion, side, continuation, target) are excluded by key.
function operationReferencesResolve(operation: Record<string, unknown>, snapshotIds: readonly string[]): boolean {
    const excluded = new Set([
        "kind",
        "rule",
        "axis",
        "insertion",
        "focused_side",
        "continuation",
        "target",
    ]);
    for (const key of Object.keys(operation)) {
        if (excluded.has(key)) {
            continue;
        }
        const value = operation[key];
        if (typeof value === "string") {
            if (snapshotIds.indexOf(value) < 0) {
                return false;
            }
        }
    }
    return true;
}

function validateOperationShape(operation: unknown, rule: string): operation is Record<string, unknown> {
    if (!isRecord(operation) || typeof operation["kind"] !== "string") {
        return false;
    }
    const kind = operation["kind"] as string;
    if (!contains(KNOWN_OPERATION_KINDS, kind)) {
        return false;
    }
    if (operation["rule"] !== rule) {
        return false;
    }
    switch (kind) {
        case "wrap-perpendicular":
            return (
                typeof operation["container"] === "string" && contains(KNOWN_AXES, operation["axis"])
            );
        case "swap-neighbor":
            return typeof operation["container"] === "string" && typeof operation["neighbor"] === "string";
        case "insert-into-group":
            return (
                typeof operation["container"] === "string" &&
                typeof operation["target_group"] === "string" &&
                isNonNegativeInteger(operation["insertion_index"]) &&
                (operation["insertion"] === "midpoint" || operation["insertion"] === "near-edge")
            );
        case "split-group-child":
            return (
                typeof operation["container"] === "string" &&
                typeof operation["target_group"] === "string" &&
                typeof operation["target_child"] === "string" &&
                isNonNegativeInteger(operation["target_child_index"]) &&
                (operation["focused_side"] === "first" || operation["focused_side"] === "second") &&
                contains(KNOWN_AXES, operation["axis"])
            );
        case "wrap-neighbor":
            return (
                typeof operation["container"] === "string" &&
                typeof operation["neighbor"] === "string" &&
                typeof operation["focused_before_neighbor"] === "boolean" &&
                contains(KNOWN_AXES, operation["axis"])
            );
        case "escape-parent":
            return (
                typeof operation["container"] === "string" &&
                typeof operation["parent"] === "string" &&
                isNonNegativeInteger(operation["container_child_index"]) &&
                (isNonNegativeInteger(operation["parent_insertion_index"]) ||
                    operation["parent_insertion_index"] === null) &&
                (operation["continuation"] === "none" || operation["continuation"] === "R1")
            );
        case "cross-output":
            return (
                typeof operation["target_output"] === "string" &&
                isNonNegativeInteger(operation["source_root_child_index"]) &&
                (operation["target"] === "empty" || operation["target"] === "occupied")
            );
        default:
            return false;
    }
}

// Strict JSON reply schema/size validation. Fixed redacted reasons only;
// received values are never echoed. POC2 selected slice is R2a
// swap-neighbor advisory only: any other rule, capability, or operation
// kind fails closed and never reaches could-execute.
export function validateShadowReply(replyText: unknown, expected: ShadowReplyExpectation): ReplyValidation {
    if (typeof replyText !== "string") {
        return { ok: false, reason: "shadow-reply-malformed" };
    }
    if (replyText.length > PLANNER_MAX_REPLY_BYTES) {
        return { ok: false, reason: "shadow-reply-oversized" };
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(replyText);
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-reply-malformed" };
    }
    if (!isRecord(parsed)) {
        return { ok: false, reason: "shadow-reply-malformed" };
    }
    if (
        parsed["v"] !== PLANNER_CONTRACT_VERSION ||
        parsed["correlation_id"] !== expected.correlationId ||
        parsed["generation"] !== expected.generation ||
        parsed["revision"] !== expected.revision
    ) {
        return { ok: false, reason: "shadow-identity-mismatch" };
    }
    const outcome = parsed["outcome"];
    if (outcome === "planned") {
        const rule = parsed["rule"];
        const capability = parsed["capability"];
        const preconditions = parsed["preconditions"];
        const operation = parsed["operation"];
        if (typeof rule !== "string" || !contains(KNOWN_RULES, rule)) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        if (typeof capability !== "string" || !contains(KNOWN_CAPABILITIES_KEBAB, capability)) {
            return { ok: false, reason: "shadow-capability-mismatch" };
        }
        const snake = kebabToSnake(capability);
        if (snake === null || expected.capabilities[snake] !== true) {
            return { ok: false, reason: "shadow-capability-mismatch" };
        }
        // POC2 structural gate: only R2a swap-neighbor advisory may execute.
        // An R2b/structural reply (different rule, capability, or operation
        // kind) fails closed here and never reaches could-execute.
        if (rule !== "R2a" || capability !== "swap-neighbor") {
            return { ok: false, reason: "shadow-capability-mismatch" };
        }
        if (!Array.isArray(preconditions)) {
            return { ok: false, reason: "shadow-precondition-mismatch" };
        }
        for (const precondition of preconditions) {
            if (!contains(KNOWN_PRECONDITIONS, precondition)) {
                return { ok: false, reason: "shadow-precondition-mismatch" };
            }
        }
        if (!validateOperationShape(operation, rule)) {
            return { ok: false, reason: "shadow-operation-mismatch" };
        }
        if ((operation as Record<string, unknown>)["kind"] !== "swap-neighbor") {
            return { ok: false, reason: "shadow-capability-mismatch" };
        }
        if (!operationReferencesResolve(operation as Record<string, unknown>, expected.snapshotIds)) {
            return { ok: false, reason: "shadow-operation-mismatch" };
        }
        return {
            ok: true,
            reply: {
                outcome: "planned",
                rule,
                capability,
                preconditions: Object.freeze([...(preconditions as string[])]),
                operation: operation as Record<string, unknown>,
            },
        };
    }
    if (outcome === "noop") {
        if (!contains(KNOWN_NOOP_REASONS, parsed["reason"])) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        return { ok: true, reply: { outcome: "noop", reason: parsed["reason"] as string } };
    }
    if (outcome === "rejected") {
        if (!contains(KNOWN_REJECTION_KINDS, parsed["kind"])) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        if (typeof parsed["message"] !== "string" || (parsed["message"] as string).length === 0) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        return { ok: true, reply: { outcome: "rejected", kind: parsed["kind"] as string } };
    }
    return { ok: false, reason: "shadow-outcome-mismatch" };
}

// Fresh-decode comparator. Opaque transport ids must match AND the anchored
// native object identities (references, order, focus) must match, so swapped
// or replaced natives behind unchanged positional ids still read as drift.
// Root/output/workspace/desktop refs close root replacement and
// output/workspace reassociation even when ordered leaves still match.
export function sameShadowTopology(a: NormalizedShadowBundle, b: NormalizedShadowBundle): boolean {
    if (a.direction !== b.direction || a.focusedLeafId !== b.focusedLeafId) {
        return false;
    }
    if (a.focusedWindowId !== b.focusedWindowId) {
        return false;
    }
    if (a.correlationId !== b.correlationId || a.generation !== b.generation || a.revision !== b.revision) {
        return false;
    }
    if (a.focusedTileRef !== b.focusedTileRef || a.focusedWindowRef !== b.focusedWindowRef) {
        return false;
    }
    if (
        a.rootRef !== b.rootRef ||
        a.outputRef !== b.outputRef ||
        a.workspaceRef !== b.workspaceRef ||
        a.desktopRef !== b.desktopRef
    ) {
        return false;
    }
    if (a.tileIdentities.length !== b.tileIdentities.length) {
        return false;
    }
    for (let index = 0; index < a.tileIdentities.length; index += 1) {
        if (a.tileIdentities[index] !== b.tileIdentities[index]) {
            return false;
        }
    }
    if (a.windowIdentities.length !== b.windowIdentities.length) {
        return false;
    }
    for (let index = 0; index < a.windowIdentities.length; index += 1) {
        if (a.windowIdentities[index] !== b.windowIdentities[index]) {
            return false;
        }
    }
    if (a.snapshotIds.length !== b.snapshotIds.length) {
        return false;
    }
    for (let index = 0; index < a.snapshotIds.length; index += 1) {
        if (a.snapshotIds[index] !== b.snapshotIds[index]) {
            return false;
        }
    }
    const keys: readonly ShadowCapabilitySnake[] = [
        "swap_neighbor",
        "wrap_perpendicular",
        "wrap_siblings",
        "insert_child",
        "split_group_child",
        "reparent_leaf",
        "cross_output_transfer",
    ];
    for (const key of keys) {
        if (a.capabilities[key] !== b.capabilities[key]) {
            return false;
        }
    }
    return true;
}

export interface ShadowProbeEnv {
    readonly callDbus: (
        service: string,
        path: string,
        dbusInterface: string,
        method: string,
        payload: string,
        callback: (reply: unknown) => void,
    ) => void;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => () => void;
    readonly log: (message: string) => void;
    readonly readFresh: () => ShadowNormalizeInput | null;
}

function logReject(env: ShadowProbeEnv, token: string): void {
    try {
        env.log(`${LOG_PREFIX}:reject:${token}`);
    } catch (error) {
        void error;
    }
}

// Manually-started one-shot probe. Never runs at ordinary startup and never
// wires to production shortcuts/actions: the separate probe entry constructs
// it per manual trigger. One in-flight request, timer timeout, fresh-decode
// identity/topology checks, duplicate/late cleanup. Logs only could-execute
// or a redacted fail-closed reason. No controller calls, native writes,
// retry, queue, owner-loss notifiers, Rust callbacks, or tray coupling. An
// absent planner service never invokes the callback, so it surfaces as
// shadow-timeout; no fake runtime owner event exists on this seam.
export class PlannerShadowProbe {
    private armed = false;
    private inFlight = false;
    private consumed = false;
    private callbackSeen = false;
    private cancelTimer: (() => void) | null = null;

    constructor(private readonly env: ShadowProbeEnv) {}

    get isArmed(): boolean {
        return this.armed;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    enableOnce(): void {
        if (this.consumed || this.inFlight) {
            return;
        }
        this.armed = true;
    }

    runOnce(bundle: NormalizedShadowBundle): void {
        if (this.consumed || this.inFlight || !this.armed) {
            logReject(this.env, this.inFlight ? "shadow-busy" : "shadow-disabled");
            return;
        }
        this.armed = false;
        this.consumed = true;
        this.inFlight = true;
        this.callbackSeen = false;
        let timerCancel: (() => void) | null = null;
        try {
            timerCancel = this.env.scheduleOnce(PLANNER_TIMEOUT_MS, () => this.onTimeout());
        } catch (error) {
            void error;
            this.inFlight = false;
            logReject(this.env, "shadow-timer-failed");
            return;
        }
        this.cancelTimer = timerCancel;
        try {
            this.env.callDbus(
                PLANNER_SERVICE,
                PLANNER_OBJECT,
                PLANNER_INTERFACE,
                PLANNER_METHOD,
                bundle.requestJson,
                (reply) => this.onReply(reply, bundle),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "shadow-dbus-failed");
        }
    }

    private onTimeout(): void {
        if (!this.inFlight) {
            return;
        }
        this.clearTimer();
        this.inFlight = false;
        logReject(this.env, "shadow-timeout");
    }

    private onReply(reply: unknown, bundle: NormalizedShadowBundle): void {
        if (!this.inFlight || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        this.inFlight = false;
        const validated = validateShadowReply(reply, {
            correlationId: bundle.correlationId,
            generation: bundle.generation,
            revision: bundle.revision,
            capabilities: bundle.capabilities,
            snapshotIds: bundle.snapshotIds,
        });
        if (!validated.ok) {
            logReject(this.env, validated.reason);
            return;
        }
        let freshInput: ShadowNormalizeInput | null = null;
        try {
            freshInput = this.env.readFresh();
        } catch (error) {
            void error;
            freshInput = null;
        }
        if (freshInput === null) {
            logReject(this.env, "shadow-topology-drift");
            return;
        }
        if (
            freshInput.correlationId !== bundle.correlationId ||
            freshInput.generation !== bundle.generation ||
            freshInput.revision !== bundle.revision
        ) {
            logReject(this.env, "shadow-identity-mismatch");
            return;
        }
        const fresh = normalizeShadowRequest(freshInput);
        if (!fresh.ok) {
            logReject(this.env, "shadow-topology-drift");
            return;
        }
        if (!sameShadowTopology(bundle, fresh.bundle)) {
            logReject(this.env, "shadow-topology-drift");
            return;
        }
        const result = validated.reply;
        if (result.outcome === "planned") {
            // Defense in depth: only R2a swap-neighbor advisory may report
            // could-execute; any structural reply fails closed even if schema
            // validation ever widened.
            if (result.rule !== "R2a" || result.capability !== "swap-neighbor") {
                logReject(this.env, "shadow-capability-mismatch");
                return;
            }
            try {
                this.env.log(`${LOG_PREFIX}:could-execute:${result.rule}:${result.capability}`);
            } catch (error) {
                void error;
            }
            return;
        }
        if (result.outcome === "noop") {
            logReject(this.env, `shadow-noop-${result.reason}`);
            return;
        }
        logReject(this.env, `shadow-rejected-${result.kind}`);
    }

    private clearTimer(): void {
        const cancel = this.cancelTimer;
        this.cancelTimer = null;
        if (cancel === null) {
            return;
        }
        try {
            cancel();
        } catch (error) {
            void error;
        }
    }
}
