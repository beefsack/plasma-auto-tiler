// Standalone signal-bound focus entry (opt-in only).
//
// Product-shaped but with no normal startup route: ordinary production
// startup never runs this module (src/entry.ts must not import it, and no
// controller route under src/controller*.ts may import it or reference the
// DescribeFocus route; those constraints are documented here only and the
// unrelated dirty controller files are intentionally untouched). The only
// activation is the explicit exported startFocusAdapterEntry function, called
// by no production source.
//
// Exclusive wiring contract (future, concrete): the caller must supply an
// explicit hasExclusiveFocusAuthority function (never a bare boolean);
// the entry fails closed when it is missing or not a function, threads it
// into the adapter env, and the adapter rechecks it before the single native
// write. Source tests prove no normal startup import and no controller route
// changes.
//
// The caller supplies an explicit hasExclusiveFocusAuthority boundary proving
// no prior handler runs in the same call, plus an explicit owner/generation
// pair. At start the entry reuses a read-only native observation built from
// public state only (active window, window list, output identity, desktop
// membership, native id normalization) and binds the adapter through the
// injected env seam. It subscribes only to minimal public events for
// invalidation (active, added, removed, output, desktop) with no polling and
// disconnects all of them on stop/disable. The single native write is the
// active-window write owned by the adapter. All logs are fixed redacted
// tokens.

import { FocusAdapter, FocusObserved } from "./focus-adapter";
import { connectSignal, readSignal } from "./signal-capability";

export interface FocusEntryOverrides {
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
    readonly hasExclusiveFocusAuthority?: () => boolean;
}

export interface FocusEntryHandle {
    readonly stop: () => void;
    readonly request: (direction: unknown) => void;
}

const ENTRY_LOG = "plasma-auto-tiler:focus-entry";
const ENTRY_READY = `${ENTRY_LOG}:ready`;
const ENTRY_REJECT = `${ENTRY_LOG}:reject:focus-entry-invalid`;
const ENTRY_SIGNAL_REJECT = `${ENTRY_LOG}:reject:focus-entry-signal-failed`;

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

