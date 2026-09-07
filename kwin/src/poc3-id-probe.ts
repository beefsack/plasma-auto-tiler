// POC3 read-only nested ID/eligibility probe (separately bundled IIFE only).
//
// Boundary: this module never imports the controller, tray, boundary, tile
// tree, shortcut, desktop/output, persistence, planner-shadow (POC2) probe,
// poc3-adapter actuation, or KCM seams. It performs zero native writes: no
// frameGeometry/activeWindow/tile/desktops/onAllDesktops writes, no
// createDesktop/removeDesktop/setCurrentDesktop, no showOutline, no
// closeWindow invocation, no callDBus, no readConfig, no signal subscriptions.
// The only observable effect is one console.log line (private nested log).
//
// Discovery contract (bounded, nested-only): the decoded workspace
// windowList must contain exactly three entries (a fourth eligible/matching
// window fails closed with poc3-id-probe-count); each must expose a valid
// opaque `String(Window.internalId)` identity, pass eligibility
// (normal/managed/resizeable/closeable, untiled, non-popup, non-fullscreen,
// non-maximized), and share one output (present in screens) plus the current
// workspace for that output. Each must expose a distinct KWin `pid` exactly
// covering the three expected manifest PIDs (arbitrary same-PID surfaces fail
// via poc3-pid-duplicate); where KWin exposes resident diagnostic
// app_id/title evidence it must agree with the PID slot. Success reports the
// three identities in deterministic expected-PID (slot A/B/C) order plus the
// caller-supplied session material (owner/generation, expected_revision 0)
// needed by later POC3 commands. Any gap fails closed with a fixed reason.
// Window identities appear only in the single private-log done line.
//
// Wayland-native note: the pinned KWin scripting Window surface declares no
// Wayland-native flag, so normal/managed/resizeable/closeable plus scope is
// the closest static contract. Live Wayland-native verification remains a
// live-only check (see report blockers/risks).

export const POC3_ID_PROBE_WINDOW_COUNT = 3;
export const POC3_ID_PROBE_EXPECTED_PID_COUNT = 3;
export const POC3_ID_PROBE_MAX_WINDOW_LIST = 1024;
export const POC3_ID_PROBE_MAX_SCREENS = 32;
export const POC3_ID_PROBE_MAX_ID_LEN = 128;
export const POC3_ID_PROBE_EXPECTED_REVISION = 0;

// Resident diagnostic-trio slot evidence (diagnostic-only cross-check).
// The three poc3-diagnostic-client slots set distinct xdg app_id values
// (see src/poc3_diag.rs slot_desc). KWin surfaces the app_id where supported
// as the scripting Window `resourceClass`. Only that single exact property
// binds a slot: any other property (resourceName, desktopFileName, caption,
// title) is never consulted for enrollment, and an absent or mismatched
// resourceClass fails closed with poc3-slot-mismatch. PID remains the
// enrollment identity; the app_id check is a mandatory cross-check, never a
// fallback. Window color (slot ARGB) has no KWin scripting observable and
// stays manifest/config evidence only; it never binds a native window.
export const POC3_DIAG_SLOT_APP_IDS: readonly string[] = Object.freeze([
    "org.plasma-auto-tiler.poc3-diag-1",
    "org.plasma-auto-tiler.poc3-diag-2",
    "org.plasma-auto-tiler.poc3-diag-3",
]);
export const POC3_DIAG_SLOT_TITLES: readonly string[] = Object.freeze([
    "poc3-diag-1",
    "poc3-diag-2",
    "poc3-diag-3",
]);

export interface Poc3IdProbeConfig {
    readonly owner: string;
    readonly generation: string;
    readonly nonce: string;
}

export type Poc3IdProbeResult =
    | {
          readonly ok: true;
          readonly ids: readonly string[];
          readonly owner: string;
          readonly generation: string;
          readonly expectedRevision: number;
          readonly nonce: string;
      }
    | { readonly ok: false; readonly reason: string; readonly count?: number };

