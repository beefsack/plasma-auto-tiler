// POC3 persistent test-only direct-enrollment adapter (initial start only).
//
// Boundary: this module never imports the controller, tray, boundary, tile
// tree, shortcut, desktop/output, persistence, login-time startup,
// package-settings, production entry, or KCM seams. It performs no tile
// split/remove/manage/unmanage writes, no proportional tile geometry writes,
// no shortcut registration/mutation, no desktop/output
// creation/deletion/reconfiguration. The only native writes are the three
// sequential `frameGeometry` assignments plus one `workspace.activeWindow`
// focus write performed by the shared Poc3Adapter start path, with the same
// observed-convergence plus typed `complete applied/divergent` reporting and
// the same fail-closed partial-application/divergence behavior. It attaches
// to zero KWin signals: single-flight, no retry/queue, no generic command
// execution.
//
// Direct enrollment (no caller-supplied window IDs): discovery reuses the
// read-only evaluateIdProbe contract against exactly three eligible
// Wayland-native normal untiled resizable closeable windows on one
// output/current workspace, bound to the three exact manifest-recorded
// manual PIDs embedded at build time (distinct live KWin `pid` coverage,
// shared-PID rejection, resident diagnostic app-id slot cross-check on the
// single exact native `resourceClass` property where exposed, with
// absent/mismatch failing closed, fourth-window rejection). No captions,
// titles, classes, geometry, position, or broad-query inference ever choose
// windows; the discovered `String(Window.internalId)` identities are
// normalized with the same `String(...)` conversion and strict equality as
// the probe. Color (slot ARGB) has no KWin scripting observable: it is
// manifest/config evidence only and never claims to bind a native window.
// Tick/exe liveness stays a shell-side manifest check before/after transport;
// this seam checks only live KWin `pid` binding plus eligibility/scope plus
// the mandatory app_id cross-check.
//
// The discovered slot-ordered IDs (slot A/B/C = expected-PID order) feed a
// single Poc3Adapter start with the literal `close-disposable` cleanup model
// only, with usable area always derived from the observed native output
// (operator `--usable` is rejected on this route). The returned engine intent
// is the deterministic initial `H[A,V[B,C]]` layout at base revision 0;
// acceptance reuses the adapter intent validation (exact enrolled IDs, focus
// in the enrolled set, `atomic:false` plus `adapter_verification_required:
// true`, bounded geometry inside the current observed output/client area)
// followed by scope/revision re-resolution and sequential writes.
// Only initial start exists here: focus/move/status/stop are not wired and
// must use the legacy separately bundled one-shot commands, which are
// preserved unchanged.
//
// Authority model: KWin print/log lines are never success authority (they
// exist only as debugging diagnostics). Status is established by the D-Bus
// `run()` reply (captured and validated shell-side, never discarded) plus
// the service-backed typed EvaluatePoc3 status/complete acknowledgement to
// the exact bound planner unique owner (revision advance with pending
// cleared, or recorded divergence) plus adapter-side post-observation of the
// KWin adapter's complete acknowledgement and its own observed convergence.
// (No independent shell native geometry observation is claimed: window IDs
// stay inside the bundle.) This bundle
// stays loaded after enrollment (success or failure) so the exact
// plugin/script-id retained in the manifest can be cleaned up explicitly;
// it never self-unloads.
//
// Planner identity: `owner` below is the planner session owner token (must
// equal the session `owner`); `unique_owner` is the planner D-Bus unique
// owner (`:N.M`) resolved shell-side on the private bus immediately before
// build/load. Every EvaluatePoc3 request is routed to that exact unique
// name with no well-known-name fallback; replacement/loss rejects.

import { Poc3Adapter, type Poc3AdapterEnv } from "./poc3-adapter";
import { evaluateIdProbe } from "./poc3-id-probe";

export const POC3_PERSISTENT_EXPECTED_REVISION = 0;
export const POC3_PERSISTENT_CLEANUP_MODEL = "close-disposable";
export const POC3_PERSISTENT_MAX_ID_LEN = 128;
export const POC3_PERSISTENT_MAX_GENERATION_LEN = 64;
export const POC3_PERSISTENT_MAX_GAP = 64;
export const POC3_PERSISTENT_DEFAULT_GAP = 8;
export const POC3_PERSISTENT_MIN_ORIGIN = -16384;
export const POC3_PERSISTENT_MAX_ORIGIN = 16384;
export const POC3_PERSISTENT_MIN_SIDE = 1;
export const POC3_PERSISTENT_MAX_SIDE = 16384;
export const POC3_PERSISTENT_PLANNER_SERVICE = "org.plasmaautotiler.Planner";
export const POC3_PERSISTENT_PLANNER_OBJECT = "/org/plasmaautotiler/Planner";
export const POC3_PERSISTENT_PLANNER_IFACE = "org.plasmaautotiler.Planner1";
export const POC3_PERSISTENT_PLANNER_METHOD = "EvaluatePoc3";
export const POC3_PERSISTENT_DIAG_APP_IDS: readonly string[] = Object.freeze([
    "org.plasma-auto-tiler.poc3-diag-1",
    "org.plasma-auto-tiler.poc3-diag-2",
    "org.plasma-auto-tiler.poc3-diag-3",
]);
export const POC3_PERSISTENT_DIAG_COLORS: readonly string[] = Object.freeze([
    "ffc02020",
    "ff20a020",
    "ff2040c0",
]);

