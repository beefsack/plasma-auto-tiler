// Live KWin wiring for the bounded DescribePlan adapter.
//
// Production startup route: src/entry.ts calls startPlanAdapterEntry with the
// fixed session owner/generation. Observation is read-only public state only
// (active window, window list, output names, desktop membership, normalized
// native ids, quantized frame extents, active-output work area). Only
// normal windows are observed; every other window kind is skipped before the
// snapshot so it can never be sent, and Rust owns all remaining policy. The
// planner requests are DescribePlan carrying one JSON string. Workspace sends
// also use the documented bus-daemon presence and activation methods before
// pinning a unique Planner owner. Reply geometries are applied by the adapter in the
// shared canonical order. Directional focus/move shortcuts and
// direction-plus-mode resize shortcuts from the configured profile catalog
// map to parameterized plan commands. Window and scope signals feed one
// debounced fresh-snapshot resync owned by the adapter. Foreground plus
// hidden-domain observation feed one shared single-flight: at startup and on
// window open/move/scope signals the adapter also adopts/reconciles
// non-visible (output, workspace) domains without switching desktop
// visibility or writing native focus. Hidden snapshots carry a deterministic
// domain-local structural anchor as focusedId and only drive
// admit/remove/reconcile geometry on exact hidden-domain refs. No tiling, order,
// membership, or rejection policy lives here. Diagnostics are always-on and
// bounded: the adapter's cmd route entry/terminal, rejected-kind, per-member
// write, scope-transition, echo-fence, and refusal lines, plus one bounded
// shortcut-failed line and one bounded plan-ready startup line.

import { DomainGaps, readDomainGaps } from "./domain-gap";
import { identifyGrabbedEdges, identifyPressGrabbed, resolveOracleResizeTargets, startDragOraclePullEntry, DragOracleFinishContext, DragOracleVerdict, OracleGrabbed, OracleGrabSource } from "./drag-oracle-pull";
import {
    DRAG_MEASURE_LATER_TIMEOUT_MS,
    DRAG_MEASURE_VERDICT_TIMEOUT_MS,
    DragMeasurePointer,
    DragMeasureRect,
    describeMeasureEdge,
    formatDragMeasureLine,
    readMeasurePointer,
    readMeasureRect,
} from "./drag-measure";
import { normalizeNativeId } from "./native-id";
import {
    ActiveGroupObserved,
    GROUP_HIGHLIGHT_CLEAR_METHOD,
    GROUP_HIGHLIGHT_INTERFACE,
    GROUP_HIGHLIGHT_OBJECT,
    GROUP_HIGHLIGHT_SERVICE,
    GROUP_HIGHLIGHT_SET_METHOD,
    startActiveGroupHighlight,
} from "./active-group-highlight";
import {
    INITIAL_MAXIMIZE_CLEAR_METHOD,
    INITIAL_MAXIMIZE_EPOCH_METHOD,
    INITIAL_MAXIMIZE_INTERFACE,
    INITIAL_MAXIMIZE_OBJECT,
    INITIAL_MAXIMIZE_SERVICE,
    INITIAL_MAXIMIZE_SET_METHOD,
    startInitialMaximize,
} from "./active-border-initial";
import { PLAN_DBUS_SERVICE, PLAN_INTERFACE, PLAN_METHOD, PLAN_OBJECT, PLAN_SERVICE, PLAN_START_FLAGS, PLAN_START_METHOD, PlanAdapter, PlanDirection, PlanDomain, PlanObserved, PlanResizeMode, DirectionalObservation, PlanWindowConstraints, planDirectionalFingerprint, planFingerprint } from "./plan-adapter";
import { PLAN_SOURCE_REV } from "./source-rev";
import { connectSignal, readSignal } from "./signal-capability";
import { KWIN_TRACE_ENABLED } from "./trace";
import { WorkspaceNativeAdapter, workspaceShortcutCatalog } from "./workspace-native";
import {
    WORKSPACE_SEND_DBUS_SERVICE,
    WORKSPACE_SEND_START_FLAGS,
    WORKSPACE_SEND_START_METHOD,
    WorkspaceSendAdapter,
    WorkspaceFollowNativeDiagnostic,
    WorkspaceSendObserved,
    workspaceFingerprint as workspaceSendFingerprint,
} from "./workspace-send-adapter";

// Module-scope grab of the raw KWin script `callDBus` global for the
// zero-argument effect epoch getter. Resolved here (not inside
// startPlanAdapterEntry, where the local wrapped `callDbus` shadows the
// global) so the getter call carries exactly one trailing callback and no
// payload argument. Null when the global is unavailable (tests/native-only).
function rawEffectCallDbus(): ((...args: ReadonlyArray<unknown>) => void) | null {
    try {
        const candidate: unknown = callDBus;
        return typeof candidate === "function" ? (candidate as (...args: ReadonlyArray<unknown>) => void) : null;
    } catch (error) {
        void error;
        return null;
    }
}

export interface PlanEntryOverrides {
    readonly workspace?: unknown;
    readonly oracleCallDbus?: (
        service: string,
        path: string,
        iface: string,
        method: string,
        callback: (reply: unknown) => void,
    ) => void;
    readonly callDbus?: (
        service: string,
        path: string,
        iface: string,
        method: string,
        payload: string,
        callback: (reply: unknown) => void,
    ) => void;
    readonly highlightCallDbus?: (
        service: string,
        path: string,
        iface: string,
        method: string,
        ...args: ReadonlyArray<unknown>
    ) => void;
    readonly initialEpochCallDbus?: (callback: (reply: unknown) => void) => void;
    readonly scheduleOnce?: (delayMs: number, callback: () => void) => () => void;
    readonly log?: (message: string) => void;
    readonly owner?: unknown;
    readonly generation?: unknown;
    readonly registerShortcutFn?: (
        name: string,
        text: string,
        sequence: string,
        callback: () => void,
    ) => boolean;
    readonly readProfileFn?: () => unknown;
    readonly readWorkspaceModeFn?: () => unknown;
    readonly readInnerGapFn?: () => unknown;
    readonly readOuterGapFn?: () => unknown;
    readonly options?: unknown;
}

export interface PlanEntryHandle {
    readonly stop: () => void;
    readonly requestFocus: (direction: unknown) => void;
    readonly requestMove: (direction: unknown) => void;
    readonly requestResize: (direction: unknown, mode: unknown) => void;
    readonly requestFloat: () => void;
    readonly requestSticky: () => void;
    readonly requestMaximize: () => void;
    readonly requestFullscreen: () => void;
    readonly requestWorkspaceSelect: (index: unknown) => void;
    readonly requestWorkspaceMove: (index: unknown) => void;
}

export interface PlanShortcutRow {
    readonly action: string;
    readonly text: string;
    readonly sequence: string;
    readonly op: "focus" | "move" | "resize" | "float" | "sticky" | "maximize" | "fullscreen";
    readonly direction: PlanDirection | null;
    readonly mode: PlanResizeMode | null;
}

const MAX_LIST = 1024;
const MAX_DESKTOPS = 32;
const MAX_ID_LEN = 128;

function readProp(value: object, property: string): unknown {
    try {
        return Reflect.get(value, property);
    } catch (error) {
        void error;
        return undefined;
    }
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LEN) {
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

function decodeList(value: unknown, maxLength: number): ReadonlyArray<unknown> | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.length <= maxLength ? value : null;
    }
    let length: unknown = undefined;
    try {
        length = Reflect.get(value, "length");
    } catch (error) {
        void error;
        return null;
    }
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > maxLength) {
        return null;
    }
    const out: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        let element: unknown = undefined;
        try {
            element = Reflect.get(value, String(index));
        } catch (error) {
            void error;
            return null;
        }
        if (element === undefined) {
            return null;
        }
        out.push(element);
    }
    return out;
}

function resolveLexicalWorkspace(): unknown {
    try {
        const candidate: unknown = workspace;
        if (typeof candidate === "object" && candidate !== null) {
            return candidate;
        }
    } catch (error) {
        void error;
    }
    return null;
}

function resolveLexicalOptions(): unknown {
    try {
        const candidate: unknown = options;
        if (typeof candidate === "object" && candidate !== null) {
            return candidate;
        }
    } catch (error) {
        void error;
    }
    return null;
}

function toQuantizedInt(value: unknown): number | null {
    // KWin 6.7.4 exposes QRectF geometry at fractional scale (e.g. 1.25).
    // Quantize at the observation boundary; the Rust wire contract stays
    // integer. Non-finite inputs still reject fail-closed.
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    const rounded = Math.round(value);
    if (!Number.isSafeInteger(rounded)) {
        return null;
    }
    return rounded;
}

type FrameRectFailure =
    | "frame-rect-missing"
    | "frame-rect-coordinate-invalid"
    | "frame-rect-size-invalid"
    | "frame-rect-coordinate-out-of-range"
    | "frame-rect-size-out-of-range";

type FrameRectRead = { x: number; y: number; w: number; h: number } | FrameRectFailure;

function readFrameRect(ref: object): FrameRectRead {
    const geometry = readProp(ref, "frameGeometry");
    if (typeof geometry !== "object" || geometry === null) {
        return "frame-rect-missing";
    }
    const record = geometry as Record<string, unknown>;
    const x = toQuantizedInt(record["x"]);
    const y = toQuantizedInt(record["y"]);
    if (x === null || y === null) {
        return "frame-rect-coordinate-invalid";
    }
    const widthRaw = record["width"] !== undefined ? record["width"] : record["w"];
    const heightRaw = record["height"] !== undefined ? record["height"] : record["h"];
    const w = toQuantizedInt(widthRaw);
    const h = toQuantizedInt(heightRaw);
    if (w === null || h === null || w <= 0 || h <= 0) {
        return "frame-rect-size-invalid";
    }
    if (x < -16384 || x > 16384 || y < -16384 || y > 16384) {
        return "frame-rect-coordinate-out-of-range";
    }
    if (w > 16384 || h > 16384) {
        return "frame-rect-size-out-of-range";
    }
    return { x, y, w, h };
}

function readConstraintSize(value: unknown): { w: number; h: number } | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const width = toQuantizedInt(record["width"] !== undefined ? record["width"] : record["w"]);
    const height = toQuantizedInt(record["height"] !== undefined ? record["height"] : record["h"]);
    if (width === null || height === null || width < 0 || height < 0) {
        return null;
    }
    return { w: width, h: height };
}

function readWindowConstraints(ref: object): PlanWindowConstraints {
    const resizeable = readProp(ref, "resizeable");
    return {
        resizeable: typeof resizeable === "boolean" ? resizeable : null,
        minSize: readConstraintSize(readProp(ref, "minSize")),
        maxSize: readConstraintSize(readProp(ref, "maxSize")),
    };
}

// Directional shortcut catalog. All three configured profiles share one
// directional core: focus and move on letters plus arrows, resize
// parameterized by direction plus inwards/outwards mode. Resize also has an
// arrow alias for the inwards/shrink family only: the outwards arrow chords
// (Meta+Alt+Left/Down/Up/Right) are the documented project insert-* chords
// (README catalog and custom-tile-acceptance PROJECT_SHORTCUTS_JSON), so they
// are not registered here and stay non-colliding. The profile value is
// validated against the configured catalog names; unknown values fall back
// to the shared core so no unmapped input ever registers.
export function planShortcutCatalog(profile: unknown): ReadonlyArray<PlanShortcutRow> {
    void profile;
    const rows: PlanShortcutRow[] = [];
    const dirs: ReadonlyArray<{ direction: PlanDirection; key: string; arrow: string }> = [
        { direction: "left", key: "H", arrow: "Left" },
        { direction: "down", key: "J", arrow: "Down" },
        { direction: "up", key: "K", arrow: "Up" },
        { direction: "right", key: "L", arrow: "Right" },
    ];
    for (const entry of dirs) {
        rows.push({
            action: `plasma-auto-tiler-focus-${entry.direction}`,
            text: `Focus window ${entry.direction}`,
            sequence: `Meta+${entry.key}`,
            op: "focus",
            direction: entry.direction,
            mode: null,
        });
        rows.push({
            action: `plasma-auto-tiler-focus-${entry.direction}-arrow`,
            text: `Focus window ${entry.direction}`,
            sequence: `Meta+${entry.arrow}`,
            op: "focus",
            direction: entry.direction,
            mode: null,
        });
        rows.push({
            action: `plasma-auto-tiler-move-${entry.direction}`,
            text: `Move window ${entry.direction}`,
            sequence: `Meta+Shift+${entry.key}`,
            op: "move",
            direction: entry.direction,
            mode: null,
        });
        rows.push({
            action: `plasma-auto-tiler-move-${entry.direction}-arrow`,
            text: `Move window ${entry.direction}`,
            sequence: `Meta+Shift+${entry.arrow}`,
            op: "move",
            direction: entry.direction,
            mode: null,
        });
        rows.push({
            action: `plasma-auto-tiler-resize-outwards-${entry.direction}`,
            text: `Grow window towards ${entry.direction}`,
            sequence: `Meta+Alt+${entry.key}`,
            op: "resize",
            direction: entry.direction,
            mode: "outwards",
        });
        rows.push({
            action: `plasma-auto-tiler-resize-inwards-${entry.direction}`,
            text: `Shrink window from ${entry.direction}`,
            sequence: `Meta+Alt+Shift+${entry.key}`,
            op: "resize",
            direction: entry.direction,
            mode: "inwards",
        });
        rows.push({
            action: `plasma-auto-tiler-resize-inwards-${entry.direction}-arrow`,
            text: `Shrink window from ${entry.direction}`,
            sequence: `Meta+Alt+Shift+${entry.arrow}`,
            op: "resize",
            direction: entry.direction,
            mode: "inwards",
        });
    }
    rows.push(
        {
            action: "plasma-auto-tiler-toggle-float",
            text: "Toggle floating window",
            sequence: "Meta+G",
            op: "float",
            direction: null,
            mode: null,
        },
        {
            action: "plasma-auto-tiler-toggle-sticky",
            text: "Toggle sticky floating window",
            sequence: "Meta+Shift+G",
            op: "sticky",
            direction: null,
            mode: null,
        },
        {
            action: "plasma-auto-tiler-toggle-maximize",
            text: "Toggle maximize window",
            sequence: "Meta+M",
            op: "maximize",
            direction: null,
            mode: null,
        },
        {
            action: "plasma-auto-tiler-toggle-fullscreen",
            text: "Toggle fullscreen window",
            sequence: "Meta+F11",
            op: "fullscreen",
            direction: null,
            mode: null,
        },
    );
    return Object.freeze(rows);
}

function readShortcutProfile(readProfileFn: (() => unknown) | undefined): string {
    if (readProfileFn !== undefined) {
        let value: unknown = undefined;
        try {
            value = readProfileFn();
        } catch (error) {
            void error;
            return "cosmic";
        }
        if (value === "cosmic" || value === "hyprland" || value === "bspwm") {
            return value as string;
        }
        return "cosmic";
    }
    try {
        const value: unknown = readConfig("shortcutProfile", "cosmic");
        if (value === "cosmic" || value === "hyprland" || value === "bspwm") {
            return value as string;
        }
    } catch (error) {
        void error;
    }
    return "cosmic";
}

function readWorkspaceModeValue(readModeFn: (() => unknown) | undefined): unknown {
    if (readModeFn !== undefined) {
        try {
            return readModeFn();
        } catch (error) {
            void error;
            return "per-output-local";
        }
    }
    try {
        return readConfig("workspaceMode", "per-output-local");
    } catch (error) {
        void error;
        return "per-output-local";
    }
}

function readWorkAreaFor(
    surface: Record<string, unknown>,
    outputRef: object,
    desktopRef: object,
): { x: number; y: number; w: number; h: number } | null {
    const areaFn = readProp(surface, "clientArea");
    if (typeof areaFn !== "function") {
        return null;
    }
    let area: unknown = undefined;
    try {
        // PlacementArea (0) is the per-output usable area. WorkArea (5) is
        // the whole work area across all screens and must never size a
        // per-output domain.
        area = Reflect.apply(areaFn as (...args: ReadonlyArray<never>) => unknown, surface, [0, outputRef, desktopRef]);
    } catch (error) {
        void error;
        return null;
    }
    if (typeof area !== "object" || area === null) {
        return null;
    }
    const record = area as Record<string, unknown>;
    const bx = toQuantizedInt(record["x"]);
    const by = toQuantizedInt(record["y"]);
    const bwRaw = record["width"] !== undefined ? record["width"] : record["w"];
    const bhRaw = record["height"] !== undefined ? record["height"] : record["h"];
    const bw = toQuantizedInt(bwRaw);
    const bh = toQuantizedInt(bhRaw);
    if (bx === null || by === null || bw === null || bh === null) {
        return null;
    }
    if (bw <= 0 || bh <= 0 || bw > 16384 || bh > 16384 || bx < -16384 || bx > 16384 || by < -16384 || by > 16384) {
        return null;
    }
    return { x: bx, y: by, w: bw, h: bh };
}