function isOpaqueText(text: string): boolean {
    if (text.length === 0 || text.length > POC3_ID_PROBE_MAX_ID_LEN) {
        return false;
    }
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
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

function isWindowId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > POC3_ID_PROBE_MAX_ID_LEN) {
        return false;
    }
    const text: string = value;
    if (isOpaqueText(text)) {
        return true;
    }
    if (text.length === 38 && text.startsWith("{") && text.endsWith("}")) {
        return isUuidText(text.slice(1, 37));
    }
    return isUuidText(text);
}

function normalizeNativeId(value: unknown): string | null {
    if (typeof value === "string") {
        return isWindowId(value) ? value : null;
    }
    let text = "";
    try {
        text = String(value);
    } catch (error) {
        void error;
        return null;
    }
    if (typeof text !== "string") {
        return null;
    }
    return isWindowId(text) ? text : null;
}

function isOwner(value: unknown): value is string {
    return typeof value === "string" && isOpaqueText(value);
}

function isToken(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > 64) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readProp(value: object, property: string): unknown {
    try {
        return Reflect.get(value, property);
    } catch (error) {
        void error;
        return undefined;
    }
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
    const elements: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        let element: unknown = undefined;
        try {
            element = Reflect.get(value, String(index));
        } catch (error) {
            void error;
            return null;
        }
        elements.push(element);
    }
    return elements;
}

export function parseIdProbeConfig(value: unknown): Poc3IdProbeConfig | null {
    if (!isRecord(value)) {
        return null;
    }
    const allowed = new Set(["owner", "generation", "nonce"]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            return null;
        }
    }
    const owner = value["owner"];
    const generation = value["generation"];
    const nonce = value["nonce"];
    if (!isOwner(owner) || !isToken(generation) || !isToken(nonce)) {
        return null;
    }
    return { owner, generation, nonce };
}

function checkEligibility(ref: object): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (readProp(ref, "normalWindow") !== true) {
        return { ok: false, reason: "poc3-special" };
    }
    if (readProp(ref, "managed") !== true) {
        return { ok: false, reason: "poc3-unmanaged" };
    }
    if (readProp(ref, "resizeable") !== true) {
        return { ok: false, reason: "poc3-unresizable" };
    }
    if (readProp(ref, "appletPopup") === true) {
        return { ok: false, reason: "poc3-applet-popup" };
    }
    if (readProp(ref, "tile") !== null) {
        return { ok: false, reason: "poc3-tiled" };
    }
    if (readProp(ref, "fullScreen") === true) {
        return { ok: false, reason: "poc3-fullscreen" };
    }
    if (readProp(ref, "maximizeMode") !== 0) {
        return { ok: false, reason: "poc3-maximized" };
    }
    if (readProp(ref, "closeable") !== true) {
        return { ok: false, reason: "poc3-uncloseable" };
    }
    if (typeof readProp(ref, "closeWindow") !== "function") {
        return { ok: false, reason: "poc3-no-close" };
    }
    return { ok: true };
}

// Manual-route PID binding: each candidate window must expose the reliable
// KWin process PID (`client.pid`, surfaced as `pid` on the scripting Window).
// `pid` is the sole enrollment identity; app_id/slot evidence below is only a
// diagnostic cross-check where KWin exposes it (never a fallback). A missing,
// zero, or non-integer pid fails closed (XWayland windows may report 0, which
// never matches a live manifest PID).
export function parseExpectedPids(value: unknown): readonly number[] | null {
    const list = decodeList(value, POC3_ID_PROBE_EXPECTED_PID_COUNT + 1);
    if (list === null || list.length !== POC3_ID_PROBE_EXPECTED_PID_COUNT) {
        return null;
    }
    const out: number[] = [];
    const seen = new Set<number>();
    for (const entry of list) {
        if (typeof entry !== "number" || !Number.isInteger(entry)) {
            return null;
        }
        if (entry < 1 || entry > 4294967295) {
            return null;
        }
        if (seen.has(entry)) {
            return null;
        }
        seen.add(entry);
        out.push(entry);
    }
    return Object.freeze(out);
}