export interface Poc3PersistentConfig {
    readonly owner: string;
    readonly generation: string;
    readonly nonce: string;
    readonly gap: number;
    readonly usable: Poc3PersistentRect | null;
    readonly planner?: Poc3PersistentPlanner;
}

export interface Poc3PersistentClient {
    readonly pid: number;
    readonly tick: number;
    readonly app_id: string;
    readonly slot: number;
    readonly color: string;
}

export interface Poc3PersistentPlanner {
    // Session owner token binding (must equal the session `owner`).
    readonly owner: string;
    // Exact planner D-Bus unique owner (`:N.M`) on the private bus.
    readonly unique_owner: string;
    readonly bus: string;
    readonly service: string;
    readonly object: string;
    readonly interface: string;
    readonly method: string;
}

export interface Poc3PersistentRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

function isOpaqueText(text: string): boolean {
    if (text.length === 0 || text.length > POC3_PERSISTENT_MAX_ID_LEN) {
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

function isTokenText(text: string): boolean {
    if (text.length === 0 || text.length > POC3_PERSISTENT_MAX_GENERATION_LEN) {
        return false;
    }
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
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

export function parsePersistentConfig(value: unknown): Poc3PersistentConfig | null {
    if (!isRecord(value)) {
        return null;
    }
    const allowed = new Set(["owner", "generation", "nonce", "gap", "usable", "expected_revision", "planner", "clients"]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            return null;
        }
    }
    const owner = value["owner"];
    const generation = value["generation"];
    const nonce = value["nonce"];
    const expectedRevision = value["expected_revision"];
    if (typeof owner !== "string" || !isOpaqueText(owner)) {
        return null;
    }
    if (typeof generation !== "string" || !isTokenText(generation)) {
        return null;
    }
    if (typeof nonce !== "string" || !isTokenText(nonce)) {
        return null;
    }
    if (expectedRevision !== POC3_PERSISTENT_EXPECTED_REVISION) {
        return null;
    }
    const rawGap = value["gap"];
    let gap = POC3_PERSISTENT_DEFAULT_GAP;
    if (rawGap !== null && rawGap !== undefined) {
        if (
            typeof rawGap !== "number" ||
            !Number.isInteger(rawGap) ||
            rawGap < 0 ||
            rawGap > POC3_PERSISTENT_MAX_GAP
        ) {
            return null;
        }
        gap = rawGap;
    }
    const rawUsable = value["usable"];
    // Direct route derives usable from the observed native output; any
    // operator-supplied usable is rejected (legacy route keeps its own form).
    if (rawUsable !== null && rawUsable !== undefined) {
        return null;
    }
    const usable: Poc3PersistentRect | null = null;
    const rawPlanner = value["planner"];
    let planner: Poc3PersistentPlanner | undefined = undefined;
    if (rawPlanner !== null && rawPlanner !== undefined) {
        const parsedPlanner = parsePersistentPlanner(rawPlanner);
        if (parsedPlanner === null || parsedPlanner.owner !== owner) {
            return null;
        }
        planner = parsedPlanner;
    }
    const rawClients = value["clients"];
    if (rawClients !== null && rawClients !== undefined) {
        const clients = parsePersistentClients(rawClients);
        if (clients === null) {
            return null;
        }
        void clients;
    }
    return planner === undefined ? { owner, generation, nonce, gap, usable } : { owner, generation, nonce, gap, usable, planner };
}

export function parsePersistentPids(value: unknown): readonly number[] | null {
    if (!Array.isArray(value) || value.length !== 3) {
        return null;
    }
    const out: number[] = [];
    const seen = new Set<number>();
    for (const entry of value) {
        if (typeof entry !== "number" || !Number.isInteger(entry)) {
            return null;
        }
        if (entry < 1 || entry > 4294967295 || seen.has(entry)) {
            return null;
        }
        seen.add(entry);
        out.push(entry);
    }
    return Object.freeze(out);
}

// Full per-slot manifest evidence: exactly three distinct PIDs plus the
// validated start-tick, diagnostic app_id, slot, and color for each slot in
// slot order. Tick liveness stays a shell-side /proc check; this seam
// validates shape/binding so malformed/missing/shared evidence fails closed
// before any probe, planner call, or native write. No captions or guessed IDs.
export function parsePersistentClients(value: unknown): readonly Poc3PersistentClient[] | null {
    if (!Array.isArray(value) || value.length !== 3) {
        return null;
    }
    const out: Poc3PersistentClient[] = [];
    const seenPid = new Set<number>();
    const seenTick = new Set<number>();
    const seenApp = new Set<string>();
    const seenSlot = new Set<number>();
    const seenColor = new Set<string>();
    for (const entry of value) {
        if (!isRecord(entry)) {
            return null;
        }
        const allowed = new Set(["pid", "tick", "app_id", "slot", "color"]);
        for (const key of Object.keys(entry)) {
            if (!allowed.has(key)) {
                return null;
            }
        }
        const pid = entry["pid"];
        const tick = entry["tick"];
        const appId = entry["app_id"];
        const slot = entry["slot"];
        const color = entry["color"];
        if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1 || pid > 4294967295) {
            return null;
        }
        if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 1 || !Number.isSafeInteger(tick)) {
            return null;
        }
        if (typeof appId !== "string" || (POC3_PERSISTENT_DIAG_APP_IDS as readonly string[]).indexOf(appId) < 0) {
            return null;
        }
        if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > 3) {
            return null;
        }
        if (typeof color !== "string" || (POC3_PERSISTENT_DIAG_COLORS as readonly string[]).indexOf(color.toLowerCase()) < 0) {
            return null;
        }
        if (seenPid.has(pid) || seenTick.has(tick) || seenApp.has(appId) || seenSlot.has(slot) || seenColor.has(color.toLowerCase())) {
            return null;
        }
        seenPid.add(pid);
        seenTick.add(tick);
        seenApp.add(appId);
        seenSlot.add(slot);
        seenColor.add(color.toLowerCase());
        // Fixed slot binding: slot N carries its fixed app_id and color.
        const slotIndex = slot - 1;
        if (appId !== POC3_PERSISTENT_DIAG_APP_IDS[slotIndex] || color.toLowerCase() !== POC3_PERSISTENT_DIAG_COLORS[slotIndex]) {
            return null;
        }
        out.push({ pid, tick, app_id: appId, slot, color: color.toLowerCase() });
    }
    // Canonical slot order: evidence arrives slot 1,2,3.
    if (out[0]?.slot !== 1 || out[1]?.slot !== 2 || out[2]?.slot !== 3) {
        return null;
    }
    return Object.freeze(out);
}

