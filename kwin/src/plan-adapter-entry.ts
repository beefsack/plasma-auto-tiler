// Live KWin wiring for the bounded Stage 4 DescribePlan adapter.
//
// Production startup route: src/entry.ts calls startPlanAdapterEntry with the
// fixed session owner/generation. Observation is read-only public state only
// (active window, window list, output names, desktop membership, normalized
// native ids, quantized frame extents, active-output work area). Only
// normal windows are observed; every other window kind is skipped before the
// snapshot so it can never be sent, and Rust owns all remaining policy. The
// single D-Bus transport is DescribePlan carrying one JSON string; no other
// method is invoked. Reply geometries are applied by the adapter in the
// shared canonical order. Directional focus/move shortcuts and
// direction-plus-mode resize shortcuts from the configured profile catalog
// map to parameterized plan commands. Window and scope signals feed one
// debounced fresh-snapshot resync owned by the adapter. No tiling, order,
// membership, or rejection policy lives here. Diagnostics are always-on and
// bounded: the adapter's cmd route entry/terminal, rejected-kind, per-member
// write, scope-transition, echo-fence, and refusal lines, plus one bounded
// shortcut-failed line and one bounded plan-ready startup line.

import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "./domain-gap";
import { deriveOracleEdge, startDragOraclePullEntry, DragOracleFinishContext, DragOracleVerdict } from "./drag-oracle-pull";
import { normalizeNativeId } from "./native-id";
import { PlanAdapter, PlanDirection, PlanObserved, PlanResizeMode, planFingerprint } from "./plan-adapter";
import { PLAN_SOURCE_REV } from "./source-rev";
import { connectSignal, readSignal } from "./signal-capability";

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
}

export interface PlanEntryHandle {
    readonly stop: () => void;
    readonly requestFocus: (direction: unknown) => void;
    readonly requestMove: (direction: unknown) => void;
    readonly requestResize: (direction: unknown, mode: unknown) => void;
}