function observeNative(liveWorkspace: unknown): FocusObserved | null {
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
        const activeOutput = readProp(activeRef, "output");
        if (typeof activeOutput !== "object" || activeOutput === null) {
            return null;
        }
        const outputRef = activeOutput as object;
        const lister = readProp(surface, "windowList");
        if (typeof lister !== "function") {
            return null;
        }
        let rawList: unknown = undefined;
        try {
            rawList = Reflect.apply(lister as (...args: readonly never[]) => unknown, surface, []);
        } catch (error) {
            void error;
            return null;
        }
        const windows = decodeList(rawList, MAX_LIST);
        if (windows === null) {
            return null;
        }
        const screens = decodeList(readProp(surface, "screens"), MAX_SCREENS);
        if (screens === null || screens.indexOf(outputRef) < 0) {
            return null;
        }
        const currentFn = readProp(surface, "currentDesktopForScreen");
        if (typeof currentFn !== "function") {
            return null;
        }
        let desktop: unknown = undefined;
        try {
            desktop = Reflect.apply(
                currentFn as (...args: readonly never[]) => unknown,
                surface,
                [outputRef],
            );
        } catch (error) {
            void error;
            return null;
        }
        if (typeof desktop !== "object" || desktop === null) {
            return null;
        }
        const desktopRef = desktop as object;
        const seen = new Set<string>();
        const entries: Array<{ id: string; ref: object }> = [];
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
            if (readProp(ref, "output") !== outputRef) {
                continue;
            }
            const membership = decodeList(readProp(ref, "desktops"), MAX_DESKTOPS);
            if (membership === null || membership.length !== 1 || membership[0] !== desktopRef) {
                continue;
            }
            let id: string | null = null;
            try {
                id = normalizeNativeId(Reflect.get(ref, "internalId"));
            } catch (error) {
                void error;
                return null;
            }
            if (id === null || seen.has(id)) {
                return null;
            }
            seen.add(id);
            entries.push({ id, ref });
        }
        if (entries.length === 0) {
            return null;
        }
        const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        let activeId: string | null = null;
        for (const entry of sorted) {
            if (entry.ref === activeRef) {
                activeId = entry.id;
                break;
            }
        }
        if (activeId === null) {
            return null;
        }
        const sortedIds = sorted.map((entry) => entry.id);
        const fingerprint = JSON.stringify({ ids: sortedIds, active: activeId });
        const byId = new Map<string, object>();
        for (const entry of sorted) {
            byId.set(entry.id, entry.ref);
        }
        const frozenWindows = Object.freeze(
            sorted.map((entry) => Object.freeze({ id: entry.id, ref: entry.ref })),
        );
        const expected = fingerprint;
        const capturedOutput = outputRef;
        const capturedDesktop = desktopRef;
        const capturedActive = activeRef;
        const capturedRefs = new Map(byId);
        return {
            domainOutput: "focus-output",
            domainWorkspace: "focus-workspace",
            focusedId: activeId,
            windows: frozenWindows,
            activeRef: activeRef,
            fingerprint: expected,
            revalidate: () => {
                try {
                    const fresh = observeNative(liveWorkspace);
                    if (fresh === null) {
                        return false;
                    }
                    if (fresh.fingerprint !== expected) {
                        return false;
                    }
                    if (fresh.activeRef !== capturedActive) {
                        return false;
                    }
                    // Output/desktop scope: the live active output and its
                    // current desktop must still be the captured pair.
                    const surface = liveWorkspace as Record<string, unknown>;
                    const liveActive = Reflect.get(surface, "activeWindow");
                    if (typeof liveActive !== "object" || liveActive === null) {
                        return false;
                    }
                    const liveOutput = Reflect.get(liveActive as object, "output");
                    if (liveOutput !== capturedOutput) {
                        return false;
                    }
                    const currentFn = Reflect.get(surface, "currentDesktopForScreen");
                    if (typeof currentFn !== "function") {
                        return false;
                    }
                    const liveDesktop = Reflect.apply(
                        currentFn as (...args: readonly never[]) => unknown,
                        surface,
                        [capturedOutput],
                    );
                    if (liveDesktop !== capturedDesktop) {
                        return false;
                    }
                    for (const entry of frozenWindows) {
                        if (capturedRefs.get(entry.id) !== byId.get(entry.id)) {
                            return false;
                        }
                        if (fresh.windows.find((item) => item.id === entry.id)?.ref !== entry.ref) {
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

// Explicit opt-in activation only; called by no production source. Returns a
// stop handle on success, null fail-closed after logging one fixed token.
export function startFocusAdapterEntry(
    overrides: FocusEntryOverrides = {},
): FocusEntryHandle | null {
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
    if (overrides.hasExclusiveFocusAuthority === undefined) {
        return fail();
    }
    const authority = overrides.hasExclusiveFocusAuthority;
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
    const sub = (
        name: string,
        handler: () => void,
    ): (() => void) | null => {
        try {
            return connectSignal(readSignal(surface, name), handler);
        } catch (error) {
            void error;
            return null;
        }
    };
    const adapter = new FocusAdapter({
        callDbus,
        scheduleOnce,
        log,
        observe: () => observeNative(liveWorkspace),
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
        hasExclusiveFocusAuthority: authority,
        subscribe: (kind, handler) => {
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
                throw new Error("focus-entry-signal-failed");
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
    // Adapter owns its own minimal subscriptions; the entry keeps no extra
    // handlers beyond those owned by the adapter. Verify the live scope once
    // so a broken scope fails closed before reporting ready.
    if (observeNative(liveWorkspace) === null) {
        adapter.disable();
        try {
            log(ENTRY_SIGNAL_REJECT);
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
                adapter.requestFocus(direction);
            } catch (error) {
                void error;
            }
        },
    };
}
