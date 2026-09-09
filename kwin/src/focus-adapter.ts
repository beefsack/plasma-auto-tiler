// Bounded static focus adapter (standalone, opt-in only).
//
// Product-shaped but with no normal startup route: ordinary production
// startup never runs this module (src/entry.ts must not import it, and no
// controller route under src/controller*.ts may import it or reference the
// DescribeFocus route; the module constraints below are the explicit future
// wiring contract). The only activation is the explicit exported FocusAdapter
// class plus the separate entry helper, called by no production source.
//
// Future exclusive wiring contract: any future caller must supply an explicit
// hasExclusiveFocusAuthority boundary proving no prior handler runs in the
// same call; the adapter rechecks it before the single native write and the
// entry requires it as a function (never a bare boolean). Source tests prove
// no normal startup import and no controller route changes without modifying
// the unrelated dirty controller files.
//
// Rust owns normalized domains, focus intent, capabilities, preconditions,
// revision binding, and reconciliation via the narrow JSON action protocol.
// This module owns KWin observation, native identity mapping, revalidation,
// single native active-window write, signals, and post-observation. One exact
// owner/generation binding, one in-flight command, one direction per request.
// A caller-supplied hasExclusiveFocusAuthority boundary must prove that no
// prior handler runs in the same call; a false value rejects before any
// native write. At most one native write per command, only to the exact
// mapped target and only when it is not already active. Any owner, service,
// correlation, revision, precondition, eligibility, or post-observation fault
// fails closed and disables. All logs are fixed redacted tokens carrying no
// captions, app ids, native ids, PIDs, paths, owners, or raw extents. Only
// minimal public events are used and all are detached on disable. No polling.

export const FOCUS_SERVICE = "org.plasmaautotiler.Planner";
export const FOCUS_OBJECT = "/org/plasmaautotiler/Planner";
export const FOCUS_INTERFACE = "org.plasmaautotiler.Planner1";
export const FOCUS_METHOD = "DescribeFocus";

// Session D-Bus activation transport (one-flight, bounded, no poll/retry).
// Discovery is GetNameOwner on the well-known Planner name, pinned to one
// exact unique owner (`:N.M`) before any planner call. When absent, exactly
// one StartServiceByName(service, 0) phase runs, accepting only result codes
// 1 (PrimaryOwner) / 2 (AlreadyOwner), followed by exactly one more owner
// resolution and pin. Flags value 0 is fixed; the production entry appends
// it as the second native D-Bus argument.
export const FOCUS_DBUS_SERVICE = "org.freedesktop.DBus";
export const FOCUS_DBUS_OBJECT = "/org/freedesktop/DBus";
export const FOCUS_DBUS_INTERFACE = "org.freedesktop.DBus";
export const FOCUS_GET_OWNER_METHOD = "GetNameOwner";
export const FOCUS_START_METHOD = "StartServiceByName";
export const FOCUS_START_FLAGS = 0;
export const FOCUS_START_PRIMARY = 1;
export const FOCUS_START_ALREADY = 2;

export const FOCUS_CONTRACT_VERSION = 1;
export const FOCUS_MAX_REQUEST_BYTES = 64 * 1024;
export const FOCUS_MAX_REPLY_BYTES = 64 * 1024;
export const FOCUS_TIMEOUT_MS = 2000;
export const FOCUS_MAX_CORRELATION_LEN = 128;
export const FOCUS_MAX_OWNER_LEN = 128;
export const FOCUS_MAX_GENERATION_LEN = 64;
export const FOCUS_MAX_REVISION = 1000000;
export const FOCUS_MAX_ID_LEN = 128;
export const FOCUS_MAX_WINDOWS = 64;
export const FOCUS_MAX_ROUTE = 64;
export const FOCUS_MAX_SEQ = 1000000;

export const FOCUS_OUTPUT_ID = "focus-output";
export const FOCUS_WORKSPACE_ID = "focus-workspace";