// Private planner expectations: session owner binding plus the exact planner
// D-Bus unique owner (`:N.M`) plus the private bus address shape plus the
// fixed planner service/object/interface/method. The bus string itself is
// enforced shell-side (manifest-bound); this seam rejects malformed/mismatched
// expectations before any planner call. `owner` is the session token;
// `unique_owner` is the D-Bus unique name: the two are never conflated.
export function parsePersistentPlanner(value: unknown): Poc3PersistentPlanner | null {
    if (!isRecord(value)) {
        return null;
    }
    const allowed = new Set(["owner", "unique_owner", "bus", "service", "object", "interface", "method"]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            return null;
        }
    }
    const owner = value["owner"];
    const uniqueOwner = value["unique_owner"];
    const bus = value["bus"];
    const service = value["service"];
    const object = value["object"];
    const iface = value["interface"];
    const method = value["method"];
    if (typeof owner !== "string" || !isOpaqueText(owner)) {
        return null;
    }
    if (typeof bus !== "string" || bus.length === 0 || bus.length > 4096) {
        return null;
    }
    if (bus.includes("\n") || bus.includes("\0")) {
        return null;
    }
    let foundPath = false;
    for (const entry of bus.split(";")) {
        if (entry === "" || !entry.startsWith("unix:")) {
            return null;
        }
        const rest = entry.slice("unix:".length);
        if (rest === "") {
            return null;
        }
        for (const kv of rest.split(",")) {
            if (kv.startsWith("path=") || kv.startsWith("abstract=")) {
                const val = kv.slice(kv.indexOf("=") + 1);
                if (val === "" || !val.startsWith("/") || val === "/") {
                    return null;
                }
                if (val.includes("//") || val.includes("/../")) {
                    return null;
                }
                foundPath = true;
            }
        }
    }
    if (!foundPath) {
        return null;
    }
    if (
        service !== POC3_PERSISTENT_PLANNER_SERVICE ||
        object !== POC3_PERSISTENT_PLANNER_OBJECT ||
        iface !== POC3_PERSISTENT_PLANNER_IFACE ||
        method !== POC3_PERSISTENT_PLANNER_METHOD
    ) {
        return null;
    }
    if (typeof uniqueOwner !== "string" || !/^:[0-9]+\.[0-9]+$/.test(uniqueOwner)) {
        return null;
    }
    return { owner, unique_owner: uniqueOwner, bus, service, object, interface: iface, method };
}