// Production send observation for one target backing desktop. Mirrors the
// established send transport observation: focused output source and target,
// per-desktop work areas, and normal tiled windows on the focused output
// whose membership is exactly one of the two observed desktops. Structural
// send policy stays in WorkspaceSendAdapter and Rust.
export function observeSendTarget(
    liveWorkspace: unknown,
    cache: Map<string, string>,
    targetWorkspace: string,
    floatingIds: ReadonlySet<string>,
    pinnedSourceWorkspace?: string,
): WorkspaceSendObserved | null {
    try {
        if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
            return null;
        }
        const surface = liveWorkspace as Record<string, unknown>;
        let active: unknown = undefined;
        try {
            active = Reflect.get(surface, "activeWindow");
        } catch (error) {
            void error;
            return null;
        }
        const activeRef = typeof active === "object" && active !== null ? (active as object) : null;
        const screens = decodeList(readProp(surface, "screens"), MAX_LIST);
        if (screens === null || screens.length === 0) {
            return null;
        }
        let outputRef: object;
        if (activeRef !== null) {
            const activeOutput = readProp(activeRef, "output");
            if (typeof activeOutput !== "object" || activeOutput === null) {
                return null;
            }
            outputRef = activeOutput as object;
        } else {
            const first = screens[0];
            if (typeof first !== "object" || first === null) {
                return null;
            }
            outputRef = first as object;
        }
        const outputNameRaw = readProp(outputRef, "name");
        if (!isOpaqueId(outputNameRaw)) {
            return null;
        }
        const sourceOutput = outputNameRaw as string;
        const desktops = decodeList(readProp(surface, "desktops"), MAX_DESKTOPS);
        if (desktops === null || desktops.length === 0) {
            return null;
        }
        let sourceDesktopRef: object | null = null;
        let sourceWorkspace = "";
        if (pinnedSourceWorkspace !== undefined) {
            if (!isOpaqueId(pinnedSourceWorkspace)) {
                return null;
            }
            for (const item of desktops) {
                if (typeof item !== "object" || item === null) {
                    continue;
                }
                const desktop = item as object;
                if (readProp(desktop, "id") === pinnedSourceWorkspace) {
                    sourceDesktopRef = desktop;
                    sourceWorkspace = pinnedSourceWorkspace;
                    break;
                }
            }
            if (sourceDesktopRef === null) {
                return null;
            }
        } else {
            const currentFn = readProp(surface, "currentDesktopForScreen");
            if (typeof currentFn !== "function") {
                return null;
            }
            let sourceDesktop: unknown = undefined;
            try {
                sourceDesktop = Reflect.apply(currentFn as (...args: ReadonlyArray<never>) => unknown, surface, [outputRef]);
            } catch (error) {
                void error;
                return null;
            }
            if (typeof sourceDesktop !== "object" || sourceDesktop === null) {
                return null;
            }
            sourceDesktopRef = sourceDesktop as object;
            const sourceIdRaw = readProp(sourceDesktopRef, "id");
            if (!isOpaqueId(sourceIdRaw)) {
                return null;
            }
            sourceWorkspace = sourceIdRaw as string;
        }
        let targetDesktopRef: object | null = null;
        let targetExists = false;
        let targetOrdinal = -1;
        for (let index = 0; index < desktops.length; index += 1) {
            const item = desktops[index];
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const desktop = item as object;
            if (readProp(desktop, "id") === targetWorkspace) {
                targetDesktopRef = desktop;
                targetExists = true;
                targetOrdinal = index;
            }
        }
        // Session-local redacted follow-diagnostic ordinals only: target live
        // list position plus the KWin native desktop number, the selected
        // output live position, and the live current desktop for the selected
        // output (order/number plus redacted current-vs-target equality).
        // Best effort with -1 for anything unreadable; never raw ids and never
        // a behavior input. The current read below always runs, even when the
        // source is pinned, but never fails observation.
        let outputOrdinal = -1;
        try {
            for (let index = 0; index < screens.length; index += 1) {
                if (screens[index] === outputRef) {
                    outputOrdinal = index;
                    break;
                }
            }
        } catch (error) {
            void error;
            outputOrdinal = -1;
        }
        let targetNumber = -1;
        try {
            if (targetDesktopRef !== null) {
                const numRaw = readProp(targetDesktopRef, "x11DesktopNumber");
                if (typeof numRaw === "number" && Number.isInteger(numRaw) && numRaw > 0 && numRaw <= 1000000) {
                    targetNumber = numRaw;
                }
            }
        } catch (error) {
            void error;
            targetNumber = -1;
        }
        let currentOrdinal = -1;
        let currentNumber = -1;
        let currentIdEq = -1;
        let currentRefEq = -1;
        try {
            const resolveCurrent = (curRef: object | null): void => {
                if (curRef === null) {
                    return;
                }
                const curIdRaw = readProp(curRef, "id");
                if (!isOpaqueId(curIdRaw)) {
                    try {
                        if (targetDesktopRef !== null) {
                            currentRefEq = curRef === targetDesktopRef ? 1 : 0;
                        }
                    } catch (error) {
                        void error;
                    }
                    return;
                }
                const curId = curIdRaw as string;
                for (let index = 0; index < desktops.length; index += 1) {
                    const item = desktops[index];
                    if (typeof item !== "object" || item === null) {
                        continue;
                    }
                    if (readProp(item as object, "id") === curId) {
                        currentOrdinal = index;
                        break;
                    }
                }
                try {
                    const numRaw = readProp(curRef, "x11DesktopNumber");
                    if (typeof numRaw === "number" && Number.isInteger(numRaw) && numRaw > 0 && numRaw <= 1000000) {
                        currentNumber = numRaw;
                    }
                } catch (error) {
                    void error;
                }
                try {
                    let flightTargetId: string | null = null;
                    if (targetDesktopRef !== null) {
                        const tgtRaw = readProp(targetDesktopRef, "id");
                        if (isOpaqueId(tgtRaw)) {
                            flightTargetId = tgtRaw as string;
                        } else if (isOpaqueId(targetWorkspace)) {
                            flightTargetId = targetWorkspace;
                        }
                    } else if (isOpaqueId(targetWorkspace)) {
                        flightTargetId = targetWorkspace;
                    }
                    if (flightTargetId !== null) {
                        currentIdEq = curId === flightTargetId ? 1 : 0;
                    }
                } catch (error) {
                    void error;
                }
                try {
                    if (targetDesktopRef !== null) {
                        currentRefEq = curRef === targetDesktopRef ? 1 : 0;
                    }
                } catch (error) {
                    void error;
                }
            };
            if (pinnedSourceWorkspace !== undefined) {
                const getter = readProp(surface, "currentDesktopForScreen");
                if (typeof getter === "function") {
                    let curRaw: unknown = undefined;
                    try {
                        curRaw = Reflect.apply(
                            getter as (...args: ReadonlyArray<never>) => unknown,
                            surface,
                            [outputRef],
                        );
                    } catch (error) {
                        void error;
                        curRaw = undefined;
                    }
                    if (typeof curRaw === "object" && curRaw !== null) {
                        resolveCurrent(curRaw as object);
                    }
                }
            } else if (sourceDesktopRef !== null) {
                resolveCurrent(sourceDesktopRef);
            }
        } catch (error) {
            void error;
            currentOrdinal = -1;
            currentNumber = -1;
            currentIdEq = -1;
            currentRefEq = -1;
        }
        if (sourceDesktopRef === null) {
            return null;
        }
        const sourceBounds = readWorkAreaFor(surface, outputRef, sourceDesktopRef);
        if (sourceBounds === null) {
            return null;
        }
        let targetBounds: { x: number; y: number; w: number; h: number } | null = null;
        if (targetDesktopRef !== null) {
            targetBounds = readWorkAreaFor(surface, outputRef, targetDesktopRef);
        }
        if (targetDesktopRef !== null && targetBounds === null) {
            return null;
        }
        if (targetBounds === null) {
            targetBounds = { x: 0, y: 0, w: 1, h: 1 };
        }
        const lister = readProp(surface, "windowList");
        if (typeof lister !== "function") {
            return null;
        }
        let rawList: unknown = undefined;
        try {
            rawList = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
        } catch (error) {
            void error;
            return null;
        }
        const windows = decodeList(rawList, MAX_LIST);
        if (windows === null) {
            return null;
        }
        const sourceWindows: Array<{ id: string; ref: object; rect: { x: number; y: number; w: number; h: number } }> = [];
        const targetWindows: Array<{ id: string; ref: object; rect: { x: number; y: number; w: number; h: number } }> = [];
        const seen = new Set<string>();
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            if (readProp(ref, "normalWindow") !== true) {
                continue;
            }
            const managed = readProp(ref, "managed");
            if (managed !== undefined && managed !== true) {
                continue;
            }
            if (readProp(ref, "minimized") === true) {
                continue;
            }
            if (readProp(ref, "fullScreen") !== false) {
                continue;
            }
            if (readProp(ref, "maximizeMode") !== 0) {
                continue;
            }
            if (readProp(ref, "onAllDesktops") !== false) {
                continue;
            }
            const output = readProp(ref, "output");
            if (typeof output !== "object" || output === null) {
                continue;
            }
            if (readProp(output as object, "name") !== sourceOutput) {
                continue;
            }
            let native: string | null = null;
            try {
                native = normalizeNativeId(readProp(ref, "internalId"));
            } catch (error) {
                void error;
                return null;
            }
            if (native === null) {
                return null;
            }
            const id = internNativeId(cache, native);
            if (floatingIds.has(id)) {
                continue;
            }
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null) {
                return null;
            }
            const memberIds = new Set<string>();
            for (const member of membership) {
                if (typeof member !== "object" || member === null) {
                    return null;
                }
                const memberRaw = readProp(member as object, "id");
                if (!isOpaqueId(memberRaw)) {
                    return null;
                }
                memberIds.add(memberRaw as string);
            }
            const targetWorkspaceId =
                targetDesktopRef !== null
                    ? ((readProp(targetDesktopRef, "id") as string) ?? targetWorkspace)
                    : targetWorkspace;
            const onSource = memberIds.has(sourceWorkspace);
            const onTarget = targetDesktopRef !== null && memberIds.has(targetWorkspaceId);
            if (onSource === onTarget) {
                continue;
            }
            if (seen.has(id)) {
                return null;
            }
            seen.add(id);
            const frame = readFrameRect(ref);
            if (typeof frame === "string") {
                return null;
            }
            if (onSource) {
                sourceWindows.push({ id, ref, rect: { x: frame.x, y: frame.y, w: frame.w, h: frame.h } });
            } else {
                targetWindows.push({ id, ref, rect: { x: frame.x, y: frame.y, w: frame.w, h: frame.h } });
            }
        }
        let focusedId = "";
        let moverRef: object | null = null;
        if (activeRef !== null) {
            let activeNative: string | null = null;
            try {
                activeNative = normalizeNativeId(readProp(activeRef, "internalId"));
            } catch (error) {
                void error;
                return null;
            }
            if (activeNative !== null) {
                const activeId = internNativeId(cache, activeNative);
                for (const entry of sourceWindows) {
                    if (entry.id === activeId) {
                        focusedId = entry.id;
                        moverRef = entry.ref;
                        break;
                    }
                }
            }
        }
        const sourceSorted = sourceWindows.map((entry) => entry.id).sort();
        const targetSorted = targetWindows.map((entry) => entry.id).sort();
        const sourceFingerprint = String(workspaceSendFingerprint(sourceOutput, sourceWorkspace, sourceSorted));
        const resolvedTargetWorkspaceId =
            targetDesktopRef !== null
                ? ((readProp(targetDesktopRef, "id") as string) ?? targetWorkspace)
                : targetWorkspace;
        const targetFingerprint = String(workspaceSendFingerprint(sourceOutput, resolvedTargetWorkspaceId, targetSorted));
        return {
            sourceOutput,
            sourceWorkspace,
            sourceBounds: Object.freeze({ x: sourceBounds.x, y: sourceBounds.y, w: sourceBounds.w, h: sourceBounds.h }),
            targetOutput: sourceOutput,
            targetWorkspace: resolvedTargetWorkspaceId,
            targetBounds:
                targetDesktopRef !== null
                    ? Object.freeze({ x: targetBounds.x, y: targetBounds.y, w: targetBounds.w, h: targetBounds.h })
                    : Object.freeze({ x: 0, y: 0, w: 1, h: 1 }),
            focusedId,
            sourceWindows: Object.freeze(
                sourceWindows.map((entry) =>
                    Object.freeze({
                        id: entry.id,
                        ref: entry.ref,
                        rect: Object.freeze({ x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h }),
                    }),
                ),
            ),
            targetWindows: Object.freeze(
                targetWindows.map((entry) =>
                    Object.freeze({
                        id: entry.id,
                        ref: entry.ref,
                        rect: Object.freeze({ x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h }),
                    }),
                ),
            ),
            activeRef,
            moverRef,
            targetDesktopRef,
            targetExists,
            desktopCount: desktops.length,
            sourceFingerprint,
            targetFingerprint,
            targetOrdinal,
            targetNumber,
            outputOrdinal,
            currentOrdinal,
            currentNumber,
            currentIdEq,
            currentRefEq,
        };
    } catch (error) {
        void error;
        return null;
    }
}

// Background-tiling hidden-domain observation for every non-foreground
// (output, workspace) pair with tiled members. The single active foreground
// is (activeWindow.output, currentDesktopForScreen(activeWindow.output))
// exactly as observeNative defines it, whenever a normal active window with
// a valid output/current desktop exists. Every other pair - including the
// activeScreen domain when it differs - is a background lifecycle domain.
// Read-only public surfaces only (screens, desktops, activeWindow,
// activeScreen, currentDesktopForScreen, clientArea, windowList), mirroring
// the observeSendTarget enumeration patterns and the observeNative
// eligibility rules (normal windows only, same output, desktop membership
// or sticky, normalized native ids, quantized frame extents). activeWindow
// is read solely to determine this boundary and never writes visibility or
// focus: each snapshot's focusedId is a deterministic domain-local
// structural anchor (spatial-first y, x, h, w, then id) and activeRef is
// that anchor's ref solely to satisfy the shared observation shape. When no
// valid active normal foreground exists, the safe default excludes
// (activeScreen, currentDesktopForScreen(activeScreen)) so hidden startup
// with no active window still has a visible domain to exclude. Hidden flights only admit/remove/reconcile geometry
// through the shared PlanAdapter single-flight. A verified-empty domain (no
// mapped members, readable bounds, output not tainted, no duplicate or
// unreadable frame) is reported explicitly as an empty snapshot (focusedId
// "", activeExcluded true, zero windows) so retirement has fresh, complete
// evidence. Exception-only domains with no eligible tiled member (all
// floating/sticky/fullscreen/maximized) are reported with their members so
// the adapter can protect a retained baseline, but the adapter never
// dispatches admission/reconcile/removal solely for them. Anything unreadable
// or tainted is omitted as unknown and must never be treated as empty.
// Omission fails closed per domain, per output, or overall. The bounded-domain cap is
// enforced by the adapter (which can distinguish cap from empty); this
// observer reports every eligible background domain without inventing
// over-limit policy.
export function observeHiddenDomains(
    liveWorkspace: unknown,
    cache: Map<string, string>,
    floatingIds: ReadonlySet<string>,
    gaps: DomainGaps,
    reportEligibility?: (ref: object, reason: string | null) => void,
): ReadonlyArray<PlanObserved> {
    try {
        if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
            return [];
        }
        const surface = liveWorkspace as Record<string, unknown>;
        const screens = decodeList(readProp(surface, "screens"), MAX_LIST);
        const desktops = decodeList(readProp(surface, "desktops"), MAX_DESKTOPS);
        if (screens === null || screens.length === 0 || desktops === null || desktops.length === 0) {
            return [];
        }
        const currentFn = readProp(surface, "currentDesktopForScreen");
        const lister = readProp(surface, "windowList");
        if (typeof currentFn !== "function" || typeof lister !== "function") {
            return [];
        }
        const screenEntries: Array<{ ref: object; name: string }> = [];
        for (const item of screens) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const nameRaw = readProp(item as object, "name");
            if (!isOpaqueId(nameRaw)) {
                continue;
            }
            screenEntries.push({ ref: item as object, name: nameRaw as string });
        }
        const desktopEntries: Array<{ ref: object; id: string }> = [];
        for (const item of desktops) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const idRaw = readProp(item as object, "id");
            if (!isOpaqueId(idRaw)) {
                continue;
            }
            desktopEntries.push({ ref: item as object, id: idRaw as string });
        }
        if (screenEntries.length === 0 || desktopEntries.length === 0) {
            return [];
        }
        // Single active foreground by stable id, exactly the observeNative
        // domain whenever a normal active window with a valid output/current
        // desktop exists: (activeWindow.output,
        // currentDesktopForScreen(activeWindow.output)). activeWindow is read
        // solely to determine this boundary; it never writes visibility or
        // focus. When no valid active normal foreground exists, fall back to
        // (activeScreen, currentDesktopForScreen(activeScreen)) so hidden
        // startup with no active window still excludes a visible domain.
        // Every other pair - including the non-foreground screen's currently
        // displayed desktop - is a background lifecycle domain. An unreadable
        // boundary is unclassifiable: fail closed overall rather than risk
        // tiling the foreground via the background path.
        let foregroundKey: string | null = null;
        const activeWindowRaw = readProp(surface, "activeWindow");
        if (typeof activeWindowRaw === "object" && activeWindowRaw !== null) {
            const activeWindowRef = activeWindowRaw as object;
            if (readProp(activeWindowRef, "normalWindow") === true) {
                const activeWindowOutput = readProp(activeWindowRef, "output");
                if (typeof activeWindowOutput === "object" && activeWindowOutput !== null) {
                    const activeWindowNameRaw = readProp(activeWindowOutput as object, "name");
                    if (isOpaqueId(activeWindowNameRaw)) {
                        let activeWindowDesktop: unknown = undefined;
                        try {
                            activeWindowDesktop = Reflect.apply(
                                currentFn as (...args: ReadonlyArray<never>) => unknown,
                                surface,
                                [activeWindowOutput],
                            );
                        } catch (error) {
                            void error;
                            activeWindowDesktop = undefined;
                        }
                        if (typeof activeWindowDesktop === "object" && activeWindowDesktop !== null) {
                            const activeWindowDesktopIdRaw = readProp(activeWindowDesktop as object, "id");
                            if (isOpaqueId(activeWindowDesktopIdRaw)) {
                                foregroundKey = `${activeWindowNameRaw as string}\u0000${activeWindowDesktopIdRaw as string}`;
                            }
                        }
                    }
                }
            }
        }
        if (foregroundKey === null) {
            const activeScreenRaw = readProp(surface, "activeScreen");
            if (typeof activeScreenRaw !== "object" || activeScreenRaw === null) {
                return [];
            }
            const activeScreenRef = activeScreenRaw as object;
            const activeNameRaw = readProp(activeScreenRef, "name");
            if (!isOpaqueId(activeNameRaw)) {
                return [];
            }
            const activeName = activeNameRaw as string;
            let activeCurrent: unknown = undefined;
            try {
                activeCurrent = Reflect.apply(
                    currentFn as (...args: ReadonlyArray<never>) => unknown,
                    surface,
                    [activeScreenRef],
                );
            } catch (error) {
                void error;
                activeCurrent = undefined;
            }
            if (typeof activeCurrent !== "object" || activeCurrent === null) {
                return [];
            }
            const activeCurrentIdRaw = readProp(activeCurrent as object, "id");
            if (!isOpaqueId(activeCurrentIdRaw)) {
                return [];
            }
            foregroundKey = `${activeName}\u0000${activeCurrentIdRaw as string}`;
        }
        let rawList: unknown = undefined;
        try {
            rawList = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
        } catch (error) {
            void error;
            return [];
        }
        const windows = decodeList(rawList, MAX_LIST);
        if (windows === null) {
            return [];
        }
        interface ParsedWindow {
            readonly ref: object;
            readonly output: string;
            readonly native: string;
            readonly sticky: boolean;
            readonly members: ReadonlyArray<object>;
        }
        const parsed: ParsedWindow[] = [];
        const taintedOutputs = new Set<string>();
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            if (readProp(ref, "normalWindow") !== true) {
                reportEligibility?.(ref, "normal-window");
                continue;
            }
            const output = readProp(ref, "output");
            if (typeof output !== "object" || output === null) {
                reportEligibility?.(ref, "output-missing");
                continue;
            }
            const nameRaw = readProp(output as object, "name");
            if (!isOpaqueId(nameRaw)) {
                reportEligibility?.(ref, "output-missing");
                continue;
            }
            const outputName = nameRaw as string;
            // An undecodable identity or membership cannot be placed: quarantine
            // the output's hidden pairs rather than tiling a partial domain.
            let native: string | null = null;
            try {
                native = normalizeNativeId(readProp(ref, "internalId"));
            } catch (error) {
                void error;
                taintedOutputs.add(outputName);
                reportEligibility?.(ref, "native-id-unreadable");
                continue;
            }
            if (native === null) {
                taintedOutputs.add(outputName);
                reportEligibility?.(ref, "native-id-unreadable");
                continue;
            }
            const sticky = readProp(ref, "onAllDesktops") === true;
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null) {
                taintedOutputs.add(outputName);
                reportEligibility?.(ref, "desktop-membership-unreadable");
                continue;
            }
            const members: object[] = [];
            for (const member of membership) {
                if (typeof member === "object" && member !== null) {
                    members.push(member as object);
                }
            }
            parsed.push({ ref, output: outputName, native, sticky, members });
        }
        const out: PlanObserved[] = [];
        for (const screen of screenEntries) {
            if (taintedOutputs.has(screen.name)) {
                continue;
            }
            for (const desktop of desktopEntries) {
                if (`${screen.name}\u0000${desktop.id}` === foregroundKey) {
                    continue;
                }
                const bounds = readWorkAreaFor(surface, screen.ref, desktop.ref);
                if (bounds === null) {
                    continue;
                }
                const seen = new Set<string>();
                let duplicate = false;
                let incomplete = false;
                const entries: Array<{
                    id: string;
                    ref: object;
                    rect: { x: number; y: number; w: number; h: number };
                    fullscreen: boolean;
                    maximized: boolean;
                    floating: boolean;
                    sticky: boolean;
                    resourceClass: string;
                }> = [];
                for (const candidate of parsed) {
                    if (candidate.output !== screen.name) {
                        continue;
                    }
                    if (!candidate.sticky && candidate.members.indexOf(desktop.ref) < 0) {
                        continue;
                    }
                    const id = internNativeId(cache, candidate.native);
                    if (seen.has(id)) {
                        duplicate = true;
                        break;
                    }
                    seen.add(id);
                    const frame = readFrameRect(candidate.ref);
                    if (typeof frame === "string") {
                        seen.delete(id);
                        incomplete = true;
                        reportEligibility?.(candidate.ref, frame);
                        continue;
                    }
                    entries.push({
                        id,
                        ref: candidate.ref,
                        rect: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
                        fullscreen: readProp(candidate.ref, "fullScreen") !== false,
                        maximized: readProp(candidate.ref, "maximizeMode") !== 0,
                        floating: floatingIds.has(id) || candidate.sticky,
                        sticky: candidate.sticky,
                        resourceClass: readResourceClass(candidate.ref),
                    });
                    reportEligibility?.(candidate.ref, null);
                }
                // Partial observation is unknown, never empty: duplicate ids or
                // any unreadable frame omits the whole domain fail-closed.
                if (duplicate || incomplete) {
                    continue;
                }
                if (entries.length === 0) {
                    // Verified-empty domain: no mapped members, readable
                    // bounds, output not tainted, no duplicate or unreadable
                    // frame. Explicit empty evidence for retirement; the
                    // adapter retires only from this shape, never from
                    // absence. activeRef is the stable desktop ref; the
                    // adapter never routes focus for hidden domains.
                    const emptyFingerprint = String(planFingerprint(screen.name, desktop.id, "", []));
                    const emptyBounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
                    const emptyInnerGap = gaps.innerGap;
                    const emptyOuterGap = gaps.outerGap;
                    const emptyActiveRef: object = desktop.ref;
                    const emptyExpected = emptyFingerprint;
                    out.push({
                        domainOutput: screen.name,
                        domainWorkspace: desktop.id,
                        domainBounds: Object.freeze({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }),
                        domainGap: gaps.innerGap,
                        domainOuterGap: gaps.outerGap,
                        focusedId: "",
                        activeExcluded: true,
                        windows: Object.freeze([]),
                        activeRef: emptyActiveRef,
                        fingerprint: emptyExpected,
                        revalidate: () => {
                            try {
                                const fresh = observeHiddenDomains(liveWorkspace, cache, floatingIds, gaps);
                                for (const candidate of fresh) {
                                    if (
                                        candidate.domainOutput !== screen.name ||
                                        candidate.domainWorkspace !== desktop.id
                                    ) {
                                        continue;
                                    }
                                    return (
                                        candidate.fingerprint === emptyExpected &&
                                        candidate.windows.length === 0 &&
                                        candidate.focusedId === "" &&
                                        candidate.activeExcluded === true &&
                                        candidate.domainBounds.x === emptyBounds.x &&
                                        candidate.domainBounds.y === emptyBounds.y &&
                                        candidate.domainBounds.w === emptyBounds.w &&
                                        candidate.domainBounds.h === emptyBounds.h &&
                                        candidate.domainGap === emptyInnerGap &&
                                        candidate.domainOuterGap === emptyOuterGap
                                    );
                                }
                                return false;
                            } catch (error) {
                                void error;
                                return false;
                            }
                        },
                    });
                    continue;
                }
                // Exception-only domains (all floating/sticky/fullscreen/
                // maximized) are reported with their members so a retained
                // baseline stays protected. The adapter never dispatches
                // admission/reconcile/removal solely for them; foreground
                // exception semantics are untouched and mixed domains keep
                // their Rust handling.
                const sortedIds = entries.map((entry) => entry.id).sort();
                const anchor = [...entries].sort((a, b) =>
                    a.rect.y !== b.rect.y
                        ? a.rect.y - b.rect.y
                        : a.rect.x !== b.rect.x
                          ? a.rect.x - b.rect.x
                          : a.rect.h !== b.rect.h
                            ? a.rect.h - b.rect.h
                            : a.rect.w !== b.rect.w
                              ? a.rect.w - b.rect.w
                              : a.id < b.id
                                ? -1
                                : a.id > b.id
                                  ? 1
                                  : 0,
                )[0] as { id: string; ref: object };
                const anchorRef = anchor.ref;
                const anchorId = anchor.id;
                const fingerprint = String(planFingerprint(screen.name, desktop.id, anchorId, sortedIds));
                const frozenWindows = Object.freeze(
                    entries.map((entry) =>
                        Object.freeze({
                            id: entry.id,
                            ref: entry.ref,
                            rect: Object.freeze({ x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h }),
                            output: screen.name,
                            workspace: desktop.id,
                            fullscreen: entry.fullscreen,
                            maximized: entry.maximized,
                            floating: entry.floating,
                            sticky: entry.sticky,
                            resourceClass: entry.resourceClass,
                        }),
                    ),
                );
                const expected = fingerprint;
                const expectedBounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
                const expectedInnerGap = gaps.innerGap;
                const expectedOuterGap = gaps.outerGap;
                const expectedAnchorId = anchorId;
                const expectedAnchorRef = anchorRef;
                out.push({
                    domainOutput: screen.name,
                    domainWorkspace: desktop.id,
                    domainBounds: Object.freeze({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }),
                    domainGap: gaps.innerGap,
                    domainOuterGap: gaps.outerGap,
                    focusedId: anchorId,
                    activeExcluded: false,
                    windows: frozenWindows,
                    activeRef: anchorRef,
                    fingerprint: expected,
                    revalidate: () => {
                        try {
                            const fresh = observeHiddenDomains(liveWorkspace, cache, floatingIds, gaps);
                            for (const candidate of fresh) {
                                if (
                                    candidate.domainOutput !== screen.name ||
                                    candidate.domainWorkspace !== desktop.id ||
                                    candidate.fingerprint !== expected
                                ) {
                                    continue;
                                }
                                if (
                                    candidate.domainBounds.x !== expectedBounds.x ||
                                    candidate.domainBounds.y !== expectedBounds.y ||
                                    candidate.domainBounds.w !== expectedBounds.w ||
                                    candidate.domainBounds.h !== expectedBounds.h ||
                                    candidate.domainGap !== expectedInnerGap ||
                                    candidate.domainOuterGap !== expectedOuterGap ||
                                    candidate.focusedId !== expectedAnchorId ||
                                    candidate.activeRef !== expectedAnchorRef ||
                                    candidate.activeExcluded !== false
                                ) {
                                    return false;
                                }
                                if (candidate.windows.length !== frozenWindows.length) {
                                    return false;
                                }
                                for (const entry of frozenWindows) {
                                    let matched = false;
                                    for (const other of candidate.windows) {
                                        if (other.id === entry.id) {
                                            matched = true;
                                            if (other.ref !== entry.ref) {
                                                return false;
                                            }
                                            if (
                                                other.rect.x !== entry.rect.x ||
                                                other.rect.y !== entry.rect.y ||
                                                other.rect.w !== entry.rect.w ||
                                                other.rect.h !== entry.rect.h ||
                                                other.fullscreen !== entry.fullscreen ||
                                                other.maximized !== entry.maximized
                                            ) {
                                                return false;
                                            }
                                            break;
                                        }
                                    }
                                    if (!matched) {
                                        return false;
                                    }
                                }
                                return true;
                            }
                            return false;
                        } catch (error) {
                            void error;
                            return false;
                        }
                    },
                });
            }
        }
        // The bounded-domain cap is enforced fail-closed by the adapter (which
        // distinguishes cap from empty for baseline cleanup). Report every
        // eligible background domain without inventing over-limit policy.
        return Object.freeze(out);
    } catch (error) {
        void error;
        return [];
    }
}