// Deterministic bounded observation fingerprint (FNV-1a 32-bit over
// `output\x1fworkspace\x1ffocused\x1fids...`, sorted ids). Must match the
// Rust focus_fingerprint exactly; sent as the numeric fingerprint instead of
// any literal zero.
export function focusFingerprint(
    domainOutput: string,
    domainWorkspace: string,
    focusedId: string,
    sortedIds: readonly string[],
): number {
    let hash = 2166136261;
    const feed = (text: string): void => {
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index) & 0xff;
            hash = Math.imul(hash, 16777619);
        }
    };
    feed(domainOutput);
    hash ^= 0x1f;
    hash = Math.imul(hash, 16777619);
    feed(domainWorkspace);
    hash ^= 0x1f;
    hash = Math.imul(hash, 16777619);
    feed(focusedId);
    for (const id of sortedIds) {
        hash ^= 0x1f;
        hash = Math.imul(hash, 16777619);
        feed(id);
    }
    return hash >>> 0;
}

const LOG_PREFIX = "plasma-auto-tiler:focus";

export type FocusDirection = "left" | "right" | "up" | "down";
export type FocusSignal = "active" | "added" | "removed" | "output" | "desktop";

export interface FocusObservedWindow {
    readonly id: string;
    readonly ref: object;
}

export interface FocusObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<FocusObservedWindow>;
    readonly activeRef: object | null;
    readonly fingerprint: string;
    readonly revalidate: () => boolean;
}

export interface FocusAdapterEnv {
    readonly callDbus: (
        service: string,
        path: string,
        iface: string,
        method: string,
        payload: string,
        callback: (reply: unknown) => void,
    ) => void;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => () => void;
    readonly log: (message: string) => void;
    readonly observe: () => FocusObserved | null;
    readonly setActive: (target: object) => boolean;
    readonly active: () => object | null;
    readonly hasExclusiveFocusAuthority: () => boolean;
    readonly subscribe: (kind: FocusSignal, handler: () => void) => () => void;
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > FOCUS_MAX_ID_LEN) {
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

// Exact D-Bus unique-owner shape (`:N.M`) for the pinned planner endpoint.
function isUniqueOwner(value: unknown): value is string {
    return typeof value === "string" && /^:[0-9]+\.[0-9]+$/.test(value);
}

function isCorrelationId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= FOCUS_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= FOCUS_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > FOCUS_MAX_GENERATION_LEN) {
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
        value <= FOCUS_MAX_REVISION
    );
}

