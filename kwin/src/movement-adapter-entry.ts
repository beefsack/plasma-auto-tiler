// Standalone signal-bound movement entry (opt-in only).
//
// Product-shaped but with no normal startup route: ordinary production
// startup never runs this module (src/entry.ts must not import it, and no
// controller route under src/controller*.ts may import it or reference the
// DescribeMovement route; those constraints are documented here only and the
// unrelated dirty controller files are intentionally untouched). The only
// activation is the explicit exported startMovementAdapterEntry function,
// called by no production source.
//
// Exclusive wiring contract (future, concrete): the caller must supply an
// explicit hasExclusiveMovementAuthority function (never a bare boolean);
// the entry fails closed when it is missing or not a function, threads it
// into the adapter env, and the adapter rechecks it before the request and
// again before native writes. Source tests prove no normal startup import
// and no controller route changes.
//
// The caller supplies an explicit owner/generation pair. At start the entry
// reuses a read-only native observation built from public state only (active
// window, window list, output identity via name, desktop membership, native
// id normalization via String(internalId), frame extents, per-output work
// areas via clientArea, current-workspace output domains with reciprocal
// cardinal adjacency derived live from work-area geometry (edge contact
// plus positive orthogonal overlap). No topology policy is implemented here.
// It subscribes only to minimal public events for invalidation (active,
// added, removed, output, desktop, geometry) with no polling and disconnects
// all of them on stop/disable. Native writes are exact frameGeometry
// rectangles applied only when changed, then focus is restored to the moved
// window. All logs are fixed redacted tokens.

import { MovementAdapter, MovementObserved } from "./movement-adapter";
import { normalizeNativeId } from "./native-id";
import { connectSignal, readSignal } from "./signal-capability";

export interface MovementEntryOverrides {
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
    readonly hasExclusiveMovementAuthority?: () => boolean;
}

export interface MovementEntryHandle {
    readonly stop: () => void;
    readonly request: (direction: unknown) => void;
}

const ENTRY_LOG = "plasma-auto-tiler:movement-entry";
const ENTRY_READY = `${ENTRY_LOG}:ready`;
const ENTRY_REJECT = `${ENTRY_LOG}:reject:movement-entry-invalid`;
const ENTRY_SCOPE_REJECT = `${ENTRY_LOG}:reject:movement-entry-scope-invalid`;
const ENTRY_SCOPE = `${ENTRY_LOG}:scope`;

const MAX_LIST = 1024;
const MAX_SCREENS = 32;
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

function isWorkAreaRect(rect: { x: number; y: number; w: number; h: number }): boolean {
    if (rect.w <= 0 || rect.h <= 0 || rect.w > 16384 || rect.h > 16384) {
        return false;
    }
    if (rect.x < -16384 || rect.x > 16384 || rect.y < -16384 || rect.y > 16384) {
        return false;
    }
    return true;
}