function internNativeId(cache: Map<string, string>, native: string): string {
    const known = cache.get(native);
    if (known !== undefined) {
        return known;
    }
    cache.set(native, native);
    return native;
}

function readNativeId(ref: object): string | null {
    let raw: unknown = undefined;
    try {
        raw = Reflect.get(ref, "internalId");
    } catch (error) {
        void error;
        return null;
    }
    return normalizeNativeId(raw);
}

function readResourceClass(ref: object): string {
    const value = readProp(ref, "resourceClass");
    return isOpaqueId(value) ? value : "unknown";
}

type EligibilityReporter = (ref: object, reason: string | null) => void;

function observeNative(
    liveWorkspace: unknown,
    cache: Map<string, string>,
    floatingIds: ReadonlySet<string>,
    gaps: DomainGaps,
    reportEligibility?: EligibilityReporter,
): PlanObserved | null {
    try {
        if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
            return null;
        }
        const surface = liveWorkspace as Record<string, unknown>;
        let active: unknown = undefined;
        try {
            active = Reflect.get(surface, "activeWindow");
        } catch (error) {
            void error;
            return null;
        }
        if (typeof active !== "object" || active === null) {
            return null;
        }
        const activeRef = active as object;
        if (readProp(activeRef, "normalWindow") !== true) {
            reportEligibility?.(activeRef, "active-normal-window");
            return null;
        }
        const activeOutput = readProp(activeRef, "output");
        if (typeof activeOutput !== "object" || activeOutput === null) {
            return null;
        }
        const lister = readProp(surface, "windowList");
        if (typeof lister !== "function") {
            return null;
        }
        let rawList: unknown = undefined;
        try {
            rawList = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
        } catch (error) {
            void error;
            return null;
        }
        const windows = decodeList(rawList, MAX_LIST);
        if (windows === null) {
            return null;
        }
        const outputNameRaw = readProp(activeOutput as object, "name");
        if (!isOpaqueId(outputNameRaw)) {
            return null;
        }
        const domainOutput = outputNameRaw as string;
        const currentFn = readProp(surface, "currentDesktopForScreen");
        const areaFn = readProp(surface, "clientArea");
        if (typeof currentFn !== "function" || typeof areaFn !== "function") {
            return null;
        }
        let desktop: unknown = undefined;
        try {
            desktop = Reflect.apply(
                currentFn as (...args: ReadonlyArray<never>) => unknown,
                surface,
                [activeOutput],
            );
        } catch (error) {
            void error;
            return null;
        }
        if (typeof desktop !== "object" || desktop === null) {
            return null;
        }
        const desktopRef = desktop as object;
        const desktopIdRaw = readProp(desktopRef, "id");
        if (!isOpaqueId(desktopIdRaw)) {
            return null;
        }
        const domainWorkspace = desktopIdRaw as string;
        let area: unknown = undefined;
        try {
            // PlacementArea (0): per-output usable area. WorkArea (5) is
            // global across screens and must never size this domain.
            area = Reflect.apply(areaFn as (...args: ReadonlyArray<never>) => unknown, surface, [
                0,
                activeOutput,
                desktopRef,
            ]);
        } catch (error) {
            void error;
            return null;
        }
        if (typeof area !== "object" || area === null) {
            return null;
        }
        const areaRecord = area as Record<string, unknown>;
        const bx = toQuantizedInt(areaRecord["x"]);
        const by = toQuantizedInt(areaRecord["y"]);
        const bwRaw = areaRecord["width"] !== undefined ? areaRecord["width"] : areaRecord["w"];
        const bhRaw = areaRecord["height"] !== undefined ? areaRecord["height"] : areaRecord["h"];
        const bw = toQuantizedInt(bwRaw);
        const bh = toQuantizedInt(bhRaw);
        if (bx === null || by === null || bw === null || bh === null) {
            return null;
        }
        if (bw <= 0 || bh <= 0 || bw > 16384 || bh > 16384 || bx < -16384 || bx > 16384 || by < -16384 || by > 16384) {
            return null;
        }
        const domainBounds = { x: bx, y: by, w: bw, h: bh };
        const seen = new Set<string>();
        const entries: Array<{
            id: string;
            ref: object;
            rect: { x: number; y: number; w: number; h: number };
            output: string;
            workspace: string;
            fullscreen: boolean;
            maximized: boolean;
            floating: boolean;
            sticky: boolean;
            resourceClass: string;
        }> = [];
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            // Only normal windows are observed. Every other classification
            // is skipped before the snapshot; Rust owns all remaining policy.
            if (readProp(ref, "normalWindow") !== true) {
                reportEligibility?.(ref, "normal-window");
                continue;
            }
            const output = readProp(ref, "output");
            if (typeof output !== "object" || output === null) {
                reportEligibility?.(ref, "output-missing");
                continue;
            }
            const nameRaw = readProp(output as object, "name");
            if (nameRaw !== domainOutput) {
                reportEligibility?.(ref, "output-mismatch");
                continue;
            }
            const allDesktops = readProp(ref, "onAllDesktops") === true;
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null) {
                return null;
            }
            let onDesktop = false;
            for (const member of membership) {
                if (member === desktopRef) {
                    onDesktop = true;
                    break;
                }
            }
            if (!onDesktop && !allDesktops) {
                reportEligibility?.(ref, "desktop-mismatch");
                continue;
            }
            // Read and normalize the native id while the object is live;
            // stable plan ids come from the string cache. Never read an id
            // from a removal signal payload.
            const native = readNativeId(ref);
            if (native === null) {
                return null;
            }
            const id = internNativeId(cache, native);
            if (seen.has(id)) {
                return null;
            }
            seen.add(id);
            const frame = readFrameRect(ref);
            if (typeof frame === "string") {
                reportEligibility?.(ref, frame);
                continue;
            }
            const rect = frame;
            // Fullscreen is a compositor-owned overlay state orthogonal to the
            // tree: the window stays observed (identity/position/share
            // retained) but must never be actuated or reflowed. Exact
            // `!== false` check mirrors the standalone adapters; revalidation
            // re-reads the property through this same observe path.
            // Maximize mirrors fullscreen: a nonzero `maximizeMode` (1 vertical,
            // 2 horizontal, 3 full) collapses to one boolean, so horizontal and
            // vertical maximize are deliberately not modeled in the engine. The
            // exact `!== 0` check mirrors the standalone adapters; revalidation
            // re-reads the property through this same observe path.
            entries.push({
                id,
                ref,
                rect,
                output: domainOutput,
                workspace: domainWorkspace,
                fullscreen: readProp(ref, "fullScreen") !== false,
                maximized: readProp(ref, "maximizeMode") !== 0,
                floating: floatingIds.has(id) || allDesktops,
                sticky: allDesktops,
                resourceClass: readResourceClass(ref),
            });
            reportEligibility?.(ref, null);
        }
        if (entries.length === 0) {
            return null;
        }
        const activeNative = readNativeId(activeRef);
        if (activeNative === null) {
            return null;
        }
        const activeNativeId = internNativeId(cache, activeNative);
        const activeExcluded = floatingIds.has(activeNativeId) || readProp(activeRef, "onAllDesktops") === true;
        let activeId: string | null = null;
        for (const entry of entries) {
            if (entry.id === activeNativeId) {
                activeId = entry.id;
                break;
            }
        }
        if (activeId === null) {
            return null;
        }
        const sortedIds = entries.map((entry) => entry.id).sort();
        const fingerprint = String(planFingerprint(domainOutput, domainWorkspace, activeId, sortedIds));
        const frozenWindows = Object.freeze(
            entries.map((entry) =>
                Object.freeze({
                    id: entry.id,
                    ref: entry.ref,
                    rect: Object.freeze({ x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h }),
                    output: entry.output,
                    workspace: entry.workspace,
                    fullscreen: entry.fullscreen,
                    maximized: entry.maximized,
                    floating: entry.floating,
                    sticky: entry.sticky,
                    resourceClass: entry.resourceClass,
                }),
            ),
        );
        const expected = fingerprint;
        const capturedActive = activeRef;
        return {
            domainOutput,
            domainWorkspace,
            domainBounds: Object.freeze({ x: domainBounds.x, y: domainBounds.y, w: domainBounds.w, h: domainBounds.h }),
            domainGap: gaps.innerGap,
            domainOuterGap: gaps.outerGap,
            focusedId: activeId,
            activeExcluded,
            windows: frozenWindows,
            activeRef: activeRef,
            fingerprint: expected,
            revalidate: () => {
                try {
                    const fresh = observeNative(liveWorkspace, cache, floatingIds, gaps, reportEligibility);
                    if (
                        fresh === null ||
                        fresh.fingerprint !== expected ||
                        fresh.activeRef !== capturedActive ||
                        fresh.activeExcluded !== activeExcluded
                    ) {
                        return false;
                    }
                    for (const entry of frozenWindows) {
                        let matchFound = false;
                        for (const candidate of fresh.windows) {
                            if (candidate.id === entry.id) {
                                matchFound = true;
                                if (candidate.ref !== entry.ref) {
                                    return false;
                                }
                                if (candidate.fullscreen !== entry.fullscreen) {
                                    return false;
                                }
                                if (candidate.maximized !== entry.maximized) {
                                    return false;
                                }
                                if (
                                    candidate.rect.x !== entry.rect.x ||
                                    candidate.rect.y !== entry.rect.y ||
                                    candidate.rect.w !== entry.rect.w ||
                                    candidate.rect.h !== entry.rect.h
                                ) {
                                    return false;
                                }
                                break;
                            }
                        }
                        if (!matchFound) {
                            return false;
                        }
                    }
                    return true;
                } catch (error) {
                    void error;
                    return false;
                }
            },
        };
    } catch (error) {
        void error;
        return null;
    }
}