// Direct-enrollment initial start: discover the exact three IDs from the
// manifest-bound expected PIDs, then delegate to one Poc3Adapter start with
// usable derived from the observed native output and every EvaluatePoc3
// request routed to the exact bound planner D-Bus unique owner. The
// adapter instance is intentionally retained (never unloaded here); terminal
// success/failure is established off-bundle via the typed service
// acknowledgement to that unique owner plus adapter-side post-observation.
// Returns the adapter for tests.
export function runPersistentStart(
    env: Poc3AdapterEnv,
    workspace: unknown,
    config: unknown,
    expectedPids: unknown,
    expectedClients?: unknown,
    expectedPlanner?: unknown,
): Poc3Adapter | null {
    const parsed = parsePersistentConfig(config);
    const pids = parsePersistentPids(expectedPids);
    if (parsed === null || pids === null) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-invalid");
        } catch (error) {
            void error;
        }
        return null;
    }
    // Full evidence is required when supplied: malformed/missing/shared
    // per-slot or planner evidence fails closed before any probe, planner
    // call, or native write. Callers that omit the new evidence (legacy
    // shape) fail closed here as well: PIDs alone are not sufficient.
    if (expectedClients === undefined || expectedPlanner === undefined) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-invalid");
        } catch (error) {
            void error;
        }
        return null;
    }
    const clients = parsePersistentClients(expectedClients);
    const planner = parsePersistentPlanner(expectedPlanner);
    if (clients === null || planner === null) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-invalid");
        } catch (error) {
            void error;
        }
        return null;
    }
    if (planner.owner !== parsed.owner) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-invalid");
        } catch (error) {
            void error;
        }
        return null;
    }
    const embeddedClients = (parsed as Poc3PersistentConfig).planner !== undefined ? (config as Record<string, unknown>)["clients"] : undefined;
    if (embeddedClients !== undefined && parsePersistentClients(embeddedClients) === null) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-invalid");
        } catch (error) {
            void error;
        }
        return null;
    }
    for (let index = 0; index < 3; index += 1) {
        const client = clients[index];
        if (client === undefined || client.pid !== pids[index]) {
            try {
                env.log("plasma-auto-tiler:poc3-persistent-invalid");
            } catch (error) {
                void error;
            }
            return null;
        }
    }
    const probe = evaluateIdProbe(
        workspace,
        { owner: parsed.owner, generation: parsed.generation, nonce: parsed.nonce },
        [...pids],
    );
    if (!probe.ok) {
        try {
            env.log(`plasma-auto-tiler:poc3-persistent-rejected:${probe.reason}`);
        } catch (error) {
            void error;
        }
        return null;
    }
    if (probe.expectedRevision !== POC3_PERSISTENT_EXPECTED_REVISION) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-rejected:poc3-stale-revision");
        } catch (error) {
            void error;
        }
        return null;
    }
    const adapter = new Poc3Adapter(env);
    // Exact unique-owner routing with no well-known fallback: replacement or
    // loss of the planner endpoint rejects before any probe/transport/write.
    // The session owner token and the D-Bus unique owner are distinct types.
    if (!adapter.bindPlannerUniqueOwner(planner.unique_owner)) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-invalid");
        } catch (error) {
            void error;
        }
        return null;
    }
    // App-id/scope re-resolution binding: the exact native app_id per slot is
    // re-checked before every geometry/focus sequence. Color stays
    // manifest/config evidence only (no KWin observable) and is not bound here.
    if (!adapter.bindPersistentAppIds([...POC3_PERSISTENT_DIAG_APP_IDS])) {
        try {
            env.log("plasma-auto-tiler:poc3-persistent-invalid");
        } catch (error) {
            void error;
        }
        return null;
    }
    try {
        adapter.start([...probe.ids], {
            cleanup: POC3_PERSISTENT_CLEANUP_MODEL,
            session: { owner: parsed.owner, generation: parsed.generation },
            gap: parsed.gap,
            nonce: parsed.nonce,
        });
    } catch (error) {
        void error;
        try {
            env.log("plasma-auto-tiler:poc3-persistent-rejected:poc3-start-failed");
        } catch (logError) {
            void logError;
        }
        return null;
    }
    return adapter;
}
