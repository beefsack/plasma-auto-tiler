// Standalone signal-bound keyboard resize entry (opt-in only).
//
// Product-shaped but with no normal startup route: ordinary production
// startup never runs this module (src/entry.ts must not import it, and no
// controller route under src/controller*.ts may import it or reference the
// DescribeResize route; those constraints are documented here only and the
// unrelated dirty controller files are intentionally untouched). The only
// activation is the explicit exported startResizeAdapterEntry function,
// called by no production source.
//
// Exclusive wiring contract (future, concrete): the caller must supply an
// explicit hasExclusiveResizeAuthority function (never a bare boolean);
// the entry fails closed when it is missing or not a function, threads it
// into the adapter env, and the adapter rechecks it before the request,
// again before native writes (per write), with the entry requiring it as a
// function. Source tests prove no normal startup import and no controller
// route changes.
//
// The caller supplies an explicit owner/generation pair. At start the entry
// reuses a read-only native observation built from public state only (active
// window, window list, output identity via name, desktop membership, native
// id normalization via String(internalId), frame extents, active-output work
// area via clientArea). Single-domain static resize: every tiled window must
// live in the active domain or the whole observation fails closed. Special
// state (non-normal, unmanaged, minimized, fullscreen, maximized,
// all-desktops, unresizable) is filtered before observation so it can never
// be resized; the focused window must itself be tiled. No topology policy is
// implemented here. It subscribes only to minimal public events for
// invalidation (active, added, removed, output, desktop, geometry) with no
// polling and disconnects all of them on stop/disable. Native writes are
// exact frameGeometry rectangles applied only when changed, then focus is
// retained on the focused window. All logs are fixed redacted tokens.

import { ResizeAdapter, ResizeObserved, resizeFingerprint } from "./resize-adapter";
import { formatRouteDiag } from "./route-diag";
import { connectSignal, readSignal } from "./signal-capability";

export interface ResizeEntryOverrides {
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
    readonly revision?: unknown;
    readonly hasExclusiveResizeAuthority?: () => boolean;
}

export interface ResizeEntryHandle {
    readonly stop: () => void;
    readonly request: (direction: unknown, mode: unknown) => void;
    // One-shot exact-three adoption, invoked by the authority dispatcher
    // after all four slices are active. Observes public state only and, for
    // exactly three eligible windows, aligns the deterministic focus target
    // natively and issues one canonical keyboard resize through the normal
    // adapter flight so seeding plus projection flow through the public
    // plan, direct geometry, acknowledgement, and post-observation contract.
    // Fail closed: anything ineligible or stale skips silently.
    readonly tryBootstrapTrio?: () => void;
}

const ENTRY_LOG = "plasma-auto-tiler:resize-entry";
const ENTRY_READY = `${ENTRY_LOG}:ready`;
const ENTRY_REJECT = `${ENTRY_LOG}:reject:resize-entry-invalid`;
const ENTRY_SCOPE_REJECT = `${ENTRY_LOG}:reject:resize-entry-scope-invalid`;
const ENTRY_SCOPE = `${ENTRY_LOG}:scope`;
const ENTRY_BOOTSTRAP = `${ENTRY_LOG}:bootstrap-trio`;

// Fresh shared-revision holder: exactly `{ current: 0 }`, meaning no slice
// has transacted yet and the Rust trio is unseeded. Anything else (a number,
// undefined, or an advanced holder) skips adoption.
function isFreshRevisionHolder(value: unknown): value is { current: number } {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return (value as Record<string, unknown>)["current"] === 0;
}

function rectContained(
    inner: { x: number; y: number; w: number; h: number },
    outer: { x: number; y: number; w: number; h: number },
): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.w <= outer.x + outer.w &&
        inner.y + inner.h <= outer.y + outer.h
    );
}