// Production directional observation for Left/Right focus/move (active
// DescribePlan route only): source plus the horizontally reciprocal adjacent
// output's current logical workspace (which may differ in workspace id),
// bounded max two domains. Reuses only documented/project-used public
// properties: `screens`, `currentDesktopForScreen`, `clientArea`,
// `windowList`, `window.output.name`, `window.desktops`, `activeWindow`.
// Exact edge-touch with positive overlap derives reciprocal Left/Right
// adjacency; distinct workspace ids are allowed. The typed outcome keeps
// local behavior for a confirmed no-adjacent condition only (`no-target`);
// ambiguous, partial, or unreadable evidence is `invalid` and must refuse
// before any local mutation. Up/Down never cross.
export function observeDirectionalDomain(
    liveWorkspace: unknown,
    cache: Map<string, string>,
    floatingIds: ReadonlySet<string>,
    gaps: DomainGaps,
    direction: string,
    reportEligibility?: EligibilityReporter,
): DirectionalObservation {
    const invalid: DirectionalObservation = { status: "invalid", observed: null };
    const noTarget: DirectionalObservation = { status: "no-target", observed: null };
    try {
        if (direction !== "left" && direction !== "right") {
            return invalid;
        }
        const source = observeNative(liveWorkspace, cache, floatingIds, gaps, reportEligibility);
        if (source === null || source.windows.length === 0) {
            // No readable source: delegate to the single-domain path, which
            // reports the observation failure accurately.
            return noTarget;
        }
        if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
            return invalid;
        }
        const surface = liveWorkspace as Record<string, unknown>;
        const screens = decodeList(readProp(surface, "screens"), MAX_LIST);
        if (screens === null || screens.length === 0 || screens.length > MAX_LIST) {
            return invalid;
        }
        const currentFn = readProp(surface, "currentDesktopForScreen");
        const areaFn = readProp(surface, "clientArea");
        if (typeof currentFn !== "function" || typeof areaFn !== "function") {
            return invalid;
        }
        interface ScreenBounds {
            readonly ref: object;
            readonly name: string;
            readonly desktopRef: object;
            readonly workspace: string;
            readonly bounds: { x: number; y: number; w: number; h: number };
        }
        const entries: ScreenBounds[] = [];
        for (const item of screens) {
            if (typeof item !== "object" || item === null) {
                return invalid;
            }
            const ref = item as object;
            const nameRaw = readProp(ref, "name");
            if (!isOpaqueId(nameRaw)) {
                return invalid;
            }
            let desktop: unknown = undefined;
            try {
                desktop = Reflect.apply(
                    currentFn as (...args: ReadonlyArray<never>) => unknown,
                    surface,
                    [ref],
                );
            } catch (error) {
                void error;
                return invalid;
            }
            if (typeof desktop !== "object" || desktop === null) {
                return invalid;
            }
            const desktopRef = desktop as object;
            const desktopIdRaw = readProp(desktopRef, "id");
            if (!isOpaqueId(desktopIdRaw)) {
                return invalid;
            }
            const bounds = readWorkAreaFor(surface, ref, desktopRef);
            if (bounds === null) {
                return invalid;
            }
            entries.push({
                ref,
                name: nameRaw as string,
                desktopRef,
                workspace: desktopIdRaw as string,
                bounds,
            });
        }
        const sourceEntry = entries.find((entry) => entry.name === source.domainOutput);
        if (sourceEntry === undefined) {
            return invalid;
        }
        // The source work area must match the source observation bounds;
        // otherwise the screen set changed under us: fail closed.
        if (
            sourceEntry.bounds.x !== source.domainBounds.x ||
            sourceEntry.bounds.y !== source.domainBounds.y ||
            sourceEntry.bounds.w !== source.domainBounds.w ||
            sourceEntry.bounds.h !== source.domainBounds.h ||
            sourceEntry.workspace !== source.domainWorkspace
        ) {
            return invalid;
        }
        // Exact edge-touch with positive vertical overlap in the commanded
        // direction. Ambiguous (multiple) or missing candidates fail closed.
        const overlap = (
            a: { y: number; h: number },
            b: { y: number; h: number },
        ): number => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const candidates = entries.filter((entry) => {
            if (entry.name === sourceEntry.name) {
                return false;
            }
            if (direction === "left") {
                return (
                    entry.bounds.x + entry.bounds.w === sourceEntry.bounds.x &&
                    overlap(entry.bounds, sourceEntry.bounds) > 0
                );
            }
            return (
                sourceEntry.bounds.x + sourceEntry.bounds.w === entry.bounds.x &&
                overlap(entry.bounds, sourceEntry.bounds) > 0
            );
        });
        // Zero candidates is a confirmed no-adjacent condition: the caller
        // keeps local single-domain behavior. Multiple candidates are
        // ambiguous and refuse.
        if (candidates.length === 0) {
            return noTarget;
        }
        if (candidates.length !== 1) {
            return invalid;
        }
        const targetEntry = candidates[0] as ScreenBounds;
        // Reciprocity check: the target's opposite edge must touch the
        // source with positive overlap (symmetric by construction, but an
        // unreadable intermediate screen set must not invent adjacency).
        if (direction === "left") {
            if (
                targetEntry.bounds.x + targetEntry.bounds.w !== sourceEntry.bounds.x ||
                overlap(targetEntry.bounds, sourceEntry.bounds) <= 0
            ) {
                return invalid;
            }
        } else if (
            sourceEntry.bounds.x + sourceEntry.bounds.w !== targetEntry.bounds.x ||
            overlap(targetEntry.bounds, sourceEntry.bounds) <= 0
        ) {
            return invalid;
        }
        // Collect the target domain's eligible windows with the exact
        // observeNative eligibility (normal windows only, same output,
        // desktop membership or sticky, normalized ids, quantized frames).
        const lister = readProp(surface, "windowList");
        if (typeof lister !== "function") {
            return invalid;
        }
        let rawList: unknown = undefined;
        try {
            rawList = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
        } catch (error) {
            void error;
            return invalid;
        }
        const windows = decodeList(rawList, MAX_LIST);
        if (windows === null) {
            return invalid;
        }
        const seen = new Set<string>();
        for (const entry of source.windows) {
            seen.add(entry.id);
        }
        interface TargetWindow {
            readonly id: string;
            readonly ref: object;
            readonly rect: { x: number; y: number; w: number; h: number };
            readonly fullscreen: boolean;
            readonly maximized: boolean;
            readonly floating: boolean;
            readonly sticky: boolean;
            readonly resourceClass: string;
        }
        const targetWindows: TargetWindow[] = [];
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            if (readProp(ref, "normalWindow") !== true) {
                continue;
            }
            const output = readProp(ref, "output");
            if (typeof output !== "object" || output === null) {
                continue;
            }
            if (readProp(output as object, "name") !== targetEntry.name) {
                continue;
            }
            const allDesktops = readProp(ref, "onAllDesktops") === true;
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null) {
                return invalid;
            }
            let onDesktop = false;
            for (const member of membership) {
                if (member === targetEntry.desktopRef) {
                    onDesktop = true;
                    break;
                }
            }
            if (!onDesktop && !allDesktops) {
                continue;
            }
            const native = readNativeId(ref);
            if (native === null) {
                return invalid;
            }
            const id = internNativeId(cache, native);
            if (seen.has(id)) {
                return invalid;
            }
            seen.add(id);
            const frame = readFrameRect(ref);
            if (typeof frame === "string") {
                // An unreadable target frame is invalid evidence, never a
                // silently dropped window: downstream Rust would otherwise
                // plan against a partial target.
                return invalid;
            }
            targetWindows.push({
                id,
                ref,
                rect: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
                fullscreen: readProp(ref, "fullScreen") !== false,
                maximized: readProp(ref, "maximizeMode") !== 0,
                floating: floatingIds.has(id) || allDesktops,
                sticky: allDesktops,
                resourceClass: readResourceClass(ref),
            });
        }
        const sourceAdjacent: Record<string, string> =
            direction === "left" ? { left: targetEntry.name } : { right: targetEntry.name };
        const targetAdjacent: Record<string, string> =
            direction === "left" ? { right: sourceEntry.name } : { left: sourceEntry.name };
        const domains: ReadonlyArray<PlanDomain> = Object.freeze([
            Object.freeze({
                output: source.domainOutput,
                workspace: source.domainWorkspace,
                bounds: { x: source.domainBounds.x, y: source.domainBounds.y, w: source.domainBounds.w, h: source.domainBounds.h },
                gap: source.domainGap,
                outerGap: source.domainOuterGap,
                adjacent: Object.freeze(sourceAdjacent),
            }),
            Object.freeze({
                output: targetEntry.name,
                workspace: targetEntry.workspace,
                bounds: { x: targetEntry.bounds.x, y: targetEntry.bounds.y, w: targetEntry.bounds.w, h: targetEntry.bounds.h },
                gap: gaps.innerGap,
                outerGap: gaps.outerGap,
                adjacent: Object.freeze(targetAdjacent),
            }),
        ]);
        const combinedWindows = Object.freeze([
            ...source.windows,
            ...targetWindows.map((entry) =>
                Object.freeze({
                    id: entry.id,
                    ref: entry.ref,
                    rect: Object.freeze({ x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h }),
                    output: targetEntry.name,
                    workspace: targetEntry.workspace,
                    fullscreen: entry.fullscreen,
                    maximized: entry.maximized,
                    floating: entry.floating,
                    sticky: entry.sticky,
                    resourceClass: entry.resourceClass,
                }),
            ),
        ]);
        // Full-evidence fingerprint: the exact wire fields Rust re-derives
        // (ordered domain primitives, focused id, every window with rect and
        // exception flags), so an altered target rect/bounds/adjacency fails
        // request validation upstream.
        const fitExcluded = (floating: boolean, sticky: boolean, fullscreen: boolean, maximized: boolean): boolean =>
            floating || sticky || fullscreen || maximized;
        const fingerprintWindows = [
            ...source.windows.map((entry) => ({
                window: entry.id,
                output: entry.output,
                workspace: entry.workspace,
                rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
                floating: entry.floating === true,
                fitExcluded: fitExcluded(
                    entry.floating === true,
                    entry.sticky === true,
                    entry.fullscreen,
                    entry.maximized,
                ),
            })),
            ...targetWindows.map((entry) => ({
                window: entry.id,
                output: targetEntry.name,
                workspace: targetEntry.workspace,
                rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
                floating: entry.floating,
                fitExcluded: fitExcluded(entry.floating, entry.sticky, entry.fullscreen, entry.maximized),
            })),
        ];
        const fingerprint = String(
            planDirectionalFingerprint(domains, source.focusedId, fingerprintWindows),
        );
        const expectedFingerprint = fingerprint;
        const capturedActive = source.activeRef;
        const capturedSource = source;
        const observed: PlanObserved = {
            domainOutput: source.domainOutput,
            domainWorkspace: source.domainWorkspace,
            domainBounds: source.domainBounds,
            domainGap: source.domainGap,
            domainOuterGap: source.domainOuterGap,
            focusedId: source.focusedId,
            ...(source.activeExcluded === undefined ? {} : { activeExcluded: source.activeExcluded }),
            domains,
            windows: combinedWindows,
            activeRef: source.activeRef,
            fingerprint: expectedFingerprint,
            revalidate: () => {
                try {
                    const fresh = observeDirectionalDomain(
                        liveWorkspace,
                        cache,
                        floatingIds,
                        gaps,
                        direction,
                        reportEligibility,
                    );
                    if (fresh.status !== "ready" || fresh.observed === null) {
                        return false;
                    }
                    if (fresh.observed.fingerprint !== expectedFingerprint) {
                        return false;
                    }
                    if (fresh.observed.activeRef !== capturedActive) {
                        return false;
                    }
                    if (fresh.observed.windows.length !== combinedWindows.length) {
                        return false;
                    }
                    for (const entry of combinedWindows) {
                        let matched = false;
                        for (const candidate of fresh.observed.windows) {
                            if (candidate.id === entry.id) {
                                matched = true;
                                if (candidate.ref !== entry.ref) {
                                    return false;
                                }
                                if (
                                    candidate.rect.x !== entry.rect.x ||
                                    candidate.rect.y !== entry.rect.y ||
                                    candidate.rect.w !== entry.rect.w ||
                                    candidate.rect.h !== entry.rect.h ||
                                    candidate.output !== entry.output ||
                                    candidate.workspace !== entry.workspace
                                ) {
                                    return false;
                                }
                                break;
                            }
                        }
                        if (!matched) {
                            return false;
                        }
                    }
                    void capturedSource;
                    return true;
                } catch (error) {
                    void error;
                    return false;
                }
            },
        };
        return { status: "ready", observed };
    } catch (error) {
        void error;
        return invalid;
    }
}

