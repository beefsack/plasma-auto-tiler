// Bounded static shadow projection KWin adapter (standalone, opt-in only).
//
// Boundary: injected pure supplier provides one bounded normalized 3-window
// shadow observation per recompute; this module validates bounds/schema,
// resolves the Planner well-known name via org.freedesktop.DBus GetNameOwner,
// pins the exact unique owner, sends the request to that pinned unique name
// only, revalidates the well-known owner still equals the pinned owner after
// receiving the plan and re-runs the required supplier revalidation before
// accepting any reply, and fails closed otherwise. Event-driven coalesced
// scheduling only (no polling): signal notifications collapse into a single
// pending recompute with exactly one in-flight request. Equal normalized
// observation fingerprints deduplicate without sending. Repeated recomputes
// are supported after each flight completes. Every returned desired rect is
// compared with the observed primitive rects exactly. All logs are fixed
// redacted tokens carrying no ids, geometry, captions, app ids, PIDs, or
// paths. No native mutation is performed.
//
// Ordinary production startup never runs this module: src/entry.ts must not
// import or construct it. The signal-bound companion entry lives separately
// with no builder/global trigger; tests drive this module directly through
// the injected env. The supplier revalidation hook is required: an absent or
// throwing hook fails closed as stale.

export const SHADOW_SERVICE = "org.plasmaautotiler.Planner";
export const SHADOW_OBJECT = "/org/plasmaautotiler/Planner";
export const SHADOW_INTERFACE = "org.plasmaautotiler.Planner1";
export const SHADOW_METHOD = "DescribeShadowProjection";

export const SHADOW_CONTRACT_VERSION = 1;
export const SHADOW_MAX_REQUEST_BYTES = 64 * 1024;
export const SHADOW_MAX_REPLY_BYTES = 64 * 1024;
export const SHADOW_TIMEOUT_MS = 2000;
export const SHADOW_MAX_CORRELATION_LEN = 128;
export const SHADOW_MAX_OWNER_LEN = 128;
export const SHADOW_MAX_GENERATION_LEN = 64;
export const SHADOW_MAX_REVISION = 1000000;
export const SHADOW_MAX_ID_LEN = 128;
export const SHADOW_WINDOW_COUNT = 3;
export const SHADOW_MAX_GAP = 256;
export const SHADOW_MAX_EXTENT = 32768;
export const SHADOW_REQUIRED_CAPABILITY = "shadow-projection";

export const DBUS_SERVICE = "org.freedesktop.DBus";
export const DBUS_OBJECT = "/org/freedesktop/DBus";
export const DBUS_INTERFACE = "org.freedesktop.DBus";
export const DBUS_METHOD = "GetNameOwner";

const LOG_PREFIX = "plasma-auto-tiler:shadow-projection";
const LOG_MATCH = `${LOG_PREFIX}:match`;
const LOG_DIVERGENCE = `${LOG_PREFIX}:divergence`;

export interface ShadowObservedRect {
    readonly x: unknown;
    readonly y: unknown;
    readonly w: unknown;
    readonly h: unknown;
}

export interface ShadowProviderInput {
    readonly correlationId: unknown;
    readonly owner: unknown;
    readonly generation: unknown;
    readonly revision: unknown;
    readonly output: unknown;
    readonly windows: unknown;
    readonly gap: unknown;
    readonly focusedWindow: unknown;
    readonly capabilities: unknown;
}

export interface NormalizedShadowBundle {
    readonly requestJson: string;
    readonly correlationId: string;
    readonly owner: string;
    readonly generation: string;
    readonly revision: number;
    readonly fingerprint: string;
    readonly observed: ReadonlyMap<string, { readonly x: number; readonly y: number; readonly w: number; readonly h: number }>;
}

export type ShadowNormalizeResult =
    | { readonly ok: true; readonly bundle: NormalizedShadowBundle }
    | { readonly ok: false; readonly reason: string };

export interface ShadowProjectionEnv {
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
    readonly provideInput: () => ShadowProviderInput | null;
    readonly revalidateInput: () => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > SHADOW_MAX_ID_LEN) {
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

function isCorrelationId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= SHADOW_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= SHADOW_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > SHADOW_MAX_GENERATION_LEN) {
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
        value <= SHADOW_MAX_REVISION
    );
}

function isUniqueOwner(value: unknown): value is string {
    return typeof value === "string" && /^:[0-9]+\.[0-9]+$/.test(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    if (actual.length !== keys.length) {
        return false;
    }
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            return false;
        }
    }
    return true;
}

function isStrictInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function isValidRect(value: unknown): value is { x: number; y: number; w: number; h: number } {
    if (!isRecord(value) || !hasExactKeys(value, ["x", "y", "w", "h"])) {
        return false;
    }
    const x = value["x"];
    const y = value["y"];
    const w = value["w"];
    const h = value["h"];
    if (!isStrictInteger(x) || !isStrictInteger(y) || !isStrictInteger(w) || !isStrictInteger(h)) {
        return false;
    }
    if (w <= 0 || h <= 0 || w > SHADOW_MAX_EXTENT || h > SHADOW_MAX_EXTENT) {
        return false;
    }
    if (!Number.isSafeInteger(x + w) || !Number.isSafeInteger(y + h)) {
        return false;
    }
    return true;
}

// Strict bounded normalization of the injected 3-window shadow observation.
// Observation-only: tree, leaf, and focused_leaf keys are rejected anywhere
// in the supplied shape; only opaque ids plus explicit integer rects pass.
export function normalizeShadowRequest(input: unknown): ShadowNormalizeResult {
    if (!isRecord(input)) {
        return { ok: false, reason: "shadow-invalid-input" };
    }
    if (
        Object.prototype.hasOwnProperty.call(input, "tree") ||
        Object.prototype.hasOwnProperty.call(input, "leaf") ||
        Object.prototype.hasOwnProperty.call(input, "focused_leaf")
    ) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const correlationId = input["correlationId"];
    const owner = input["owner"];
    const generation = input["generation"];
    const revision = input["revision"];
    const output = input["output"];
    const windows = input["windows"];
    const gap = input["gap"];
    const focusedWindow = input["focusedWindow"];
    const capabilities = input["capabilities"];
    if (!isCorrelationId(correlationId) || !isOwnerId(owner)) {
        return { ok: false, reason: "shadow-invalid-input" };
    }
    if (!isGeneration(generation) || !isRevision(revision)) {
        return { ok: false, reason: "shadow-invalid-input" };
    }
    if (!isRecord(output) || !hasExactKeys(output, ["id", "workspace", "workArea"])) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (
        Object.prototype.hasOwnProperty.call(output, "tree") ||
        Object.prototype.hasOwnProperty.call(output, "leaf")
    ) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (!isOpaqueId(output["id"]) || !isOpaqueId(output["workspace"])) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (!isValidRect(output["workArea"])) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (!Array.isArray(windows) || windows.length !== SHADOW_WINDOW_COUNT) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (!isStrictInteger(gap) || (gap as number) < 0 || (gap as number) > SHADOW_MAX_GAP) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (!isOpaqueId(focusedWindow)) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    if (!isRecord(capabilities) || !hasExactKeys(capabilities, ["shadow_projection"])) {
        return { ok: false, reason: "shadow-invalid-input" };
    }
    if (typeof capabilities["shadow_projection"] !== "boolean") {
        return { ok: false, reason: "shadow-invalid-input" };
    }
    const outputId = output["id"] as string;
    const workspaceId = output["workspace"] as string;
    const workArea = output["workArea"] as { x: number; y: number; w: number; h: number };
    const seen = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const link of windows) {
        if (!isRecord(link) || !hasExactKeys(link, ["window", "output", "workspace", "rect"])) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        if (
            Object.prototype.hasOwnProperty.call(link, "tree") ||
            Object.prototype.hasOwnProperty.call(link, "leaf") ||
            Object.prototype.hasOwnProperty.call(link, "focused_leaf")
        ) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        if (!isOpaqueId(link["window"]) || !isOpaqueId(link["output"]) || !isOpaqueId(link["workspace"])) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        if ((link["output"] as string) !== outputId || (link["workspace"] as string) !== workspaceId) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        if (!isValidRect(link["rect"])) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        const windowId = link["window"] as string;
        if (seen.has(windowId)) {
            return { ok: false, reason: "shadow-unsupported-topology" };
        }
        const rect = link["rect"] as { x: number; y: number; w: number; h: number };
        seen.set(windowId, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }
    if (!seen.has(focusedWindow as string)) {
        return { ok: false, reason: "shadow-unsupported-topology" };
    }
    const sortedWindows = [...seen.keys()].sort();
    const fingerprintPayload = {
        output: outputId,
        workspace: workspaceId,
        area: [workArea.x, workArea.y, workArea.w, workArea.h],
        gap,
        focused: focusedWindow,
        projection: (capabilities["shadow_projection"] as boolean) ? 1 : 0,
        windows: sortedWindows.map((id) => {
            const rect = seen.get(id) as { x: number; y: number; w: number; h: number };
            return [id, rect.x, rect.y, rect.w, rect.h];
        }),
    };
    let fingerprint = "";
    try {
        fingerprint = JSON.stringify(fingerprintPayload);
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-invalid-input" };
    }
    const request = {
        v: SHADOW_CONTRACT_VERSION,
        correlation_id: correlationId,
        owner,
        generation,
        revision,
        output: {
            id: outputId,
            workspace: workspaceId,
            work_area: { x: workArea.x, y: workArea.y, w: workArea.w, h: workArea.h },
        },
        windows: sortedWindows.map((id) => {
            const rect = seen.get(id) as { x: number; y: number; w: number; h: number };
            return {
                window: id,
                output: outputId,
                workspace: workspaceId,
                rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
            };
        }),
        gap,
        focused_window: focusedWindow,
        capabilities: { shadow_projection: capabilities["shadow_projection"] },
    };
    let requestJson = "";
    try {
        requestJson = JSON.stringify(request);
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-invalid-input" };
    }
    if (requestJson.length > SHADOW_MAX_REQUEST_BYTES) {
        return { ok: false, reason: "shadow-oversized" };
    }
    return {
        ok: true,
        bundle: {
            requestJson,
            correlationId: correlationId as string,
            owner: owner as string,
            generation: generation as string,
            revision: revision as number,
            fingerprint,
            observed: seen,
        },
    };
}