function isDirection(value: unknown): value is FocusDirection {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface PlannedOperation {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly fromLeaf: string;
    readonly toLeaf: string;
    readonly fromWindow: string;
    readonly toWindow: string;
    readonly direction: string;
    readonly route: readonly string[];
}

interface PlannedReply {
    readonly correlationId: string;
    readonly baseRevision: number;
    readonly capability: string;
    readonly preconditions: readonly string[];
    readonly operation: PlannedOperation;
    readonly toWindow: string;
}

const KNOWN_PRECONDITIONS: readonly string[] = Object.freeze([
    "focused-leaf-occupied-by-focused-window",
    "target-leaf-occupied",
    "focus-targets-same-domain",
    "adapter-must-verify-postconditions",
]);

function isExactPreconditions(value: unknown): value is readonly string[] {
    if (!Array.isArray(value) || value.length !== KNOWN_PRECONDITIONS.length) {
        return false;
    }
    for (let index = 0; index < KNOWN_PRECONDITIONS.length; index += 1) {
        if (value[index] !== KNOWN_PRECONDITIONS[index]) {
            return false;
        }
    }
    return true;
}

function validatePlanned(reply: unknown, correlationId: string): PlannedReply | null {
    if (!isRecord(reply)) {
        return null;
    }
    if (reply["v"] !== FOCUS_CONTRACT_VERSION) {
        return null;
    }
    if (reply["correlation_id"] !== correlationId) {
        return null;
    }
    if (reply["outcome"] !== "planned") {
        return null;
    }
    const capability = reply["capability"];
    const preconditions = reply["preconditions"];
    const operation = reply["operation"];
    const toWindow = reply["to_window"];
    if (capability !== "directional-focus") {
        return null;
    }
    if (!isExactPreconditions(preconditions)) {
        return null;
    }
    if (!isRecord(operation)) {
        return null;
    }
    const fields: readonly string[] = [
        "domain_output",
        "domain_workspace",
        "from_leaf",
        "to_leaf",
        "from_window",
        "to_window",
        "direction",
    ];
    for (const field of fields) {
        if (!isOpaqueId(operation[field])) {
            return null;
        }
    }
    if (!isDirection(operation["direction"])) {
        return null;
    }
    const route = operation["route"];
    if (!Array.isArray(route) || route.length === 0 || route.length > FOCUS_MAX_ROUTE) {
        return null;
    }
    for (const entry of route) {
        if (!isOpaqueId(entry)) {
            return null;
        }
    }
    const baseRevision = reply["base_revision"];
    if (!isRevision(baseRevision)) {
        return null;
    }
    if (!isOpaqueId(toWindow)) {
        return null;
    }
    // Target binding: the top-level target must equal the operation target.
    if (toWindow !== operation["to_window"]) {
        return null;
    }
    return {
        correlationId,
        baseRevision: baseRevision as number,
        capability: capability as string,
        preconditions: Object.freeze([...(preconditions as string[])]),
        operation: {
            domainOutput: operation["domain_output"] as string,
            domainWorkspace: operation["domain_workspace"] as string,
            fromLeaf: operation["from_leaf"] as string,
            toLeaf: operation["to_leaf"] as string,
            fromWindow: operation["from_window"] as string,
            toWindow: operation["to_window"] as string,
            direction: operation["direction"] as string,
            route: Object.freeze([...(route as string[])]),
        },
        toWindow: toWindow as string,
    };
}

function validateObserved(observed: FocusObserved | null): observed is FocusObserved {
    if (observed === null || typeof observed !== "object") {
        return false;
    }
    if (!isOpaqueId(observed.domainOutput) || !isOpaqueId(observed.domainWorkspace)) {
        return false;
    }
    if (!isOpaqueId(observed.focusedId)) {
        return false;
    }
    if (!Array.isArray(observed.windows as unknown)) {
        return false;
    }
    const windows = observed.windows;
    if (windows.length === 0 || windows.length > FOCUS_MAX_WINDOWS) {
        return false;
    }
    const seen = new Set<string>();
    let focusedFound = false;
    for (const entry of windows) {
        if (typeof entry !== "object" || entry === null) {
            return false;
        }
        const candidate = entry as FocusObservedWindow;
        if (!isOpaqueId(candidate.id) || typeof candidate.ref !== "object" || candidate.ref === null) {
            return false;
        }
        if (seen.has(candidate.id)) {
            return false;
        }
        seen.add(candidate.id);
        if (candidate.id === observed.focusedId) {
            focusedFound = true;
        }
    }
    if (!focusedFound) {
        return false;
    }
    if (typeof observed.fingerprint !== "string" || observed.fingerprint.length === 0) {
        return false;
    }
    if (typeof observed.revalidate !== "function") {
        return false;
    }
    return true;
}

export interface FocusEnableAuth {
    readonly owner: unknown;
    readonly generation: unknown;
    readonly revision?: unknown;
}

export class FocusAdapter {
    private enabled = false;
    private owner = "";
    private generation = "";
    private revision = 0;
    private inFlight = false;
    private token = 0;
    private activeToken = 0;
    private callbackSeen = false;
    private cancelTimer: (() => void) | null = null;
    private detaches: Array<() => void> = [];
    private invalidated = false;
    private writes = 0;
    private seq = 0;
    private lastFingerprint = "";
    private lastDirection = "";
    private pending: PlannedReply | null = null;
    private pendingObserved: FocusObserved | null = null;
    private pendingDirection: FocusDirection | null = null;
    private lossReported = false;
    // Session D-Bus activation pin: exact planner unique owner (`:N.M`)
    // resolved via GetNameOwner (plus one StartServiceByName phase only when
    // absent) before any planner call. Null means unpinned; planner calls
    // never fall back to the well-known name.
    private pinnedOwner: string | null = null;
    // 0 idle, 1 awaiting initial owner, 2 awaiting start result, 3 awaiting
    // post-start owner, 4 planner dispatched. Single flight, no retry.
    private activationStep = 0;

    constructor(private readonly env: FocusAdapterEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    private clearDedup(): void {
        this.lastFingerprint = "";
        this.lastDirection = "";
    }

    private reportAdapterLost(planned: PlannedReply | null): void {
        // Best-effort terminal divergence for a received plan that can no
        // longer be completed locally. Narrow fire-and-forget `acknowledge`
        // with `outcome: "adapter-lost"` bound to the exact pending
        // owner/generation/correlation/base revision. No timer, no token
        // change, no retry, no native write; the noop callback never touches
        // flight state so stray replies cannot race. D-Bus loss makes this
        // impossible by definition and stays fail-closed.
        // Pinned-owner only: never fall back to the well-known name. When
        // unpinned (activation never completed) there is no endpoint to
        // notify, so stay fail-closed without transport.
        if (planned === null || this.lossReported) {
            return;
        }
        const target = this.pinnedOwner;
        if (!isUniqueOwner(target)) {
            return;
        }
        this.lossReported = true;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: FOCUS_CONTRACT_VERSION,
                action: "acknowledge",
                correlation_id: planned.correlationId,
                owner: this.owner,
                generation: this.generation,
                base_revision: planned.baseRevision,
                outcome: "adapter-lost",
            });
        } catch (error) {
            void error;
            return;
        }
        if (payload.length === 0 || payload.length > FOCUS_MAX_REQUEST_BYTES) {
            return;
        }
        try {
            this.env.callDbus(
                target,
                FOCUS_OBJECT,
                FOCUS_INTERFACE,
                FOCUS_METHOD,
                payload,
                () => {},
            );
        } catch (error) {
            void error;
        }
    }

    private plannerService(): string | null {
        return this.pinnedOwner;
    }

    enable(auth: FocusEnableAuth): boolean {
        if (this.enabled) {
            return false;
        }
        if (!isRecord(auth as unknown as Record<string, unknown>)) {
            this.reject("focus-invalid-auth");
            return false;
        }
        if (!isOwnerId(auth.owner) || !isGeneration(auth.generation)) {
            this.reject("focus-invalid-auth");
            return false;
        }
        const revision = auth.revision === undefined ? 0 : auth.revision;
        if (!isRevision(revision)) {
            this.reject("focus-invalid-auth");
            return false;
        }
        const kinds: readonly FocusSignal[] = ["active", "added", "removed", "output", "desktop"];
        const attached: Array<() => void> = [];
        for (const kind of kinds) {
            let detach: (() => void) | null = null;
            try {
                detach = this.env.subscribe(kind, () => this.onSignal());
            } catch (error) {
                void error;
                detach = null;
            }
            if (typeof detach !== "function") {
                for (const done of attached) {
                    try {
                        done();
                    } catch (error) {
                        void error;
                    }
                }
                this.reject("focus-signal-failed");
                return false;
            }
            attached.push(detach);
        }
        this.detaches = attached;
        this.owner = auth.owner as string;
        this.generation = auth.generation as string;
        this.revision = revision as number;
        this.enabled = true;
        this.invalidated = false;
        this.writes = 0;
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        this.lossReported = false;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.clearDedup();
        this.log(`${LOG_PREFIX}:ready`);
        return true;
    }

    disable(): void {
        if (!this.enabled && this.detaches.length === 0) {
            return;
        }
        this.enabled = false;
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.clearDedup();
        this.clearTimer();
        for (const detach of this.detaches) {
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
        this.detaches = [];
        this.log(`${LOG_PREFIX}:disabled`);
    }

    requestFocus(direction: unknown): void {
        if (!this.enabled) {
            this.reject("focus-disabled");
            return;
        }
        if (this.inFlight) {
            this.reject("focus-busy");
            return;
        }
        if (!isDirection(direction)) {
            this.reject("focus-invalid-intent");
            return;
        }
        let authority = false;
        try {
            authority = this.env.hasExclusiveFocusAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reject("focus-exclusive-conflict");
            this.disable();
            return;
        }
        let observed: FocusObserved | null = null;
        try {
            observed = this.env.observe();
        } catch (error) {
            void error;
            observed = null;
        }
        if (!validateObserved(observed)) {
            this.reject("focus-stale-scope");
            this.disable();
            return;
        }
        const current = observed as FocusObserved;
        if (current.fingerprint === this.lastFingerprint && direction === this.lastDirection) {
            this.reject("focus-dedup");
            return;
        }
        if (this.revision < 0 || this.revision > FOCUS_MAX_REVISION) {
            this.reject("focus-stale-revision");
            this.disable();
            return;
        }
        if (this.seq < 0 || this.seq > FOCUS_MAX_SEQ) {
            this.reject("focus-seq-exhausted");
            this.disable();
            return;
        }
        const correlation = `${this.generation}-f${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("focus-invalid-auth");
            this.disable();
            return;
        }
        const windows = current.windows.map((entry) => ({
            window: entry.id,
            output: current.domainOutput,
            workspace: current.domainWorkspace,
        }));
        const sortedIds = current.windows.map((entry) => entry.id).sort();
        // Initial revision binds exactly to the normalized observed membership
        // size N (the Rust post-seed base); later revisions bind exactly.
        // An explicit non-zero revision is sent verbatim so an incompatible
        // value still diverges fail-closed on the service.
        let requestRevision = this.revision;
        if (requestRevision === 0) {
            requestRevision = sortedIds.length;
            this.revision = requestRevision;
        }
        const fingerprint = focusFingerprint(
            current.domainOutput,
            current.domainWorkspace,
            current.focusedId,
            sortedIds,
        );
        let payload = "";
        try {
            payload = JSON.stringify({
                v: FOCUS_CONTRACT_VERSION,
                action: "request",
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                revision: requestRevision,
                fingerprint,
                domain: { output: current.domainOutput, workspace: current.domainWorkspace },
                focused_window: current.focusedId,
                direction,
                windows,
                capabilities: { directional_focus: true },
            });
        } catch (error) {
            void error;
            this.reject("focus-invalid-intent");
            return;
        }
        if (payload.length > FOCUS_MAX_REQUEST_BYTES) {
            this.reject("focus-oversized");
            return;
        }
        this.lastFingerprint = current.fingerprint;
        this.lastDirection = direction;
        this.startFlight(payload, correlation, direction, current);
    }

    private onSignal(): void {
        this.invalidated = true;
    }

    private startFlight(
        payload: string,
        correlation: string,
        direction: FocusDirection,
        observed: FocusObserved,
    ): void {
        this.inFlight = true;
        this.invalidated = false;
        this.writes = 0;
        this.pending = null;
        this.pendingObserved = observed;
        this.pendingDirection = direction;
        this.lossReported = false;
        this.callbackSeen = false;
        this.pinnedOwner = null;
        this.activationStep = 1;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(FOCUS_TIMEOUT_MS, () => this.onTimeout(flight, "request"));
        } catch (error) {
            void error;
            this.inFlight = false;
            this.activationStep = 0;
            this.reject("focus-timer-failed");
            this.disable();
            return;
        }
        this.cancelTimer = cancel;
        // Phase 1: resolve the well-known Planner name to one exact unique
        // owner. Absent (any non-`:N.M` reply) falls through to exactly one
        // StartServiceByName phase; present pins immediately with no service
        // request. One flight, one bounded timeout, no poll/timer/retry.
        try {
            this.env.callDbus(
                FOCUS_DBUS_SERVICE,
                FOCUS_DBUS_OBJECT,
                FOCUS_DBUS_INTERFACE,
                FOCUS_GET_OWNER_METHOD,
                FOCUS_SERVICE,
                (reply) => this.onOwnerInitial(reply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.reject("focus-dbus-failed");
            this.disable();
        }
    }

    private onOwnerInitial(
        reply: unknown,
        flight: number,
        payload: string,
        correlation: string,
    ): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 1) {
            return;
        }
        if (isUniqueOwner(reply)) {
            this.pinnedOwner = reply;
            this.activationStep = 4;
            this.sendPlannerRequest(flight, payload, correlation);
            return;
        }
        // Absent name: exactly one StartServiceByName(service, 0) phase. The
        // flags value 0 is fixed (FOCUS_START_FLAGS); the production entry
        // appends it as the second native D-Bus argument.
        this.activationStep = 2;
        try {
            this.env.callDbus(
                FOCUS_DBUS_SERVICE,
                FOCUS_DBUS_OBJECT,
                FOCUS_DBUS_INTERFACE,
                FOCUS_START_METHOD,
                FOCUS_SERVICE,
                (startReply) => this.onStartResult(startReply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.reject("focus-dbus-failed");
            this.disable();
        }
    }

    private onStartResult(
        reply: unknown,
        flight: number,
        payload: string,
        correlation: string,
    ): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 2) {
            return;
        }
        // Accept only 1 PrimaryOwner / 2 AlreadyOwner; reject
        // malformed/unknown results fail-closed with no planner call.
        if (reply !== FOCUS_START_PRIMARY && reply !== FOCUS_START_ALREADY) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-activation-failed");
            this.disable();
            return;
        }
        // Exactly one bounded post-activation owner resolution, then pin
        // before any planner call. No retry on failure.
        this.activationStep = 3;
        try {
            this.env.callDbus(
                FOCUS_DBUS_SERVICE,
                FOCUS_DBUS_OBJECT,
                FOCUS_DBUS_INTERFACE,
                FOCUS_GET_OWNER_METHOD,
                FOCUS_SERVICE,
                (ownerReply) => this.onOwnerAfterStart(ownerReply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.reject("focus-dbus-failed");
            this.disable();
        }
    }

    private onOwnerAfterStart(
        reply: unknown,
        flight: number,
        payload: string,
        correlation: string,
    ): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 3) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-owner-missing");
            this.disable();
            return;
        }
        this.pinnedOwner = reply;
        this.activationStep = 4;
        this.sendPlannerRequest(flight, payload, correlation);
    }

    private sendPlannerRequest(flight: number, payload: string, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 4) {
            return;
        }
        const target = this.plannerService();
        if (!isUniqueOwner(target)) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.reject("focus-owner-missing");
            this.disable();
            return;
        }
        try {
            this.env.callDbus(
                target,
                FOCUS_OBJECT,
                FOCUS_INTERFACE,
                FOCUS_METHOD,
                payload,
                (reply) => this.onRequestReply(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.reject("focus-dbus-failed");
            this.disable();
        }
    }

    private onTimeout(flight: number, stage: string): void {
        if (!this.inFlight || flight !== this.activeToken) {
            return;
        }
        const lost = this.pending;
        if (lost !== null) {
            this.reportAdapterLost(lost);
        }
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        this.reject(`focus-timeout-${stage}`);
        this.disable();
    }

    private onRequestReply(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        // Planner reply is valid only after activation pinned one owner.
        if (this.activationStep !== 4 || !isUniqueOwner(this.pinnedOwner)) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        if (typeof reply !== "string" || reply.length > FOCUS_MAX_REPLY_BYTES) {
            this.inFlight = false;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.inFlight = false;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed)) {
            this.inFlight = false;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "noop") {
            // Noop carries no plan: verify exact v/correlation binding before
            // accepting, then release the flight without a write.
            if (parsed["v"] !== FOCUS_CONTRACT_VERSION) {
                this.inFlight = false;
                this.reject("focus-service-fault");
                this.disable();
                return;
            }
            if (parsed["correlation_id"] !== correlation) {
                this.inFlight = false;
                this.reject("focus-correlation-mismatch");
                this.disable();
                return;
            }
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            // Idle reset: drop the pin so the next idle command re-resolves
            // and re-pins. Adapter stays enabled (no disable here).
            this.pinnedOwner = null;
            this.activationStep = 0;
            this.log(`${LOG_PREFIX}:noop`);
            return;
        }
        if (outcome === "rejected") {
            // Refused service fault fails closed: no write, terminal disable.
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-rejected");
            this.disable();
            return;
        }
        if (outcome === "diverged") {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-diverged");
            this.disable();
            return;
        }
        if (outcome !== "planned") {
            this.inFlight = false;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        const planned = validatePlanned(parsed, correlation);
        if (planned === null) {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-precondition-mismatch");
            this.disable();
            return;
        }
        if (planned.baseRevision !== this.revision) {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-revision-mismatch");
            this.disable();
            return;
        }
        this.pending = planned;
        this.applyPlanned(flight);
    }

    private applyPlanned(flight: number): void {
        const planned = this.pending;
        const captured = this.pendingObserved;
        const wantedDirection = this.pendingDirection;
        if (planned === null || captured === null || wantedDirection === null) {
            this.inFlight = false;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        // Exact domain/from-window/direction/target binding before any write.
        if (
            planned.operation.domainOutput !== captured.domainOutput ||
            planned.operation.domainWorkspace !== captured.domainWorkspace ||
            planned.operation.fromWindow !== captured.focusedId ||
            planned.operation.direction !== wantedDirection ||
            planned.toWindow !== planned.operation.toWindow
        ) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-target-mismatch");
            this.disable();
            return;
        }
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-signal-invalid");
            this.disable();
            return;
        }
        let authority = false;
        try {
            authority = this.env.hasExclusiveFocusAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-exclusive-conflict");
            this.disable();
            return;
        }
        let fresh: FocusObserved | null = null;
        try {
            fresh = this.env.observe();
        } catch (error) {
            void error;
            fresh = null;
        }
        if (!validateObserved(fresh)) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-stale-scope");
            this.disable();
            return;
        }
        const current = fresh as FocusObserved;
        let ok = false;
        try {
            ok = current.revalidate() === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-stale-revalidate");
            this.disable();
            return;
        }
        if (current.fingerprint !== captured.fingerprint) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-stale-revalidate");
            this.disable();
            return;
        }
        // Output/desktop scope: the fresh scope must still target the same
        // domain as the captured scope (revalidation already pins refs).
        if (
            current.domainOutput !== captured.domainOutput ||
            current.domainWorkspace !== captured.domainWorkspace ||
            current.focusedId !== captured.focusedId
        ) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-stale-scope");
            this.disable();
            return;
        }
        const wanted = planned.toWindow;
        let target: object | null = null;
        for (const entry of current.windows) {
            if (entry.id === wanted) {
                target = entry.ref;
                break;
            }
        }
        if (target === null) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-target-mismatch");
            this.disable();
            return;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
            currentActive = null;
        }
        if (currentActive === target) {
            this.sendAcknowledge(flight, planned, true);
            return;
        }
        if (this.writes >= 1) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-write-limit");
            this.disable();
            return;
        }
        let written = false;
        try {
            written = this.env.setActive(target) === true;
        } catch (error) {
            void error;
            written = false;
        }
        if (!written) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-write-failed");
            this.disable();
            return;
        }
        this.writes += 1;
        this.sendAcknowledge(flight, planned, false);
    }

    private sendAcknowledge(flight: number, planned: PlannedReply, wasActive: boolean): void {
        void flight;
        void wasActive;
        // Post-write signal invalidation: any signal between the write and
        // the ack fails closed before the ack is sent.
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-signal-invalid");
            this.disable();
            return;
        }
        const target = this.plannerService();
        if (!isUniqueOwner(target)) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-owner-missing");
            this.disable();
            return;
        }
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: FOCUS_CONTRACT_VERSION,
                action: "acknowledge",
                correlation_id: planned.correlationId,
                owner: this.owner,
                generation: this.generation,
                base_revision: planned.baseRevision,
                outcome: "accepted",
            });
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(FOCUS_TIMEOUT_MS, () => this.onTimeout(next, "ack"));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-timer-failed");
            this.disable();
            return;
        }
        this.cancelTimer = cancel;
        try {
            this.env.callDbus(
                target,
                FOCUS_OBJECT,
                FOCUS_INTERFACE,
                FOCUS_METHOD,
                payload,
                (reply) => this.onAckReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-dbus-failed");
            this.disable();
        }
    }

    private onAckReply(reply: unknown, flight: number, planned: PlannedReply): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        // Post-write signal invalidation across ack: a signal that landed
        // after the write fails closed instead of verifying.
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-signal-invalid");
            this.disable();
            return;
        }
        if (typeof reply !== "string" || reply.length > FOCUS_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "acknowledged") {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        // Exact ack binding: v, correlation, and base revision must match.
        if (parsed["v"] !== FOCUS_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-correlation-mismatch");
            this.disable();
            return;
        }
        if (parsed["base_revision"] !== planned.baseRevision) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-revision-mismatch");
            this.disable();
            return;
        }
        this.sendVerify(planned);
    }

    private sendVerify(planned: PlannedReply): void {
        // Post-write signal invalidation across verify: re-observe fresh,
        // revalidate, and bind output/desktop scope before sending.
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-signal-invalid");
            this.disable();
            return;
        }
        const target = this.plannerService();
        if (!isUniqueOwner(target)) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-owner-missing");
            this.disable();
            return;
        }
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        let fresh: FocusObserved | null = null;
        try {
            fresh = this.env.observe();
        } catch (error) {
            void error;
            fresh = null;
        }
        if (!validateObserved(fresh)) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-post-stale");
            this.disable();
            return;
        }
        const current = fresh as FocusObserved;
        let ok = false;
        try {
            ok = current.revalidate() === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-post-stale");
            this.disable();
            return;
        }
        // Output/desktop scope in post-write revalidation: the fresh scope
        // must still target the planned domain.
        if (
            current.domainOutput !== planned.operation.domainOutput ||
            current.domainWorkspace !== planned.operation.domainWorkspace
        ) {
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-post-stale");
            this.disable();
            return;
        }
        const sortedIds = current.windows.map((entry) => entry.id).sort();
        const fingerprint = focusFingerprint(
            current.domainOutput,
            current.domainWorkspace,
            current.focusedId,
            sortedIds,
        );
        let payload = "";
        try {
            payload = JSON.stringify({
                v: FOCUS_CONTRACT_VERSION,
                action: "verify",
                correlation_id: planned.correlationId,
                owner: this.owner,
                generation: this.generation,
                revision: planned.baseRevision,
                fingerprint,
                verified: true,
                verified_preconditions: [...planned.preconditions],
                verified_operation: {
                    domain_output: planned.operation.domainOutput,
                    domain_workspace: planned.operation.domainWorkspace,
                    from_leaf: planned.operation.fromLeaf,
                    to_leaf: planned.operation.toLeaf,
                    from_window: planned.operation.fromWindow,
                    to_window: planned.operation.toWindow,
                    direction: planned.operation.direction,
                    route: [...planned.operation.route],
                },
            });
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(FOCUS_TIMEOUT_MS, () => this.onTimeout(next, "verify"));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-timer-failed");
            this.disable();
            return;
        }
        this.cancelTimer = cancel;
        try {
            this.env.callDbus(
                target,
                FOCUS_OBJECT,
                FOCUS_INTERFACE,
                FOCUS_METHOD,
                payload,
                (reply) => this.onVerifyReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.reject("focus-dbus-failed");
            this.disable();
        }
    }

    private onVerifyReply(reply: unknown, flight: number, planned: PlannedReply): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        // Post-write signal invalidation across commit: a signal that landed
        // during ack/verify fails closed instead of applying.
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.reject("focus-signal-invalid");
            this.disable();
            return;
        }
        if (typeof reply !== "string" || reply.length > FOCUS_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "committed") {
            this.reportAdapterLost(planned);
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        // Exact commit binding: v, correlation, and exactly revision+1.
        if (parsed["v"] !== FOCUS_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.reject("focus-service-fault");
            this.disable();
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.reject("focus-correlation-mismatch");
            this.disable();
            return;
        }
        const revision = parsed["revision"];
        if (typeof revision === "number" && Number.isInteger(revision) && revision === this.revision + 1) {
            this.revision = revision;
        } else {
            this.reportAdapterLost(planned);
            this.reject("focus-revision-mismatch");
            this.disable();
            return;
        }
        // Idle reset: drop the pin so the next idle command re-resolves.
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.log(`${LOG_PREFIX}:applied`);
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

    private reject(token: string): void {
        try {
            this.env.log(`${LOG_PREFIX}:reject:${token}`);
        } catch (error) {
            void error;
        }
    }

    private log(message: string): void {
        try {
            this.env.log(message);
        } catch (error) {
            void error;
        }
    }
}