// Skip category for the exact-three adoption, mirroring
// trioBootstrapTarget below. Count only, never identities or geometry.
function trioBootstrapSkipReason(observed: ResizeObserved): string {
    try {
        if (observed.windows.length !== 3) {
            return "non-three";
        }
        const sorted = [...observed.windows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const middle = sorted[1];
        const last = sorted[2];
        if (middle === undefined || last === undefined) {
            return "unknown";
        }
        if (!(middle.rect.w > middle.rect.h)) {
            return "middle-not-wide";
        }
        if (!(last.rect.w <= last.rect.h)) {
            return "last-not-tall";
        }
        return "uncontained";
    } catch (error) {
        void error;
        return "unknown";
    }
}
// Exact-three adoption target from a live observation: exactly three
// eligible windows in the single active domain with real contained rects,
// where the sorted middle window is wide and the sorted last window is
// tall-or-tie. The wide/tall rule mirrors the portable COSMIC admission
// axis (wide splits Horizontal, otherwise Vertical) so the Rust seed binds
// the deterministic H[A,V[B,C]] shape; anything else fails closed.
function trioBootstrapTarget(observed: ResizeObserved): { ref: object } | null {
    try {
        if (observed.windows.length !== 3) {
            return null;
        }
        const sorted = [...observed.windows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const first = sorted[0] as ResizeObserved["windows"][number];
        const middle = sorted[1] as ResizeObserved["windows"][number];
        const last = sorted[2] as ResizeObserved["windows"][number];
        if (first === undefined || middle === undefined || last === undefined) {
            return null;
        }
        if (!(middle.rect.w > middle.rect.h)) {
            return null;
        }
        if (!(last.rect.w <= last.rect.h)) {
            return null;
        }
        for (const entry of sorted) {
            if (!rectContained(entry.rect, observed.domainBounds)) {
                return null;
            }
        }
        return { ref: last.ref };
    } catch (error) {
        void error;
        return null;
    }
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

function isHexRun(text: string): boolean {
    if (text.length === 0) {
        return false;
    }
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        const digit = code >= 48 && code <= 57;
        const lower = code >= 97 && code <= 102;
        const upper = code >= 65 && code <= 70;
        if (!(digit || lower || upper)) {
            return false;
        }
    }
    return true;
}

function isUuidText(text: string): boolean {
    const parts = text.split("-");
    const lens: readonly number[] = [8, 4, 4, 4, 12];
    if (parts.length !== lens.length) {
        return false;
    }
    for (let index = 0; index < lens.length; index += 1) {
        const part = parts[index] as string;
        if (part.length !== (lens[index] as number) || !isHexRun(part)) {
            return false;
        }
    }
    return true;
}

function unwrapBraced(text: string): string | null {
    if (text.length !== 38 || !text.startsWith("{") || !text.endsWith("}")) {
        return null;
    }
    const inner = text.slice(1, 37);
    if (!isUuidText(inner) || !isOpaqueId(inner)) {
        return null;
    }
    return inner;
}

function normalizeNativeId(value: unknown): string | null {
    if (typeof value === "string") {
        if (isOpaqueId(value)) {
            return value;
        }
        return unwrapBraced(value);
    }
    let text = "";
    try {
        text = String(value);
    } catch (error) {
        void error;
        return null;
    }
    if (isOpaqueId(text)) {
        return text;
    }
    return unwrapBraced(text);
}

function decodeList(value: unknown, maxLength: number): readonly unknown[] | null {
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

function activeIneligibilityCategory(ref: object, domainOutput: string, desktopRef: object): string | null {
    if (readProp(ref, "normalWindow") !== true) {
        return "class";
    }
    if (readProp(ref, "managed") !== true) {
        return "managed";
    }
    if (readProp(ref, "minimized") !== false) {
        return "minimized";
    }
    if (readProp(ref, "fullScreen") !== false) {
        return "fullscreen";
    }
    if (readProp(ref, "maximizeMode") !== 0) {
        return "maximized";
    }
    if (readProp(ref, "onAllDesktops") !== false) {
        return "all-desktops";
    }
    if (readProp(ref, "resizeable") === false) {
        return "normal-resizable";
    }
    const output = readProp(ref, "output");
    if (typeof output !== "object" || output === null) {
        return "output";
    }
    const nameRaw = readProp(output, "name");
    if (!isOpaqueId(nameRaw) || (nameRaw as string) !== domainOutput) {
        return "output";
    }
    const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
    if (membership === null || membership.length !== 1 || membership[0] !== desktopRef) {
        return "desktop";
    }
    return null;
}

function observeNative(liveWorkspace: unknown, log?: (message: string) => void): ResizeObserved | null {
    const fail = (predicate: string): null => {
        try {
            log?.(`${ENTRY_SCOPE}:${predicate}`);
        } catch (error) {
            void error;
        }
        return null;
    };
    try {
        if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
            return fail("workspace-invalid");
        }
        const surface = liveWorkspace as Record<string, unknown>;
        let active: unknown = undefined;
        try {
            active = Reflect.get(surface, "activeWindow");
        } catch (error) {
            void error;
            return fail("active-read-failed");
        }
        if (typeof active !== "object" || active === null) {
            return fail("active-invalid");
        }
        const activeRef = active as object;
        const activeOutput = readProp(activeRef, "output");
        if (typeof activeOutput !== "object" || activeOutput === null) {
            return fail("output-invalid");
        }
        const lister = readProp(surface, "windowList");
        if (typeof lister !== "function") {
            return fail("window-list-missing");
        }
        let rawList: unknown = undefined;
        try {
            rawList = Reflect.apply(lister as (...args: readonly never[]) => unknown, surface, []);
        } catch (error) {
            void error;
            return fail("window-list-failed");
        }
        const windows = decodeList(rawList, MAX_LIST);
        if (windows === null) {
            return fail("window-list-invalid");
        }
        const currentFn = readProp(surface, "currentDesktopForScreen");
        const areaFn = readProp(surface, "clientArea");
        if (typeof currentFn !== "function" || typeof areaFn !== "function") {
            return fail("scope-fns-missing");
        }
        const outputNameRaw = readProp(activeOutput, "name");
        if (!isOpaqueId(outputNameRaw)) {
            return fail("output-name-invalid");
        }
        const domainOutput = outputNameRaw as string;
        let desktop: unknown = undefined;
        try {
            desktop = Reflect.apply(
                currentFn as (...args: readonly never[]) => unknown,
                surface,
                [activeOutput],
            );
        } catch (error) {
            void error;
            return fail("desktop-read-failed");
        }
        if (typeof desktop !== "object" || desktop === null) {
            return fail("desktop-invalid");
        }
        const desktopRef = desktop as object;
        const desktopIdRaw = readProp(desktopRef, "id");
        if (!isOpaqueId(desktopIdRaw)) {
            return fail("workspace-id-invalid");
        }
        const domainWorkspace = desktopIdRaw as string;
        let area: unknown = undefined;
        try {
            area = Reflect.apply(areaFn as (...args: readonly never[]) => unknown, surface, [
                5,
                activeOutput,
                desktopRef,
            ]);
        } catch (error) {
            void error;
            return fail("work-area-failed");
        }
        if (typeof area !== "object" || area === null) {
            return fail("work-area-invalid");
        }
        const areaRecord = area as Record<string, unknown>;
        const bx = toQuantizedInt(areaRecord["x"]);
        const by = toQuantizedInt(areaRecord["y"]);
        const bwRaw = areaRecord["width"] !== undefined ? areaRecord["width"] : areaRecord["w"];
        const bhRaw = areaRecord["height"] !== undefined ? areaRecord["height"] : areaRecord["h"];
        const bw = toQuantizedInt(bwRaw);
        const bh = toQuantizedInt(bhRaw);
        if (bx === null || by === null || bw === null || bh === null) {
            return fail("work-area-coords-invalid");
        }
        if (bw <= 0 || bh <= 0 || bw > 16384 || bh > 16384 || bx < -16384 || bx > 16384 || by < -16384 || by > 16384) {
            return fail("work-area-bounds-invalid");
        }
        const domainBounds = { x: bx, y: by, w: bw, h: bh };
        const seen = new Set<string>();
        const entries: Array<{ id: string; ref: object; rect: { x: number; y: number; w: number; h: number }; output: string; workspace: string }> = [];
        for (const item of windows) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const ref = item as object;
            if (readProp(ref, "normalWindow") !== true) {
                continue;
            }
            if (readProp(ref, "managed") !== true) {
                continue;
            }
            if (readProp(ref, "minimized") !== false) {
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
            const resizeable = readProp(ref, "resizeable");
            if (resizeable === false) {
                continue;
            }
            const output = readProp(ref, "output");
            if (typeof output !== "object" || output === null) {
                continue;
            }
            const nameRaw = readProp(output, "name");
            if (!isOpaqueId(nameRaw)) {
                return fail("output-name-invalid");
            }
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null || membership.length !== 1) {
                continue;
            }
            if (membership[0] !== desktopRef) {
                // Single-domain static resize: a tiled window on another
                // desktop fails the whole observation closed rather than
                // being silently dropped as a partial observation.
                return fail("desktop-scope-mismatch");
            }
            if ((nameRaw as string) !== domainOutput) {
                return fail("output-scope-mismatch");
            }
            let id: string | null = null;
            try {
                id = normalizeNativeId(Reflect.get(ref, "internalId"));
            } catch (error) {
                void error;
                return fail("id-read-failed");
            }
            if (id === null) {
                return fail("id-invalid");
            }
            if (seen.has(id)) {
                return fail("id-duplicate");
            }
            seen.add(id);
            const rect = readFrameRect(ref);
            if (rect === null) {
                return fail("frame-invalid");
            }
            entries.push({ id, ref, rect, output: domainOutput, workspace: domainWorkspace });
        }
        if (entries.length === 0) {
            return fail("empty-scope");
        }
        const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        let activeNativeId: string | null = null;
        try {
            activeNativeId = normalizeNativeId(Reflect.get(activeRef, "internalId"));
        } catch (error) {
            void error;
            return fail("active-unobserved:active-id-invalid");
        }
        if (activeNativeId === null) {
            return fail("active-unobserved:active-id-invalid");
        }
        const ineligible = activeIneligibilityCategory(activeRef, domainOutput, desktopRef);
        if (ineligible !== null) {
            return fail(`active-unobserved:active-ineligible:${ineligible}`);
        }
        let activeId: string | null = null;
        for (const entry of sorted) {
            if (entry.id === activeNativeId) {
                activeId = entry.id;
                if (entry.ref !== activeRef) {
                    try {
                        log?.(`${ENTRY_SCOPE}:active-wrapper-mismatch`);
                    } catch (error) {
                        void error;
                    }
                }
                break;
            }
        }
        if (activeId === null) {
            return fail("active-unobserved:active-missing");
        }
        const sortedIds = sorted.map((entry) => entry.id);
        // One canonical fingerprint: the numeric wire binding
        // (resizeFingerprint) carried as a string for the native cache, so
        // dedup, revalidation, and the Rust wire contract all bind the same
        // value instead of maintaining a separate JSON cache identity.
        const fingerprint = String(
            resizeFingerprint(domainOutput, domainWorkspace, activeId, sortedIds),
        );
        const frozenWindows = Object.freeze(
            sorted.map((entry) =>
                Object.freeze({
                    id: entry.id,
                    ref: entry.ref,
                    rect: Object.freeze({ ...entry.rect }),
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
            domainBounds: Object.freeze({ ...domainBounds }),
            domainGap: 0,
            focusedId: activeId,
            windows: frozenWindows,
            activeRef,
            fingerprint: expected,
            revalidate: () => {
                try {
                    const fresh = observeNative(liveWorkspace, log);
                    if (fresh === null) {
                        return false;
                    }
                    if (fresh.fingerprint !== expected) {
                        return false;
                    }
                    if (fresh.activeRef !== capturedActive) {
                        return false;
                    }
                    for (const entry of frozenWindows) {
                        const match = fresh.windows.find((item) => item.id === entry.id);
                        if (match === undefined || match.ref !== entry.ref) {
                            return false;
                        }
                        if (
                            match.rect.x !== entry.rect.x ||
                            match.rect.y !== entry.rect.y ||
                            match.rect.w !== entry.rect.w ||
                            match.rect.h !== entry.rect.h
                        ) {
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
        return fail("observe-failed");
    }
}

// Explicit opt-in activation only; called by no production source. Returns a
// stop handle on success, null fail-closed after logging one fixed token.
export function startResizeAdapterEntry(
    overrides: ResizeEntryOverrides = {},
): ResizeEntryHandle | null {
    const liveWorkspace: unknown =
        overrides.workspace !== undefined ? overrides.workspace : resolveLexicalWorkspace();
    const log = overrides.log ?? ((message: string): void => {
        try {
            console.log(message);
        } catch (error) {
            void error;
        }
    });
    const fail = (): null => {
        try {
            log(ENTRY_REJECT);
        } catch (error) {
            void error;
        }
        return null;
    };
    if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
        return fail();
    }
    if (overrides.hasExclusiveResizeAuthority === undefined) {
        return fail();
    }
    const authority = overrides.hasExclusiveResizeAuthority;
    if (typeof authority !== "function") {
        return fail();
    }
    let callDbus = overrides.callDbus;
    if (callDbus === undefined) {
        try {
            const native: unknown = callDBus;
            if (typeof native !== "function") {
                return fail();
            }
            callDbus = (service, path, iface, method, payload, callback) => {
                // Exact session activation: StartServiceByName(service, 0) is
                // the only two-argument daemon call; the adapter passes the
                // well-known Planner name as payload with fixed flags 0.
                if (
                    service === "org.freedesktop.DBus" &&
                    method === "StartServiceByName"
                ) {
                    (native as (...args: readonly unknown[]) => void)(
                        service,
                        path,
                        iface,
                        method,
                        payload,
                        0,
                        callback,
                    );
                    return;
                }
                (native as (...args: readonly unknown[]) => void)(
                    service,
                    path,
                    iface,
                    method,
                    payload,
                    callback,
                );
            };
        } catch (error) {
            void error;
            return fail();
        }
    }
    let scheduleOnce = overrides.scheduleOnce;
    if (scheduleOnce === undefined) {
        try {
            const ctor: unknown = QTimer;
            if (typeof ctor !== "function") {
                return fail();
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
            return fail();
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
                raw = Reflect.apply(lister as (...args: readonly never[]) => unknown, surface, []);
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
            // Fail closed when no native geometry signal could be connected:
            // without at least one live geometry subscription the adapter
            // would run with a snapshot-only blind spot.
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
    const adapter = new ResizeAdapter({
        callDbus,
        scheduleOnce,
        log,
        observe: () => observeNative(liveWorkspace, log),
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
        hasExclusiveResizeAuthority: authority,
        subscribe: (kind, handler) => {
            if (kind === "geometry") {
                const detach = subWindowGeometry(handler);
                if (detach === null) {
                    throw new Error("resize-entry-signal-failed");
                }
                return detach;
            }
            const name =
                kind === "active"
                    ? "windowActivated"
                    : kind === "added"
                      ? "windowAdded"
                      : kind === "removed"
                        ? "windowRemoved"
                        : kind === "output"
                          ? "screensChanged"
                          : "currentDesktopChanged";
            const detach = sub(name, handler);
            if (detach === null) {
                throw new Error("resize-entry-signal-failed");
            }
            return detach;
        },
    });
    const enabled = adapter.enable({
        owner: overrides.owner,
        generation: overrides.generation,
        revision: overrides.revision,
    });
    if (!enabled) {
        return null;
    }
    if (observeNative(liveWorkspace, log) === null) {
        adapter.disable();
        try {
            log(ENTRY_SCOPE_REJECT);
        } catch (error) {
            void error;
        }
        return null;
    }
    try {
        log(ENTRY_READY);
    } catch (error) {
        void error;
    }
    const tryBootstrapTrio = (): void => {
        try {
            // Single-shot adoption: only a fresh shared holder may seed, so
            // an established or foreign revision never re-seeds.
            if (!isFreshRevisionHolder(overrides.revision)) {
                try {
                    log(
                        formatRouteDiag("scope", [
                            ["count", -1],
                            ["decision", "skip"],
                            ["reason", "stale-holder"],
                        ]),
                    );
                } catch (error) {
                    void error;
                }
                return;
            }
            const observed = observeNative(liveWorkspace, log);
            if (observed === null) {
                try {
                    log(
                        formatRouteDiag("scope", [
                            ["count", -1],
                            ["decision", "skip"],
                            ["reason", "no-scope"],
                        ]),
                    );
                } catch (error) {
                    void error;
                }
                return;
            }
            const target = trioBootstrapTarget(observed);
            if (target === null) {
                // Exact-three scope validation: window count only plus the
                // fixed skip category. Never identities or geometry.
                try {
                    log(
                        formatRouteDiag("scope", [
                            ["count", observed.windows.length],
                            ["decision", "skip"],
                            ["reason", trioBootstrapSkipReason(observed)],
                        ]),
                    );
                } catch (error) {
                    void error;
                }
                return;
            }
            // Deterministic focus alignment through public state: the Rust
            // seed always focuses the sorted-last window, so the canonical
            // intent below must start there. Native activation only; the
            // projection itself flows through the adapter flight.
            try {
                const surface = liveWorkspace as { activeWindow: unknown };
                if (surface.activeWindow !== target.ref) {
                    surface.activeWindow = target.ref;
                }
            } catch (error) {
                void error;
                return;
            }
            adapter.requestResize("up", "inwards");
            try {
                log(ENTRY_BOOTSTRAP);
            } catch (error) {
                void error;
            }
            try {
                log(
                    formatRouteDiag("scope", [
                        ["count", 3],
                        ["decision", "adopt"],
                    ]),
                );
            } catch (error) {
                void error;
            }
        } catch (error) {
            void error;
        }
    };
    return {
        stop: () => {
            try {
                adapter.disable();
            } catch (error) {
                void error;
            }
        },
        request: (direction, mode) => {
            try {
                adapter.requestResize(direction, mode);
            } catch (error) {
                void error;
            }
        },
        tryBootstrapTrio,
    };
}