export interface ShadowReplyExpectation {
    readonly correlationId: string;
    readonly owner: string;
    readonly generation: string;
    readonly revision: number;
    readonly observedWindows: ReadonlySet<string>;
}

export type ShadowReplyValidation =
    | {
          readonly ok: true;
          readonly desired: ReadonlyArray<{ readonly window: string; readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } }>;
          readonly focusedWindow: string;
      }
    | { readonly ok: false; readonly reason: string };

const FORBIDDEN_REPLY_KEYS: readonly string[] = Object.freeze([
    "command",
    "execute",
    "exec",
    "script",
    "native",
    "action",
    "cleanup",
    "envelopes",
]);
const SHADOW_PRECONDITIONS: readonly string[] = Object.freeze([
    "trio-adopted",
    "projection-contained-and-disjoint",
    "adapter-must-verify-postconditions",
]);

// Strict reply validation: fixed shape, binding, complete desired coverage.
export function validateShadowReply(
    replyText: unknown,
    expected: ShadowReplyExpectation,
): ShadowReplyValidation {
    if (typeof replyText !== "string") {
        return { ok: false, reason: "shadow-reply-malformed" };
    }
    if (replyText.length > SHADOW_MAX_REPLY_BYTES) {
        return { ok: false, reason: "shadow-reply-oversized" };
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(replyText);
    } catch (error) {
        void error;
        return { ok: false, reason: "shadow-reply-malformed" };
    }
    if (!isRecord(parsed)) {
        return { ok: false, reason: "shadow-reply-malformed" };
    }
    for (const forbidden of FORBIDDEN_REPLY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(parsed, forbidden)) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
    }
    if (
        !hasExactKeys(parsed, [
            "v",
            "correlation_id",
            "owner",
            "generation",
            "revision",
            "outcome",
            "capability",
            "preconditions",
            "desired",
            "focused_window",
        ])
    ) {
        return { ok: false, reason: "shadow-outcome-mismatch" };
    }
    if (
        parsed["v"] !== SHADOW_CONTRACT_VERSION ||
        parsed["correlation_id"] !== expected.correlationId ||
        parsed["owner"] !== expected.owner ||
        parsed["generation"] !== expected.generation ||
        parsed["revision"] !== expected.revision
    ) {
        return { ok: false, reason: "shadow-identity-mismatch" };
    }
    if (parsed["outcome"] !== "projected") {
        return { ok: false, reason: "shadow-outcome-mismatch" };
    }
    if (parsed["capability"] !== SHADOW_REQUIRED_CAPABILITY) {
        return { ok: false, reason: "shadow-outcome-mismatch" };
    }
    const preconditions = parsed["preconditions"];
    if (!Array.isArray(preconditions) || preconditions.length !== SHADOW_PRECONDITIONS.length) {
        return { ok: false, reason: "shadow-outcome-mismatch" };
    }
    for (let index = 0; index < SHADOW_PRECONDITIONS.length; index += 1) {
        if (preconditions[index] !== SHADOW_PRECONDITIONS[index]) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
    }
    const desired = parsed["desired"];
    if (!Array.isArray(desired) || desired.length !== SHADOW_WINDOW_COUNT) {
        return { ok: false, reason: "shadow-outcome-mismatch" };
    }
    const seen = new Set<string>();
    const entries: Array<{ window: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    for (const entry of desired) {
        if (!isRecord(entry) || !hasExactKeys(entry, ["window", "rect"])) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        if (!isOpaqueId(entry["window"])) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        const windowId = entry["window"] as string;
        if (seen.has(windowId) || !expected.observedWindows.has(windowId)) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        if (!isValidRect(entry["rect"])) {
            return { ok: false, reason: "shadow-outcome-mismatch" };
        }
        const rect = entry["rect"] as { x: number; y: number; w: number; h: number };
        seen.add(windowId);
        entries.push({ window: windowId, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
    }
    if (seen.size !== SHADOW_WINDOW_COUNT) {
        return { ok: false, reason: "shadow-outcome-mismatch" };
    }
    if (!isOpaqueId(parsed["focused_window"]) || !expected.observedWindows.has(parsed["focused_window"] as string)) {
        return { ok: false, reason: "shadow-outcome-mismatch" };
    }
    return { ok: true, desired: entries, focusedWindow: parsed["focused_window"] as string };
}

function logReject(env: ShadowProjectionEnv, token: string): void {
    try {
        env.log(`${LOG_PREFIX}:reject:${token}`);
    } catch (error) {
        void error;
    }
}

// Opt-in event-driven shadow projection adapter. Disabled by default; signal
// handlers call requestRecompute() which coalesces into one scheduled pass.
// Exactly one in-flight D-Bus request; equal fingerprints deduplicate.
export class ShadowProjection {
    private enabled = false;
    private inFlight = false;
    private scheduled = false;
    private pending = false;
    private ownerResolved = false;
    private planReceived = false;
    private revalidated = false;
    private pinnedOwner: string | null = null;
    private pendingReply: unknown = null;
    private bundle: NormalizedShadowBundle | null = null;
    private lastFingerprint: string | null = null;
    private cancelTimer: (() => void) | null = null;

    constructor(private readonly env: ShadowProjectionEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    enable(): void {
        this.enabled = true;
    }

    disable(): void {
        this.enabled = false;
    }

    // Signal-driven entry: coalesce bursts into a single scheduled pass.
    requestRecompute(): void {
        if (!this.enabled) {
            logReject(this.env, "shadow-disabled");
            return;
        }
        if (this.scheduled) {
            this.pending = true;
            return;
        }
        this.scheduled = true;
        this.pending = false;
        try {
            this.env.scheduleOnce(0, () => this.onScheduled());
        } catch (error) {
            void error;
            this.scheduled = false;
            logReject(this.env, "shadow-timer-failed");
        }
    }

    private onScheduled(): void {
        this.scheduled = false;
        if (!this.enabled) {
            logReject(this.env, "shadow-disabled");
            return;
        }
        if (this.inFlight) {
            this.pending = true;
            return;
        }
        this.runPass();
    }

    private runPass(): void {
        let input: ShadowProviderInput | null = null;
        try {
            input = this.env.provideInput();
        } catch (error) {
            void error;
            input = null;
        }
        if (input === null) {
            logReject(this.env, "shadow-invalid-input");
            this.drainPending();
            return;
        }
        const normalized = normalizeShadowRequest(input);
        if (!normalized.ok) {
            logReject(this.env, normalized.reason);
            this.drainPending();
            return;
        }
        if (this.lastFingerprint !== null && this.lastFingerprint === normalized.bundle.fingerprint) {
            logReject(this.env, "shadow-duplicate-observation");
            this.drainPending();
            return;
        }
        this.bundle = normalized.bundle;
        this.inFlight = true;
        this.ownerResolved = false;
        this.planReceived = false;
        this.revalidated = false;
        this.pinnedOwner = null;
        this.pendingReply = null;
        try {
            const cancel = this.env.scheduleOnce(SHADOW_TIMEOUT_MS, () => this.onTimeout());
            this.cancelTimer = cancel;
        } catch (error) {
            void error;
            this.inFlight = false;
            logReject(this.env, "shadow-timer-failed");
            this.drainPending();
            return;
        }
        try {
            this.env.callDbus(
                DBUS_SERVICE,
                DBUS_OBJECT,
                DBUS_INTERFACE,
                DBUS_METHOD,
                SHADOW_SERVICE,
                (reply) => this.onOwner(reply),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "shadow-dbus-failed");
            this.drainPending();
        }
    }

    private onOwner(reply: unknown): void {
        if (!this.inFlight || this.ownerResolved || this.bundle === null) {
            return;
        }
        this.ownerResolved = true;
        if (!isUniqueOwner(reply)) {
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "shadow-owner-missing");
            this.drainPending();
            return;
        }
        this.pinnedOwner = reply;
        let fresh = false;
        try {
            fresh = typeof this.env.revalidateInput === "function" ? this.env.revalidateInput() : false;
        } catch (error) {
            void error;
            fresh = false;
        }
        if (fresh !== true) {
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "shadow-stale-snapshot");
            this.drainPending();
            return;
        }
        try {
            this.env.callDbus(
                reply,
                SHADOW_OBJECT,
                SHADOW_INTERFACE,
                SHADOW_METHOD,
                this.bundle.requestJson,
                (planReply) => this.onPlan(planReply),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "shadow-dbus-failed");
            this.drainPending();
        }
    }

    private onPlan(reply: unknown): void {
        if (!this.inFlight || this.planReceived || this.pinnedOwner === null) {
            return;
        }
        this.planReceived = true;
        this.pendingReply = reply;
        try {
            this.env.callDbus(
                DBUS_SERVICE,
                DBUS_OBJECT,
                DBUS_INTERFACE,
                DBUS_METHOD,
                SHADOW_SERVICE,
                (current) => this.onRevalidate(current),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "shadow-dbus-failed");
            this.drainPending();
        }
    }

    private onRevalidate(current: unknown): void {
        if (!this.inFlight || !this.planReceived || this.revalidated || this.bundle === null) {
            return;
        }
        this.revalidated = true;
        this.clearTimer();
        this.inFlight = false;
        const bundle = this.bundle;
        if (current !== this.pinnedOwner) {
            logReject(this.env, "shadow-owner-changed");
            this.drainPending();
            return;
        }
        let fresh = false;
        try {
            fresh = typeof this.env.revalidateInput === "function" ? this.env.revalidateInput() : false;
        } catch (error) {
            void error;
            fresh = false;
        }
        if (fresh !== true) {
            logReject(this.env, "shadow-stale-snapshot");
            this.drainPending();
            return;
        }
        const observedWindows = new Set<string>(bundle.observed.keys());
        const validated = validateShadowReply(this.pendingReply, {
            correlationId: bundle.correlationId,
            owner: bundle.owner,
            generation: bundle.generation,
            revision: bundle.revision,
            observedWindows,
        });
        if (!validated.ok) {
            logReject(this.env, validated.reason);
            this.drainPending();
            return;
        }
        this.lastFingerprint = bundle.fingerprint;
        // Exact comparison of every returned desired rect against the
        // observed primitive rects.
        let equal = true;
        for (const entry of validated.desired) {
            const observed = bundle.observed.get(entry.window);
            if (
                observed === undefined ||
                observed.x !== entry.rect.x ||
                observed.y !== entry.rect.y ||
                observed.w !== entry.rect.w ||
                observed.h !== entry.rect.h
            ) {
                equal = false;
                break;
            }
        }
        if (validated.focusedWindow !== this.focusedOf(bundle)) {
            equal = false;
        }
        try {
            this.env.log(equal ? LOG_MATCH : LOG_DIVERGENCE);
        } catch (error) {
            void error;
        }
        this.drainPending();
    }

    private focusedOf(bundle: NormalizedShadowBundle): string {
        try {
            const parsed = JSON.parse(bundle.requestJson) as Record<string, unknown>;
            const focused = parsed["focused_window"];
            return typeof focused === "string" ? focused : "";
        } catch (error) {
            void error;
            return "";
        }
    }

    private onTimeout(): void {
        if (!this.inFlight) {
            return;
        }
        this.clearTimer();
        this.inFlight = false;
        logReject(this.env, "shadow-timeout");
        this.drainPending();
    }

    private drainPending(): void {
        if (this.pending && this.enabled && !this.inFlight) {
            this.pending = false;
            this.requestRecompute();
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
