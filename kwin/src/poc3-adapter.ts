// POC3 KWin manual adapter (separately bundled one-shot command IIFE only).
//
// Boundary: this module never imports the controller, tray, boundary, tile
// tree, shortcut, desktop/output, persistence, login-time startup,
// package-settings, or KCM seams. It performs no tile split/remove/manage/unmanage writes, no
// proportional tile geometry writes, no shortcut registration/mutation, no
// desktop/output creation/deletion/reconfiguration. The only native writes are
// sequential `frameGeometry` assignments for the three explicitly enrolled
// windows followed by one `workspace.activeWindow` focus write, plus
// closure-only cleanup via the public scripting `closeWindow` method on the
// exact enrolled three (explicit `stop` with a `close-disposable` or
// `abandoned-pending-close` directive only, revalidated then observed). It
// attaches to zero KWin signals, so no geometry change can generate another
// intent or event loop.
//
// Enrollment is never inferred: every command must be given exactly three
// explicitly supplied native identity strings. Identity is the observed
// public representation `String(Window.internalId)` (project proof scripts
// key managed windows by exactly this conversion; the public typing is
// `Q_PROPERTY(QUuid internalId ...)` on KWin::Window). The adapter normalizes
// the native side with the same `String(...)` conversion and compares by
// strict string equality against `workspace.windowList()` entries only. Both
// the legacy opaque form and the canonical QUuid forms (brace-wrapped or
// bare `8-4-4-4-12` hex) validate; anything else rejects before transport.
// No active window, titles, classes, geometry, position, or broad-query
// inference is used to choose windows. Residual live-verification item: the
// exact live QUuid string form (braced vs bare) is accepted in both strict
// forms until one is observed live; a simultaneous same-string collision
// across distinct windows fails closed (`poc3-duplicate-native`).
//
// Reference identity is a conservative fail-closed live verification gap,
// not a guarantee: within one command execution every actuation re-resolves
// the exact enrolled windows and requires the same object references,
// continued eligibility, and unchanged scope output/workspace. A replaced
// reference logs `poc3-reference-drift` and fails closed. Across separately
// loaded per-command bundles no reference continuity exists (each bundle runs
// in its own isolated engine); each command revalidates the exact supplied
// IDs and scope from scratch. This gap is recorded here, not weakened.
//
// Production startup never runs this adapter: the ordinary entry point
// (src/entry.ts) must not import or construct it. The only manual entry is
// src/poc3-command-entry.ts (one-shot per-command bundle), built only via the
// per-command build helper into dist (never into contents/code/main.js).
//
// Transport: async callDBus to EvaluatePoc3, one in-flight request, bounded
// records/payloads, 2s timeout, per-request correlation with
// owner/generation/revision binding. Every reply freshly re-resolves the exact
// handles/IDs and compares references, eligibility, scope output/workspace,
// and pending native state before actuation. Any failure stops actuation,
// reports `complete divergent` with a fixed reason when transport is
// available, emits bounded timestamp diagnostics, and exposes only the
// cleanup/termination path. No atomicity is claimed; there is no
// retry/queue. Convergence is observed only: after writes the adapter polls
// frame geometry plus focus on a bounded QTimer loop (fixed interval, fixed
// check budget, zero signal subscriptions, never dispatching another intent)
// and reports `applied` only when the desired state is actually observed.
// A mismatch at expiry reports divergent. This is observed convergence, not
// an atomic or Wayland configure acknowledgement. Closure is likewise
// observed: after invoking the public close method on the exact three, the
// adapter polls until all three have left the window list; expiry reports
// cleanup failure with user-visible residue, never success. Restore of the
// captured originals is class-level test-only (direct `stop({ restore: true })`
// on the adapter): it writes the originals then observes geometry plus focus
// on the same bounded QTimer mechanism before reporting
// `poc3-stopped:restore-enrolled`; expiry reports a fixed restore failure and
// terminates with residue, never success. The one-shot per-command route is
// closure-only and never confirms restore, so restore is unreachable from any
// user command; the closure-only command route remains the accepted live POC
// cleanup model.
//
// Authority model (architectural, by design): the engine plans; verified
// state advances only on adapter-validated completion (`complete applied`
// after observed convergence). Adapter completion reports are the authority
// input the engine trusts; the trust is explicit in the intent
// (`adapter_verification_required`) and is not an independent native proof.
//
// Declared POC risk (not silently fixed): the default D-Bus well-known
// service name is used without caller verification on the legacy seam, so a
// same-session service spoof could answer; correlation/owner/generation/
// revision binding limits cross-talk but does not authenticate the service.
// The persistent direct-enrollment seam must not use the well-known name: it
// binds one exact planner D-Bus unique owner (`:N.M`, resolved shell-side
// immediately before build/load) via bindPlannerUniqueOwner() and routes
// every EvaluatePoc3 request to that exact unique name with no fallback.
//
// Stale-reply and timeout behavior is fail-closed by design: late/duplicate
// replies never consume a newer flight, timeouts emit `poc3-timeout:<kind>`
// and leave only the cleanup/termination path, and every rejection keeps the
// engine revision unchanged.

export const POC3_SERVICE = "org.plasmaautotiler.Planner";
export const POC3_OBJECT = "/org/plasmaautotiler/Planner";
export const POC3_INTERFACE = "org.plasmaautotiler.Planner1";
export const POC3_METHOD = "EvaluatePoc3";

export const POC3_CONTRACT_VERSION = 3;
export const POC3_MAX_REQUEST_BYTES = 64 * 1024;
export const POC3_MAX_REPLY_BYTES = 64 * 1024;
export const POC3_TIMEOUT_MS = 2000;
export const POC3_WINDOW_COUNT = 3;
export const POC3_MAX_GAP = 64;
export const POC3_DEFAULT_GAP = 8;
export const POC3_MAX_REVISION = 1_000_000;
export const POC3_MIN_SIDE = 1;
export const POC3_MAX_SIDE = 16_384;
export const POC3_MIN_ORIGIN = -16_384;
export const POC3_MAX_ORIGIN = 16_384;
export const POC3_MAX_ID_LEN = 128;
export const POC3_MAX_CORRELATION_LEN = 128;
export const POC3_MAX_GENERATION_LEN = 64;
export const POC3_MAX_ROLLBACK_BYTES = 4096;
export const POC3_MAX_WINDOW_LIST = 1024;
export const POC3_MAX_SCREENS = 32;
// KWin Workspace.clientArea ClientAreaOption: WorkArea is 5.
export const POC3_CLIENT_AREA_OPTION = 5;
// Observed-convergence polling: fixed interval with a fixed check budget.
// Finite by construction: at most POC3_CONVERGE_CHECKS QTimer polls per
// actuation, POC3_CLOSE_CHECKS per closure observation, and
// POC3_RESTORE_CHECKS per test-only restore observation.
export const POC3_CONVERGE_INTERVAL_MS = 50;
export const POC3_CONVERGE_CHECKS = 20;
export const POC3_CLOSE_INTERVAL_MS = 50;
export const POC3_CLOSE_CHECKS = 20;
export const POC3_RESTORE_INTERVAL_MS = 50;
export const POC3_RESTORE_CHECKS = 20;

export const POC3_SCOPE_ALIAS = "scope-1";
export const POC3_CLEANUP_MODEL = "close-disposable";

// Exact D-Bus unique-owner shape (`:N.M`) for the bound planner endpoint.
export function isPlannerUniqueOwner(value: unknown): value is string {
    return typeof value === "string" && /^:[0-9]+\.[0-9]+$/.test(value);
}

const LOG_PREFIX = "plasma-auto-tiler:poc3";

export type Poc3Direction = "left" | "right" | "up" | "down";

export interface Poc3AdapterEnv {
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
    readonly now: () => number;
    readonly workspace: unknown;
}

export interface Poc3AdapterState {
    readonly started: boolean;
    readonly diverged: boolean;
    readonly inFlight: boolean;
    readonly pending: boolean;
    readonly revision: number;
    readonly enrolled: readonly string[];
    readonly focus: string | null;
}

export interface Poc3SessionToken {
    readonly owner: string;
    readonly generation: string;
}

export interface Poc3StartOptions {
    readonly gap?: unknown;
    readonly usable?: unknown;
    // Explicit user-selected cleanup model. The literal "close-disposable"
    // is the only supported value; absent or any other value rejects before
    // any native write or transport. There is no default.
    readonly cleanup?: unknown;
    // Optional explicit session token. When omitted a fresh random token is
    // generated (direct class-level use); the per-command route always
    // supplies it so separately loaded commands bind the same engine session.
    readonly session?: unknown;
    // Optional bounded nonce echoed only in the one-shot command-done
    // diagnostic so the lifecycle tool can match completion. Never echoed
    // with window identities.
    readonly nonce?: unknown;
}

export interface Poc3StopOptions {
    // Test-only restore confirmation. The one-shot per-command route never
    // sets this (closure-only); only direct class-level use in tests may
    // confirm restore. Never a user command.
    readonly restore?: unknown;
}

export type Poc3CommandName = "start" | "focus" | "move" | "status" | "stop";