function readWindowPid(candidate: object): number | null {
    const raw = readProp(candidate, "pid");
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
        return null;
    }
    if (raw < 1 || raw > 4294967295) {
        return null;
    }
    return raw;
}

// Slot evidence where supported: the single exact native app_id property
// (`resourceClass`) KWin exposes for the xdg app_id. Read-only cross-check
// only; never enrollment. Returns the known trio slot index (0/1/2) when the
// value exactly equals a resident diagnostic app_id, else null (absent,
// unsupported, or generic). Titles/captions are never consulted: they are
// not app_id identity.
function knownDiagSlot(text: unknown): number | null {
    if (typeof text !== "string" || text.length === 0 || text.length > 128) {
        return null;
    }
    for (let index = 0; index < POC3_DIAG_SLOT_APP_IDS.length; index += 1) {
        if (text === POC3_DIAG_SLOT_APP_IDS[index]) {
            return index;
        }
    }
    return null;
}

function findSlotForPid(expected: readonly number[], pid: number): number | null {
    for (let index = 0; index < expected.length; index += 1) {
        if (expected[index] === pid) {
            return index;
        }
    }
    return null;
}

function readDiagSlotHint(candidate: object): number | null {
    // Only the documented exact native app_id property. No permissive
    // multi-property hints, no caption/title fallback.
    let raw: unknown = undefined;
    try {
        raw = readProp(candidate, "resourceClass");
    } catch (error) {
        void error;
        return null;
    }
    return knownDiagSlot(raw);
}