// Bounded reciprocal cardinal output adjacency derived live from
// current-workspace public work-area geometry only (no JS topology): two
// same-workspace domains are adjacent in a cardinal direction when their
// work-area edges touch exactly and their orthogonal spans overlap
// positively. At most one neighbor per direction is admitted; ambiguity
// (two candidates one way), unknown workspaces, or any partial geometry
// fails the whole observation closed.
function deriveAdjacent(
    domains: ReadonlyArray<{ outputName: string; workspaceId: string; bounds: { x: number; y: number; w: number; h: number } }>,
): ReadonlyArray<Readonly<Record<string, string>>> | null {
    const result: Array<Record<string, string>> = domains.map(() => ({}));
    const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
        Math.min(a1, b1) - Math.max(a0, b0);
    for (let a = 0; a < domains.length; a += 1) {
        const left = domains[a] as { outputName: string; workspaceId: string; bounds: { x: number; y: number; w: number; h: number } };
        for (let b = 0; b < domains.length; b += 1) {
            if (a === b) {
                continue;
            }
            const right = domains[b] as { outputName: string; workspaceId: string; bounds: { x: number; y: number; w: number; h: number } };
            if (left.workspaceId !== right.workspaceId) {
                continue;
            }
            const la = left.bounds;
            const lb = right.bounds;
            let direction: string | null = null;
            if (la.x + la.w === lb.x && overlap(la.y, la.y + la.h, lb.y, lb.y + lb.h) > 0) {
                direction = "right";
            } else if (lb.x + lb.w === la.x && overlap(la.y, la.y + la.h, lb.y, lb.y + lb.h) > 0) {
                direction = "left";
            } else if (la.y + la.h === lb.y && overlap(la.x, la.x + la.w, lb.x, lb.x + lb.w) > 0) {
                direction = "down";
            } else if (lb.y + lb.h === la.y && overlap(la.x, la.x + la.w, lb.x, lb.x + lb.w) > 0) {
                direction = "up";
            }
            if (direction === null) {
                continue;
            }
            const slot = result[a] as Record<string, string>;
            const other = result[b] as Record<string, string>;
            const opposite =
                direction === "right" ? "left" : direction === "left" ? "right" : direction === "down" ? "up" : "down";
            if (slot[direction] !== undefined && slot[direction] !== right.outputName) {
                return null;
            }
            if (other[opposite] !== undefined && other[opposite] !== left.outputName) {
                return null;
            }
            slot[direction] = right.outputName;
            other[opposite] = left.outputName;
        }
    }
    return result;
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

function activeIneligibilityCategory(
    ref: object,
    domainOf: (output: unknown) => { readonly desktopRef: object } | undefined,
): string | null {
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
    const domain = domainOf(readProp(ref, "output"));
    if (domain === undefined) {
        return "output";
    }
    const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
    if (membership === null || membership.length !== 1 || membership[0] !== domain.desktopRef) {
        return "desktop";
    }
    return null;
}

function observeNative(liveWorkspace: unknown, log?: (message: string) => void): MovementObserved | null {
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
        const screens = decodeList(readProp(surface, "screens"), MAX_SCREENS);
        if (screens === null || screens.length === 0 || screens.indexOf(activeOutput) < 0) {
            return fail("screens-invalid");
        }
        const currentFn = readProp(surface, "currentDesktopForScreen");
        const areaFn = readProp(surface, "clientArea");
        if (typeof currentFn !== "function" || typeof areaFn !== "function") {
            return fail("scope-fns-missing");
        }
        interface DomainBuild {
            readonly outputName: string;
            readonly workspaceId: string;
            readonly outputRef: object;
            readonly desktopRef: object;
            readonly bounds: { x: number; y: number; w: number; h: number };
        }
        const domains: DomainBuild[] = [];
        const seenPairs = new Set<string>();
        const outputByRef = new Map<unknown, DomainBuild>();
        for (const screen of screens) {
            if (typeof screen !== "object" || screen === null) {
                return fail("screen-invalid");
            }
            const outputRef = screen as object;
            const nameRaw = readProp(outputRef, "name");
            if (!isOpaqueId(nameRaw)) {
                return fail("output-name-invalid");
            }
            const outputName = nameRaw as string;
            let desktop: unknown = undefined;
            try {
                desktop = Reflect.apply(
                    currentFn as (...args: readonly never[]) => unknown,
                    surface,
                    [outputRef],
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
            const workspaceId = desktopIdRaw as string;
            const pair = `${outputName}\x1f${workspaceId}`;
            if (seenPairs.has(pair)) {
                return fail("domain-duplicate");
            }
            seenPairs.add(pair);
            let area: unknown = undefined;
            try {
                area = Reflect.apply(areaFn as (...args: readonly never[]) => unknown, surface, [
                    5,
                    outputRef,
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
            if (!isWorkAreaRect({ x: bx, y: by, w: bw, h: bh })) {
                return fail("work-area-bounds-invalid");
            }
            const built: DomainBuild = {
                outputName,
                workspaceId,
                outputRef,
                desktopRef,
                bounds: { x: bx, y: by, w: bw, h: bh },
            };
            domains.push(built);
            outputByRef.set(outputRef, built);
        }
        // Reciprocal cardinal adjacency is derived live from the observed
        // current-workspace public work areas (edge contact plus positive
        // orthogonal overlap); no JS topology is consulted. Ambiguity or
        // partial geometry rejects the observation.
        const adjacentMaps = deriveAdjacent(domains);
        if (adjacentMaps === null) {
            return fail("adjacency-invalid");
        }
        const activeDomain = outputByRef.get(activeOutput);
        if (activeDomain === undefined) {
            return fail("domain-missing");
        }
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
            const domain = typeof output === "object" && output !== null ? outputByRef.get(output) : undefined;
            if (domain === undefined) {
                continue;
            }
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null || membership.length !== 1 || membership[0] !== domain.desktopRef) {
                continue;
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
            entries.push({ id, ref, rect, output: domain.outputName, workspace: domain.workspaceId });
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
        const ineligible = activeIneligibilityCategory(activeRef, (output) => outputByRef.get(output));
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
        const fingerprint = JSON.stringify({ ids: sortedIds, active: activeId });
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
        const frozenDomains = Object.freeze(
            domains.map((domain, index) =>
                Object.freeze({
                    output: domain.outputName,
                    workspace: domain.workspaceId,
                    bounds: Object.freeze({ ...domain.bounds }),
                    gap: 0,
                    adjacent: Object.freeze({ ...((adjacentMaps[index] as Record<string, string>) ?? {}) }),
                }),
            ),
        );
        const expected = fingerprint;
        const capturedActive = activeRef;
        const capturedOutput = activeDomain.outputRef;
        const capturedDesktop = activeDomain.desktopRef;
        return {
            domainOutput: activeDomain.outputName,
            domainWorkspace: activeDomain.workspaceId,
            focusedId: activeId,
            windows: frozenWindows,
            domains: frozenDomains,
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
                    const liveSurface = liveWorkspace as Record<string, unknown>;
                    const liveActive = Reflect.get(liveSurface, "activeWindow");
                    if (typeof liveActive !== "object" || liveActive === null) {
                        return false;
                    }
                    const liveOutput = Reflect.get(liveActive as object, "output");
                    if (liveOutput !== capturedOutput) {
                        return false;
                    }
                    const liveCurrent = Reflect.get(liveSurface, "currentDesktopForScreen");
                    if (typeof liveCurrent !== "function") {
                        return false;
                    }
                    const liveDesktop = Reflect.apply(
                        liveCurrent as (...args: readonly never[]) => unknown,
                        liveSurface,
                        [capturedOutput],
                    );
                    if (liveDesktop !== capturedDesktop) {
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
export function startMovementAdapterEntry(
    overrides: MovementEntryOverrides = {},
): MovementEntryHandle | null {
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
    if (overrides.hasExclusiveMovementAuthority === undefined) {
        return fail();
    }
    const authority = overrides.hasExclusiveMovementAuthority;
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
    const adapter = new MovementAdapter({
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
        hasExclusiveMovementAuthority: authority,
        subscribe: (kind, handler) => {
            if (kind === "geometry") {
                const detach = subWindowGeometry(handler);
                if (detach === null) {
                    throw new Error("movement-entry-signal-failed");
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
                throw new Error("movement-entry-signal-failed");
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
    return {
        stop: () => {
            try {
                adapter.disable();
            } catch (error) {
                void error;
            }
        },
        request: (direction) => {
            try {
                adapter.requestMovement(direction);
            } catch (error) {
                void error;
            }
        },
    };
}
