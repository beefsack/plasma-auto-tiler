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
// membership, or rejection policy lives here and no diagnostic beyond the
// adapter's two bounded line shapes plus one bounded shortcut-failed line
// is emitted.

import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "./domain-gap";
import { normalizeNativeId } from "./native-id";
import { PlanAdapter, PlanDirection, PlanObserved, PlanResizeMode, planFingerprint } from "./plan-adapter";
import { connectSignal, readSignal } from "./signal-capability";

export interface PlanEntryOverrides {
    readonly workspace?: unknown;
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

function readFrameRect(ref: object): { x: number; y: number; w: number; h: number } | null {
    const geometry = readProp(ref, "frameGeometry");
    if (typeof geometry !== "object" || geometry === null) {
        return null;
    }
    const record = geometry as Record<string, unknown>;
    const x = toQuantizedInt(record["x"]);
    const y = toQuantizedInt(record["y"]);
    const widthRaw = record["width"] !== undefined ? record["width"] : record["w"];
    const heightRaw = record["height"] !== undefined ? record["height"] : record["h"];
    const w = toQuantizedInt(widthRaw);
    const h = toQuantizedInt(heightRaw);
    if (x === null || y === null || w === null || h === null) {
        return null;
    }
    if (w <= 0 || h <= 0 || x < -16384 || x > 16384 || y < -16384 || y > 16384 || w > 16384 || h > 16384) {
        return null;
    }
    return { x, y, w, h };
}

// Directional shortcut catalog. All three configured profiles share one
// directional core: focus and move on letters plus arrows, resize
// parameterized by direction plus inwards/outwards mode. The profile value
// is validated against the configured catalog names; unknown values fall
// back to the shared core so no unmapped input ever registers.
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

function observeNative(liveWorkspace: unknown, cache: Map<string, string>): PlanObserved | null {
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
        }> = [];
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            // Only normal windows are observed. Every other classification
            // is skipped before the snapshot; Rust owns all remaining policy.
            if (readProp(ref, "normalWindow") !== true) {
                continue;
            }
            const output = readProp(ref, "output");
            if (typeof output !== "object" || output === null) {
                continue;
            }
            const nameRaw = readProp(output as object, "name");
            if (nameRaw !== domainOutput) {
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
            const rect = readFrameRect(ref);
            if (rect === null) {
                return null;
            }
            entries.push({ id, ref, rect, output: domainOutput, workspace: domainWorkspace });
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
                    const fresh = observeNative(liveWorkspace, cache);
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
    // String-keyed native identity cache: normalized internalId to stable
    // plan id (the same normalized string, interned). Never keyed by Window.
    // Eviction is explicit when the adapter identifies a removed string id.
    const nativeIds = new Map<string, string>();
    const adapter = new PlanAdapter({
        callDbus,
        scheduleOnce,
        log,
        observe: () => observeNative(liveWorkspace, nativeIds),
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
            } catch (error) {
                void error;
            }
        },
    });
    const enabled = adapter.enable({ owner: overrides.owner, generation: overrides.generation });
    if (!enabled) {
        return null;
    }
    if (observeNative(liveWorkspace, nativeIds) === null) {
        adapter.disable();
        return null;
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
    return {
        stop: () => {
            try {
                adapter.disable();
            } catch (error) {
                void error;
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