// Read-only discovery: exactly three eligible windows, one output, current
// workspace, plus exact binding of each window to a distinct live
// manifest-recorded manual PID. No writes, no transport, no timers, no signals.
export function evaluateIdProbe(
    workspace: unknown,
    config: unknown,
    expectedPids?: unknown,
): Poc3IdProbeResult {
    const parsed = parseIdProbeConfig(config);
    if (parsed === null) {
        return { ok: false, reason: "poc3-id-probe-invalid" };
    }
    const expected = parseExpectedPids(expectedPids);
    if (expected === null) {
        return { ok: false, reason: "poc3-pid-missing" };
    }
    if (typeof workspace !== "object" || workspace === null) {
        return { ok: false, reason: "poc3-invalid-scope" };
    }
    const surface = workspace as Record<string, unknown>;
    let windowList: unknown = undefined;
    try {
        const lister = surface["windowList"];
        if (typeof lister !== "function") {
            return { ok: false, reason: "poc3-invalid-scope" };
        }
        windowList = (lister as () => unknown).call(surface);
    } catch (error) {
        void error;
        return { ok: false, reason: "poc3-invalid-scope" };
    }
    const windows = decodeList(windowList, POC3_ID_PROBE_MAX_WINDOW_LIST);
    if (windows === null) {
        return { ok: false, reason: "poc3-invalid-scope" };
    }
    if (windows.length !== POC3_ID_PROBE_WINDOW_COUNT) {
        return { ok: false, reason: "poc3-id-probe-count", count: windows.length };
    }
    const ids: string[] = [];
    const refs: object[] = [];
    const seen = new Set<string>();
    for (const candidate of windows) {
        if (typeof candidate !== "object" || candidate === null) {
            return { ok: false, reason: "poc3-invalid-id" };
        }
        const nativeId = normalizeNativeId(readProp(candidate, "internalId"));
        if (nativeId === null) {
            return { ok: false, reason: "poc3-invalid-id" };
        }
        if (seen.has(nativeId)) {
            return { ok: false, reason: "poc3-duplicate-native" };
        }
        seen.add(nativeId);
        ids.push(nativeId);
        refs.push(candidate);
    }
    for (const ref of refs) {
        const eligibility = checkEligibility(ref);
        if (!eligibility.ok) {
            return { ok: false, reason: eligibility.reason };
        }
    }
    // Exact manual PID binding: each eligible window must expose a live
    // KWin `pid` matching a distinct expected manifest PID. A fourth
    // windowList entry (eligible or not) already fails at the exact-three
    // count above, so a fourth eligible/matching window never passes; a
    // disposable automatic-route PID never matches and fails below. Windows
    // sharing one PID (arbitrary same-PID surfaces of one process) fail via
    // poc3-pid-duplicate. The exact native app_id (`resourceClass`) must be
    // present and agree with the PID slot (poc3-slot-mismatch on absent or
    // mismatch); there is no PID-only fallback on this seam. Color has no
    // KWin observable and is not checked here (manifest/config evidence only).
    const windowPids: number[] = [];
    const seenPids = new Set<number>();
    for (const ref of refs) {
        const pid = readWindowPid(ref);
        if (pid === null) {
            return { ok: false, reason: "poc3-no-pid" };
        }
        if (seenPids.has(pid)) {
            return { ok: false, reason: "poc3-pid-duplicate" };
        }
        seenPids.add(pid);
        windowPids.push(pid);
    }
    const expectedSet = new Set<number>(expected);
    for (const pid of windowPids) {
        if (!expectedSet.has(pid)) {
            return { ok: false, reason: "poc3-pid-mismatch" };
        }
    }
    for (let index = 0; index < refs.length; index += 1) {
        const hint = readDiagSlotHint(refs[index] as object);
        if (hint === null || hint !== findSlotForPid(expected, windowPids[index] as number)) {
            return { ok: false, reason: "poc3-slot-mismatch" };
        }
    }
    const firstOutput = readProp(refs[0] as object, "output");
    if (typeof firstOutput !== "object" || firstOutput === null) {
        return { ok: false, reason: "poc3-cross-output" };
    }
    const output = firstOutput as object;
    for (const ref of refs) {
        if (readProp(ref, "output") !== output) {
            return { ok: false, reason: "poc3-cross-output" };
        }
    }
    let screens: unknown = undefined;
    try {
        screens = surface["screens"];
    } catch (error) {
        void error;
        return { ok: false, reason: "poc3-invalid-scope" };
    }
    const decodedScreens = decodeList(screens, POC3_ID_PROBE_MAX_SCREENS);
    if (decodedScreens === null || decodedScreens.indexOf(output) < 0) {
        return { ok: false, reason: "poc3-unknown-output" };
    }
    let desktop: unknown = undefined;
    try {
        const current = surface["currentDesktopForScreen"];
        if (typeof current !== "function") {
            return { ok: false, reason: "poc3-invalid-scope" };
        }
        desktop = (current as (output: object) => unknown).call(surface, output);
    } catch (error) {
        void error;
        return { ok: false, reason: "poc3-invalid-scope" };
    }
    if (typeof desktop !== "object" || desktop === null) {
        return { ok: false, reason: "poc3-cross-workspace" };
    }
    const desktopObject = desktop as object;
    for (const ref of refs) {
        if (readProp(ref, "onAllDesktops") === true) {
            return { ok: false, reason: "poc3-cross-workspace" };
        }
        const membership = decodeList(readProp(ref, "desktops"), POC3_ID_PROBE_MAX_SCREENS);
        if (membership === null || membership.indexOf(desktopObject) < 0) {
            return { ok: false, reason: "poc3-cross-workspace" };
        }
    }
    // Deterministic A/B/C slot association: emit IDs ordered by the expected
    // manifest PID order (slot 1, 2, 3), not windowList order, so the result
    // feeds the existing `poc3-command start <id1> <id2> <id3>` route
    // deterministically. Same-parent distinct PIDs stay distinct here; only
    // the ordering is normalized.
    const idByPid = new Map<number, string>();
    for (let index = 0; index < windowPids.length; index += 1) {
        idByPid.set(windowPids[index] as number, ids[index] as string);
    }
    const orderedIds: string[] = [];
    for (const pid of expected) {
        const id = idByPid.get(pid);
        if (id === undefined) {
            return { ok: false, reason: "poc3-pid-mismatch" };
        }
        orderedIds.push(id);
    }
    return {
        ok: true,
        ids: Object.freeze([...orderedIds]),
        owner: parsed.owner,
        generation: parsed.generation,
        expectedRevision: POC3_ID_PROBE_EXPECTED_REVISION,
        nonce: parsed.nonce,
    };
}