// Explicit production activation; called once by src/entry.ts and directly
// by focused tests with overrides. Returns a stop handle on success, null
// fail-closed (silently: only the adapter's two bounded line shapes may be
// logged anywhere on this path).
export function startPlanAdapterEntry(overrides: PlanEntryOverrides = {}): PlanEntryHandle | null {
    const liveWorkspace: unknown =
        overrides.workspace !== undefined ? overrides.workspace : resolveLexicalWorkspace();
    const log = overrides.log ?? ((message: string): void => {
        try {
            console.log(message);
        } catch (error) {
            void error;
        }
    });
    if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
        return null;
    }
    let callDbus = overrides.callDbus;
    if (callDbus === undefined) {
        try {
            const native: unknown = callDBus;
            if (typeof native !== "function") {
                return null;
            }
            const bound = native as (...args: ReadonlyArray<unknown>) => void;
            callDbus = (service, path, iface, method, payload, callback) => {
                if (service === WORKSPACE_SEND_DBUS_SERVICE && method === WORKSPACE_SEND_START_METHOD) {
                    bound(service, path, iface, method, payload, WORKSPACE_SEND_START_FLAGS, callback);
                    return;
                }
                if (service === PLAN_DBUS_SERVICE && method === PLAN_START_METHOD) {
                    bound(service, path, iface, method, payload, PLAN_START_FLAGS, callback);
                    return;
                }
                bound(service, path, iface, method, payload, callback);
            };
        } catch (error) {
            void error;
            return null;
        }
    }
    let scheduleOnce = overrides.scheduleOnce;
    if (scheduleOnce === undefined) {
        try {
            const ctor: unknown = QTimer;
            if (typeof ctor !== "function") {
                return null;
            }
            scheduleOnce = (delayMs, callback) => {
                const timer = new (ctor as new () => QTimer)();
                timer.interval = delayMs;
                timer.singleShot = true;
                timer.timeout.connect(callback);
                timer.start();
                return () => {
                    try {
                        timer.stop();
                    } catch (error) {
                        void error;
                    }
                };
            };
        } catch (error) {
            void error;
            return null;
        }
    }
    const surface = liveWorkspace as Record<string, unknown>;
    const sub = (name: string, handler: () => void): (() => void) | null => {
        try {
            return connectSignal(readSignal(surface, name), handler);
        } catch (error) {
            void error;
            return null;
        }
    };
    const subWindowGeometry = (handler: () => void): (() => void) | null => {
        try {
            const lister = surface["windowList"];
            if (typeof lister !== "function") {
                return null;
            }
            let raw: unknown = undefined;
            try {
                raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
            } catch (error) {
                void error;
                return null;
            }
            const list = decodeList(raw, MAX_LIST);
            if (list === null) {
                return null;
            }
            const detaches: Array<() => void> = [];
            const seen = new Set<object>();
            const connectOne = (item: object): void => {
                if (seen.has(item)) {
                    return;
                }
                const detach = connectSignal(readSignal(item, "frameGeometryChanged"), handler);
                if (detach === null) {
                    return;
                }
                seen.add(item);
                detaches.push(detach);
            };
            for (const item of list) {
                if (typeof item === "object" && item !== null) {
                    connectOne(item as object);
                }
            }
            const addedDetach = connectSignal(readSignal(surface, "windowAdded"), (added) => {
                if (typeof added === "object" && added !== null) {
                    connectOne(added as object);
                }
                handler();
            });
            if (addedDetach !== null) {
                detaches.push(addedDetach);
            }
            if (detaches.length === 0) {
                return null;
            }
            return (): void => {
                for (const detach of detaches) {
                    try {
                        detach();
                    } catch (error) {
                        void error;
                    }
                }
            };
        } catch (error) {
            void error;
            return null;
        }
    };
    // Best-effort per-window fullscreen-state subscription.
    // `fullScreenChanged` is a documented per-window signal but is never
    // assumed present: attach where the feature-detecting seam exposes a
    // connectable signal, and keep per-window connections in sync with the
    // live window set. `windowAdded` subscribes the new window (idempotent per
    // object identity), `windowRemoved` detaches the removed window's signal
    // so old subscriptions never accumulate, and the returned detach releases
    // everything. enable() never fails when the source lacks the signal.
    const subWindowFullscreen = (handler: () => void): (() => void) | null => {
        try {
            const lister = surface["windowList"];
            if (typeof lister !== "function") {
                return null;
            }
            const seen = new Set<object>();
            const windowDetaches = new Map<object, () => void>();
            const topDetaches: Array<() => void> = [];
            const connectOne = (ref: object): void => {
                if (seen.has(ref)) {
                    return;
                }
                const detach = connectSignal(readSignal(ref, "fullScreenChanged"), handler);
                if (detach === null) {
                    return;
                }
                seen.add(ref);
                windowDetaches.set(ref, detach);
            };
            const connectAll = (): void => {
                let raw: unknown = undefined;
                try {
                    raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
                } catch (error) {
                    void error;
                    return;
                }
                const list = decodeList(raw, MAX_LIST);
                if (list === null) {
                    return;
                }
                for (const item of list) {
                    if (typeof item === "object" && item !== null) {
                        connectOne(item as object);
                    }
                }
            };
            const dropOne = (ref: object): void => {
                const detach = windowDetaches.get(ref);
                if (detach === undefined) {
                    return;
                }
                windowDetaches.delete(ref);
                seen.delete(ref);
                try {
                    detach();
                } catch (error) {
                    void error;
                }
            };
            connectAll();
            const addedDetach = connectSignal(readSignal(surface, "windowAdded"), (added) => {
                if (typeof added === "object" && added !== null) {
                    connectOne(added as object);
                } else {
                    connectAll();
                }
                handler();
            });
            if (addedDetach !== null) {
                topDetaches.push(addedDetach);
            }
            const removedDetach = connectSignal(readSignal(surface, "windowRemoved"), (removed) => {
                if (typeof removed === "object" && removed !== null) {
                    dropOne(removed as object);
                }
            });
            if (removedDetach !== null) {
                topDetaches.push(removedDetach);
            }
            return (): void => {
                for (const detach of windowDetaches.values()) {
                    try {
                        detach();
                    } catch (error) {
                        void error;
                    }
                }
                windowDetaches.clear();
                seen.clear();
                for (const detach of topDetaches) {
                    try {
                        detach();
                    } catch (error) {
                        void error;
                    }
                }
            };
        } catch (error) {
            void error;
            return null;
        }
    };
    // Initial handoff stop slot, set once the narrow active-window publisher
    // starts. A later-added eligible window lacking maximizedChanged disables
    // the Plan adapter; the initial gate must clear there too so a stale
    // normal confirmation cannot authorize.
    let initialStopSlot: (() => void) | null = null;
    // Native state writes require their exact notify signal. Unlike fullscreen,
    // a missing signal cannot leave a state-write fence blind.
    const subWindowRequiredSignal = (
        signalName: string,
        failureToken: string,
        handler: (target?: object) => void,
        hard: boolean,
    ): (() => void) | null => {
        try {
            const lister = surface["windowList"];
            if (typeof lister !== "function") {
                return null;
            }
            const seen = new Set<object>();
            const windowDetaches = new Map<object, () => void>();
            const topDetaches: Array<() => void> = [];
            // Returns false only when an eligible normal window (the same
            // `normalWindow === true` classification observeNative uses) lacks
            // this state signal; non-normal windows are never observed.
            const connectOne = (ref: object): boolean => {
                if (seen.has(ref)) {
                    return true;
                }
                const detach = connectSignal(readSignal(ref, signalName), () => handler(ref));
                if (detach === null) {
                    return !hard || readProp(ref, "normalWindow") !== true;
                }
                seen.add(ref);
                windowDetaches.set(ref, detach);
                return true;
            };
            const connectAll = (): { list: ReadonlyArray<unknown> | null; ok: boolean } => {
                let raw: unknown = undefined;
                try {
                    raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
                } catch (error) {
                    void error;
                    return { list: null, ok: true };
                }
                const list = decodeList(raw, MAX_LIST);
                if (list === null) {
                    return { list: null, ok: true };
                }
                let ok = true;
                for (const item of list) {
                    if (typeof item === "object" && item !== null) {
                        if (!connectOne(item as object)) {
                            ok = false;
                        }
                    }
                }
                return { list, ok };
            };
            const dropOne = (ref: object): void => {
                const detach = windowDetaches.get(ref);
                if (detach === undefined) {
                    return;
                }
                windowDetaches.delete(ref);
                seen.delete(ref);
                try {
                    detach();
                } catch (error) {
                    void error;
                }
            };
            const detachAll = (): void => {
                for (const detach of windowDetaches.values()) {
                    try {
                        detach();
                    } catch (error) {
                        void error;
                    }
                }
                windowDetaches.clear();
                seen.clear();
                for (const detach of topDetaches) {
                    try {
                        detach();
                    } catch (error) {
                        void error;
                    }
                }
                topDetaches.length = 0;
            };
            const initial = connectAll();
            if (initial.list !== null && !initial.ok) {
                // Startup refusal: an eligible observed normal window cannot
                // expose a connectable `maximizedChanged`. Release every
                // per-window subscription made before the failure so the failed
                // enable leaves nothing attached, then fail closed.
                detachAll();
                return null;
            }
            const addedDetach = connectSignal(readSignal(surface, "windowAdded"), (added) => {
                const ok =
                    typeof added === "object" && added !== null ? connectOne(added as object) : connectAll().ok;
                if (!ok) {
                    // A window added after enable is an eligible normal window
                    // lacking the signal: fail closed with the exact token
                    // instead of leaving an enabled/blind adapter. Every
                    // maximize subscription is released and the adapter is
                    // disabled.
                    try {
                        log(failureToken);
                    } catch (error) {
                        void error;
                    }
                    detachAll();
                    try {
                        adapter.disable();
                    } catch (error) {
                        void error;
                    }
                    try {
                        initialStopSlot?.();
                    } catch (error) {
                        void error;
                    }
                    initialStopSlot = null;
                    return;
                }
                handler();
            });
            if (addedDetach !== null) {
                topDetaches.push(addedDetach);
            }
            const removedDetach = connectSignal(readSignal(surface, "windowRemoved"), (removed) => {
                if (typeof removed === "object" && removed !== null) {
                    dropOne(removed as object);
                }
            });
            if (removedDetach !== null) {
                topDetaches.push(removedDetach);
            }
            return detachAll;
        } catch (error) {
            void error;
            return null;
        }
    };
    // String-keyed native identity cache: normalized internalId to stable
    // plan id (the same normalized string, interned). Never keyed by Window.
    // Eviction is explicit when the adapter identifies a removed string id.
    const nativeIds = new Map<string, string>();
    const floatingIds = new Set<string>();
    // Deliberate tiler reload gap configuration: resolved at startup, then
    // re-read only on the KWin Options `configChanged` signal. That signal is
    // emitted after `org.kde.KWin /KWin reconfigure` reparses kwinrc
    // (dbusinterface.cpp delegates to Workspace::reconfigure; workspace.cpp
    // slotReconfigure reparses and calls Options::updateSettings which emits
    // configChanged; scripting.cpp exposes that Options singleton as the
    // script global `options`). The running script is never restarted by that
    // call (the Scripting load path returns -1 when already loaded, Script::run
    // returns early when running), so this subscription is the pickup route. Ordinary
    // reads and unchanged saves send nothing and never fire it. No shortcut
    // re-registration, no script/plugin lifecycle, no in-flight reset.
    let domainGaps: DomainGaps = readDomainGaps({
        readInnerGapFn: overrides.readInnerGapFn,
        readOuterGapFn: overrides.readOuterGapFn,
    });
    const eligibilityReasons = new Map<string, string>();
    const reportEligibility: EligibilityReporter = (ref, reason): void => {
        if (!KWIN_TRACE_ENABLED) {
            return;
        }
        const id = readNativeId(ref);
        if (id === null) {
            if (reason !== null) {
                try {
                    log(`plasma-auto-tiler:plan:observe-excluded reason=${reason} window=unknown resource_class=unknown`);
                } catch (error) {
                    void error;
                }
            }
            return;
        }
        if (reason === null) {
            eligibilityReasons.delete(id);
            return;
        }
        if (eligibilityReasons.get(id) === reason) {
            return;
        }
        eligibilityReasons.set(id, reason);
        try {
            log(`plasma-auto-tiler:plan:observe-excluded reason=${reason} window=${id} resource_class=${readResourceClass(ref)}`);
        } catch (error) {
            void error;
        }
    };
    // Entry-owned highlight refresh edge: set once the highlight bridge
    // starts, invoked exactly once per successful geometry-plan boundary.
    let highlightRefresh: (() => void) | null = null;
    // Entry-owned cross-flight guard: the send adapter is created below, so
    // the Plan guard reads through this mutable slot. While a send flight is
    // active, Plan dispatches are blocked and auto intents are dropped; a
    // single normal resync after send commit converges.
    let workspaceSendRef: import("./workspace-send-adapter").WorkspaceSendAdapter | null = null;
    const adapter = new PlanAdapter({
        callDbus,
        scheduleOnce,
        log,
        isSendActive: () => workspaceSendRef !== null && workspaceSendRef.blocksPlan,
        isInteractiveResizeActive: () => interactiveResizeRefs.size > 0 || interactiveMoveRefs.size > 0,
        onPlannedApplied: () => {
            try {
                highlightRefresh?.();
            } catch (error) {
                void error;
            }
        },
        observe: () => observeNative(liveWorkspace, nativeIds, floatingIds, domainGaps, reportEligibility),
        observeHidden: () => observeHiddenDomains(liveWorkspace, nativeIds, floatingIds, domainGaps, reportEligibility),
        observeDirectional: (direction) =>
            observeDirectionalDomain(liveWorkspace, nativeIds, floatingIds, domainGaps, direction, reportEligibility),
        clearMaximize: (target) => {
            try {
                const method = readProp(target, "setMaximize");
                if (typeof method !== "function") {
                    return "missing";
                }
                Reflect.apply(method as (...args: ReadonlyArray<unknown>) => unknown, target, [false, false]);
                return "invoked";
            } catch (error) {
                void error;
                return "threw";
            }
        },
        setMaximize: (target, maximized) => {
            try {
                const method = readProp(target, "setMaximize");
                if (typeof method !== "function") {
                    return "missing";
                }
                Reflect.apply(method as (...args: ReadonlyArray<unknown>) => unknown, target, [maximized, maximized]);
                return "invoked";
            } catch (error) {
                void error;
                return "threw";
            }
        },
        setFullscreen: (target, fullscreen) => {
            try {
                if (readProp(target, "fullScreen") === undefined) {
                    return "missing";
                }
                return Reflect.set(target, "fullScreen", fullscreen) ? "invoked" : "threw";
            } catch (error) {
                void error;
                return "threw";
            }
        },
        setAllDesktops: (target, allDesktops) => {
            try {
                const probe = connectSignal(readSignal(target, "desktopsChanged"), () => {});
                if (probe === null) {
                    return "missing";
                }
                probe();
                return Reflect.set(target, "onAllDesktops", allDesktops) ? "invoked" : "threw";
            } catch (error) {
                void error;
                return "threw";
            }
        },
        readKeepAbove: (target) => {
            try {
                const value = readProp(target, "keepAbove");
                return typeof value === "boolean" ? value : null;
            } catch (error) {
                void error;
                return null;
            }
        },
        readKeepBelow: (target) => {
            try {
                const value = readProp(target, "keepBelow");
                return typeof value === "boolean" ? value : null;
            } catch (error) {
                void error;
                return null;
            }
        },
        setKeepAbove: (target, keepAbove) => {
            try {
                const current = readProp(target, "keepAbove");
                const below = readProp(target, "keepBelow");
                if (typeof current !== "boolean" || typeof below !== "boolean") {
                    return "missing";
                }
                if (!Reflect.set(target, "keepAbove", keepAbove)) {
                    return "threw";
                }
                const actualAbove = readProp(target, "keepAbove");
                const actualBelow = readProp(target, "keepBelow");
                return actualAbove === keepAbove && (!keepAbove || actualBelow === false) ? "invoked" : "refused";
            } catch (error) {
                void error;
                return "threw";
            }
        },
        setKeepBelow: (target, keepBelow) => {
            try {
                if (typeof readProp(target, "keepBelow") !== "boolean") {
                    return "missing";
                }
                if (!Reflect.set(target, "keepBelow", keepBelow)) {
                    return "threw";
                }
                const actualAbove = readProp(target, "keepAbove");
                const actualBelow = readProp(target, "keepBelow");
                return actualBelow === keepBelow && (!keepBelow || actualAbove === false) ? "invoked" : "refused";
            } catch (error) {
                void error;
                return "threw";
            }
        },
        setGeometry: (target, rect) => {
            try {
                return Reflect.set(target, "frameGeometry", {
                    x: rect.x,
                    y: rect.y,
                    width: rect.w,
                    height: rect.h,
                });
            } catch (error) {
                void error;
                return false;
            }
        },
        setFloating: (id, floating) => {
            if (floating) {
                floatingIds.add(id);
            } else {
                floatingIds.delete(id);
            }
        },
        // Production R4 cross-output transfer: exact Output object plus exact
        // target VirtualDesktop refs through public typed surfaces only.
        // sendClientToScreen initiates transfer only; the adapter proves the
        // resulting output, desktop membership, geometry, and focus
        // asynchronously before ack/verify commit.
        resolveOutput: (name) => {
            try {
                const screens = decodeList(readProp(surface, "screens"), MAX_LIST);
                if (screens === null) {
                    return null;
                }
                for (const item of screens) {
                    if (typeof item === "object" && item !== null && readProp(item as object, "name") === name) {
                        return item as object;
                    }
                }
                return null;
            } catch (error) {
                void error;
                return null;
            }
        },
        resolveDesktop: (workspaceId) => {
            try {
                const desktops = decodeList(readProp(surface, "desktops"), MAX_DESKTOPS);
                if (desktops === null) {
                    return null;
                }
                for (const item of desktops) {
                    if (typeof item === "object" && item !== null && readProp(item as object, "id") === workspaceId) {
                        return item as object;
                    }
                }
                return null;
            } catch (error) {
                void error;
                return null;
            }
        },
        sendClientToScreen: (mover, output) => {
            try {
                const send = readProp(surface, "sendClientToScreen");
                if (typeof send !== "function") {
                    return false;
                }
                Reflect.apply(send as (...args: ReadonlyArray<unknown>) => unknown, surface, [mover, output]);
                return true;
            } catch (error) {
                void error;
                return false;
            }
        },
        setDesktops: (mover, desktops) => {
            try {
                const probe = connectSignal(readSignal(mover, "desktopsChanged"), () => {});
                if (probe === null) {
                    return false;
                }
                probe();
                return Reflect.set(mover, "desktops", [...desktops]);
            } catch (error) {
                void error;
                return false;
            }
        },
        readOutputName: (ref) => {
            try {
                const output = readProp(ref, "output");
                if (typeof output !== "object" || output === null) {
                    return null;
                }
                const name = readProp(output as object, "name");
                return isOpaqueId(name) ? (name as string) : null;
            } catch (error) {
                void error;
                return null;
            }
        },
        readDesktopIds: (ref) => {
            try {
                const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
                if (membership === null) {
                    return null;
                }
                const ids: string[] = [];
                for (const member of membership) {
                    if (typeof member !== "object" || member === null) {
                        return null;
                    }
                    const id = readProp(member as object, "id");
                    if (!isOpaqueId(id)) {
                        return null;
                    }
                    ids.push(id as string);
                }
                return Object.freeze(ids);
            } catch (error) {
                void error;
                return null;
            }
        },
        readGeometry: (ref) => {
            try {
                const frame = readFrameRect(ref);
                return typeof frame === "string" ? null : { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
            } catch (error) {
                void error;
                return null;
            }
        },
        readWindowConstraints: (ref) => readWindowConstraints(ref),
        // Bounded R4 signal fences grounded in the documented notify
        // signals: outputChanged carries the old output (re-read for the
        // current value), desktopsChanged for membership, and
        // frameGeometryChanged per changed window. One-shot: the adapter
        // detaches after each echo and on every terminal path.
        subscribeMoverOutput: (moverRef, handler) => {
            try {
                return connectSignal(readSignal(moverRef, "outputChanged"), handler);
            } catch (error) {
                void error;
                return null;
            }
        },
        subscribeMoverDesktops: (moverRef, handler) => {
            try {
                return connectSignal(readSignal(moverRef, "desktopsChanged"), handler);
            } catch (error) {
                void error;
                return null;
            }
        },
        subscribeWindowGeometry: (windowRef, handler) => {
            try {
                return connectSignal(readSignal(windowRef, "frameGeometryChanged"), handler);
            } catch (error) {
                void error;
                return null;
            }
        },
        setActive: (target) => {
            try {
                (liveWorkspace as { activeWindow: unknown }).activeWindow = target;
                return true;
            } catch (error) {
                void error;
                return false;
            }
        },
        active: () => {
            try {
                const current = (liveWorkspace as { activeWindow: unknown }).activeWindow;
                return typeof current === "object" && current !== null
                    ? (current as object)
                    : null;
            } catch (error) {
                void error;
                return null;
            }
        },
        subscribe: (kind, handler) => {
            if (kind === "geometry") {
                const detach = subWindowGeometry(handler);
                if (detach === null) {
                    throw new Error("plan-entry-signal-failed");
                }
                return detach;
            }
            if (kind === "scope") {
                const first = sub("screensChanged", handler);
                const second = sub("currentDesktopChanged", handler);
                if (first === null || second === null) {
                    if (first !== null) {
                        try {
                            first();
                        } catch (error) {
                            void error;
                        }
                    }
                    throw new Error("plan-entry-signal-failed");
                }
                return (): void => {
                    try {
                        first();
                    } catch (error) {
                        void error;
                    }
                    try {
                        second();
                    } catch (error) {
                        void error;
                    }
                };
            }
            if (kind === "fullscreen") {
                const detach = subWindowFullscreen(handler);
                if (detach === null) {
                    return (): void => {};
                }
                return detach;
            }
            if (kind === "maximize") {
                const detach = subWindowRequiredSignal("maximizedChanged", "plasma-auto-tiler:plan:maximize-refused-signal", handler, true);
                if (detach === null) {
                    // Maximize observation is a hard startup requirement, unlike
                    // best-effort fullscreen: refuse fail-closed with the exact
                    // maximize-specific token so a missing signal cannot leave
                    // the adapter blind to maximize transitions.
                    try {
                        log("plasma-auto-tiler:plan:maximize-refused-signal");
                    } catch (error) {
                        void error;
                    }
                    throw new Error("plan-entry-maximize-signal-failed");
                }
                return detach;
            }
            if (kind === "desktops") {
                const detach = subWindowRequiredSignal("desktopsChanged", "plasma-auto-tiler:plan:sticky-refused-signal", handler, false);
                if (detach === null) {
                    return (): void => {};
                }
                return detach;
            }
            const name =
                kind === "added"
                    ? "windowAdded"
                    : kind === "removed"
                      ? "windowRemoved"
                      : "windowActivated";
            const detach = sub(name, handler);
            if (detach === null) {
                throw new Error("plan-entry-signal-failed");
            }
            return detach;
        },
        noteRemoved: (id) => {
            try {
                nativeIds.delete(id);
                eligibilityReasons.delete(id);
            } catch (error) {
                void error;
            }
        },
    });
    const enabled = adapter.enable({ owner: overrides.owner, generation: overrides.generation });
    if (!enabled) {
        return null;
    }
    const initial = observeNative(liveWorkspace, nativeIds, floatingIds, domainGaps, reportEligibility);
    const initialHidden = observeHiddenDomains(liveWorkspace, nativeIds, floatingIds, domainGaps, reportEligibility);
    // Startup enables when the foreground is observable or when any eligible
    // background domain exists (non-empty with at least one tiled,
    // non-exception member). Explicit empty and exception-only observations
    // never enable by themselves; only when neither foreground nor eligible
    // hidden exists is the old fail-closed disable preserved.
    let hasEligibleHidden = false;
    for (const entry of initialHidden) {
        if (entry.windows.length === 0) {
            continue;
        }
        let eligible = false;
        for (const member of entry.windows) {
            if (!member.floating && !member.sticky && !member.fullscreen && !member.maximized) {
                eligible = true;
                break;
            }
        }
        if (eligible) {
            hasEligibleHidden = true;
            break;
        }
    }
    if ((initial === null || initial.windows.length === 0) && !hasEligibleHidden) {
        adapter.disable();
        return null;
    }
    // Startup session context from the existing owner/generation provenance
    // plus the compiled-in source revision: one bounded ready line identifies
    // the plan session for the whole journal so every later cmd/write/rejected
    // line is attributable.
    try {
        log(
            `plasma-auto-tiler:plan:ready owner=${String(overrides.owner)} generation=${String(overrides.generation)} source=${PLAN_SOURCE_REV}`,
        );
    } catch (error) {
        void error;
    }
    adapter.requestResync();
    const profile = readShortcutProfile(overrides.readProfileFn);
    const catalog = planShortcutCatalog(profile);
    let registerFn = overrides.registerShortcutFn;
    if (registerFn === undefined) {
        try {
            const native: unknown = registerShortcut;
            if (typeof native !== "function") {
                adapter.disable();
                return null;
            }
            const bound = native as (
                name: string,
                text: string,
                sequence: string,
                callback: () => void,
            ) => boolean;
            registerFn = (name, text, sequence, callback) => bound(name, text, sequence, callback);
        } catch (error) {
            void error;
            adapter.disable();
            return null;
        }
    }
    for (const row of catalog) {
        const action = row.action;
        const text = row.text;
        const sequence = row.sequence;
        const op = row.op;
        const direction = row.direction;
        const mode = row.mode;
        try {
            const ok =
                op === "resize"
                    ? registerFn(action, text, sequence, () => adapter.requestResize(direction, mode))
                    : op === "move"
                      ? registerFn(action, text, sequence, () => adapter.requestMove(direction))
                      : op === "float"
                        ? registerFn(action, text, sequence, () => adapter.requestFloat())
                        : op === "sticky"
                          ? registerFn(action, text, sequence, () => adapter.requestSticky())
                          : op === "maximize"
                            ? registerFn(action, text, sequence, () => adapter.requestMaximize())
                            : op === "fullscreen"
                              ? registerFn(action, text, sequence, () => adapter.requestFullscreen())
                              : registerFn(action, text, sequence, () => adapter.requestFocus(direction));
            if (ok !== true) {
                try {
                    log(`plasma-auto-tiler:plan:shortcut-failed action=${action} sequence=${sequence}`);
                } catch (error) {
                    void error;
                }
            } else if (action === "plasma-auto-tiler-toggle-float") {
                // KGlobalAccel keeps both registrations and dispatches the
                // earliest serial holder. Grid View is already registered by
                // KWin, so this new action is visible in Settings but cannot
                // receive Meta+G until the user resolves that conflict there.
                try {
                    log("plasma-auto-tiler:plan:shortcut-dispatch-shadowed action=plasma-auto-tiler-toggle-float sequence=Meta+G holder_component=kwin holder_action=Grid View");
                } catch (error) {
                    void error;
                }
            } else if (action === "plasma-auto-tiler-toggle-maximize") {
                try {
                    log("plasma-auto-tiler:plan:shortcut-dispatch-shadowed action=plasma-auto-tiler-toggle-maximize sequence=Meta+M holder_component=kwin holder_action=KrohnkiteMonocleLayout");
                } catch (error) {
                    void error;
                }
            }
        } catch (error) {
            void error;
            try {
                log(`plasma-auto-tiler:plan:shortcut-failed action=${action} sequence=${sequence}`);
            } catch (inner) {
                void inner;
            }
        }
    }
    // Production dynamic workspace route: the native adapter owns the
    // project-owned backing-desktop mapping and lifecycle observation; the
    // existing send adapter owns the sole structural same-output tiled move
    // through Rust, then follows to the Rust-planned target desktop after its
    // own fresh native mover-membership confirmation; Rust commit remains
    // separately exact and may complete later.
    const workspaceNative = new WorkspaceNativeAdapter({
        getWorkspace: () => liveWorkspace,
        readWorkspaceMode: () => readWorkspaceModeValue(overrides.readWorkspaceModeFn),
        log,
    });
    workspaceNative.enable();
    const sendNativeIds = new Map<string, string>();
    const emitNativeFollow = (
        diagnostic: WorkspaceFollowNativeDiagnostic,
        event: string,
        outcome: string,
        detail: {
            readonly api: string;
            readonly returnKind: string;
            readonly callOrdinal: number;
            readonly callTotal: number;
            readonly selection: string;
            readonly mode: string;
            readonly outputs: number;
            readonly targetOrdinal: number;
            readonly currentIdEq: number;
            readonly activeIdEq: number;
            readonly exception: string;
        },
    ): void => {
        if (!KWIN_TRACE_ENABLED) {
            return;
        }
        try {
            log(
                `plasma-auto-tiler:route-diag component=cosmic-send stage=follow correlation=${diagnostic.correlation} generation=${String(overrides.generation)} revision=${String(diagnostic.revision)} event=${event} outcome=${outcome} diag_seq=${String(diagnostic.nextSequence())} api=${detail.api} return_kind=${detail.returnKind} call_ord=${String(detail.callOrdinal)} call_total=${String(detail.callTotal)} selection=${detail.selection} mode=${detail.mode} outputs=${String(detail.outputs)} tgt_ord=${String(detail.targetOrdinal)} cur_id_eq=${String(detail.currentIdEq)} active_id_eq=${String(detail.activeIdEq)} exception=${detail.exception}`,
            );
        } catch (error) {
            void error;
        }
    };
    const nativeDetail = (
        api: string,
        returnKind: string,
        callOrdinal: number,
        callTotal: number,
        selection: string,
        mode: string,
        outputs: number,
        targetOrdinal: number,
        currentIdEq: number,
        activeIdEq: number,
        exception: string,
    ) => ({ api, returnKind, callOrdinal, callTotal, selection, mode, outputs, targetOrdinal, currentIdEq, activeIdEq, exception });
    const workspaceSend = new WorkspaceSendAdapter(
        {
        callDbus,
        scheduleOnce,
        log,
        observe: (targetWorkspace, pinnedSourceWorkspace?) =>
            observeSendTarget(liveWorkspace, sendNativeIds, targetWorkspace, floatingIds, pinnedSourceWorkspace),
        onCommitted: () => {
            try {
                adapter.requestResync();
            } catch (error) {
                void error;
            }
            // The send adapter releases source/target retention before this
            // committed-only callback, so lifecycle cleanup may now prune it.
            try {
                workspaceNative.handleTopologySignal();
            } catch (error) {
                void error;
            }
        },
        setGeometry: (target, rect) => {
            try {
                return Reflect.set(target, "frameGeometry", {
                    x: rect.x,
                    y: rect.y,
                    width: rect.w,
                    height: rect.h,
                });
            } catch (error) {
                void error;
                return false;
            }
        },
        setDesktops: (target, refs) => {
            try {
                return Reflect.set(target, "desktops", refs);
            } catch (error) {
                void error;
                return false;
            }
        },
        subscribeMoverDesktops: (moverRef, handler) => {
            try {
                return connectSignal(readSignal(moverRef, "desktopsChanged"), handler);
            } catch (error) {
                void error;
                return null;
            }
        },
        subscribeWindowGeometry: (windowRef, handler) => {
            try {
                return connectSignal(readSignal(windowRef, "frameGeometryChanged"), handler);
            } catch (error) {
                void error;
                return null;
            }
        },
        switchToTarget: (desktopRef, diagnostic) => {
            try {
                const surface = liveWorkspace as Record<string, unknown>;
                const screens = decodeList(readProp(surface, "screens"), MAX_LIST);
                if (screens === null || screens.length === 0) {
                    emitNativeFollow(diagnostic, "native-switch-before", "unavailable", nativeDetail("unknown", "void", -1, -1, "unknown", "unknown", -1, -1, -1, -1, "none"));
                    return false;
                }
                let activeOutput: object | null = null;
                let selection = "active-window";
                try {
                    const active = Reflect.get(surface, "activeWindow");
                    if (typeof active === "object" && active !== null) {
                        const output = readProp(active as object, "output");
                        if (typeof output === "object" && output !== null) {
                            activeOutput = output as object;
                        }
                    }
                } catch (error) {
                    void error;
                }
                if (activeOutput === null) {
                    selection = "active-screen";
                    try {
                        const screen = Reflect.get(surface, "activeScreen");
                        if (typeof screen === "object" && screen !== null) {
                            activeOutput = screen as object;
                        }
                    } catch (error) {
                        void error;
                    }
                }
                if (activeOutput === null) {
                    selection = "first-screen";
                    const first = screens[0];
                    if (typeof first !== "object" || first === null) {
                        emitNativeFollow(diagnostic, "native-switch-before", "unavailable", nativeDetail("unknown", "void", -1, -1, selection, "unknown", screens.length, -1, -1, -1, "none"));
                        return false;
                    }
                    activeOutput = first as object;
                }
                const setter = readProp(surface, "setCurrentDesktopForScreen");
                if (typeof setter !== "function") {
                    emitNativeFollow(diagnostic, "native-switch-before", "api-missing", nativeDetail("missing", "void", -1, -1, selection, "unknown", screens.length, -1, -1, -1, "none"));
                    return false;
                }
                // Shared mode shows one desktop everywhere, so follow every
                // output; otherwise follow only the active output. Mapping
                // itself stays owned by WorkspaceNativeAdapter and rebuilds on
                // the next topology signal. The setter is void in KWin
                // scripting (WorkspaceWrapper::setCurrentDesktopForScreen) and
                // never reports success, so confirm with one immediate direct
                // current-desktop read by stable desktop id (KWin may return a
                // fresh wrapper object per read); a mismatch reports false
                // with no retry so follow stays truthful while commit is
                // preserved.
                const targetIdRaw = readProp(desktopRef, "id");
                if (!isOpaqueId(targetIdRaw)) {
                    emitNativeFollow(diagnostic, "native-switch-before", "target-unreadable", nativeDetail("available", "void", -1, -1, selection, "unknown", screens.length, -1, -1, -1, "none"));
                    return false;
                }
                const targetId = targetIdRaw as string;
                const desktops = decodeList(readProp(surface, "desktops"), MAX_DESKTOPS);
                const targetOrdinal = desktops === null ? -1 : desktops.indexOf(desktopRef);
                const mode = workspaceNative.getMode() === "shared" ? "shared" : "single";
                const selected = mode === "shared" ? screens : [activeOutput];
                emitNativeFollow(diagnostic, "native-switch-before", "ready", nativeDetail("available", "void", -1, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                const confirmCurrent = (output: object, callOrdinal: number): boolean => {
                    try {
                        const getter = readProp(surface, "currentDesktopForScreen");
                        if (typeof getter !== "function") {
                            emitNativeFollow(diagnostic, "native-switch-readback", "api-missing", nativeDetail("missing", "void", callOrdinal, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                            return false;
                        }
                        const current = Reflect.apply(
                            getter as (...args: ReadonlyArray<unknown>) => unknown,
                            surface,
                            [output],
                        );
                        if (typeof current !== "object" || current === null) {
                            emitNativeFollow(diagnostic, "native-switch-readback", "unreadable", nativeDetail("available", "void", callOrdinal, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                            return false;
                        }
                        const currentEq = readProp(current as object, "id") === targetId ? 1 : 0;
                        emitNativeFollow(diagnostic, "native-switch-readback", currentEq === 1 ? "observed" : "mismatch", nativeDetail("available", "void", callOrdinal, selected.length, selection, mode, screens.length, targetOrdinal, currentEq, -1, "none"));
                        return currentEq === 1;
                    } catch (error) {
                        void error;
                        emitNativeFollow(diagnostic, "native-switch-readback", "exception", nativeDetail("available", "void", callOrdinal, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "caught"));
                        return false;
                    }
                };
                if (mode === "shared") {
                    for (let index = 0; index < screens.length; index += 1) {
                        const output = screens[index];
                        if (typeof output !== "object" || output === null) {
                            emitNativeFollow(diagnostic, "native-switch-call", "skipped-non-object-output", nativeDetail("available", "void", index, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                            return false;
                        }
                        emitNativeFollow(diagnostic, "native-switch-call", "attempted", nativeDetail("available", "void", index, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                        Reflect.apply(setter as (...args: ReadonlyArray<unknown>) => unknown, surface, [desktopRef, output]);
                        emitNativeFollow(diagnostic, "native-switch-call", "returned-void", nativeDetail("available", "void", index, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                    }
                    for (let index = 0; index < screens.length; index += 1) {
                        const output = screens[index];
                        if (typeof output !== "object" || output === null) {
                            emitNativeFollow(diagnostic, "native-switch-readback", "skipped-non-object-output", nativeDetail("available", "void", index, selected.length, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                            return false;
                        }
                        if (!confirmCurrent(output as object, index)) {
                            return false;
                        }
                    }
                    return true;
                }
                emitNativeFollow(diagnostic, "native-switch-call", "attempted", nativeDetail("available", "void", 0, 1, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                Reflect.apply(setter as (...args: ReadonlyArray<unknown>) => unknown, surface, [desktopRef, activeOutput]);
                emitNativeFollow(diagnostic, "native-switch-call", "returned-void", nativeDetail("available", "void", 0, 1, selection, mode, screens.length, targetOrdinal, -1, -1, "none"));
                return confirmCurrent(activeOutput, 0);
            } catch (error) {
                void error;
                emitNativeFollow(diagnostic, "native-switch-after", "exception", nativeDetail("unknown", "void", -1, -1, "unknown", "unknown", -1, -1, -1, -1, "caught"));
                return false;
            }
        },
        focusWindow: (windowRef, diagnostic) => {
            try {
                const targetId = readNativeId(windowRef);
                if (targetId === null) {
                    emitNativeFollow(diagnostic, "native-focus-before", "target-unreadable", nativeDetail("property", "direct-assignment", -1, 1, "mover", "single", -1, -1, -1, -1, "none"));
                    return false;
                }
                emitNativeFollow(diagnostic, "native-focus-before", "ready", nativeDetail("property", "direct-assignment", -1, 1, "mover", "single", -1, -1, -1, -1, "none"));
                emitNativeFollow(diagnostic, "native-focus-call", "attempted", nativeDetail("property", "direct-assignment", 0, 1, "mover", "single", -1, -1, -1, -1, "none"));
                (liveWorkspace as { activeWindow: unknown }).activeWindow = windowRef;
                emitNativeFollow(diagnostic, "native-focus-call", "returned-no-api-result", nativeDetail("property", "direct-assignment", 0, 1, "mover", "single", -1, -1, -1, -1, "none"));
                const active = Reflect.get(liveWorkspace as object, "activeWindow");
                const activeId = typeof active === "object" && active !== null ? readNativeId(active as object) : null;
                const activeEq = activeId === null ? -1 : activeId === targetId ? 1 : 0;
                emitNativeFollow(diagnostic, "native-focus-after", activeEq === -1 ? "unreadable" : activeEq === 1 ? "observed" : "mismatch", nativeDetail("property", "direct-assignment", 0, 1, "mover", "single", -1, -1, -1, activeEq, "none"));
                return activeEq === 1;
            } catch (error) {
                void error;
                emitNativeFollow(diagnostic, "native-focus-after", "exception", nativeDetail("property", "direct-assignment", -1, 1, "mover", "single", -1, -1, -1, -1, "caught"));
                return false;
            }
        },
        },
        { innerGap: domainGaps.innerGap, outerGap: domainGaps.outerGap },
    );
    // Terminal send semantics: the send adapter may enable once at startup.
    // Thereafter a terminal disable (pending mismatch, owner loss, refusal,
    // or reset correlation sequence) stays fail-closed. No normal workspace
    // shortcut may restore it.
    workspaceSendRef = workspaceSend;
    // Bounded transaction-lifetime ordering: while the send holds a bound
    // plan awaiting ack/verify, the native cleanup must not prune its exact
    // pending source/target ids even when empty and non-visible after follow.
    // Provider-read per cleanup, so settle (commit/terminal clears pending)
    // restores normal pruning with no extra state.
    try {
        workspaceNative.setRetentionProvider(() => workspaceSend.pendingWorkspaces);
    } catch (error) {
        void error;
    }
    try {
        workspaceSend.enable({ owner: overrides.owner, generation: overrides.generation });
    } catch (error) {
        void error;
    }
    const requestWorkspaceSelect = (index: unknown): void => {
        try {
            if (index === 0) {
                workspaceNative.selectTrailingOrCreate();
                return;
            }
            if (typeof index !== "number" || !Number.isInteger(index)) {
                return;
            }
            workspaceNative.selectLogical(index);
        } catch (error) {
            void error;
        }
    };
    const requestWorkspaceMove = (index: unknown): void => {
        try {
            if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 9) {
                try {
                    log(`plasma-auto-tiler:route-diag component=cosmic-send stage=entry correlation= generation=${String(overrides.generation)} revision=0 diag_seq=-1 event=workspace-move outcome=invalid-logical-target follow=not-reached gate=pre-commit phase=entry reason=invalid-logical-target req_ord=-1 inflight_stage=idle`);
                } catch (error) {
                    void error;
                }
                return;
            }
            if (!workspaceSend.isEnabled || workspaceSend.isInFlight || adapter.isInFlight) {
                const outcome = !workspaceSend.isEnabled
                    ? "disabled"
                    : workspaceSend.isInFlight
                      ? "busy-send"
                      : "busy-plan";
                try {
                    let correlation = "";
                    let inflightStage = "idle";
                    try {
                        correlation = workspaceSend.activeCorrelation;
                        inflightStage = workspaceSend.activeStage;
                    } catch (error) {
                        void error;
                    }
                    log(`plasma-auto-tiler:route-diag component=cosmic-send stage=entry correlation=${correlation} generation=${String(overrides.generation)} revision=0 diag_seq=-1 event=workspace-move outcome=${outcome} follow=not-reached gate=pre-commit phase=entry reason=${outcome} req_ord=${String(index)} inflight_stage=${inflightStage}`);
                    log("plasma-auto-tiler:plan:busy-refused kind=workspace-move");
                } catch (error) {
                    void error;
                }
                return;
            }
            const target =
                index === 0 ? workspaceNative.resolveOrAppendMoveTarget() : workspaceNative.resolveMoveTarget(index);
            if (target === null) {
                try {
                    log(`plasma-auto-tiler:route-diag component=cosmic-send stage=entry correlation= generation=${String(overrides.generation)} revision=0 diag_seq=-1 event=workspace-move outcome=target-unresolved follow=not-reached gate=pre-commit phase=entry reason=target-unresolved req_ord=${String(index)} inflight_stage=idle`);
                } catch (error) {
                    void error;
                }
                return;
            }
            if (!workspaceSend.isEnabled || workspaceSend.isInFlight || adapter.isInFlight) {
                const outcome = !workspaceSend.isEnabled
                    ? "disabled"
                    : workspaceSend.isInFlight
                      ? "busy-send"
                      : "busy-plan";
                try {
                    let correlation = "";
                    let inflightStage = "idle";
                    try {
                        correlation = workspaceSend.activeCorrelation;
                        inflightStage = workspaceSend.activeStage;
                    } catch (error) {
                        void error;
                    }
                    log(`plasma-auto-tiler:route-diag component=cosmic-send stage=entry correlation=${correlation} generation=${String(overrides.generation)} revision=0 diag_seq=-1 event=workspace-move outcome=${outcome} follow=not-reached gate=pre-commit phase=entry reason=${outcome} req_ord=${String(index)} inflight_stage=${inflightStage}`);
                    log("plasma-auto-tiler:plan:busy-refused kind=workspace-move");
                } catch (error) {
                    void error;
                }
                return;
            }
            // Diagnostic-only handoff: the validated logical ordinal (0
            // permitted for the trailing target) travels into the send flight
            // for follow logs and never gates request behavior.
            workspaceSend.requestSend(target, index);
        } catch (error) {
            void error;
        }
    };
    for (const row of workspaceShortcutCatalog()) {
        const action = row.action;
        const text = row.text;
        const sequence = row.sequence;
        const kind = row.kind;
        const index = row.index;
        try {
            const ok =
                kind === "move"
                    ? registerFn(action, text, sequence, () => requestWorkspaceMove(index))
                    : registerFn(action, text, sequence, () => requestWorkspaceSelect(index));
            if (ok !== true) {
                try {
                    log(`plasma-auto-tiler:plan:shortcut-failed action=${action} sequence=${sequence}`);
                } catch (error) {
                    void error;
                }
            }
        } catch (error) {
            void error;
            try {
                log(`plasma-auto-tiler:plan:shortcut-failed action=${action} sequence=${sequence}`);
            } catch (inner) {
                void inner;
            }
        }
    }
    const workspaceDetaches: Array<() => void> = [];
    const workspaceWindowDetaches = new Map<object, () => void>();
    const trackWorkspaceDetach = (detach: (() => void) | null): void => {
        if (detach !== null) {
            workspaceDetaches.push(detach);
        }
    };
    const trackWorkspaceWindowDetach = (ref: object, detach: (() => void) | null): void => {
        if (detach === null || workspaceWindowDetaches.has(ref)) {
            return;
        }
        workspaceWindowDetaches.set(ref, detach);
        workspaceDetaches.push(detach);
    };
    const dropWorkspaceWindowDetach = (ref: object): void => {
        const detach = workspaceWindowDetaches.get(ref);
        if (detach === undefined) {
            return;
        }
        workspaceWindowDetaches.delete(ref);
        const at = workspaceDetaches.indexOf(detach);
        if (at >= 0) {
            workspaceDetaches.splice(at, 1);
        }
        try {
            detach();
        } catch (error) {
            void error;
        }
    };
    trackWorkspaceDetach(sub("desktopsChanged", () => workspaceNative.handleTopologySignal()));
    trackWorkspaceDetach(sub("currentDesktopChanged", () => workspaceNative.handleTopologySignal()));
    trackWorkspaceDetach(sub("screensChanged", () => workspaceNative.handleTopologySignal()));
    trackWorkspaceDetach(sub("windowAdded", () => workspaceNative.handleTopologySignal()));
    trackWorkspaceDetach(sub("windowRemoved", () => workspaceNative.handleTopologySignal()));
    try {
        const lister = surface["windowList"];
        if (typeof lister === "function") {
            let raw: unknown = undefined;
            try {
                raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
            } catch (error) {
                void error;
                raw = undefined;
            }
            const list = decodeList(raw, MAX_LIST);
            if (list !== null) {
                const seenWindows = new Set<object>();
                for (const item of list) {
                    if (typeof item !== "object" || item === null || seenWindows.has(item as object)) {
                        continue;
                    }
                    seenWindows.add(item as object);
                    trackWorkspaceWindowDetach(
                        item as object,
                        connectSignal(readSignal(item as object, "desktopsChanged"), () =>
                            workspaceNative.handleTopologySignal(),
                        ),
                    );
                }
            }
            trackWorkspaceDetach(
                connectSignal(readSignal(surface, "windowAdded"), (added) => {
                    if (typeof added === "object" && added !== null) {
                        trackWorkspaceWindowDetach(
                            added as object,
                            connectSignal(readSignal(added as object, "desktopsChanged"), () =>
                                workspaceNative.handleTopologySignal(),
                            ),
                        );
                    }
                    workspaceNative.handleTopologySignal();
                }),
            );
            trackWorkspaceDetach(
                connectSignal(readSignal(surface, "windowRemoved"), (removed) => {
                    if (typeof removed === "object" && removed !== null) {
                        dropWorkspaceWindowDetach(removed as object);
                    }
                    workspaceNative.handleTopologySignal();
                }),
            );
        }
    } catch (error) {
        void error;
    }
    // Oracle route: preserve start rect, move/resize classification, start
    // pointer, and grabbed edge(s) at Started, then on a non-cancelled
    // LastVerdict route the grabbed final edge target(s) from the
    // authoritative final rect (never the finish pointer). Non-grabbed edge
    // deltas are ignored, never a rejection; a grabbed corner routes both
    // axes in exactly one atomic dual-axis pointer-resize intent through
    // the shared single-flight (never two concurrent requests); the
    // single-axis wire shape is unchanged. Cancelled is a strict no-op
    // with one bounded normal-mode log at the pull layer; unusable-edge
    // failures (missing grab, zero move) fail closed with exact bounded
    // correlated reasons.
    // Every finish carries an opaque per-finish token (exact Window object
    // plus finish epoch) from its signal through the D-Bus pull back to the
    // route/settle callbacks. Route/settle consume only a start whose epoch
    // is <= that finish token; an old reply faced with a newer start fails
    // closed and never clears the newer start. Cancelled verdicts never reach
    // the pointer route and never change a share.
    interface OracleStart { id: string; rect: { x: number; y: number; w: number; h: number }; move: boolean; resize: boolean; epoch: number; grabbed: OracleGrabbed | null; grabSource: OracleGrabSource | "missing"; pointerStart: { x: number; y: number } | null; floatingStart: boolean }
    const oracleStarts = new Map<object, OracleStart>();
    const interactiveResizeRefs = new Set<object>();
    // Tiled-move suppression mirrors the resize hold: while a tiled member is
    // being moved, ordinary reconcile stays suppressed exactly as during
    // resize. Floating moves never enter this set and stay native-only.
    // The hold lasts from Started until the correlated verdict settles
    // (route or settle) or the bounded per-finish timer releases it, so a
    // missing/unavailable reply cannot block later work and no successful
    // drag terminal is invented without a validated drag-N correlation.
    const interactiveMoveRefs = new Set<object>();
    const moveGuardCancels = new Map<DragOracleFinishContext, () => void>();
    let oracleEpoch = 0;
    const readLiveState = (target: object): { move: boolean; resize: boolean } | null => {
        try {
            const move = Reflect.get(target, "move");
            const resize = Reflect.get(target, "resize");
            if ((move !== true && move !== false) || (resize !== true && resize !== false)) return null;
            return { move, resize };
        } catch (error) {
            void error;
            return null;
        }
    };
    const captureOracleStart = (ref: object): void => {
        try {
            const observed = observeNative(liveWorkspace, nativeIds, floatingIds, domainGaps, reportEligibility);
            if (observed === null) return;
            for (const entry of observed.windows) {
                if (entry.ref === ref) {
                    const state = readLiveState(ref);
                    if (state === null) {
                        oracleStarts.delete(ref);
                        return;
                    }
                    // Route-owned start pointer capture: always read, never
                    // trace-gated. Trace-only measurement keeps its own
                    // separate capture. Fail-closed null, never throws.
                    let pointerStart: { x: number; y: number } | null = null;
                    try {
                        pointerStart = readMeasurePointer(liveWorkspace);
                    } catch (error) {
                        void error;
                        pointerStart = null;
                    }
                    const rect = { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h };
                    let grabbed: OracleGrabbed | null = null;
                    let grabSource: OracleGrabSource | "missing" = "missing";
                    try {
                        const identified = identifyGrabbedEdges(rect, pointerStart);
                        if (identified !== null) {
                            grabbed = identified.grabbed;
                            grabSource = identified.source;
                        }
                    } catch (error) {
                        void error;
                    }
                    oracleStarts.set(ref, { id: entry.id, rect, move: state.move, resize: state.resize, epoch: (oracleEpoch += 1), grabbed, grabSource, pointerStart, floatingStart: (entry as { floating?: unknown }).floating === true });
                    if (state.move === false && state.resize === true && !interactiveResizeRefs.has(ref)) {
                        interactiveResizeRefs.add(ref);
                        adapter.setInteractiveResizeActive(true);
                    }
                    // Tiled-move hold: any move gesture on a tiled member
                    // suppresses ordinary reconcile exactly as a resize hold.
                    // Floating (including sticky, which observes as floating)
                    // never enters the hold and stays native-only. The start
                    // floating state is recorded so a move that STARTS
                    // floating stays unaffected even if tiled at finish.
                    if (state.move === true && !interactiveMoveRefs.has(ref)) {
                        let floating = false;
                        try {
                            floating = (entry as { floating?: unknown }).floating === true;
                        } catch (error) {
                            void error;
                            floating = false;
                        }
                        if (!floating) {
                            interactiveMoveRefs.add(ref);
                            adapter.setInteractiveResizeActive(true);
                        }
                    }
                    return;
                }
            }
            oracleStarts.delete(ref);
        } catch (error) {
            void error;
        }
    };
    const makeOracleFinishContext = (ref: object): DragOracleFinishContext => {
        oracleEpoch += 1;
        return { ref, finishEpoch: oracleEpoch };
    };
    // Token-guarded consumption: delete the finish's own captured start only
    // when it predates the finish token. A newer Started (larger epoch) that
    // lands before the async reply is always kept. Never touches other
    // windows and never broad-clears.
    const takeOwnStart = (ctx: DragOracleFinishContext | undefined): OracleStart | null => {
        try {
            if (ctx === undefined) return null;
            const start = oracleStarts.get(ctx.ref);
            if (start === undefined) return null;
            if (start.epoch > ctx.finishEpoch) return null;
            oracleStarts.delete(ctx.ref);
            return start;
        } catch (error) {
            void error;
            return null;
        }
    };
    // AR8 offline drag measurement (trace-only, read-only): one bounded
    // correlated record per interactive move/resize finish carrying the
    // finish frameGeometry, the first later frameGeometryChanged for the
    // same window or a timeout marker, the route's captured start rect (or
    // missing when the route holds no capture for the finish), the pulled
    // verdict (cancelled/reason/final geometry), the deriveOracleEdge result
    // over those rects, pointer start/finish via workspace.cursorPos, and
    // the existing drag correlation. Opt-in via KWIN_TRACE_ENABLED; when
    // disabled nothing is captured, subscribed, scheduled, or logged. Reads
    // frameGeometry/cursorPos only: never calls DescribePlan, never writes
    // geometry, never touches the oracle route above. The start rect is
    // peeked (never consumed) from the route's own oracleStarts under its
    // epoch guard; pointers are captured separately at Started. Keyed by
    // the oracle finish context (one pending per initiated pull, never by
    // window alone), so overlapping finishes keep separate records and a
    // reply always meets its own finish: the pending is created in the
    // finish context factory before the pull runs, so even a synchronous
    // D-Bus callback settles after creation regardless of finish-listener
    // order. A fired-but-unreadable later geometry completes as missing
    // (never misreported as timeout), and a per-pending verdict timeout
    // bounds finishes whose reply never arrives. A finish followed by
    // window removal still emits one partial record (arrived sides kept,
    // unarrived verdict as missing, unarrived later as missing rather than
    // timeout). When the global oracle pull failed to attach, the entry
    // finished handler arms a standalone pending per finish whose verdict
    // side completes via the verdict timeout. No titles, no window
    // identity strings, no raw native ids.
    interface MeasurePending {
        ref: object;
        seq: number;
        start: DragMeasureRect | null;
        finish: DragMeasureRect | null;
        later: DragMeasureRect | null;
        laterDone: boolean;
        laterTimeout: boolean;
        verdict: DragOracleVerdict | null;
        verdictMissing: boolean;
        verdictDone: boolean;
        pointerStart: DragMeasurePointer | null;
        pointerFinish: DragMeasurePointer | null;
        cancelLaterTimer: (() => void) | null;
        cancelVerdictTimer: (() => void) | null;
        detachLater: (() => void) | null;
    }
    const measureStarts = new Map<object, DragMeasurePointer | null>();
    // Route captures already claimed by a standalone finish. The standalone
    // path cannot consume oracleStarts (route-owned), so each route capture
    // may back at most one standalone record: a second finish without an
    // intervening Started reports start=missing. A new Started re-arms.
    const measureStandaloneClaimed = new Set<object>();
    const measurePending = new Map<DragOracleFinishContext, MeasurePending>();
    let measureSeq = 0;
    // True once the global oracle pull attached. Only then does a finish
    // context (and a later settle) exist; otherwise the entry finished
    // handler owns a standalone measurement below.
    let measurePullAvailable = false;
    const releaseMeasurePending = (ctx: DragOracleFinishContext, pending: MeasurePending): void => {
        try {
            measurePending.delete(ctx);
        } catch (error) {
            void error;
        }
        try {
            pending.detachLater?.();
        } catch (error) {
            void error;
        }
        try {
            pending.cancelLaterTimer?.();
        } catch (error) {
            void error;
        }
        try {
            pending.cancelVerdictTimer?.();
        } catch (error) {
            void error;
        }
    };
    const dropMeasureWindow = (ref: object): void => {
        try {
            for (const [ctx, pending] of [...measurePending]) {
                if (pending.ref !== ref) {
                    continue;
                }
                releaseMeasurePending(ctx, pending);
            }
        } catch (error) {
            void error;
        }
    };
    const tryEmitMeasure = (ctx: DragOracleFinishContext): void => {
        try {
            const pending = measurePending.get(ctx);
            if (pending === undefined || !pending.verdictDone || (!pending.laterDone && !pending.laterTimeout)) {
                return;
            }
            emitMeasureRecord(ctx, pending);
        } catch (error) {
            void error;
        }
    };
    const emitMeasureRecord = (ctx: DragOracleFinishContext, pending: MeasurePending): void => {
        try {
            releaseMeasurePending(ctx, pending);
            const correlation =
                !pending.verdictMissing && pending.verdict !== null ? pending.verdict.correlation : "none";
            try {
                log(
                    formatDragMeasureLine({
                        seq: pending.seq,
                        correlation,
                        start: pending.start,
                        finish: pending.finish,
                        later: pending.later,
                        laterTimeout: pending.laterTimeout,
                        verdict: pending.verdict,
                        verdictMissing: pending.verdictMissing,
                        edge: describeMeasureEdge(pending.start, pending.finish),
                        pointerStart: pending.pointerStart,
                        pointerFinish: pending.pointerFinish,
                    }),
                );
            } catch (error) {
                void error;
            }
        } catch (error) {
            void error;
        }
    };
    // Removal completion: a finish followed by window removal before its
    // later geometry or verdict still yields one bounded partial record.
    // An arrived side is kept; an unarrived verdict completes as missing
    // (no reply can meaningfully arrive for a removed window) and an
    // unarrived later stays missing (never timeout: the timer never won).
    // Reads nothing from the removed window; no ids leave this path.
    const completeMeasureRemoval = (ref: object): void => {
        try {
            for (const [ctx, pending] of [...measurePending]) {
                if (pending.ref !== ref) {
                    continue;
                }
                if (!pending.verdictDone) {
                    pending.verdict = null;
                    pending.verdictMissing = true;
                    pending.verdictDone = true;
                }
                emitMeasureRecord(ctx, pending);
            }
        } catch (error) {
            void error;
        }
    };
    const captureMeasureStart = (ref: object): void => {
        if (!KWIN_TRACE_ENABLED) {
            return;
        }
        try {
            measureStarts.set(ref, readMeasurePointer(liveWorkspace));
            measureStandaloneClaimed.delete(ref);
        } catch (error) {
            void error;
        }
    };
    const takeMeasurePointer = (ref: object): DragMeasurePointer | null => {
        try {
            const pointer = measureStarts.get(ref) ?? null;
            try {
                measureStarts.delete(ref);
            } catch (error) {
                void error;
            }
            return pointer;
        } catch (error) {
            void error;
            return null;
        }
    };
    // The recorded start rect is the oracle route's own capture for this
    // finish (same epoch guard as takeOwnStart), never an independent
    // script read: peek only, the route still owns consumption. Missing
    // exactly when the route has no capture for this finish.
    const peekMeasureStartRect = (ctx: DragOracleFinishContext): DragMeasureRect | null => {
        try {
            const start = oracleStarts.get(ctx.ref);
            if (start === undefined || start.epoch > ctx.finishEpoch) {
                return null;
            }
            return { x: start.rect.x, y: start.rect.y, w: start.rect.w, h: start.rect.h };
        } catch (error) {
            void error;
            return null;
        }
    };
    const createMeasurePending = (ctx: DragOracleFinishContext): void => {
        if (!KWIN_TRACE_ENABLED) {
            return;
        }
        try {
            armMeasurePending(ctx, peekMeasureStartRect(ctx), takeMeasurePointer(ctx.ref));
        } catch (error) {
            void error;
        }
    };
    // Standalone finish for a globally unavailable oracle pull (no pull
    // listeners exist, so no ordering or duplication concern): the latest
    // unclaimed route capture is the start association (each capture backs
    // at most one record; a repeat finish without a new Started reports
    // missing) and the verdict side can only complete via the verdict
    // timeout. Route/pull untouched: with no handle neither ever runs, and
    // oracleStarts itself is never mutated here.
    const createMeasureStandaloneFinish = (ref: object): void => {
        if (!KWIN_TRACE_ENABLED || measurePullAvailable) {
            return;
        }
        try {
            let start: DragMeasureRect | null = null;
            try {
                const captured = oracleStarts.get(ref);
                if (captured !== undefined && !measureStandaloneClaimed.has(ref)) {
                    start = { x: captured.rect.x, y: captured.rect.y, w: captured.rect.w, h: captured.rect.h };
                    measureStandaloneClaimed.add(ref);
                }
            } catch (error) {
                void error;
            }
            armMeasurePending({ ref, finishEpoch: 0 }, start, takeMeasurePointer(ref));
        } catch (error) {
            void error;
        }
    };
    const armMeasurePending = (
        ctx: DragOracleFinishContext,
        start: DragMeasureRect | null,
        pointerStart: DragMeasurePointer | null,
    ): void => {
        try {
            const pending: MeasurePending = {
                ref: ctx.ref,
                seq: (measureSeq += 1),
                start,
                finish: readMeasureRect(ctx.ref),
                later: null,
                laterDone: false,
                laterTimeout: false,
                verdict: null,
                verdictMissing: false,
                verdictDone: false,
                pointerStart,
                pointerFinish: readMeasurePointer(liveWorkspace),
                cancelLaterTimer: null,
                cancelVerdictTimer: null,
                detachLater: null,
            };
            measurePending.set(ctx, pending);
            try {
                const detach = connectSignal(readSignal(ctx.ref, "frameGeometryChanged"), () => {
                    try {
                        const current = measurePending.get(ctx);
                        if (current === undefined || current.laterDone || current.laterTimeout) {
                            return;
                        }
                        // A fired change always completes the later slot, even
                        // when the rect itself is unreadable (missing, never
                        // timeout). Only the timer below reports timeout.
                        current.later = readMeasureRect(ctx.ref);
                        current.laterDone = true;
                        tryEmitMeasure(ctx);
                    } catch (error) {
                        void error;
                    }
                });
                pending.detachLater = detach;
            } catch (error) {
                void error;
            }
            try {
                pending.cancelLaterTimer = scheduleOnce(DRAG_MEASURE_LATER_TIMEOUT_MS, () => {
                    try {
                        const current = measurePending.get(ctx);
                        if (current === undefined || current.laterDone) {
                            return;
                        }
                        current.laterTimeout = true;
                        tryEmitMeasure(ctx);
                    } catch (error) {
                        void error;
                    }
                });
            } catch (error) {
                void error;
            }
            try {
                pending.cancelVerdictTimer = scheduleOnce(DRAG_MEASURE_VERDICT_TIMEOUT_MS, () => {
                    try {
                        const current = measurePending.get(ctx);
                        if (current === undefined || current.verdictDone) {
                            return;
                        }
                        current.verdict = null;
                        current.verdictMissing = true;
                        current.verdictDone = true;
                        tryEmitMeasure(ctx);
                    } catch (error) {
                        void error;
                    }
                });
            } catch (error) {
                void error;
            }
        } catch (error) {
            void error;
        }
    };
    // Per-finish measurement factory: wraps the existing oracle finish
    // context (same epoch token, same object the route and settle paths
    // already use) and creates this finish's pending before the pull runs.
    // Route/settle behavior is unchanged: the returned context is the
    // oracle's own.
    const measureMakeFinishContext = (ref: object): DragOracleFinishContext => {
        const ctx = makeOracleFinishContext(ref);
        try {
            createMeasurePending(ctx);
        } catch (error) {
            void error;
        }
        // Bounded move-guard release: when this finish belongs to a held
        // tiled move, arm one per-finish timer on the shared verdict bound.
        // Settle cancels it; if no verdict ever settles, the timer consumes
        // only this finish's own start (newer Started stays) and releases
        // the hold once through the ordinary resync. No marker and no drag
        // terminal is created here.
        try {
            if (interactiveMoveRefs.has(ref)) {
                const cancel = scheduleOnce(DRAG_MEASURE_VERDICT_TIMEOUT_MS, () => {
                    try {
                        moveGuardCancels.delete(ctx);
                        if (!interactiveMoveRefs.has(ref)) {
                            return;
                        }
                        const start = oracleStarts.get(ctx.ref);
                        if (start !== undefined && start.epoch > ctx.finishEpoch) {
                            return;
                        }
                        try { takeOwnStart(ctx); } catch (error) { void error; }
                        const had = interactiveMoveRefs.delete(ref);
                        if (had && interactiveMoveRefs.size === 0 && interactiveResizeRefs.size === 0) {
                            try { adapter.setInteractiveResizeActive(false); } catch (error) { void error; }
                        }
                        try { log(`plasma-auto-tiler:route-diag:drag-move-timeout correlation=none`); } catch (error) { void error; }
                    } catch (error) {
                        void error;
                    }
                });
                if (typeof cancel === "function") {
                    moveGuardCancels.set(ctx, cancel);
                }
            }
        } catch (error) {
            void error;
        }
        return ctx;
    };
    const feedMeasureVerdict = (ctx: DragOracleFinishContext | undefined, verdict: DragOracleVerdict | null): void => {
        if (!KWIN_TRACE_ENABLED) {
            return;
        }
        try {
            if (ctx === undefined) {
                return;
            }
            const pending = measurePending.get(ctx);
            if (pending === undefined || pending.verdictDone) {
                return;
            }
            pending.verdict = verdict;
            pending.verdictMissing = verdict === null;
            pending.verdictDone = true;
            tryEmitMeasure(ctx);
        } catch (error) {
            void error;
        }
    };
    // Finish-token completion: runs after every parsed verdict (including
    // cancelled) and for invalid/unavailable replies (null). Consumes only
    // its own finish's associated start without routing, logging, or
    // touching DescribePlan. For a held tiled move that did not already
    // restore through the route, this releases the hold once through the
    // ordinary resync: cancelled, null, and route failure paths converge
    // without a marker and without inventing a drag terminal. A successful
    // move restore already cleared the hold silently, so this is a no-op
    // then. A newer Started (larger epoch) is never cleared.
    const settleOracleVerdict = (verdict: DragOracleVerdict | null, ctx: DragOracleFinishContext | undefined): void => {
        try {
            void verdict;
            if (ctx !== undefined) {
                try {
                    const cancel = moveGuardCancels.get(ctx);
                    if (cancel !== undefined) {
                        moveGuardCancels.delete(ctx);
                        try { cancel(); } catch (error) { void error; }
                    }
                } catch (error) {
                    void error;
                }
                if (interactiveMoveRefs.has(ctx.ref)) {
                    let owned = true;
                    try {
                        const start = oracleStarts.get(ctx.ref);
                        if (start !== undefined && start.epoch > ctx.finishEpoch) {
                            owned = false;
                        }
                    } catch (error) {
                        void error;
                        owned = true;
                    }
                    if (owned) {
                        try { takeOwnStart(ctx); } catch (error) { void error; }
                        const had = interactiveMoveRefs.delete(ctx.ref);
                        if (had && interactiveMoveRefs.size === 0 && interactiveResizeRefs.size === 0) {
                            try { adapter.setInteractiveResizeActive(false); } catch (error) { void error; }
                        }
                        feedMeasureVerdict(ctx, verdict);
                        return;
                    }
                    takeOwnStart(ctx);
                    feedMeasureVerdict(ctx, verdict);
                    return;
                }
            }
            takeOwnStart(ctx);
            feedMeasureVerdict(ctx, verdict);
        } catch (error) {
            void error;
        }
    };
    // Every oracle drag rejection logs its exact reason with the parsed
    // drag-N correlation (validated closed-vocabulary tokens only; no
    // titles, no native ids, no secrets). Logging is best-effort and never
    // affects behavior.
    const routeOracleVerdict = (verdict: DragOracleVerdict, ctx: DragOracleFinishContext | undefined): void => {
        try {
            if (ctx === undefined) {
                try { log(`plasma-auto-tiler:route-diag:drag-context-invalid correlation=${verdict.correlation}`); } catch (error) { void error; }
                return;
            }
            const observed = observeNative(liveWorkspace, nativeIds, floatingIds, domainGaps, reportEligibility);
            if (observed === null) {
                takeOwnStart(ctx);
                try { log(`plasma-auto-tiler:route-diag:drag-scope-invalid correlation=${verdict.correlation}`); } catch (error) { void error; }
                return;
            }
            let ref: object | null = null;
            for (const entry of observed.windows) {
                if (entry.id === verdict.windowIdentity) {
                    ref = entry.ref;
                    break;
                }
            }
            if (ref === null) {
                takeOwnStart(ctx);
                try { log(`plasma-auto-tiler:route-diag:drag-unknown-window correlation=${verdict.correlation}`); } catch (error) { void error; }
                return;
            }
            if (ref !== ctx.ref) {
                takeOwnStart(ctx);
                try { log(`plasma-auto-tiler:route-diag:drag-ref-mismatch correlation=${verdict.correlation}`); } catch (error) { void error; }
                return;
            }
            const start = takeOwnStart(ctx);
            if (start === null || start.id !== verdict.windowIdentity) {
                try { log(`plasma-auto-tiler:route-diag:drag-start-missing correlation=${verdict.correlation}`); } catch (error) { void error; }
                return;
            }
            if (start.move === true) {
                // Tiled move-drop restore: only a move that STARTS tiled and
                // FINISHES tiled converges its retained domain once through
                // the existing coalesced one-shot marker (one dispatch, no
                // retry, per-drag terminal naming the satisfying plan).
                // Anything touching floating stays native-only with the
                // historical ignored line and no marker: floating-at-start
                // never entered the hold, and tiled-at-finish after a
                // floating start must not restore. A start/finish mismatch
                // logs one bounded line (closed-vocabulary tokens only, no
                // ids or coordinates) so the decision stays observable.
                // Cancelled verdicts never reach this route (the pull settles
                // them directly), so this branch only sees ok-moved drops.
                let floatingFinish = false;
                try {
                    for (const entry of observed.windows) {
                        if (entry.id === verdict.windowIdentity) {
                            floatingFinish = (entry as { floating?: unknown }).floating === true;
                            break;
                        }
                    }
                } catch (error) {
                    void error;
                    floatingFinish = false;
                }
                const floatingStart = start.floatingStart === true;
                if (floatingStart !== floatingFinish) {
                    try { log(`plasma-auto-tiler:route-diag:drag-move-floating-mismatch correlation=${verdict.correlation} start=${floatingStart ? "floating" : "tiled"} finish=${floatingFinish ? "floating" : "tiled"}`); } catch (error) { void error; }
                }
                if (floatingFinish || floatingStart) {
                    // Single-use release without a marker: cancel this
                    // finish's bounded timer and drop the hold when present.
                    // A tiled-at-start hold converges through the ordinary
                    // resync below; a floating-at-start move never held, so
                    // this is a no-op beyond the ignored line. Settle finds
                    // no guard afterwards and only feeds measurement.
                    try {
                        const cancel = moveGuardCancels.get(ctx);
                        if (cancel !== undefined) {
                            moveGuardCancels.delete(ctx);
                            try { cancel(); } catch (error) { void error; }
                        }
                    } catch (error) {
                        void error;
                    }
                    try {
                        const had = interactiveMoveRefs.delete(ctx.ref);
                        if (had && interactiveMoveRefs.size === 0 && interactiveResizeRefs.size === 0) {
                            try { adapter.setInteractiveResizeActive(false); } catch (error) { void error; }
                        }
                    } catch (error) {
                        void error;
                    }
                    try { log(`plasma-auto-tiler:route-diag:drag-move-ignored correlation=${verdict.correlation}`); } catch (error) { void error; }
                    return;
                }
                try {
                    const cancel = moveGuardCancels.get(ctx);
                    if (cancel !== undefined) {
                        moveGuardCancels.delete(ctx);
                        try { cancel(); } catch (error) { void error; }
                    }
                } catch (error) {
                    void error;
                }
                try { interactiveMoveRefs.delete(ctx.ref); } catch (error) { void error; }
                try { log(`plasma-auto-tiler:route-diag:drag-move-restore correlation=${verdict.correlation}`); } catch (error) { void error; }
                try {
                    adapter.noteMoveDropped(verdict.correlation, verdict.windowIdentity, observed.domainOutput, observed.domainWorkspace);
                } catch (error) {
                    void error;
                }
                return;
            }
            if (!(start.move === false && start.resize === true)) {
                try { log(`plasma-auto-tiler:route-diag:drag-start-invalid correlation=${verdict.correlation}`); } catch (error) { void error; }
                return;
            }
            // Grabbed-edge routing: the grabbed edge(s) captured at Started
            // select the final target edge(s) from the authoritative final
            // rect (final edge target, never the finish pointer).
            // Non-grabbed edge deltas are ignored, never a rejection. A
            // grabbed corner routes both axes in exactly one dual-axis
            // pointer-resize intent through the shared single-flight (never
            // two concurrent requests); the single-axis wire shape is
            // unchanged. Reject only when no usable edge remains: missing
            // grab, zero move on every grabbed axis, or gone/identity-invalid
            // above. Logging is best-effort and never affects behavior; no
            // native ids or secrets are logged.
            const formatGrabbed = (grabbed: OracleGrabbed): string => {
                const h = grabbed.horizontal ?? "-";
                const v = grabbed.vertical ?? "-";
                return `${h}+${v}`;
            };
            // Verified press override: only after the entry verified the same
            // finish ref, the verdict window identity, and a resize-only
            // start above. A present press classifies by exact KWin thirds
            // regardless of the 64px Started-pointer depth gate; an absent
            // (missing/stale/other-window) press keeps the Started
            // nearest-frame capture with one correlated press-absent line (no
            // raw native ids or coordinates at normal level). A present but
            // unusable press (outside the start frame) keeps the Started capture
            // the same way. The epoch-guarded start consumption above already prevents
            // any async stale-start route; the press never bypasses it.
            let grabbed: OracleGrabbed | null = start.grabbed;
            let grabSource: OracleGrabSource | "missing" = start.grabSource;
            if (verdict.press !== undefined) {
                let identified: { grabbed: OracleGrabbed; source: OracleGrabSource } | null = null;
                try {
                    identified = identifyPressGrabbed(start.rect, verdict.press);
                } catch (error) {
                    void error;
                    identified = null;
                }
                if (identified !== null) {
                    grabbed = identified.grabbed;
                    grabSource = identified.source;
                } else {
                    try { log(`plasma-auto-tiler:route-diag:drag-press-fallback correlation=${verdict.correlation} source=${start.grabSource}`); } catch (error) { void error; }
                }
            } else {
                try { log(`plasma-auto-tiler:route-diag:drag-press-fallback correlation=${verdict.correlation} source=${start.grabSource}`); } catch (error) { void error; }
            }
            if (grabbed === null) {
                try { log(`plasma-auto-tiler:route-diag:drag-no-grabbed-edge correlation=${verdict.correlation} source=${grabSource}`); } catch (error) { void error; }
                return;
            }
            const resolved = resolveOracleResizeTargets(start.rect, verdict.finalRect, grabbed);
            if (resolved === null) {
                try { log(`plasma-auto-tiler:route-diag:drag-zero-move correlation=${verdict.correlation} grabbed=${formatGrabbed(grabbed)} source=${grabSource}`); } catch (error) { void error; }
                return;
            }
            try {
                const targetText = resolved.targets.map((t) => `${t.direction}:${String(t.boundary)}`).join(",");
                const ignoredText = resolved.ignored.length > 0 ? resolved.ignored.join(",") : "none";
                log(`plasma-auto-tiler:route-diag:drag-route correlation=${verdict.correlation} grabbed=${formatGrabbed(grabbed)} source=${grabSource} targets=${targetText} ignored=${ignoredText}`);
            } catch (error) {
                void error;
            }
            // The adapter emits its exact source-grounded refusal token for
            // every distinct failure cause (disabled, identity, direction,
            // boundary, observation failure, absent target, fullscreen or
            // maximized target). No catch-all pointer-refused line is added here.
            // Targets resolve horizontal-first, so a corner pair is
            // (direction, boundary) horizontal plus (direction2, boundary2)
            // vertical in exactly one atomic intent. The dispatch outcome
            // is logged with the drag correlation: accepted means one
            // intent entered the single flight (dispatched or deferred);
            // refused means the adapter's exact refusal token (logged
            // alongside by the adapter) rejected it and nothing was sent.
            // Completion (planned/applied/rejected) is logged by the
            // adapter under its own plan correlation.
            try {
                let accepted = false;
                // Drag correlation travels as optional entry request metadata:
                // adapter-validation or Planner rejection of this drop then
                // converges once via a drag-correlated reconcile (no retry).
                // Cancelled/zero-move never reach here (strict no-op above).
                if (resolved.targets.length === 2) {
                    const first = resolved.targets[0] as { direction: string; boundary: number };
                    const second = resolved.targets[1] as { direction: string; boundary: number };
                    accepted = adapter.requestPointerResize(verdict.windowIdentity, first.direction, first.boundary, second.direction, second.boundary, verdict.correlation);
                } else {
                    const only = resolved.targets[0] as { direction: string; boundary: number };
                    accepted = adapter.requestPointerResize(verdict.windowIdentity, only.direction, only.boundary, undefined, undefined, verdict.correlation);
                }
                try {
                    const targetText = resolved.targets.map((t) => `${t.direction}:${String(t.boundary)}`).join(",");
                    log(`plasma-auto-tiler:route-diag:drag-dispatched correlation=${verdict.correlation} targets=${targetText} accepted=${accepted === true ? "true" : "false"}`);
                } catch (error) {
                    void error;
                }
            } catch (error) {
                void error;
                try { log(`plasma-auto-tiler:route-diag:drag-dispatch-thrown correlation=${verdict.correlation}`); } catch (_ignored) { /* fail-closed */ }
            }
        } catch (error) {
            void error;
            try { log(`plasma-auto-tiler:route-diag:drag-route-thrown correlation=${verdict.correlation}`); } catch (_ignored) { /* fail-closed */ }
        }
    };
    const oracleSeen = new Set<object>();
    const oracleDetaches: Array<() => void> = [];
    const oracleWindowDetaches = new Map<object, Array<() => void>>();
    const trackOracleDetach = (ref: object, detach: () => void): void => {
        try {
            oracleDetaches.push(detach);
            const owned = oracleWindowDetaches.get(ref);
            if (owned === undefined) {
                oracleWindowDetaches.set(ref, [detach]);
            } else {
                owned.push(detach);
            }
        } catch (error) {
            void error;
        }
    };
    const dropOracleWindow = (ref: object): void => {
        // Removed-window cleanup keyed by object identity only: never reads an
        // id from the removal payload. Runs the window's own Started detach
        // so dead signals stop firing, then drops captured state.
        try {
            const owned = oracleWindowDetaches.get(ref);
            if (owned !== undefined) {
                oracleWindowDetaches.delete(ref);
                for (const detach of owned) {
                    try { detach(); } catch (error) { void error; }
                }
            }
            oracleStarts.delete(ref);
            measureStarts.delete(ref);
            measureStandaloneClaimed.delete(ref);
            completeMeasureRemoval(ref);
            try {
                for (const [ctx, cancel] of [...moveGuardCancels]) {
                    if (ctx.ref === ref) {
                        moveGuardCancels.delete(ctx);
                        try { cancel(); } catch (error) { void error; }
                    }
                }
            } catch (error) {
                void error;
            }
            const hadResize = interactiveResizeRefs.delete(ref);
            const hadMove = interactiveMoveRefs.delete(ref);
            if ((hadResize || hadMove) && interactiveResizeRefs.size === 0 && interactiveMoveRefs.size === 0) {
                adapter.setInteractiveResizeActive(false);
            }
            oracleSeen.delete(ref);
        } catch (error) {
            void error;
        }
    };
    const attachOracleStartOne = (ref: object): void => {
        if (oracleSeen.has(ref)) return;
        let started: unknown = null;
        let finished: unknown = null;
        try {
            started = readSignal(ref, "interactiveMoveResizeStarted");
            finished = readSignal(ref, "interactiveMoveResizeFinished");
        } catch (error) { void error; return; }
        let startedDetach: (() => void) | null = null;
        let finishedDetach: (() => void) | null = null;
        try {
            startedDetach = connectSignal(started, () => {
                try { captureOracleStart(ref); } catch (error) { void error; }
                try { captureMeasureStart(ref); } catch (error) { void error; }
            });
            if (startedDetach === null) return;
            finishedDetach = connectSignal(finished, () => {
                try {
                    if (interactiveResizeRefs.delete(ref)) {
                        if (interactiveResizeRefs.size === 0 && interactiveMoveRefs.size === 0) {
                            adapter.setInteractiveResizeActive(false);
                        }
                    } else if (interactiveMoveRefs.has(ref)) {
                        // Tiled move hold: keep suppression until the
                        // correlated verdict settles (route or settle) or the
                        // bounded per-finish timer releases it. When the
                        // global pull never attached, no verdict can arrive,
                        // so release now through the ordinary resync.
                        let available = false;
                        try { available = measurePullAvailable === true; } catch (error) { void error; }
                        if (!available) {
                            const had = interactiveMoveRefs.delete(ref);
                            if (had && interactiveMoveRefs.size === 0 && interactiveResizeRefs.size === 0) {
                                try { adapter.setInteractiveResizeActive(false); } catch (error) { void error; }
                            }
                        }
                    }
                } catch (error) { void error; }
                // Standalone measurement only: active exactly when the
                // global oracle pull failed to attach (no pull listeners
                // exist for this finish). Never duplicates the
                // context-keyed path above.
                try { createMeasureStandaloneFinish(ref); } catch (error) { void error; }
            });
            if (finishedDetach === null) {
                startedDetach();
                return;
            }
        } catch (error) { void error; return; }
        if (startedDetach === null || finishedDetach === null) return;
        oracleSeen.add(ref);
        trackOracleDetach(ref, startedDetach);
        trackOracleDetach(ref, finishedDetach);
    };
    const attachOracleStartAll = (): void => {
        try {
            const lister = surface["windowList"];
            if (typeof lister !== "function") return;
            const raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
            const list = decodeList(raw, MAX_LIST);
            if (list === null) return;
            for (const item of list) {
                if (typeof item === "object" && item !== null) attachOracleStartOne(item as object);
            }
        } catch (error) { void error; }
    };
    attachOracleStartAll();
    try {
        const addedDetach = connectSignal(readSignal(surface, "windowAdded"), () => { attachOracleStartAll(); });
        if (addedDetach !== null) oracleDetaches.push(addedDetach);
    } catch (error) { void error; }
    // Removed-window oracle cleanup within the exact existing signal APIs:
    // windowRemoved carries the Window object, used here by identity only.
    try {
        const removedDetach = connectSignal(readSignal(surface, "windowRemoved"), (removed) => {
            try {
                if (typeof removed === "object" && removed !== null) dropOracleWindow(removed as object);
            } catch (error) { void error; }
        });
        if (removedDetach !== null) oracleDetaches.push(removedDetach);
    } catch (error) { void error; }
    let oracleStop: (() => void) | null = null;
    try {
        const oracleOverrides: import("./drag-oracle-pull").DragOraclePullOverrides =
            overrides.oracleCallDbus === undefined
                ? { workspace: liveWorkspace, log, routePointer: routeOracleVerdict, onSettled: settleOracleVerdict, makeFinishContext: measureMakeFinishContext }
                : { workspace: liveWorkspace, log, callDbus: overrides.oracleCallDbus, routePointer: routeOracleVerdict, onSettled: settleOracleVerdict, makeFinishContext: measureMakeFinishContext };
        const oracleHandle = startDragOraclePullEntry(oracleOverrides);
        if (oracleHandle !== null) {
            oracleStop = () => { try { oracleHandle.stop(); } catch (error) { void error; } };
            measurePullAvailable = true;
        }
    } catch (error) { void error; }
    // Temporary active-group highlight bridge: asks the existing DescribePlan
    // route with {"op":"active-group"} at startup and on focus/domain/tree
    // lifecycle changes, validates the exact bounded reply shape and identity,
    // and forwards engine-projected union bounds to the effect-owned
    // SetGroupHighlight(QString)/ClearGroupHighlight() endpoint. No new
    // transport, no topology derivation, no /Effects. Every script error,
    // no-group, service loss, or lifecycle invalidation clears fail-closed.
    let highlightStop: (() => void) | null = null;
    try {
        const ownerRaw = overrides.owner;
        const generationRaw = overrides.generation;
        if (typeof ownerRaw === "string" && typeof generationRaw === "string") {
            let effectCall = overrides.highlightCallDbus;
            if (effectCall === undefined) {
                try {
                    const native: unknown = callDBus;
                    if (typeof native === "function") {
                        const bound = native as (...args: ReadonlyArray<unknown>) => void;
                        effectCall = (service, path, iface, method, ...args) => {
                            bound(service, path, iface, method, ...args);
                        };
                    }
                } catch (error) {
                    void error;
                }
            }
            if (effectCall !== undefined) {
                const effect = effectCall;
                const highlight = startActiveGroupHighlight({
                    callDescribePlan: (payload, callback) => {
                        callDbus(PLAN_SERVICE, PLAN_OBJECT, PLAN_INTERFACE, PLAN_METHOD, payload, callback);
                    },
                    setHighlight: (payload) => {
                        effect(GROUP_HIGHLIGHT_SERVICE, GROUP_HIGHLIGHT_OBJECT, GROUP_HIGHLIGHT_INTERFACE, GROUP_HIGHLIGHT_SET_METHOD, payload);
                    },
                    clearHighlight: () => {
                        effect(GROUP_HIGHLIGHT_SERVICE, GROUP_HIGHLIGHT_OBJECT, GROUP_HIGHLIGHT_INTERFACE, GROUP_HIGHLIGHT_CLEAR_METHOD);
                    },
                    observe: (): ActiveGroupObserved | null => {
                        let seen: PlanObserved | null = null;
                        try {
                            seen = observeNative(liveWorkspace, nativeIds, floatingIds, domainGaps, reportEligibility);
                        } catch (error) {
                            void error;
                            return null;
                        }
                        if (seen === null) {
                            return null;
                        }
                        try {
                            return {
                                domainOutput: seen.domainOutput,
                                domainWorkspace: seen.domainWorkspace,
                                domainBounds: {
                                    x: seen.domainBounds.x,
                                    y: seen.domainBounds.y,
                                    w: seen.domainBounds.w,
                                    h: seen.domainBounds.h,
                                },
                                domainGap: seen.domainGap,
                                domainOuterGap: seen.domainOuterGap,
                                focusedId: seen.focusedId,
                                windows: seen.windows.map((entry) => ({
                                    id: entry.id,
                                    output: entry.output,
                                    workspace: entry.workspace,
                                    rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
                                    // Script-only lifecycle validity; never
                                    // serialized into the DescribePlan request.
                                    fullscreen: entry.fullscreen,
                                })),
                            };
                        } catch (error) {
                            void error;
                            return null;
                        }
                    },
                    subscribe: (kind, handler) => {
                        if (kind === "focus") {
                            const detach = sub("windowActivated", handler);
                            if (detach === null) {
                                throw new Error("plan-entry-highlight-signal-failed");
                            }
                            return detach;
                        }
                        if (kind === "fullscreen") {
                            // Best-effort per-window fullscreen state: uses the
                            // existing documented fullScreenChanged seam. Never
                            // fails enable; effect-side eligibility still hides
                            // when the source is unavailable.
                            try {
                                const detach = subWindowFullscreen(handler);
                                if (detach === null) {
                                    return (): void => {};
                                }
                                return detach;
                            } catch (error) {
                                void error;
                                return (): void => {};
                            }
                        }
                        if (kind === "domain") {
                            const first = sub("screensChanged", handler);
                            const second = sub("currentDesktopChanged", handler);
                            if (first === null || second === null) {
                                if (first !== null) {
                                    try {
                                        first();
                                    } catch (error) {
                                        void error;
                                    }
                                }
                                throw new Error("plan-entry-highlight-signal-failed");
                            }
                            return (): void => {
                                try {
                                    first();
                                } catch (error) {
                                    void error;
                                }
                                try {
                                    second();
                                } catch (error) {
                                    void error;
                                }
                            };
                        }
                        const added = sub("windowAdded", handler);
                        const removed = sub("windowRemoved", handler);
                        if (added === null || removed === null) {
                            if (added !== null) {
                                try {
                                    added();
                                } catch (error) {
                                    void error;
                                }
                            }
                            throw new Error("plan-entry-highlight-signal-failed");
                        }
                        return (): void => {
                            try {
                                added();
                            } catch (error) {
                                void error;
                            }
                            try {
                                removed();
                            } catch (error) {
                                void error;
                            }
                        };
                    },
                    log,
                    owner: ownerRaw,
                    generation: generationRaw,
                });
                if (highlight !== null) {
                    // Single observational refresh after each successful
                    // geometry-plan boundary, even when focus is unchanged.
                    // Geometry writes emit no highlight lifecycle signal, so
                    // this edge is the only post-plan refresh: no retries,
                    // no polling, no geometry subscription.
                    highlightRefresh = (): void => {
                        try {
                            highlight.refresh();
                        } catch (error) {
                            void error;
                        }
                    };
                    highlightStop = () => {
                        highlightRefresh = null;
                        try {
                            highlight.stop();
                        } catch (error) {
                            void error;
                        }
                    };
                }
            }
        }
    } catch (error) {
        void error;
    }
    // Initial active-border maximize handoff: narrow public active-window
    // publisher over the same effect-owned endpoint (Set/ClearInitial...
    // methods plus the GetInitialMaximizeEpoch getter). The payload
    // generation carries the effect-issued epoch fetched asynchronously
    // before any publish; Plan/group generation is never touched. Publishes
    // at startup, on active focus changes, and on the focused window's
    // maximizedChanged with exactly one per-window binding. Group ordering
    // stays independent; this handoff carries its own per-epoch revision.
    // Never fails enable: without confirmation both borders stay hidden.
    let initialStop: (() => void) | null = null;
    try {
        const ownerRaw = overrides.owner;
        if (typeof ownerRaw === "string") {
            let effectCall = overrides.highlightCallDbus;
            if (effectCall === undefined) {
                try {
                    const native: unknown = callDBus;
                    if (typeof native === "function") {
                        const bound = native as (...args: ReadonlyArray<unknown>) => void;
                        effectCall = (service, path, iface, method, ...args) => {
                            bound(service, path, iface, method, ...args);
                        };
                    }
                } catch (error) {
                    void error;
                }
            }
            let epochFetch = overrides.initialEpochCallDbus;
            if (epochFetch === undefined) {
                const raw = rawEffectCallDbus();
                if (raw !== null) {
                    const boundRaw = raw;
                    epochFetch = (callback) => {
                        boundRaw(
                            INITIAL_MAXIMIZE_SERVICE,
                            INITIAL_MAXIMIZE_OBJECT,
                            INITIAL_MAXIMIZE_INTERFACE,
                            INITIAL_MAXIMIZE_EPOCH_METHOD,
                            callback,
                        );
                    };
                }
            }
            if (effectCall !== undefined && epochFetch !== undefined) {
                const effect = effectCall;
                const fetch = epochFetch;
                const initial = startInitialMaximize({
                    owner: ownerRaw,
                    getActiveWindow: () => {
                        try {
                            return (liveWorkspace as { activeWindow: unknown }).activeWindow ?? null;
                        } catch (error) {
                            void error;
                            return null;
                        }
                    },
                    setInitial: (payload) => {
                        effect(
                            INITIAL_MAXIMIZE_SERVICE,
                            INITIAL_MAXIMIZE_OBJECT,
                            INITIAL_MAXIMIZE_INTERFACE,
                            INITIAL_MAXIMIZE_SET_METHOD,
                            payload,
                        );
                    },
                    clearInitial: (payload) => {
                        effect(
                            INITIAL_MAXIMIZE_SERVICE,
                            INITIAL_MAXIMIZE_OBJECT,
                            INITIAL_MAXIMIZE_INTERFACE,
                            INITIAL_MAXIMIZE_CLEAR_METHOD,
                            payload,
                        );
                    },
                    fetchEpoch: fetch,
                    subscribeFocus: (handler) => sub("windowActivated", handler),
                    subscribeWindowMaximized: (ref, handler) => {
                        try {
                            return connectSignal(readSignal(ref, "maximizedChanged"), handler);
                        } catch (error) {
                            void error;
                            return null;
                        }
                    },
                    log,
                });
                if (initial !== null) {
                    initialStop = () => {
                        try {
                            initial.stop();
                        } catch (error) {
                            void error;
                        }
                    };
                    initialStopSlot = initialStop;
                }
            }
        }
    } catch (error) {
        void error;
    }
    let optionsConfigDetach: (() => void) | null = null;
    try {
        const optionsGlobal: unknown =
            overrides.options !== undefined ? overrides.options : resolveLexicalOptions();
        if (typeof optionsGlobal === "object" && optionsGlobal !== null) {
            optionsConfigDetach = connectSignal(
                readSignal(optionsGlobal as object, "configChanged"),
                () => {
                    let next: DomainGaps;
                    try {
                        next = readDomainGaps({
                            readInnerGapFn: overrides.readInnerGapFn,
                            readOuterGapFn: overrides.readOuterGapFn,
                        });
                    } catch (error) {
                        void error;
                        return;
                    }
                    if (next.innerGap === domainGaps.innerGap && next.outerGap === domainGaps.outerGap) {
                        return;
                    }
                    domainGaps = next;
                    try {
                        workspaceSend.updateGaps({ innerGap: next.innerGap, outerGap: next.outerGap });
                    } catch (error) {
                        void error;
                    }
                    try {
                        log(
                            `plasma-auto-tiler:plan:config-reloaded innerGap=${String(next.innerGap)} outerGap=${String(next.outerGap)}`,
                        );
                    } catch (error) {
                        void error;
                    }
                    try {
                        adapter.requestResync();
                    } catch (error) {
                        void error;
                    }
                },
            );
        }
    } catch (error) {
        void error;
        optionsConfigDetach = null;
    }
    return {
        stop: () => {
            try {
                adapter.disable();
            } catch (error) {
                void error;
            }
            try {
                workspaceSend.disable();
            } catch (error) {
                void error;
            }
            try {
                workspaceNative.disable();
            } catch (error) {
                void error;
            }
            for (const detach of workspaceDetaches.splice(0)) {
                try { detach(); } catch (error) { void error; }
            }
            workspaceWindowDetaches.clear();
            for (const detach of oracleDetaches) {
                try { detach(); } catch (error) { void error; }
            }
            try {
                for (const pending of [...measurePending.values()]) {
                    dropMeasureWindow(pending.ref);
                }
                measureStarts.clear();
                measureStandaloneClaimed.clear();
            } catch (error) { void error; }
            if (oracleStop !== null) {
                try { oracleStop(); } catch (error) { void error; }
            }
            if (highlightStop !== null) {
                try { highlightStop(); } catch (error) { void error; }
            }
            if (initialStop !== null) {
                try { initialStop(); } catch (error) { void error; }
                initialStopSlot = null;
            }
            if (optionsConfigDetach !== null) {
                try { optionsConfigDetach(); } catch (error) { void error; }
            }
        },
        requestFocus: (direction) => {
            try {
                adapter.requestFocus(direction);
            } catch (error) {
                void error;
            }
        },
        requestMove: (direction) => {
            try {
                adapter.requestMove(direction);
            } catch (error) {
                void error;
            }
        },
        requestResize: (direction, mode) => {
            try {
                adapter.requestResize(direction, mode);
            } catch (error) {
                void error;
            }
        },
        requestFloat: () => {
            try {
                adapter.requestFloat();
            } catch (error) {
                void error;
            }
        },
        requestSticky: () => {
            try {
                adapter.requestSticky();
            } catch (error) {
                void error;
            }
        },
        requestMaximize: () => {
            try {
                adapter.requestMaximize();
            } catch (error) {
                void error;
            }
        },
        requestFullscreen: () => {
            try {
                adapter.requestFullscreen();
            } catch (error) {
                void error;
            }
        },
        requestWorkspaceSelect: (index) => {
            try {
                requestWorkspaceSelect(index);
            } catch (error) {
                void error;
            }
        },
        requestWorkspaceMove: (index) => {
            try {
                requestWorkspaceMove(index);
            } catch (error) {
                void error;
            }
        },
    };
}