export interface PlanShortcutRow {
    readonly action: string;
    readonly text: string;
    readonly sequence: string;
    readonly op: "focus" | "move" | "resize";
    readonly direction: PlanDirection;
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
            area = Reflect.apply(areaFn as (...args: ReadonlyArray<never>) => unknown, surface, [
                5,
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
            if (!onDesktop) {
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
                }),
            ),
        );
        const expected = fingerprint;
        const capturedActive = activeRef;
        return {
            domainOutput,
            domainWorkspace,
            domainBounds: Object.freeze({ x: domainBounds.x, y: domainBounds.y, w: domainBounds.w, h: domainBounds.h }),
            domainGap: DOMAIN_GAP,
            domainOuterGap: OUTER_DOMAIN_GAP,
            focusedId: activeId,
            windows: frozenWindows,
            activeRef: activeRef,
            fingerprint: expected,
            revalidate: () => {
                try {
                    const fresh = observeNative(liveWorkspace, cache, reportEligibility);
                    if (fresh === null || fresh.fingerprint !== expected || fresh.activeRef !== capturedActive) {
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
            for (const item of list) {
                if (typeof item !== "object" || item === null) {
                    continue;
                }
                const detach = connectSignal(readSignal(item, "moveResizedChanged"), handler);
                if (detach === null) {
                    continue;
                }
                detaches.push(detach);
            }
            const addedDetach = connectSignal(readSignal(surface, "windowAdded"), () => {
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
    // Hard per-window maximize-state subscription. Mirrors the fullscreen
    // machinery (windowAdded subscribes the new window, windowRemoved detaches
    // the removed window) but is a startup requirement: every eligible observed
    // normal window must expose a connectable `maximizedChanged` signal or the
    // attachment refuses fail-closed with an exact maximize-specific token
    // rather than silently running unobservant of maximize state. Unlike
    // best-effort fullscreen, an individual eligible normal window that lacks
    // the signal is never skipped, and a window added after enable that lacks
    // it fails the adapter closed instead of leaving it blind.
    const subWindowMaximize = (handler: () => void): (() => void) | null => {
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
            // a connectable `maximizedChanged`; non-normal windows are never
            // observed so a missing signal there is skipped like fullscreen.
            const connectOne = (ref: object): boolean => {
                if (seen.has(ref)) {
                    return true;
                }
                const detach = connectSignal(readSignal(ref, "maximizedChanged"), handler);
                if (detach === null) {
                    return readProp(ref, "normalWindow") !== true;
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
                        log("plasma-auto-tiler:plan:maximize-refused-signal");
                    } catch (error) {
                        void error;
                    }
                    detachAll();
                    try {
                        adapter.disable();
                    } catch (error) {
                        void error;
                    }
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
    const eligibilityReasons = new Map<string, string>();
    const reportEligibility: EligibilityReporter = (ref, reason): void => {
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
    const adapter = new PlanAdapter({
        callDbus,
        scheduleOnce,
        log,
        observe: () => observeNative(liveWorkspace, nativeIds, reportEligibility),
        setGeometry: (target, rect) => {
            try {
                Reflect.set(target, "frameGeometry", {
                    x: rect.x,
                    y: rect.y,
                    width: rect.w,
                    height: rect.h,
                });
                return true;
            } catch (error) {
                void error;
                return false;
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
                const detach = subWindowMaximize(handler);
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
    if (observeNative(liveWorkspace, nativeIds, reportEligibility) === null) {
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
                      : registerFn(action, text, sequence, () => adapter.requestFocus(direction));
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
    // Slice 2 oracle route: preserve start rect plus move/resize classification
    // at Started, then on a non-cancelled LastVerdict route exactly one strict
    // pointer-resize derived from the authoritative final rect. Cancelled is a
    // strict no-op; derive failures fail closed with exact bounded reasons.
    // Every finish carries an opaque per-finish token (exact Window object
    // plus finish epoch) from its signal through the D-Bus pull back to the
    // route/settle callbacks. Route/settle consume only a start whose epoch
    // is <= that finish token; an old reply faced with a newer start fails
    // closed and never clears the newer start. Cancelled verdicts never reach
    // the pointer route and never change a share.
    const oracleStarts = new Map<object, { id: string; rect: { x: number; y: number; w: number; h: number }; move: boolean; resize: boolean; epoch: number }>();
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
            const observed = observeNative(liveWorkspace, nativeIds, reportEligibility);
            if (observed === null) return;
            for (const entry of observed.windows) {
                if (entry.ref === ref) {
                    const state = readLiveState(ref);
                    if (state === null) {
                        oracleStarts.delete(ref);
                        return;
                    }
                    oracleStarts.set(ref, { id: entry.id, rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h }, move: state.move, resize: state.resize, epoch: (oracleEpoch += 1) });
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
    const takeOwnStart = (ctx: DragOracleFinishContext | undefined): { id: string; rect: { x: number; y: number; w: number; h: number }; move: boolean; resize: boolean } | null => {
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
    // Finish-token completion: runs after every parsed verdict (including
    // cancelled) and for invalid/unavailable replies (null). Consumes only
    // its own finish's associated start without routing, logging, or
    // touching DescribePlan.
    const settleOracleVerdict = (verdict: DragOracleVerdict | null, ctx: DragOracleFinishContext | undefined): void => {
        try {
            void verdict;
            takeOwnStart(ctx);
        } catch (error) {
            void error;
        }
    };
    const routeOracleVerdict = (verdict: DragOracleVerdict, ctx: DragOracleFinishContext | undefined): void => {
        try {
            if (ctx === undefined) {
                try { log("plasma-auto-tiler:route-diag:drag-context-invalid"); } catch (error) { void error; }
                return;
            }
            const observed = observeNative(liveWorkspace, nativeIds, reportEligibility);
            if (observed === null) {
                takeOwnStart(ctx);
                try { log("plasma-auto-tiler:route-diag:drag-scope-invalid"); } catch (error) { void error; }
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
                try { log("plasma-auto-tiler:route-diag:drag-unknown-window"); } catch (error) { void error; }
                return;
            }
            if (ref !== ctx.ref) {
                takeOwnStart(ctx);
                try { log("plasma-auto-tiler:route-diag:drag-ref-mismatch"); } catch (error) { void error; }
                return;
            }
            const start = takeOwnStart(ctx);
            if (start === null || start.id !== verdict.windowIdentity) {
                try { log("plasma-auto-tiler:route-diag:drag-start-missing"); } catch (error) { void error; }
                return;
            }
            if (start.move === true) {
                try { log("plasma-auto-tiler:route-diag:drag-move-ignored"); } catch (error) { void error; }
                return;
            }
            if (!(start.move === false && start.resize === true)) {
                try { log("plasma-auto-tiler:route-diag:drag-start-invalid"); } catch (error) { void error; }
                return;
            }
            const edge = deriveOracleEdge(start.rect, verdict.finalRect);
            if (edge === null || edge === "mixed") {
                try { log("plasma-auto-tiler:route-diag:drag-edge-invalid"); } catch (error) { void error; }
                return;
            }
            // The adapter emits its exact source-grounded refusal token for
            // every distinct failure cause (disabled, identity, direction,
            // boundary, observation failure, absent target, fullscreen or
            // maximized target). No catch-all pointer-refused line is added here.
            adapter.requestPointerResize(verdict.windowIdentity, edge.direction, edge.boundary);
        } catch (error) {
            void error;
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
            oracleSeen.delete(ref);
        } catch (error) {
            void error;
        }
    };
    const attachOracleStartOne = (ref: object): void => {
        if (oracleSeen.has(ref)) return;
        let started: unknown = null;
        try {
            started = readSignal(ref, "interactiveMoveResizeStarted");
        } catch (error) { void error; return; }
        let startedDetach: (() => void) | null = null;
        try {
            startedDetach = connectSignal(started, () => {
                try { captureOracleStart(ref); } catch (error) { void error; }
            });
            if (startedDetach === null) return;
        } catch (error) { void error; return; }
        if (startedDetach === null) return;
        oracleSeen.add(ref);
        trackOracleDetach(ref, startedDetach);
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
                ? { workspace: liveWorkspace, log, routePointer: routeOracleVerdict, onSettled: settleOracleVerdict, makeFinishContext: makeOracleFinishContext }
                : { workspace: liveWorkspace, log, callDbus: overrides.oracleCallDbus, routePointer: routeOracleVerdict, onSettled: settleOracleVerdict, makeFinishContext: makeOracleFinishContext };
        const oracleHandle = startDragOraclePullEntry(oracleOverrides);
        if (oracleHandle !== null) oracleStop = () => { try { oracleHandle.stop(); } catch (error) { void error; } };
    } catch (error) { void error; }
    return {
        stop: () => {
            try {
                adapter.disable();
            } catch (error) {
                void error;
            }
            for (const detach of oracleDetaches) {
                try { detach(); } catch (error) { void error; }
            }
            if (oracleStop !== null) {
                try { oracleStop(); } catch (error) { void error; }
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
    };
}