export interface Poc3CommandConfig {
    readonly command: Poc3CommandName;
    readonly ids: readonly string[] | null;
    readonly direction: Poc3Direction | null;
    readonly owner: string;
    readonly generation: string;
    readonly expectedRevision: number;
    readonly gap: number | null;
    readonly usable: Poc3Rect | null;
    readonly nonce: string;
}

interface Poc3Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

interface Poc3Desired {
    readonly id: string;
    readonly rect: Poc3Rect;
}

interface Poc3Intent {
    readonly baseRevision: number;
    readonly focus: string;
    readonly desired: readonly Poc3Desired[];
}

interface EnrolledNative {
    readonly id: string;
    readonly ref: object;
    readonly geometry: Poc3Rect;
    readonly rollback: string;
    readonly wasActive: boolean;
}

function isOpaqueText(text: string): boolean {
    if (text.length === 0 || text.length > POC3_MAX_ID_LEN) {
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

function isOpaqueId(value: unknown): value is string {
    return typeof value === "string" && isOpaqueText(value);
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

// Window identity validation: the legacy opaque form plus the observed
// `String(Window.internalId)` QUuid family (canonical 8-4-4-4-12 hex, bare
// or wrapped in the single `{...}` pair `QUuid::toString()` emits). Braces
// are allowed only as that exact wrapping pair. Mirrors the Rust contract
// `is_window_id`; shell-injection shapes (`;`, `$`, backticks, spaces,
// slashes, quotes) never validate.
function isWindowId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > POC3_MAX_ID_LEN) {
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

// Normalizes a native `internalId` read to the observed public
// representation: the raw string when already a string, otherwise the same
// `String(...)` conversion the project proof scripts use for the QUuid
// property. Returns null when the result is not a valid window id.
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

function isSessionToken(value: unknown): value is Poc3SessionToken {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return isOpaqueId(candidate["owner"]) && isGeneration(candidate["generation"]);
}

function isNonce(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > POC3_MAX_GENERATION_LEN) {
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

function isExpectedRevision(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= POC3_MAX_REVISION
    );
}

function isCorrelationId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= POC3_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > POC3_MAX_GENERATION_LEN
    ) {
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

function isDirection(value: unknown): value is Poc3Direction {
    return value === "left" || value === "right" || value === "up" || value === "down";
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

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

// Bounded array-like decode for KWin QList boundaries. Elements are unknown;
// only reference identity is observed by callers.
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
    if (
        typeof length !== "number" ||
        !Number.isInteger(length) ||
        length < 0 ||
        length > maxLength
    ) {
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

function readNativeRect(value: unknown): Poc3Rect | null {
    if (!isRecord(value)) {
        return null;
    }
    const x = value["x"];
    const y = value["y"];
    const w = value["w"] !== undefined ? value["w"] : value["width"];
    const h = value["h"] !== undefined ? value["h"] : value["height"];
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) {
        return null;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) {
        return null;
    }
    if (
        x < POC3_MIN_ORIGIN ||
        x > POC3_MAX_ORIGIN ||
        y < POC3_MIN_ORIGIN ||
        y > POC3_MAX_ORIGIN ||
        w < POC3_MIN_SIDE ||
        w > POC3_MAX_SIDE ||
        h < POC3_MIN_SIDE ||
        h > POC3_MAX_SIDE
    ) {
        return null;
    }
    return { x, y, w, h };
}

function sameRect(a: Poc3Rect, b: Poc3Rect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function randomToken(prefix: string, lowercase: boolean): string {
    let suffix = "fallback";
    try {
        let raw = "";
        for (let index = 0; index < 4; index += 1) {
            raw += Math.floor(Math.random() * 0x100000000).toString(36);
        }
        suffix = raw;
    } catch (error) {
        void error;
        suffix = "fallback";
    }
    const candidate = `${prefix}-${suffix}`;
    const normalized = lowercase ? candidate.toLowerCase() : candidate;
    return normalized.length <= POC3_MAX_ID_LEN ? normalized : normalized.slice(0, POC3_MAX_ID_LEN);
}

// Manually-started three-window POC3 adapter. Disabled until an explicit
// manual `start` supplies exactly three opaque native identity strings.
// Control surface is exactly start/focus/move/status/stop; no external
// controller protocol is offered (a later unit exposes user CLI).
export class Poc3Adapter {
    private started = false;
    private diverged = false;
    private inFlight = false;
    private requestToken = 0;
    private activeToken = 0;
    private callbackSeen = false;
    private cancelTimer: (() => void) | null = null;
    private seq = 0;
    private owner = "";
    private generation = "";
    private revision = 0;
    private ids: readonly string[] = Object.freeze([]);
    private refs: readonly object[] = Object.freeze([]);
    private rollbacks: readonly string[] = Object.freeze([]);
    private originals: readonly Poc3Rect[] = Object.freeze([]);
    private originalFocusId: string | null = null;
    private sessionRollback = "";
    private outputRef: object | null = null;
    private desktopRef: object | null = null;
    // Persistent-route bindings (absent on the legacy route): the exact
    // planner D-Bus unique owner every EvaluatePoc3 request must target, and
    // the exact expected native app_id per enrolled slot re-checked on every
    // re-resolution before any geometry/focus write.
    private plannerUniqueOwner: string | null = null;
    private expectedAppIds: readonly string[] | null = null;
    // Host-route user-selected scope binding (absent on the legacy route):
    // the exact live output/desktop captured adapter-side from the receipt
    // scope before enrollment. Every resolve re-requires the enrolled scope
    // to equal these refs, and every re-resolution revalidates they are still
    // the live current scope. Read-only; never creates/changes workspaces,
    // outputs, config, shortcuts, or tiles.
    private hostScopeOutput: object | null = null;
    private hostScopeDesktop: object | null = null;
    private pending: Poc3Intent | null = null;
    private focusId: string | null = null;
    private converge: { readonly pending: Poc3Intent; readonly command: string; remaining: number } | null =
        null;
    private convergeCancel: (() => void) | null = null;
    private closeWatch: { remaining: number } | null = null;
    private closeWatchCancel: (() => void) | null = null;
    private restoreWatch: { remaining: number } | null = null;
    private restoreWatchCancel: (() => void) | null = null;
    private oneShot = false;
    private oneShotSettled = false;
    private oneShotNonce = "";
    private lastToken = "";

    constructor(private readonly env: Poc3AdapterEnv) {}

    // Binds the exact planner D-Bus unique owner for all subsequent
    // EvaluatePoc3 transport. Returns false (no binding) on any malformed
    // name; callers must fail closed without transport. This is the D-Bus
    // unique name (`:N.M`), never the session owner token.
    bindPlannerUniqueOwner(uniqueOwner: unknown): boolean {
        if (!isPlannerUniqueOwner(uniqueOwner)) {
            return false;
        }
        this.plannerUniqueOwner = uniqueOwner;
        return true;
    }

    // Binds the exact expected native app_id per enrolled slot (slot order).
    // Checked on every re-resolution before any geometry/focus write; absent
    // means the legacy route (no app-id cross-check).
    bindPersistentAppIds(appIds: unknown): boolean {
        if (!Array.isArray(appIds) || appIds.length !== POC3_WINDOW_COUNT) {
            return false;
        }
        for (const entry of appIds) {
            if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) {
                return false;
            }
        }
        this.expectedAppIds = Object.freeze([...(appIds as string[])]);
        return true;
    }

    // Binds the exact live output/desktop captured adapter-side from the
    // user-selected receipt scope before enrollment. Returns false (no
    // binding) unless both are non-null objects; callers must fail closed
    // without transport. Never creates/changes workspaces or outputs.
    bindHostScope(output: unknown, desktop: unknown): boolean {
        if (typeof output !== "object" || output === null) {
            return false;
        }
        if (typeof desktop !== "object" || desktop === null) {
            return false;
        }
        this.hostScopeOutput = output;
        this.hostScopeDesktop = desktop;
        return true;
    }

    // Read-only live revalidation of the pinned host scope: the pinned
    // output must still be present in `workspace.screens` and the pinned
    // desktop must still be the exact `currentDesktopForScreen(output)`
    // reference. Unpinned (legacy route) passes. No writes, no creation.
    private verifyHostScopeLive(): boolean {
        if (this.hostScopeOutput === null || this.hostScopeDesktop === null) {
            return true;
        }
        const workspace = this.env.workspace;
        if (typeof workspace !== "object" || workspace === null) {
            return false;
        }
        const surface = workspace as Record<string, unknown>;
        let screens: unknown = undefined;
        try {
            screens = surface["screens"];
        } catch (error) {
            void error;
            return false;
        }
        const decoded = decodeList(screens, POC3_MAX_SCREENS);
        if (decoded === null || decoded.indexOf(this.hostScopeOutput) < 0) {
            return false;
        }
        let current: unknown = undefined;
        try {
            const currentFn = surface["currentDesktopForScreen"];
            if (typeof currentFn !== "function") {
                return false;
            }
            current = (currentFn as (output: object) => unknown).call(surface, this.hostScopeOutput);
        } catch (error) {
            void error;
            return false;
        }
        return current === this.hostScopeDesktop;
    }

    private plannerService(): string {
        return this.plannerUniqueOwner ?? POC3_SERVICE;
    }

    getState(): Poc3AdapterState {
        return {
            started: this.started,
            diverged: this.diverged,
            inFlight: this.inFlight,
            pending: this.pending !== null,
            revision: this.revision,
            enrolled: this.ids,
            focus: this.focusId,
        };
    }

    start(ids: readonly unknown[], options?: Poc3StartOptions): void {
        // The explicit user-selected cleanup model is validated first: only
        // the literal "close-disposable" is supported and there is no
        // default. Absent or any other value rejects before any native read,
        // native write, or transport, so a non-disposable or missing-cleanup
        // start can never send D-Bus or close.
        if (options?.cleanup !== POC3_CLEANUP_MODEL) {
            this.reject("poc3-cleanup-model");
            return;
        }
        if (this.started) {
            this.reject("poc3-session-active");
            return;
        }
        if (this.inFlight) {
            this.reject("poc3-busy");
            return;
        }
        if (!Array.isArray(ids) || ids.length !== POC3_WINDOW_COUNT) {
            this.reject("poc3-window-count");
            return;
        }
        const first = ids[0];
        const second = ids[1];
        const third = ids[2];
        if (!isWindowId(first) || !isWindowId(second) || !isWindowId(third)) {
            this.reject("poc3-invalid-id");
            return;
        }
        const supplied: readonly string[] = Object.freeze([first, second, third]);
        if (first === second || first === third || second === third) {
            this.reject("poc3-duplicate-id");
            return;
        }
        const gap = options?.gap === undefined ? POC3_DEFAULT_GAP : options.gap;
        if (typeof gap !== "number" || !Number.isInteger(gap) || gap < 0 || gap > POC3_MAX_GAP) {
            this.reject("poc3-invalid-gap");
            return;
        }
        const resolved = this.resolveScope(supplied);
        if (!resolved.ok) {
            this.reject(resolved.reason);
            return;
        }
        let usable: Poc3Rect | null = null;
        if (options?.usable !== undefined) {
            usable = readNativeRect(options.usable);
            if (usable === null) {
                this.reject("poc3-invalid-geometry");
                return;
            }
        } else {
            usable = this.readUsableArea(resolved.output, resolved.desktop);
            if (usable === null) {
                this.reject("poc3-invalid-geometry");
                return;
            }
        }
        const enrolled = this.captureRollback(supplied, resolved.refs, usable);
        if (!enrolled.ok) {
            this.reject(enrolled.reason);
            return;
        }
        // Explicit session token when the caller supplies one (per-command
        // route binds the same engine session across separately loaded
        // bundles); otherwise a fresh random token (direct class-level use).
        let owner = "";
        let generation = "";
        if (options?.session !== undefined) {
            if (!isSessionToken(options.session)) {
                this.reject("poc3-invalid-identity");
                return;
            }
            owner = options.session.owner;
            generation = options.session.generation;
        } else {
            owner = randomToken("owner", false);
            if (!isOpaqueId(owner)) {
                owner = "owner-fallback";
            }
            generation = randomToken("poc3", true);
            if (!isGeneration(generation)) {
                generation = "poc3-fallback";
            }
        }
        if (options?.nonce !== undefined && !isNonce(options.nonce)) {
            this.reject("poc3-invalid-identity");
            return;
        }
        const correlation = `${generation}-s${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("poc3-invalid-identity");
            return;
        }
        const request = {
            v: POC3_CONTRACT_VERSION,
            command: "start",
            correlation_id: correlation,
            owner,
            generation,
            scope: POC3_SCOPE_ALIAS,
            usable: { x: usable.x, y: usable.y, w: usable.w, h: usable.h },
            gap,
            windows: enrolled.windows.map((window) => ({
                id: window.id,
                scope: POC3_SCOPE_ALIAS,
                rollback: window.rollback,
            })),
            session_rollback: enrolled.sessionRollback,
            capabilities: { untiled_asserted: true, disposable: true, restore_capable: true },
            cleanup: POC3_CLEANUP_MODEL,
        };
        let requestJson = "";
        try {
            requestJson = JSON.stringify(request);
        } catch (error) {
            void error;
            this.reject("poc3-invalid-intent");
            return;
        }
        if (requestJson.length > POC3_MAX_REQUEST_BYTES) {
            this.reject("poc3-oversized");
            return;
        }
        this.owner = owner;
        this.generation = generation;
        this.revision = 0;
        this.ids = supplied;
        this.refs = resolved.refs;
        this.rollbacks = Object.freeze(enrolled.windows.map((window) => window.rollback));
        this.originals = Object.freeze(enrolled.windows.map((window) => window.geometry));
        this.originalFocusId = enrolled.originalFocusId;
        this.sessionRollback = enrolled.sessionRollback;
        this.outputRef = resolved.output;
        this.desktopRef = resolved.desktop;
        this.focusId = enrolled.originalFocusId;
        this.sendRequest("start", requestJson, correlation, (parsed) =>
            this.onIntentReply(parsed, correlation, "start", 0),
        );
        // `started` flips only when the engine answers with an intent; the
        // pending dispatch is tracked via inFlight until then.
    }

    focus(direction: unknown): void {
        this.dispatchDirection("focus", direction);
    }

    move(direction: unknown): void {
        this.dispatchDirection("move", direction);
    }

    status(): void {
        if (
            this.inFlight ||
            this.converge !== null ||
            this.closeWatch !== null ||
            this.restoreWatch !== null
        ) {
            this.reject("poc3-busy");
            return;
        }
        if (!this.verifyHostScopeLive()) {
            this.reject("poc3-stale-scope");
            return;
        }
        const correlation = `${this.generation === "" ? "poc3-status" : this.generation}-s${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("poc3-invalid-identity");
            return;
        }
        let requestJson = "";
        try {
            requestJson = JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                command: "status",
                correlation_id: correlation,
            });
        } catch (error) {
            void error;
            this.reject("poc3-invalid-intent");
            return;
        }
        this.sendRequest("status", requestJson, correlation, (parsed) =>
            this.onStatusReply(parsed, correlation),
        );
    }

    stop(options?: Poc3StopOptions): void {
        // Cleanup/termination is available once session identity exists:
        // after a start attempt (even one lost to timeout) as well as while
        // started or divergent. The engine answers stop with a directive for
        // exactly the enrolled three, or a redacted rejection that still
        // terminates local state. Never blocked by divergence.
        // `restore: true` is class-level test-only (no user command reaches
        // it; the one-shot route always sends confirm_restore false).
        if (this.inFlight || this.closeWatch !== null || this.restoreWatch !== null) {
            this.reject("poc3-busy");
            return;
        }
        if (!this.started && this.owner === "") {
            this.reject("poc3-disabled");
            return;
        }
        const confirmRestore = options?.restore === true;
        // Stopping abandons local convergence observation: the engine intent
        // is still pending, so the engine records the explicit
        // abandoned-pending cleanup state instead of silently erasing it.
        this.cancelConvergence();
        this.sendStopRequest(confirmRestore, this.revision);
    }

    private sendStopRequest(confirmRestore: boolean, expected: number): void {
        const correlation = `${this.generation}-s${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("poc3-invalid-identity");
            return;
        }
        let requestJson = "";
        try {
            requestJson = JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                command: "stop",
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                expected_revision: expected,
                confirm_restore: confirmRestore,
            });
        } catch (error) {
            void error;
            this.reject("poc3-invalid-intent");
            return;
        }
        if (requestJson.length > POC3_MAX_REQUEST_BYTES) {
            this.reject("poc3-oversized");
            return;
        }
        this.sendRequest("stop", requestJson, correlation, (parsed) =>
            this.onStopReply(parsed, correlation, confirmRestore),
        );
    }

    // One-shot per-command execution for separately bundled command IIFEs.
    // Each loaded command bundle carries exactly one validated config; this
    // method revalidates it strictly, re-resolves the exact supplied IDs and
    // scope from scratch, binds the manually supplied session token, runs
    // exactly one command against the Rust service, and reports a bounded
    // `poc3-command-done:<nonce>:<token>` diagnostic at every terminal
    // outcome so the lifecycle tool can unload the exact script id. The
    // adapter instance is single-use: a second call rejects busy. No generic
    // command execution, no shortcut, no restore (closure-only route), no
    // persistence, no config mutation.
    runCommand(config: unknown): void {
        if (this.oneShot || this.started || this.inFlight) {
            this.reject("poc3-busy");
            return;
        }
        const parsed = parseCommandConfig(config);
        if (parsed === null) {
            this.reject("poc3-invalid-command");
            return;
        }
        if (!isNonce(parsed.nonce)) {
            this.reject("poc3-invalid-identity");
            return;
        }
        this.oneShot = true;
        this.oneShotSettled = false;
        this.oneShotNonce = parsed.nonce;
        if (parsed.command === "status") {
            this.owner = parsed.owner;
            this.generation = parsed.generation;
            this.status();
            return;
        }
        const ids = parsed.ids;
        if (ids === null || !isExpectedRevision(parsed.expectedRevision)) {
            this.reject("poc3-invalid-command");
            return;
        }
        if (parsed.command === "focus" || parsed.command === "move") {
            if (parsed.direction === null) {
                this.reject("poc3-invalid-direction");
                return;
            }
        }
        const supplied: readonly string[] = Object.freeze([ids[0], ids[1], ids[2]] as readonly string[]);
        if (supplied.some((id) => !isWindowId(id))) {
            this.reject("poc3-invalid-id");
            return;
        }
        if (supplied[0] === supplied[1] || supplied[0] === supplied[2] || supplied[1] === supplied[2]) {
            this.reject("poc3-duplicate-id");
            return;
        }
        if (parsed.command === "start") {
            this.start(supplied, {
                cleanup: POC3_CLEANUP_MODEL,
                session: { owner: parsed.owner, generation: parsed.generation },
                gap: parsed.gap === null ? undefined : parsed.gap,
                usable: parsed.usable === null ? undefined : parsed.usable,
                nonce: parsed.nonce,
            });
            return;
        }
        const resolved = this.resolveScope(supplied);
        if (!resolved.ok) {
            this.reject(resolved.reason);
            return;
        }
        this.owner = parsed.owner;
        this.generation = parsed.generation;
        this.revision = parsed.expectedRevision;
        this.ids = supplied;
        this.refs = resolved.refs;
        this.outputRef = resolved.output;
        this.desktopRef = resolved.desktop;
        if (parsed.command === "focus" || parsed.command === "move") {
            this.sendDirectionRequest(parsed.command, parsed.direction as Poc3Direction, parsed.expectedRevision);
            return;
        }
        this.sendStopRequest(false, parsed.expectedRevision);
    }

    private dispatchDirection(kind: "focus" | "move", direction: unknown): void {
        if (!this.started) {
            this.reject("poc3-disabled");
            return;
        }
        if (this.diverged) {
            this.reject("poc3-diverged");
            return;
        }
        if (
            this.inFlight ||
            this.pending !== null ||
            this.converge !== null ||
            this.closeWatch !== null ||
            this.restoreWatch !== null
        ) {
            this.reject("poc3-busy");
            return;
        }
        if (!isDirection(direction)) {
            this.reject("poc3-invalid-direction");
            return;
        }
        this.sendDirectionRequest(kind, direction, this.revision);
    }

    private sendDirectionRequest(kind: "focus" | "move", direction: Poc3Direction, expected: number): void {
        const correlation = `${this.generation}-s${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("poc3-invalid-identity");
            return;
        }
        let requestJson = "";
        try {
            requestJson = JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                command: kind,
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                expected_revision: expected,
                direction,
            });
        } catch (error) {
            void error;
            this.reject("poc3-invalid-intent");
            return;
        }
        if (requestJson.length > POC3_MAX_REQUEST_BYTES) {
            this.reject("poc3-oversized");
            return;
        }
        this.sendRequest(kind, requestJson, correlation, (parsed) =>
            this.onIntentReply(parsed, correlation, kind, expected),
        );
    }

    private resolveScope(supplied: readonly string[]):
        | { readonly ok: true; readonly refs: readonly object[]; readonly output: object; readonly desktop: object }
        | { readonly ok: false; readonly reason: string } {
        const workspace = this.env.workspace;
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
        const windows = decodeList(windowList, POC3_MAX_WINDOW_LIST);
        if (windows === null) {
            return { ok: false, reason: "poc3-invalid-scope" };
        }
        const refs: object[] = [];
        for (const id of supplied) {
            const matches: object[] = [];
            for (const candidate of windows) {
                if (typeof candidate !== "object" || candidate === null) {
                    continue;
                }
                // Stable-ish native identity: the observed public
                // representation `String(Window.internalId)` compared by
                // strict string equality. Only exact supplied IDs resolve;
                // nothing is inferred.
                const nativeId = normalizeNativeId(readProp(candidate, "internalId"));
                if (nativeId !== null && nativeId === id) {
                    matches.push(candidate);
                }
            }
            if (matches.length === 0) {
                return { ok: false, reason: "poc3-unknown-id" };
            }
            if (matches.length > 1) {
                return { ok: false, reason: "poc3-duplicate-native" };
            }
            const found = matches[0];
            if (found === undefined) {
                return { ok: false, reason: "poc3-unknown-id" };
            }
            refs.push(found);
        }
        for (const ref of refs) {
            const eligibility = checkEligibility(ref);
            if (!eligibility.ok) {
                return eligibility;
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
            screens = (surface["screens"] as unknown);
        } catch (error) {
            void error;
            return { ok: false, reason: "poc3-invalid-scope" };
        }
        const decodedScreens = decodeList(screens, POC3_MAX_SCREENS);
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
            const membership = decodeList(readProp(ref, "desktops"), POC3_MAX_SCREENS);
            if (membership === null || membership.indexOf(desktopObject) < 0) {
                return { ok: false, reason: "poc3-cross-workspace" };
            }
        }
        if (this.hostScopeOutput !== null || this.hostScopeDesktop !== null) {
            if (this.hostScopeOutput === null || this.hostScopeDesktop === null) {
                return { ok: false, reason: "poc3-stale-scope" };
            }
            if (output !== this.hostScopeOutput || desktopObject !== this.hostScopeDesktop) {
                return { ok: false, reason: "poc3-scope-mismatch" };
            }
            if (!this.verifyHostScopeLive()) {
                return { ok: false, reason: "poc3-stale-scope" };
            }
        }
        return { ok: true, refs: Object.freeze(refs), output, desktop: desktopObject };
    }

    private readUsableArea(output: object, desktop: object): Poc3Rect | null {
        const surface = this.env.workspace as Record<string, unknown>;
        try {
            const clientArea = surface["clientArea"];
            if (typeof clientArea === "function") {
                const area = (clientArea as (option: number, output: object, desktop: object) => unknown).call(
                    surface,
                    POC3_CLIENT_AREA_OPTION,
                    output,
                    desktop,
                );
                const rect = readNativeRect(area);
                if (rect !== null) {
                    return rect;
                }
            }
        } catch (error) {
            void error;
        }
        const geometry = readProp(output, "geometry");
        return readNativeRect(geometry);
    }

    private captureRollback(
        supplied: readonly string[],
        refs: readonly object[],
        usable: Poc3Rect,
    ):
        | {
              readonly ok: true;
              readonly windows: readonly EnrolledNative[];
              readonly sessionRollback: string;
              readonly originalFocusId: string | null;
          }
        | { readonly ok: false; readonly reason: string } {
        void usable;
        const active = this.readActiveWindow();
        const windows: EnrolledNative[] = [];
        for (let index = 0; index < supplied.length; index += 1) {
            const id = supplied[index];
            const ref = refs[index];
            if (id === undefined || ref === undefined) {
                return { ok: false, reason: "poc3-unknown-id" };
            }
            const geometry = readNativeRect(readProp(ref, "frameGeometry"));
            if (geometry === null) {
                return { ok: false, reason: "poc3-invalid-geometry" };
            }
            const wasActive = active !== null && active === ref;
            let rollback = "";
            try {
                rollback = JSON.stringify({ g: [geometry.x, geometry.y, geometry.w, geometry.h], a: wasActive ? 1 : 0 });
            } catch (error) {
                void error;
                return { ok: false, reason: "poc3-invalid-intent" };
            }
            if (rollback.length > POC3_MAX_ROLLBACK_BYTES) {
                return { ok: false, reason: "poc3-rollback-oversized" };
            }
            windows.push({ id, ref, geometry, rollback, wasActive });
        }
        let sessionRollback = "";
        try {
            const activeId = windows.find((window) => window.wasActive)?.id ?? "";
            sessionRollback = JSON.stringify({ a: activeId });
        } catch (error) {
            void error;
            return { ok: false, reason: "poc3-invalid-intent" };
        }
        if (sessionRollback.length > POC3_MAX_ROLLBACK_BYTES) {
            return { ok: false, reason: "poc3-rollback-oversized" };
        }
        const focused = windows.find((window) => window.wasActive) ?? null;
        return {
            ok: true,
            windows: Object.freeze(windows),
            sessionRollback,
            originalFocusId: focused === null ? null : focused.id,
        };
    }

    private readActiveWindow(): object | null {
        try {
            const surface = this.env.workspace as Record<string, unknown>;
            const active = surface["activeWindow"];
            if (typeof active === "function") {
                const resolved = (active as () => unknown).call(surface);
                return typeof resolved === "object" && resolved !== null ? resolved : null;
            }
            return typeof active === "object" && active !== null ? (active as object) : null;
        } catch (error) {
            void error;
            return null;
        }
    }

    private sendRequest(
        kind: string,
        payload: string,
        correlation: string,
        onReply: (parsed: unknown) => void,
    ): void {
        if (this.inFlight) {
            this.reject("poc3-busy");
            return;
        }
        if (payload.length > POC3_MAX_REQUEST_BYTES) {
            this.reject("poc3-oversized");
            return;
        }
        this.inFlight = true;
        this.callbackSeen = false;
        this.requestToken += 1;
        const token = this.requestToken;
        this.activeToken = token;
        let timerCancel: (() => void) | null = null;
        try {
            timerCancel = this.env.scheduleOnce(POC3_TIMEOUT_MS, () => this.onTimeout(token, kind));
        } catch (error) {
            void error;
            this.inFlight = false;
                this.reject("poc3-timer-failed");
            return;
        }
        this.cancelTimer = timerCancel;
        void correlation;
        try {
            this.env.callDbus(
                this.plannerService(),
                POC3_OBJECT,
                POC3_INTERFACE,
                POC3_METHOD,
                payload,
                (reply) => {
                    // Late/duplicate replies from an earlier token never
                    // consume a newer flight. No retry/queue: at most the
                    // current token is honored exactly once.
                    if (token !== this.activeToken || this.callbackSeen) {
                        return;
                    }
                    onReply(reply);
                },
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
                this.failClosed("poc3-dbus-failed");
        }
    }

    private onTimeout(token: number, kind: string): void {
        if (!this.inFlight || token !== this.activeToken) {
            return;
        }
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        // Absent service never invokes the callback: surface as a timeout and
        // fail closed to the cleanup/termination path only. No retry/queue.
        this.failClosed(`poc3-timeout:${kind}`);
    }

    private onIntentReply(
        reply: unknown,
        correlation: string,
        command: string,
        expectedRevision: number,
    ): void {
        if (!this.inFlight || this.callbackSeen) {
            return;
        }
        this.takeReply();
        const parsed = parseBoundedReply(reply);
        if (parsed === null) {
            this.intentFailed("poc3-reply-malformed", expectedRevision, command);
            return;
        }
        if (!checkEnvelope(parsed, correlation, command)) {
            this.intentFailed("poc3-identity-mismatch", expectedRevision, command);
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "noop") {
            this.pending = null;
            this.diag(`poc3-noop:${command}`);
            this.settleOneShot(`poc3-noop:${command}`);
            return;
        }
        if (outcome !== "ok" || !isRecord(parsed["intent"])) {
            if (isRecord(parsed["error"]) && parsed["error"]["kind"] === "divergent-fail-closed") {
                this.diverged = true;
                this.diag("poc3-diverged");
                return;
            }
            this.intentFailed("poc3-rejected", expectedRevision, command);
            return;
        }
        const intent = parseIntent(parsed["intent"] as Record<string, unknown>, this.ids);
        if (intent === null || intent.baseRevision !== expectedRevision) {
            this.intentFailed("poc3-identity-mismatch", expectedRevision, command);
            return;
        }
        this.pending = intent;
        if (command === "start") {
            this.started = true;
        }
        this.actuatePending(command);
    }

    private onStatusReply(reply: unknown, correlation: string): void {
        if (!this.inFlight || this.callbackSeen) {
            return;
        }
        this.takeReply();
        const parsed = parseBoundedReply(reply);
        if (parsed === null || !checkEnvelope(parsed, correlation, "status")) {
            this.diag("poc3-status-unverified");
            this.settleOneShot("poc3-status-unverified");
            return;
        }
        if (parsed["outcome"] !== "ok" || !isRecord(parsed["status"])) {
            this.diag("poc3-status-unverified");
            this.settleOneShot("poc3-status-unverified");
            return;
        }
        // Adapter status reports the revision state: strict fixed-state plus
        // numeric revision only, never enrolled identities or envelopes.
        const body = parsed["status"] as Record<string, unknown>;
        const state = body["state"];
        const revision = body["revision"];
        if (
            (state !== "disabled" && state !== "active" && state !== "divergent") ||
            typeof revision !== "number" ||
            !Number.isInteger(revision) ||
            revision < 0 ||
            revision > POC3_MAX_REVISION
        ) {
            this.diag("poc3-status-unverified");
            this.settleOneShot("poc3-status-unverified");
            return;
        }
        this.diag(`poc3-status:${state}:${String(revision)}`);
        this.settleOneShot(`poc3-status:${state}:${String(revision)}`);
    }

    private onStopReply(reply: unknown, correlation: string, confirmRestore: boolean): void {
        if (!this.inFlight || this.callbackSeen) {
            return;
        }
        this.takeReply();
        const parsed = parseBoundedReply(reply);
        if (parsed === null || !checkEnvelope(parsed, correlation, "stop")) {
            this.diag("poc3-cleanup-unverified");
            this.terminate();
            return;
        }
        if (parsed["outcome"] !== "ok" || !isRecord(parsed["cleanup"])) {
            this.diag("poc3-cleanup-unverified");
            this.terminate();
            return;
        }
        const cleanup = parsed["cleanup"] as Record<string, unknown>;
        const action = cleanup["action"];
        const ids = cleanup["ids"];
        if (
            (action !== "close-disposable" &&
                action !== "abandoned-pending-close" &&
                action !== "restore-enrolled") ||
            !Array.isArray(ids) ||
            ids.length !== POC3_WINDOW_COUNT
        ) {
            this.diag("poc3-cleanup-mismatch");
            this.terminate();
            return;
        }
        const seen = new Set<string>();
        for (const id of ids) {
            if (typeof id !== "string" || this.ids.indexOf(id) < 0 || seen.has(id)) {
                this.diag("poc3-cleanup-mismatch");
                this.terminate();
                return;
            }
            seen.add(id);
        }
        // Cleanup directives apply only to the identity-pinned enrolled three.
        // Closure runs only for an explicit `stop` whose engine reply is
        // exactly `close-disposable` for the enrolled three: each ref is
        // freshly re-resolved (same object reference, continued eligibility,
        // unchanged scope output/workspace), confirmed to expose the public
        // scripting close method with user-closeable state, invoked on the
        // exact three only, then verified to have left the current window
        // list. Any gap fails closed with no close invoked; a failed
        // verification reports cleanup failure with leave state. No other
        // command path ever closes a window.
        // Closure runs only for an explicit `stop` whose engine reply is a
        // closure-only directive for the enrolled three. The per-command
        // route never confirms restore, so it only ever takes this branch;
        // `abandoned-pending-close` additionally records that the engine had
        // to abandon a pending unverified intent.
        if (action === "close-disposable" || action === "abandoned-pending-close") {
            if (confirmRestore) {
                this.diag("poc3-cleanup-mismatch");
                this.terminate();
                return;
            }
            if (action === "abandoned-pending-close") {
                this.diag("poc3-abandoned-pending");
            }
            this.closeDisposableEnrolled();
            return;
        }
        if (!confirmRestore) {
            this.diag("poc3-cleanup-mismatch");
            this.terminate();
            return;
        }
        this.restoreEnrolled(cleanup);
    }

    private closeDisposableEnrolled(): void {
        const resolved = this.reresolve("poc3-cleanup-mismatch");
        if (resolved === null) {
            this.terminate();
            return;
        }
        for (let index = 0; index < this.ids.length; index += 1) {
            const ref = resolved[index];
            if (ref === undefined) {
                this.diag("poc3-cleanup-mismatch");
                this.terminate();
                return;
            }
            if (readProp(ref, "closeable") !== true) {
                this.diag("poc3-cleanup-mismatch");
                this.terminate();
                return;
            }
            if (typeof readProp(ref, "closeWindow") !== "function") {
                this.diag("poc3-cleanup-mismatch");
                this.terminate();
                return;
            }
        }
        try {
            for (const ref of resolved) {
                const closer = readProp(ref, "closeWindow") as () => unknown;
                closer.call(ref);
            }
        } catch (error) {
            void error;
            this.diag("poc3-cleanup-failed");
            this.terminate();
            return;
        }
        // Observed closure only (never an immediate closed claim): a bounded
        // QTimer poll loop verifies all three actually left the window list.
        // Expiry reports cleanup failure with user-visible residue, not
        // success. Finite, zero signal subscriptions, no further intents.
        this.beginCloseWatch();
    }

    private beginCloseWatch(): void {
        this.cancelCloseWatch();
        this.closeWatch = { remaining: POC3_CLOSE_CHECKS };
        this.pollCloseWatch();
    }

    private cancelCloseWatch(): void {
        this.closeWatch = null;
        const cancel = this.closeWatchCancel;
        this.closeWatchCancel = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    private haveAllLeftList(): boolean | null {
        // True when every enrolled id is absent, false when any remains,
        // null when the list itself is unreadable.
        try {
            const surface = this.env.workspace as Record<string, unknown>;
            const lister = surface["windowList"];
            if (typeof lister !== "function") {
                return null;
            }
            const current = decodeList(
                (lister as () => unknown).call(surface),
                POC3_MAX_WINDOW_LIST,
            );
            if (current === null) {
                return null;
            }
            for (const id of this.ids) {
                for (const candidate of current) {
                    if (
                        typeof candidate === "object" &&
                        candidate !== null &&
                        normalizeNativeId(readProp(candidate, "internalId")) === id
                    ) {
                        return false;
                    }
                }
            }
            return true;
        } catch (error) {
            void error;
            return null;
        }
    }

    private pollCloseWatch(): void {
        this.closeWatchCancel = null;
        const state = this.closeWatch;
        if (state === null) {
            return;
        }
        const left = this.haveAllLeftList();
        if (left === true) {
            this.closeWatch = null;
            this.diag("poc3-stopped:close-disposable");
            this.settleOneShot("poc3-stopped:close-disposable");
            this.terminate();
            return;
        }
        if (state.remaining <= 1) {
            this.closeWatch = null;
            this.diag("poc3-cleanup-failed");
            this.settleOneShot("poc3-cleanup-failed");
            this.terminate();
            return;
        }
        state.remaining -= 1;
        try {
            this.closeWatchCancel = this.env.scheduleOnce(POC3_CLOSE_INTERVAL_MS, () =>
                this.pollCloseWatch(),
            );
        } catch (error) {
            void error;
            this.closeWatch = null;
            this.diag("poc3-cleanup-failed");
            this.settleOneShot("poc3-cleanup-failed");
            this.terminate();
        }
    }

    private restoreEnrolled(cleanup: Record<string, unknown>): void {
        // Test-only restore path (direct class-level `stop({ restore: true })`
        // only; the one-shot per-command route never confirms restore). No
        // synchronous success is claimed here: the originals are written and
        // then observed on the bounded restore poll loop.
        if (!isRecord(cleanup["envelopes"])) {
            this.diag("poc3-restore-mismatch");
            this.terminate();
            return;
        }
        const envelopes = cleanup["envelopes"] as Record<string, unknown>;
        for (let index = 0; index < this.ids.length; index += 1) {
            const id = this.ids[index];
            const expected = this.rollbacks[index];
            if (id === undefined || expected === undefined || envelopes[id] !== expected) {
                this.diag("poc3-restore-mismatch");
                this.terminate();
                return;
            }
        }
        if (cleanup["session_envelope"] !== this.sessionRollback) {
            this.diag("poc3-restore-mismatch");
            this.terminate();
            return;
        }
        const resolved = this.reresolve("poc3-restore-mismatch");
        if (resolved === null) {
            this.terminate();
            return;
        }
        try {
            for (let index = 0; index < this.ids.length; index += 1) {
                const ref = resolved[index];
                const original = this.originals[index];
                if (ref === undefined || original === undefined) {
                    this.diag("poc3-restore-mismatch");
                    this.terminate();
                    return;
                }
                Reflect.set(ref, "frameGeometry", {
                    x: original.x,
                    y: original.y,
                    width: original.w,
                    height: original.h,
                });
            }
            if (this.originalFocusId !== null) {
                const focusIndex = this.ids.indexOf(this.originalFocusId);
                const focusRef = resolved[focusIndex];
                if (focusIndex < 0 || focusRef === undefined) {
                    this.diag("poc3-restore-mismatch");
                    this.terminate();
                    return;
                }
                const surface = this.env.workspace as Record<string, unknown>;
                surface["activeWindow"] = focusRef;
            }
        } catch (error) {
            void error;
            this.diag("poc3-restore-mismatch");
            this.terminate();
            return;
        }
        // Observed restore only (never a synchronous restored claim): a
        // bounded QTimer poll loop verifies the exact original geometry plus
        // focus is actually observed. Expiry reports a fixed restore failure
        // with residue, never success. Finite, zero signal subscriptions, no
        // retries, no further engine intents, no atomic/configure-ack claim.
        this.beginRestoreWatch();
    }

    private beginRestoreWatch(): void {
        this.cancelRestoreWatch();
        this.restoreWatch = { remaining: POC3_RESTORE_CHECKS };
        this.pollRestoreWatch();
    }

    private cancelRestoreWatch(): void {
        this.restoreWatch = null;
        const cancel = this.restoreWatchCancel;
        this.restoreWatchCancel = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    private isRestoreConverged(): boolean | null {
        // True when every original geometry plus focus is observed, false
        // when the state is readable but not yet converged, null when the
        // enrolled refs or native state are unreadable.
        const resolved = this.reresolve(null);
        if (resolved === null) {
            return null;
        }
        for (let index = 0; index < this.ids.length; index += 1) {
            const ref = resolved[index];
            const original = this.originals[index];
            if (ref === undefined || original === undefined) {
                return null;
            }
            const current = readNativeRect(readProp(ref, "frameGeometry"));
            if (current === null || !sameRect(current, original)) {
                return false;
            }
        }
        if (this.originalFocusId !== null) {
            const focusIndex = this.ids.indexOf(this.originalFocusId);
            const focusRef = resolved[focusIndex];
            if (focusRef === undefined || this.readActiveWindow() !== focusRef) {
                return false;
            }
        }
        return true;
    }

    private pollRestoreWatch(): void {
        this.restoreWatchCancel = null;
        const state = this.restoreWatch;
        if (state === null) {
            return;
        }
        const converged = this.isRestoreConverged();
        if (converged === true) {
            this.restoreWatch = null;
            this.diag("poc3-stopped:restore-enrolled");
            this.settleOneShot("poc3-stopped:restore-enrolled");
            this.terminate();
            return;
        }
        if (converged === null) {
            this.restoreWatch = null;
            this.diag("poc3-restore-failed");
            this.settleOneShot("poc3-restore-failed");
            this.terminate();
            return;
        }
        if (state.remaining <= 1) {
            this.restoreWatch = null;
            this.diag("poc3-restore-failed");
            this.settleOneShot("poc3-restore-failed");
            this.terminate();
            return;
        }
        state.remaining -= 1;
        try {
            this.restoreWatchCancel = this.env.scheduleOnce(POC3_RESTORE_INTERVAL_MS, () =>
                this.pollRestoreWatch(),
            );
        } catch (error) {
            void error;
            this.restoreWatch = null;
            this.diag("poc3-restore-failed");
            this.settleOneShot("poc3-restore-failed");
            this.terminate();
        }
    }

    private actuatePending(command: string): void {
        const pending = this.pending;
        if (pending === null) {
            this.intentFailed("poc3-invalid-intent", this.revision, command);
            return;
        }
        // Immediate pre-write re-resolution: same references, eligibility,
        // app-id/scope, output/workspace. /proc and KWin cannot be bound
        // atomically; any observable drift fails before any write.
        const resolved = this.reresolve(null);
        if (resolved === null) {
            this.reportDivergent(pending, "window-missing");
            return;
        }
        // Intent geometry must lie inside the currently observed output/client
        // area before any write; out-of-output intents fail closed with no
        // writes. This holds for both the derived-usable persistent route and
        // the operator-usable legacy route.
        if (!this.intentFitsObservedArea(pending)) {
            this.diag("poc3-geometry-out-of-output");
            this.reportDivergent(pending, "geometry-mismatch");
            return;
        }
        // Sequential native actuation only: frameGeometry writes for all three
        // explicitly enrolled IDs, then workspace.activeWindow focus. No tile,
        // shortcut, desktop, output, persistence, tray, or KCM route exists.
        // Partial sequential writes plus complete transport loss fail closed:
        // a divergent report is attempted when transport allows, and status
        // (engine revision advance only on applied ack) never calls it applied.
        let wrote = 0;
        try {
            for (const desired of pending.desired) {
                const index = this.ids.indexOf(desired.id);
                const ref = resolved[index];
                if (index < 0 || ref === undefined) {
                    this.reportDivergent(pending, "window-missing");
                    return;
                }
                Reflect.set(ref, "frameGeometry", {
                    x: desired.rect.x,
                    y: desired.rect.y,
                    width: desired.rect.w,
                    height: desired.rect.h,
                });
                wrote += 1;
            }
            const focusIndex = this.ids.indexOf(pending.focus);
            const focusRef = resolved[focusIndex];
            if (focusIndex < 0 || focusRef === undefined) {
                this.reportDivergent(pending, "window-missing");
                return;
            }
            const surface = this.env.workspace as Record<string, unknown>;
            surface["activeWindow"] = focusRef;
        } catch (error) {
            void error;
            this.reportDivergent(pending, wrote === 0 ? "window-missing" : "partial-application");
            return;
        }
        // Observed convergence only (never an atomic or Wayland configure
        // acknowledgement): the writes above are followed by a bounded QTimer
        // poll loop that reports `applied` only when the desired frame
        // geometry plus focus is actually observed. Expiry reports divergent.
        this.beginConvergence(pending, command);
    }

    private beginConvergence(pending: Poc3Intent, command: string): void {
        this.cancelConvergence();
        this.converge = { pending, command, remaining: POC3_CONVERGE_CHECKS };
        this.pollConvergence();
    }

    private cancelConvergence(): void {
        this.converge = null;
        const cancel = this.convergeCancel;
        this.convergeCancel = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    private scheduleConvergencePoll(): void {
        this.convergeCancel = null;
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(POC3_CONVERGE_INTERVAL_MS, () => this.pollConvergence());
        } catch (error) {
            void error;
            this.converge = null;
            this.failClosed("poc3-timer-failed");
            return;
        }
        this.convergeCancel = cancel;
    }

    // Single convergence check: finite, single-flight (pending is set, so no
    // new intent can dispatch), zero window/workspace signal subscriptions,
    // and never dispatching another intent — read-only observation only.
    private pollConvergence(): void {
        this.convergeCancel = null;
        const state = this.converge;
        if (state === null) {
            return;
        }
        const resolved = this.reresolve(null);
        if (resolved === null) {
            const pending = state.pending;
            this.converge = null;
            this.reportDivergent(pending, "window-missing");
            return;
        }
        let matched = 0;
        let readable = true;
        for (const desired of state.pending.desired) {
            const index = this.ids.indexOf(desired.id);
            const ref = resolved[index];
            if (index < 0 || ref === undefined) {
                readable = false;
                break;
            }
            const current = readNativeRect(readProp(ref, "frameGeometry"));
            if (current === null) {
                readable = false;
                break;
            }
            if (sameRect(current, desired.rect)) {
                matched += 1;
            }
        }
        const focusIndex = this.ids.indexOf(state.pending.focus);
        const focusRef = resolved[focusIndex];
        const focusObserved = focusRef !== undefined && this.readActiveWindow() === focusRef;
        if (readable && matched === POC3_WINDOW_COUNT && focusObserved) {
            const pending = state.pending;
            this.converge = null;
            if (this.focusId !== pending.focus) {
                this.focusId = pending.focus;
            }
            this.sendComplete(pending, "applied", null);
            return;
        }
        if (state.remaining <= 1) {
            const pending = state.pending;
            this.converge = null;
            this.diag("poc3-converge-expired");
            let reason = "partial-application";
            if (!readable || matched === 0) {
                reason = "geometry-mismatch";
            }
            if (readable && matched === POC3_WINDOW_COUNT && !focusObserved) {
                reason = "focus-unverified";
            }
            this.reportDivergent(pending, reason);
            return;
        }
        state.remaining -= 1;
        this.scheduleConvergencePoll();
    }

    // Fresh re-resolution of the exact enrolled handles/IDs before any
    // actuation: same object references, continued eligibility, expected
    // native app-id per slot when bound (persistent route), unchanged
    // scope output/workspace, pinned host scope still live-current, and no
    // tile association or special-state drift.
    // /proc liveness stays shell-side; this seam fails before writes on all
    // KWin-observable drift. No atomic /proc+KWin binding is claimed.
    private reresolve(failureReason: string | null): readonly object[] | null {
        if (!this.verifyHostScopeLive()) {
            this.diag("poc3-stale-scope");
            if (failureReason !== null) {
                this.diag(failureReason);
            }
            return null;
        }
        const workspace = this.env.workspace;
        if (typeof workspace !== "object" || workspace === null) {
            if (failureReason !== null) {
                this.diag(failureReason);
            }
            return null;
        }
        const surface = workspace as Record<string, unknown>;
        let windowList: unknown = undefined;
        try {
            const lister = surface["windowList"];
            if (typeof lister !== "function") {
                if (failureReason !== null) {
                    this.diag(failureReason);
                }
                return null;
            }
            windowList = (lister as () => unknown).call(surface);
        } catch (error) {
            void error;
            if (failureReason !== null) {
                this.diag(failureReason);
            }
            return null;
        }
        const windows = decodeList(windowList, POC3_MAX_WINDOW_LIST);
        if (windows === null) {
            if (failureReason !== null) {
                this.diag(failureReason);
            }
            return null;
        }
        const resolved: object[] = [];
        for (let index = 0; index < this.ids.length; index += 1) {
            const id = this.ids[index];
            const expected = this.refs[index];
            if (id === undefined || expected === undefined) {
                if (failureReason !== null) {
                    this.diag(failureReason);
                }
                return null;
            }
            let found: object | null = null;
            for (const candidate of windows) {
                if (typeof candidate !== "object" || candidate === null) {
                    continue;
                }
                if (normalizeNativeId(readProp(candidate, "internalId")) === id) {
                    found = candidate;
                    break;
                }
            }
            if (found === null) {
                if (failureReason !== null) {
                    this.diag(failureReason);
                }
                return null;
            }
            if (found !== expected) {
                // Conservative fail-closed live verification gap, recorded
                // rather than weakened: the id still resolves but the object
                // reference changed (window replaced under a reused id, id
                // reuse, or cross-load state). Never actuate onto it.
                this.diag("poc3-reference-drift");
                if (failureReason !== null) {
                    this.diag(failureReason);
                }
                return null;
            }
            const eligibility = checkEligibility(found);
            if (!eligibility.ok) {
                if (failureReason !== null) {
                    this.diag(failureReason);
                } else {
                    this.diag(eligibility.reason);
                }
                return null;
            }
            // Persistent-route app-id/scope re-resolution: the exact native
            // app_id (`resourceClass`) per slot must still match. Absent or
            // mismatched app_id fails before any write. Legacy route has no
            // binding (null) and skips this check.
            if (this.expectedAppIds !== null) {
                const expectedAppId = this.expectedAppIds[index];
                const observedAppId = readProp(found, "resourceClass");
                if (typeof observedAppId !== "string" || observedAppId !== expectedAppId) {
                    this.diag("poc3-app-id-drift");
                    if (failureReason !== null) {
                        this.diag(failureReason);
                    }
                    return null;
                }
            }
            if (readProp(found, "output") !== this.outputRef) {
                if (failureReason !== null) {
                    this.diag(failureReason);
                } else {
                    this.diag("poc3-output-drift");
                }
                return null;
            }
            const membership = decodeList(readProp(found, "desktops"), POC3_MAX_SCREENS);
            if (
                readProp(found, "onAllDesktops") === true ||
                membership === null ||
                this.desktopRef === null ||
                membership.indexOf(this.desktopRef) < 0
            ) {
                if (failureReason !== null) {
                    this.diag(failureReason);
                } else {
                    this.diag("poc3-workspace-drift");
                }
                return null;
            }
            resolved.push(found);
        }
        return Object.freeze(resolved);
    }

    // Intent geometry containment against the currently observed output/client
    // area. Every desired rect must fit exactly inside the live area; any
    // invalid or out-of-output rect fails closed before any write. Gap
    // boundedness (0..64) is enforced at start/config validation.
    private intentFitsObservedArea(pending: Poc3Intent): boolean {
        if (this.outputRef === null || this.desktopRef === null) {
            return false;
        }
        const area = this.readUsableArea(this.outputRef, this.desktopRef);
        if (area === null) {
            return false;
        }
        for (const desired of pending.desired) {
            const r = desired.rect;
            if (r.w < POC3_MIN_SIDE || r.w > POC3_MAX_SIDE || r.h < POC3_MIN_SIDE || r.h > POC3_MAX_SIDE) {
                return false;
            }
            if (r.x < area.x || r.y < area.y || r.x + r.w > area.x + area.w || r.y + r.h > area.y + area.h) {
                return false;
            }
        }
        return true;
    }

    private sendComplete(
        pending: Poc3Intent,
        outcome: "applied" | "divergent",
        reason: string | null,
    ): void {
        // Convergence observation is over once completion is reported, either
        // way; the completion round-trip below re-arms single-flight itself.
        this.cancelConvergence();
        const correlation = `${this.generation}-s${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.pending = null;
            this.failClosed("poc3-invalid-identity");
            return;
        }
        let requestJson = "";
        try {
            requestJson = JSON.stringify(
                outcome === "applied"
                    ? {
                          v: POC3_CONTRACT_VERSION,
                          command: "complete",
                          correlation_id: correlation,
                          owner: this.owner,
                          generation: this.generation,
                          expected_revision: pending.baseRevision,
                          outcome: "applied",
                      }
                    : {
                          v: POC3_CONTRACT_VERSION,
                          command: "complete",
                          correlation_id: correlation,
                          owner: this.owner,
                          generation: this.generation,
                          expected_revision: pending.baseRevision,
                          outcome: "divergent",
                          reason,
                      },
            );
        } catch (error) {
            void error;
            this.pending = null;
            this.failClosed("poc3-invalid-intent");
            return;
        }
        if (requestJson.length > POC3_MAX_REQUEST_BYTES) {
            this.pending = null;
            this.failClosed("poc3-oversized");
            return;
        }
        // The intent request round-trip finished; release single-flight before
        // the completion round-trip so transport never deadlocks itself. No
        // new intent can dispatch while `pending` is set.
        this.inFlight = false;
        this.pending = pending;
        this.sendRequestRaw("complete", requestJson, correlation, (reply) =>
            this.onCompleteReply(reply, correlation, pending),
        );
    }

    private onCompleteReply(reply: unknown, correlation: string, pending: Poc3Intent): void {
        if (!this.inFlight || this.callbackSeen) {
            return;
        }
        this.takeReply();
        const parsed = parseBoundedReply(reply);
        if (parsed === null || !checkEnvelope(parsed, correlation, "complete")) {
            this.pending = null;
            this.failClosed("poc3-identity-mismatch");
            return;
        }
        if (parsed["outcome"] === "ok" && isRecord(parsed["completed"])) {
            const completed = parsed["completed"] as Record<string, unknown>;
            if (completed["result"] === "applied" && completed["revision"] === pending.baseRevision + 1) {
                this.pending = null;
                this.revision = pending.baseRevision + 1;
                this.diag(`poc3-applied:${String(this.revision)}`);
                this.settleOneShot(`poc3-applied:${String(this.revision)}`);
                return;
            }
            if (completed["result"] === "diverged-recorded") {
                this.pending = null;
                this.failClosed("poc3-diverged");
                return;
            }
        }
        if (
            parsed["outcome"] === "diverged" ||
            (isRecord(parsed["error"]) && parsed["error"]["kind"] === "divergent-fail-closed")
        ) {
            this.pending = null;
            this.failClosed("poc3-diverged");
            return;
        }
        this.pending = null;
        this.failClosed("poc3-rejected");
    }

    private reportDivergent(pending: Poc3Intent, reason: string): void {
        // Partial application stops actuation immediately and reports
        // `complete divergent` with a fixed reason when transport is
        // available. Atomicity is never claimed. No retry/queue.
        this.diag(`poc3-divergent:${reason}`);
        this.sendComplete(pending, "divergent", reason);
    }

    private intentFailed(reason: string, expectedRevision: number, command: string): void {
        void expectedRevision;
        void command;
        this.pending = null;
        this.failClosed(reason);
    }

    private failClosed(reason: string): void {
        this.clearTimer();
        this.cancelConvergence();
        this.cancelCloseWatch();
        this.cancelRestoreWatch();
        this.inFlight = false;
        if (this.started) {
            this.diverged = true;
        }
        this.pending = null;
        this.diag(reason);
        this.settleOneShot(reason);
    }

    private terminate(): void {
        // Termination is always a terminal outcome for the current command:
        // settle the one-shot done diagnostic with the last emitted token
        // (already-settled paths are no-ops).
        this.settleOneShot(this.lastToken === "" ? "poc3-terminated" : this.lastToken);
        this.clearTimer();
        this.cancelConvergence();
        this.cancelCloseWatch();
        this.cancelRestoreWatch();
        this.inFlight = false;
        this.started = false;
        this.diverged = false;
        this.pending = null;
        this.owner = "";
        this.generation = "";
        this.revision = 0;
        this.ids = Object.freeze([]);
        this.refs = Object.freeze([]);
        this.rollbacks = Object.freeze([]);
        this.originals = Object.freeze([]);
        this.originalFocusId = null;
        this.sessionRollback = "";
        this.outputRef = null;
        this.desktopRef = null;
        this.plannerUniqueOwner = null;
        this.expectedAppIds = null;
        this.hostScopeOutput = null;
        this.hostScopeDesktop = null;
        this.focusId = null;
    }

    // One-shot command completion marker for the lifecycle tool: logs the
    // bounded `poc3-command-done:<nonce>:<token>` diagnostic exactly once at
    // the first terminal outcome. Window identities never appear in it; the
    // nonce is the caller-supplied bounded token from the validated config.
    private settleOneShot(token: string): void {
        if (!this.oneShot || this.oneShotSettled || this.oneShotNonce === "") {
            return;
        }
        this.oneShotSettled = true;
        this.diag(`poc3-command-done:${this.oneShotNonce}:${token}`);
    }

    // Consumes exactly one in-flight reply. Follow-up round-trips
    // (intent completion) re-arm single-flight explicitly via sendRequestRaw.
    private takeReply(): void {
        if (!this.inFlight || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        this.inFlight = false;
    }

    // Raw send used for the completion round-trip after the intent request
    // released single-flight. Never queues: refuses when already in flight.
    private sendRequestRaw(
        kind: string,
        payload: string,
        correlation: string,
        onReply: (parsed: unknown) => void,
    ): void {
        if (this.inFlight) {
            this.pending = null;
            this.failClosed("poc3-busy");
            return;
        }
        this.inFlight = true;
        this.callbackSeen = false;
        this.requestToken += 1;
        this.activeToken = this.requestToken;
        const token = this.activeToken;
        let timerCancel: (() => void) | null = null;
        try {
            timerCancel = this.env.scheduleOnce(POC3_TIMEOUT_MS, () => this.onTimeout(token, kind));
        } catch (error) {
            void error;
            this.inFlight = false;
                this.pending = null;
            this.failClosed("poc3-timer-failed");
            return;
        }
        this.cancelTimer = timerCancel;
        void correlation;
        try {
            this.env.callDbus(
                this.plannerService(),
                POC3_OBJECT,
                POC3_INTERFACE,
                POC3_METHOD,
                payload,
                (reply) => {
                    if (token !== this.activeToken || this.callbackSeen) {
                        return;
                    }
                    onReply(reply);
                },
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
                this.pending = null;
            this.failClosed("poc3-dbus-failed");
        }
    }

    private reject(reason: string): void {
        this.diag(reason);
        this.settleOneShot(reason);
    }

    private diag(token: string): void {
        this.lastToken = token;
        let stamp = 0;
        try {
            stamp = Math.floor(this.env.now());
        } catch (error) {
            void error;
            stamp = 0;
        }
        if (!Number.isFinite(stamp) || stamp < 0) {
            stamp = 0;
        }
        try {
            this.env.log(`${LOG_PREFIX}:${token}:${String(Math.floor(stamp))}`);
        } catch (error) {
            void error;
        }
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

function checkEligibility(ref: object):
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string } {
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
    // Untiled assertion: any tile association rejects enrollment.
    if (readProp(ref, "tile") !== null) {
        return { ok: false, reason: "poc3-tiled" };
    }
    if (readProp(ref, "fullScreen") === true) {
        return { ok: false, reason: "poc3-fullscreen" };
    }
    if (readProp(ref, "maximizeMode") !== 0) {
        return { ok: false, reason: "poc3-maximized" };
    }
    return { ok: true };
}

function parseBoundedReply(reply: unknown): Record<string, unknown> | null {
    if (typeof reply !== "string" || reply.length > POC3_MAX_REPLY_BYTES) {
        return null;
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(reply);
    } catch (error) {
        void error;
        return null;
    }
    return isRecord(parsed) ? parsed : null;
}

function checkEnvelope(parsed: Record<string, unknown>, correlation: string, command: string): boolean {
    return (
        parsed["v"] === POC3_CONTRACT_VERSION &&
        parsed["correlation_id"] === correlation &&
        parsed["command"] === command
    );
}

// Strict embedded per-command config validation for the one-shot command
// route. Unknown top-level fields are denied; every bound mirrors the
// contract and CLI validation so a tampered or truncated bundle fails closed
// before any native read, write, or transport.
export function parseCommandConfig(value: unknown): Poc3CommandConfig | null {
    if (!isRecord(value)) {
        return null;
    }
    const allowed = new Set([
        "command",
        "ids",
        "direction",
        "owner",
        "generation",
        "expected_revision",
        "gap",
        "usable",
        "nonce",
    ]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            return null;
        }
    }
    const command = value["command"];
    if (
        command !== "start" &&
        command !== "focus" &&
        command !== "move" &&
        command !== "status" &&
        command !== "stop"
    ) {
        return null;
    }
    const owner = value["owner"];
    const generation = value["generation"];
    const nonce = value["nonce"];
    const expectedRevision = value["expected_revision"];
    if (!isOpaqueId(owner) || !isGeneration(generation) || !isNonce(nonce)) {
        return null;
    }
    if (!isExpectedRevision(expectedRevision)) {
        return null;
    }
    if (command === "status") {
        if (value["ids"] !== null || value["direction"] !== null) {
            return null;
        }
        return {
            command,
            ids: null,
            direction: null,
            owner,
            generation,
            expectedRevision,
            gap: null,
            usable: null,
            nonce,
        };
    }
    const ids = value["ids"];
    if (!Array.isArray(ids) || ids.length !== POC3_WINDOW_COUNT) {
        return null;
    }
    const first = ids[0];
    const second = ids[1];
    const third = ids[2];
    if (!isWindowId(first) || !isWindowId(second) || !isWindowId(third)) {
        return null;
    }
    if (first === second || first === third || second === third) {
        return null;
    }
    const direction = value["direction"];
    if (command === "focus" || command === "move") {
        if (!isDirection(direction)) {
            return null;
        }
    } else if (direction !== null) {
        return null;
    }
    let gap: number | null = null;
    let usable: Poc3Rect | null = null;
    if (command === "start") {
        const rawGap = value["gap"];
        if (rawGap !== null) {
            if (
                typeof rawGap !== "number" ||
                !Number.isInteger(rawGap) ||
                rawGap < 0 ||
                rawGap > POC3_MAX_GAP
            ) {
                return null;
            }
            gap = rawGap;
        } else {
            gap = POC3_DEFAULT_GAP;
        }
        const rawUsable = value["usable"];
        if (rawUsable !== null) {
            const rect = readNativeRect(rawUsable);
            if (rect === null) {
                return null;
            }
            usable = rect;
        }
    } else if (value["gap"] !== null && value["gap"] !== undefined) {
        return null;
    } else if (value["usable"] !== null && value["usable"] !== undefined) {
        return null;
    }
    return {
        command,
        ids: Object.freeze([first, second, third]),
        direction: command === "focus" || command === "move" ? (direction as Poc3Direction) : null,
        owner,
        generation,
        expectedRevision,
        gap,
        usable,
        nonce,
    };
}

function parseIntent(value: Record<string, unknown>, ids: readonly string[]): Poc3Intent | null {
    const baseRevision = value["base_revision"];
    const focus = value["focus"];
    const desired = value["desired"];
    if (
        typeof baseRevision !== "number" ||
        !Number.isInteger(baseRevision) ||
        baseRevision < 0 ||
        baseRevision > POC3_MAX_REVISION
    ) {
        return null;
    }
    if (typeof focus !== "string" || ids.indexOf(focus) < 0) {
        return null;
    }
    if (!Array.isArray(desired) || desired.length !== POC3_WINDOW_COUNT) {
        return null;
    }
    const seen = new Set<string>();
    const rects: Poc3Desired[] = [];
    for (const entry of desired) {
        if (!isRecord(entry) || typeof entry["id"] !== "string") {
            return null;
        }
        const id = entry["id"] as string;
        if (ids.indexOf(id) < 0 || seen.has(id)) {
            return null;
        }
        seen.add(id);
        const rect = readNativeRect(entry["rect"]);
        if (rect === null) {
            return null;
        }
        rects.push({ id, rect });
    }
    if (value["atomic"] !== false || value["adapter_verification_required"] !== true) {
        return null;
    }
    return { baseRevision, focus, desired: Object.freeze(rects) };
}
