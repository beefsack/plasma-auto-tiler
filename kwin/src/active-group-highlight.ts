// Temporary active-group highlight bridge (script side).
//
// Narrow bridge from the existing DescribePlan route to the effect-owned
// group-highlight D-Bus endpoint. The bridge sends the complete normalized
// observation plus exactly one `{"op":"active-group"}` command over the
// existing DescribePlan transport (no new transport), validates the exact
// bounded reply shape and identity, and forwards engine-projected union
// bounds to the owned effect through `SetGroupHighlight(QString)` or
// `ClearGroupHighlight()`. It never derives topology or native geometry:
// member rectangles and the union bounds are Rust engine projections carried
// verbatim. Every failure (script errors, no-group, service loss,
// focus/domain/tree lifecycle invalidation, malformed/stale/out-of-order
// replies) clears fail-closed. Argument demarshalling on the effect side is
// static-only/live-unverified.
//
// Effect endpoint (owned by the active-border effect, never the generic
// effect bus):
//   service   org.plasmaautotiler.ActiveBorder
//   path      /org/plasmaautotiler/ActiveBorder
//   interface org.plasmaautotiler.ActiveBorder1
//   methods   SetGroupHighlight(QString) / ClearGroupHighlight()
//
// Diagnostics are always-on and bounded: one dispatch line per refresh plus
// one terminal line per flight, carrying correlation/owner/generation only.

import { PLAN_CONTRACT_VERSION, PLAN_MAX_REPLY_BYTES, PLAN_MAX_REQUEST_BYTES, planFingerprint } from "./plan-adapter";

export const GROUP_HIGHLIGHT_SERVICE = "org.plasmaautotiler.ActiveBorder";
export const GROUP_HIGHLIGHT_OBJECT = "/org/plasmaautotiler/ActiveBorder";
export const GROUP_HIGHLIGHT_INTERFACE = "org.plasmaautotiler.ActiveBorder1";
export const GROUP_HIGHLIGHT_SET_METHOD = "SetGroupHighlight";
export const GROUP_HIGHLIGHT_CLEAR_METHOD = "ClearGroupHighlight";

export const ACTIVE_GROUP_OP = "active-group";
export const ACTIVE_GROUP_MAX_REPLY_BYTES = PLAN_MAX_REPLY_BYTES;
export const ACTIVE_GROUP_MAX_REQUEST_BYTES = PLAN_MAX_REQUEST_BYTES;
export const ACTIVE_GROUP_MAX_ID_LEN = 128;
export const ACTIVE_GROUP_MAX_OWNER_LEN = 128;
export const ACTIVE_GROUP_MAX_GENERATION_LEN = 64;
export const ACTIVE_GROUP_MAX_CORRELATION_LEN = 128;
export const ACTIVE_GROUP_MAX_SEQ = 1000000;

const LOG_PREFIX = "plasma-auto-tiler:group-highlight";

const NO_GROUP_REASONS: ReadonlyArray<string> = [
    "no-session",
    "diverged",
    "pending",
    "domain-mismatch",
    "stale-revision",
    "focus-mismatch",
    "focus-unmapped",
    "no-tree",
    "no-parent-group",
];

export type ActiveGroupSignal = "focus" | "domain" | "tree" | "fullscreen";

export interface ActiveGroupRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface ActiveGroupObservedWindow {
    readonly id: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: ActiveGroupRect;
    // Script-only lifecycle validity: compositor fullscreen state carried with
    // the opaque window id (`!== false` fail-closed at the observation
    // boundary). Never serialized into the DescribePlan request and never
    // sent to Rust; checked locally on each current-flight active-group reply
    // before the effect setter runs.
    readonly fullscreen: boolean;
}

export interface ActiveGroupObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: ActiveGroupRect;
    readonly domainGap: number;
    readonly domainOuterGap: number;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<ActiveGroupObservedWindow>;
}

export interface ActiveGroupMember {
    readonly window: string;
    readonly leaf: string;
    readonly rect: ActiveGroupRect;
}

export interface ActiveGroupReplyIdentity {
    readonly correlationId: string;
    readonly owner: string;
    readonly generation: string;
}

export interface ActiveGroupFlightIdentity extends ActiveGroupReplyIdentity {
    readonly focusedId: string;
    readonly domainOutput: string;
    readonly domainWorkspace: string;
}

export type ParsedActiveGroupReply =
    | {
          readonly kind: "active-group";
          readonly correlationId: string;
          readonly owner: string;
          readonly generation: string;
          readonly baseRevision: number;
          readonly group: string;
          readonly focusedLeaf: string;
          readonly focusedWindow: string;
          readonly domainOutput: string;
          readonly domainWorkspace: string;
          readonly members: ReadonlyArray<ActiveGroupMember>;
          readonly bounds: ActiveGroupRect;
      }
    | {
          readonly kind: "no-group";
          readonly correlationId: string;
          readonly owner: string;
          readonly generation: string;
          // Null when the engine omitted base_revision: still a valid clear
          // reply, but identity is preserved conservatively (no revision
          // update) instead of adopting an unknown base.
          readonly baseRevision: number | null;
          readonly reason: string;
      };

export interface ActiveGroupHighlightEnv {
    readonly callDescribePlan: (payload: string, callback: (reply: unknown) => void) => void;
    readonly setHighlight: (payload: string) => void;
    readonly clearHighlight: () => void;
    readonly observe: () => ActiveGroupObserved | null;
    readonly subscribe: (kind: ActiveGroupSignal, handler: () => void) => () => void;
    readonly log: (message: string) => void;
    readonly owner: string;
    readonly generation: string;
}

export interface ActiveGroupHighlightHandle {
    readonly stop: () => void;
    readonly refresh: () => void;
    readonly invalidate: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInt(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isOpaqueId(value: unknown, maxLen: number, allowEmpty: boolean): value is string {
    if (typeof value !== "string") {
        return false;
    }
    if (value.length === 0) {
        return allowEmpty;
    }
    if (value.length > maxLen) {
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

function isGenerationId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > ACTIVE_GROUP_MAX_GENERATION_LEN) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 122) || code === 45)) {
            return false;
        }
    }
    return true;
}

function correlationIsNewer(next: string, previous: string): boolean {
    const nextMatch = /^(.*?)(\d+)$/.exec(next);
    const previousMatch = /^(.*?)(\d+)$/.exec(previous);
    if (nextMatch !== null && previousMatch !== null && nextMatch[1] === previousMatch[1]) {
        const nextSeq = Number(nextMatch[2]);
        const previousSeq = Number(previousMatch[2]);
        if (Number.isSafeInteger(nextSeq) && Number.isSafeInteger(previousSeq) && nextSeq !== previousSeq) {
            return nextSeq > previousSeq;
        }
    }
    return next > previous;
}

function isTargetRect(value: unknown): value is ActiveGroupRect {
    if (!isRecord(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 4 || keys.indexOf("x") < 0 || keys.indexOf("y") < 0 || keys.indexOf("w") < 0 || keys.indexOf("h") < 0) {
        return false;
    }
    const x = value["x"];
    const y = value["y"];
    const w = value["w"];
    const h = value["h"];
    if (!isFiniteInt(x) || !isFiniteInt(y) || !isFiniteInt(w) || !isFiniteInt(h)) {
        return false;
    }
    if (w <= 0 || h <= 0) {
        return false;
    }
    if (x < -16384 || x > 16384 || y < -16384 || y > 16384 || w > 16384 || h > 16384) {
        return false;
    }
    return true;
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
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

function isRevision(value: unknown): value is number {
    return isFiniteInt(value) && value >= 0 && value <= 9007199254740991;
}

function validateMember(value: unknown): ActiveGroupMember | null {
    if (!isRecord(value)) {
        return null;
    }
    if (!hasExactKeys(value, ["window", "leaf", "rect"])) {
        return null;
    }
    if (!isOpaqueId(value["window"], ACTIVE_GROUP_MAX_ID_LEN, false)) {
        return null;
    }
    if (!isOpaqueId(value["leaf"], ACTIVE_GROUP_MAX_ID_LEN, false)) {
        return null;
    }
    if (!isTargetRect(value["rect"])) {
        return null;
    }
    const rect = value["rect"] as unknown as Record<string, unknown>;
    return {
        window: value["window"] as string,
        leaf: value["leaf"] as string,
        rect: {
            x: rect["x"] as number,
            y: rect["y"] as number,
            w: rect["w"] as number,
            h: rect["h"] as number,
        },
    };
}

// Strict bounded validation of one DescribePlan active-group/no-group reply
// against the dispatched flight identity. Returns the parsed reply, or null
// for any malformed or identity-mismatched payload (caller clears).
export function parseActiveGroupReply(reply: unknown, expected: ActiveGroupReplyIdentity): ParsedActiveGroupReply | null {
    if (typeof reply !== "string" || reply.length === 0 || reply.length > ACTIVE_GROUP_MAX_REPLY_BYTES) {
        return null;
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(reply);
    } catch (error) {
        void error;
        return null;
    }
    if (!isRecord(parsed)) {
        return null;
    }
    if (parsed["v"] !== PLAN_CONTRACT_VERSION) {
        return null;
    }
    if (parsed["correlation_id"] !== expected.correlationId) {
        return null;
    }
    const outcome = parsed["outcome"];
    if (outcome !== "active-group" && outcome !== "no-group") {
        return null;
    }
    if (parsed["kind"] !== outcome) {
        return null;
    }
    // Active-group always carries a valid base revision for ordering.
    // No-group may omit it (stateless build failure): that is still a valid
    // fail-closed clear reply with a null base, preserving identity
    // conservatively downstream.
    const baseRaw = parsed["base_revision"];
    const hasBase = baseRaw !== undefined && baseRaw !== null;
    if (outcome === "active-group") {
        if (!isRevision(baseRaw)) {
            return null;
        }
    } else if (hasBase && !isRevision(baseRaw)) {
        return null;
    }
    const baseRevision = hasBase ? (baseRaw as number) : null;
    const detail = parsed["detail"];
    if (!isRecord(detail)) {
        return null;
    }
    if (outcome === "no-group") {
        if (!hasExactKeys(detail, ["kind", "reason", "owner", "generation"])) {
            return null;
        }
        if (detail["kind"] !== "no-group") {
            return null;
        }
        const reason = detail["reason"];
        if (typeof reason !== "string" || NO_GROUP_REASONS.indexOf(reason) < 0) {
            return null;
        }
        if (detail["owner"] !== expected.owner || detail["generation"] !== expected.generation) {
            return null;
        }
        return {
            kind: "no-group",
            correlationId: expected.correlationId,
            owner: expected.owner,
            generation: expected.generation,
            baseRevision,
            reason,
        };
    }
    if (
        !hasExactKeys(detail, [
            "kind",
            "owner",
            "generation",
            "domain_output",
            "domain_workspace",
            "group",
            "focused_leaf",
            "focused_window",
            "members",
            "bounds",
        ])
    ) {
        return null;
    }
    if (detail["kind"] !== "active-group") {
        return null;
    }
    if (detail["owner"] !== expected.owner || detail["generation"] !== expected.generation) {
        return null;
    }
    if (
        !isOpaqueId(detail["domain_output"], ACTIVE_GROUP_MAX_ID_LEN, false) ||
        !isOpaqueId(detail["domain_workspace"], ACTIVE_GROUP_MAX_ID_LEN, false) ||
        !isOpaqueId(detail["group"], ACTIVE_GROUP_MAX_ID_LEN, false) ||
        !isOpaqueId(detail["focused_leaf"], ACTIVE_GROUP_MAX_ID_LEN, false) ||
        !isOpaqueId(detail["focused_window"], ACTIVE_GROUP_MAX_ID_LEN, false)
    ) {
        return null;
    }
    const membersRaw = detail["members"];
    if (!Array.isArray(membersRaw) || membersRaw.length === 0) {
        return null;
    }
    const members: ActiveGroupMember[] = [];
    const seen = new Set<string>();
    for (const entry of membersRaw) {
        const member = validateMember(entry);
        if (member === null || seen.has(member.window)) {
            return null;
        }
        seen.add(member.window);
        members.push(member);
    }
    if (!isTargetRect(detail["bounds"])) {
        return null;
    }
    const boundsRaw = detail["bounds"] as unknown as Record<string, unknown>;
    const bounds: ActiveGroupRect = {
        x: boundsRaw["x"] as number,
        y: boundsRaw["y"] as number,
        w: boundsRaw["w"] as number,
        h: boundsRaw["h"] as number,
    };
    // Rendering consumes only the engine-projected union bounds; every member
    // rectangle must be contained in it, otherwise the projection is
    // inconsistent and the reply clears.
    for (const member of members) {
        if (
            member.rect.x < bounds.x ||
            member.rect.y < bounds.y ||
            member.rect.x + member.rect.w > bounds.x + bounds.w ||
            member.rect.y + member.rect.h > bounds.y + bounds.h
        ) {
            return null;
        }
    }
    return {
        kind: "active-group",
        correlationId: expected.correlationId,
        owner: expected.owner,
        generation: expected.generation,
        baseRevision: baseRevision as number,
        group: detail["group"] as string,
        focusedLeaf: detail["focused_leaf"] as string,
        focusedWindow: detail["focused_window"] as string,
        domainOutput: detail["domain_output"] as string,
        domainWorkspace: detail["domain_workspace"] as string,
        members: Object.freeze(members),
        bounds,
    };
}

function validateObserved(observed: ActiveGroupObserved | null): observed is ActiveGroupObserved {
    if (observed === null || typeof observed !== "object") {
        return false;
    }
    if (!isOpaqueId(observed.domainOutput, ACTIVE_GROUP_MAX_ID_LEN, false)) {
        return false;
    }
    if (!isOpaqueId(observed.domainWorkspace, ACTIVE_GROUP_MAX_ID_LEN, false)) {
        return false;
    }
    if (!isOpaqueId(observed.focusedId, ACTIVE_GROUP_MAX_ID_LEN, false)) {
        return false;
    }
    if (!isTargetRect({ x: observed.domainBounds.x, y: observed.domainBounds.y, w: observed.domainBounds.w, h: observed.domainBounds.h })) {
        return false;
    }
    if (!isFiniteInt(observed.domainGap) || observed.domainGap < 0 || observed.domainGap > 64) {
        return false;
    }
    if (!isFiniteInt(observed.domainOuterGap) || observed.domainOuterGap < 0 || observed.domainOuterGap > 64) {
        return false;
    }
    if (!Array.isArray(observed.windows as unknown)) {
        return false;
    }
    if (observed.windows.length === 0) {
        return false;
    }
    const seen = new Set<string>();
    let focusedFound = false;
    for (const entry of observed.windows) {
        if (typeof entry !== "object" || entry === null) {
            return false;
        }
        const candidate = entry as ActiveGroupObservedWindow;
        if (!isOpaqueId(candidate.id, ACTIVE_GROUP_MAX_ID_LEN, false)) {
            return false;
        }
        if (candidate.output !== observed.domainOutput || candidate.workspace !== observed.domainWorkspace) {
            return false;
        }
        if (!isTargetRect({ x: candidate.rect.x, y: candidate.rect.y, w: candidate.rect.w, h: candidate.rect.h })) {
            return false;
        }
        // Fullscreen validity rides with the opaque id only. Unknown state
        // must already have collapsed to `true` at the observation boundary
        // (`!== false`); any non-boolean here invalidates the snapshot.
        if (typeof candidate.fullscreen !== "boolean") {
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
    return focusedFound;
}

// Builds the exact DescribePlan active-group request over the existing
// route. The observation rectangles are carried verbatim for the Rust
// retained lookup; no topology is derived here. Over-cap is reported
// distinctly from malformed builds so the caller can refuse loudly instead
// of silently dropping.
export type ActiveGroupRequestResult =
    | { readonly ok: true; readonly payload: string }
    | { readonly ok: false; readonly reason: "request-invalid" | "request-over-cap" };

export function buildActiveGroupRequest(
    observed: ActiveGroupObserved,
    owner: string,
    generation: string,
    correlation: string,
    revision: number,
    fingerprint: number,
): ActiveGroupRequestResult {
    if (!validateObserved(observed)) {
        return { ok: false, reason: "request-invalid" };
    }
    if (!isOpaqueId(owner, ACTIVE_GROUP_MAX_OWNER_LEN, false)) {
        return { ok: false, reason: "request-invalid" };
    }
    if (!isOpaqueId(correlation, ACTIVE_GROUP_MAX_CORRELATION_LEN, false)) {
        return { ok: false, reason: "request-invalid" };
    }
    if (!isGenerationId(generation)) {
        return { ok: false, reason: "request-invalid" };
    }
    if (!isRevision(revision) || !isRevision(fingerprint)) {
        return { ok: false, reason: "request-invalid" };
    }
    const windows = observed.windows.map((entry) => ({
        window: entry.id,
        output: entry.output,
        workspace: entry.workspace,
        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
    }));
    let payload = "";
    try {
        payload = JSON.stringify({
            v: PLAN_CONTRACT_VERSION,
            correlation_id: correlation,
            owner,
            generation,
            revision,
            fingerprint,
            domain: {
                output: observed.domainOutput,
                workspace: observed.domainWorkspace,
                bounds: {
                    x: observed.domainBounds.x,
                    y: observed.domainBounds.y,
                    w: observed.domainBounds.w,
                    h: observed.domainBounds.h,
                },
                gap: observed.domainGap,
                outer_gap: observed.domainOuterGap,
            },
            focused_window: observed.focusedId,
            windows,
            command: { op: ACTIVE_GROUP_OP },
        });
    } catch (error) {
        void error;
        return { ok: false, reason: "request-invalid" };
    }
    // `.length` is an exact byte count: every serialized string is a fixed
    // literal or passes isOpaqueId/isGenerationId (ASCII-only charsets), and
    // JSON numbers and escapes are ASCII-only. Validation above rejects any
    // non-ASCII before this build.
    if (payload.length > ACTIVE_GROUP_MAX_REQUEST_BYTES) {
        return { ok: false, reason: "request-over-cap" };
    }
    return { ok: true, payload };
}

// Formats the bounded QString payload forwarded to the owned effect setter.
// Carries only identity plus the engine-projected union bounds; member
// topology never crosses to the renderer.
export function formatGroupHighlightPayload(
    correlationId: string,
    owner: string,
    generation: string,
    revision: number,
    group: string,
    focusedWindow: string,
    bounds: ActiveGroupRect,
): string | null {
    if (!isOpaqueId(correlationId, ACTIVE_GROUP_MAX_CORRELATION_LEN, false)) {
        return null;
    }
    if (!isOpaqueId(owner, ACTIVE_GROUP_MAX_OWNER_LEN, false)) {
        return null;
    }
    if (!isGenerationId(generation)) {
        return null;
    }
    if (!isRevision(revision)) {
        return null;
    }
    if (!isOpaqueId(group, ACTIVE_GROUP_MAX_ID_LEN, false)) {
        return null;
    }
    if (!isOpaqueId(focusedWindow, ACTIVE_GROUP_MAX_ID_LEN, false)) {
        return null;
    }
    if (!isTargetRect({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h })) {
        return null;
    }
    let payload = "";
    try {
        payload = JSON.stringify({
            v: 1,
            correlation_id: correlationId,
            owner,
            generation,
            revision,
            group,
            focused_window: focusedWindow,
            bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
        });
    } catch (error) {
        void error;
        return null;
    }
    if (payload.length > 4096) {
        return null;
    }
    return payload;
}

interface PendingHighlightFlight {
    readonly correlation: string;
    readonly epoch: number;
    readonly focusedId: string;
    readonly domainOutput: string;
    readonly domainWorkspace: string;
}

export class ActiveGroupHighlight {
    private epoch = 0;
    private seq = 0;
    private pending: PendingHighlightFlight | null = null;
    private lastRevision: number | null = null;
    private lastCorrelation: string | null = null;
    private requestRevision = 0;

    constructor(private readonly env: ActiveGroupHighlightEnv) {}

    refresh(): void {
        this.epoch += 1;
        const flightEpoch = this.epoch;
        let observed: ActiveGroupObserved | null = null;
        try {
            observed = this.env.observe();
        } catch (error) {
            void error;
            observed = null;
        }
        if (!validateObserved(observed)) {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=observe-invalid`);
            return;
        }
        if (this.seq < 0 || this.seq > ACTIVE_GROUP_MAX_SEQ) {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=seq-exhausted`);
            return;
        }
        const correlation = `${this.env.generation}-g${String(this.seq)}`;
        this.seq += 1;
        if (!isOpaqueId(correlation, ACTIVE_GROUP_MAX_CORRELATION_LEN, false)) {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=correlation-invalid`);
            return;
        }
        const snapshot = observed as ActiveGroupObserved;
        const sortedIds = snapshot.windows.map((entry) => entry.id).sort();
        let fingerprint = 0;
        try {
            fingerprint = planFingerprint(snapshot.domainOutput, snapshot.domainWorkspace, snapshot.focusedId, sortedIds);
        } catch (error) {
            void error;
            this.clearFlight(`${LOG_PREFIX}:cleared reason=fingerprint-invalid`);
            return;
        }
        const result = buildActiveGroupRequest(snapshot, this.env.owner, this.env.generation, correlation, this.requestRevision, fingerprint);
        if (!result.ok) {
            // Unbuildable or over-cap request: no dispatch, plus one
            // correlated refusal line so the drop is never silent.
            this.logToken(`${LOG_PREFIX}:request-refused correlation=${correlation} reason=${result.reason}`);
            this.clearFlight(`${LOG_PREFIX}:cleared reason=request-invalid`);
            return;
        }
        const payload = result.payload;
        this.pending = {
            correlation,
            epoch: flightEpoch,
            focusedId: snapshot.focusedId,
            domainOutput: snapshot.domainOutput,
            domainWorkspace: snapshot.domainWorkspace,
        };
        const flight = this.pending;
        this.logToken(`${LOG_PREFIX}:dispatch correlation=${correlation}`);
        try {
            this.env.callDescribePlan(payload, (reply) => this.onReply(reply, flight));
        } catch (error) {
            void error;
            this.pending = null;
            this.clearFlight(`${LOG_PREFIX}:cleared reason=dbus-failed`);
        }
    }

    invalidate(): void {
        this.epoch += 1;
        this.pending = null;
        this.clearEffect();
        this.logToken(`${LOG_PREFIX}:cleared reason=lifecycle-invalid`);
    }

    private onReply(reply: unknown, flight: PendingHighlightFlight | null): void {
        // A late reply for a superseded flight must be ignored without
        // touching the newer pending flight or the currently displayed
        // highlight: clearing here would let an old async no-group erase a
        // newer focus result and would null the newer flight's pending slot
        // so its own reply is then dropped.
        if (flight === null || this.pending === null || flight.correlation !== this.pending.correlation || flight.epoch !== this.pending.epoch || flight.epoch !== this.epoch) {
            this.logToken(`${LOG_PREFIX}:dropped reason=stale-dropped`);
            return;
        }
        this.pending = null;
        if (typeof reply !== "string") {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=reply-invalid`);
            return;
        }
        let parsed: ParsedActiveGroupReply | null = null;
        try {
            parsed = parseActiveGroupReply(reply, {
                correlationId: flight.correlation,
                owner: this.env.owner,
                generation: this.env.generation,
            });
        } catch (error) {
            void error;
            parsed = null;
        }
        if (parsed === null) {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=reply-invalid`);
            return;
        }
        if (parsed.kind === "no-group") {
            // Missing base preserves identity conservatively: clear without
            // adopting an unknown revision.
            if (parsed.baseRevision !== null) {
                this.requestRevision = parsed.baseRevision;
            }
            this.clearFlight(`${LOG_PREFIX}:cleared reason=${parsed.reason}`);
            return;
        }
        if (parsed.focusedWindow !== flight.focusedId || parsed.domainOutput !== flight.domainOutput || parsed.domainWorkspace !== flight.domainWorkspace) {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=identity-mismatch`);
            return;
        }
        // Stale/out-of-order versus the currently displayed highlight is
        // ignored without destroying it: the newer display stays up.
        if (this.lastRevision !== null) {
            if (parsed.baseRevision < this.lastRevision) {
                this.logToken(`${LOG_PREFIX}:dropped reason=stale-revision`);
                return;
            }
            if (parsed.baseRevision === this.lastRevision && this.lastCorrelation !== null && !correlationIsNewer(parsed.correlationId, this.lastCorrelation)) {
                this.logToken(`${LOG_PREFIX}:dropped reason=out-of-order`);
                return;
            }
        }
        // Fail-closed fullscreen gate for non-focused members: every
        // Rust-reported member must have a current observed entry and none may
        // be fullscreen. The check re-reads current script observation (never
        // Rust topology) after the focus/ordering gates so stale-flight and
        // ordering behavior is unchanged. Missing, unknown, or fullscreen
        // clears before the setter call.
        let current: ActiveGroupObserved | null = null;
        try {
            current = this.env.observe();
        } catch (error) {
            void error;
            current = null;
        }
        if (!validateObserved(current)) {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=fullscreen`);
            return;
        }
        const fullscreenById = new Map<string, boolean>();
        for (const entry of (current as ActiveGroupObserved).windows) {
            fullscreenById.set(entry.id, entry.fullscreen);
        }
        for (const member of parsed.members) {
            const flag = fullscreenById.get(member.window);
            if (flag === undefined || flag !== false) {
                this.clearFlight(`${LOG_PREFIX}:cleared reason=fullscreen`);
                return;
            }
        }
        const payload = formatGroupHighlightPayload(
            parsed.correlationId,
            parsed.owner,
            parsed.generation,
            parsed.baseRevision,
            parsed.group,
            parsed.focusedWindow,
            parsed.bounds,
        );
        if (payload === null) {
            this.clearFlight(`${LOG_PREFIX}:cleared reason=payload-invalid`);
            return;
        }
        try {
            this.env.setHighlight(payload);
        } catch (error) {
            void error;
            this.clearFlight(`${LOG_PREFIX}:cleared reason=service-loss`);
            return;
        }
        this.lastRevision = parsed.baseRevision;
        this.lastCorrelation = parsed.correlationId;
        this.requestRevision = parsed.baseRevision;
        // The effect setter has no callback: this line records only that the
        // setter call was submitted, never effect acceptance or rendering.
        this.logToken(`${LOG_PREFIX}:setter-submitted correlation=${parsed.correlationId} revision=${String(parsed.baseRevision)}`);
    }

    private clearFlight(line: string): void {
        this.pending = null;
        this.clearEffect();
        this.logToken(line);
    }

    private clearEffect(): void {
        try {
            this.env.clearHighlight();
        } catch (error) {
            void error;
        }
    }

    private logToken(line: string): void {
        try {
            this.env.log(line);
        } catch (error) {
            void error;
        }
    }
}

// Starts the temporary highlight bridge: validates owner/generation,
// subscribes to focus/domain/tree/fullscreen lifecycle signals, issues the
// initial DescribePlan active-group query, and re-queries (after clearing) on
// every lifecycle change. Focus activation clears the old group immediately
// before the asynchronous refresh so no stale group renders under the new
// focus. Any workspace-signal subscription failure clears fail-closed and
// returns null; the best-effort per-window fullscreen signal never fails
// enable. No timers, no polling, no fallback.
export function startActiveGroupHighlight(env: ActiveGroupHighlightEnv): ActiveGroupHighlightHandle | null {
    if (!isOpaqueId(env.owner, ACTIVE_GROUP_MAX_OWNER_LEN, false)) {
        return null;
    }
    if (!isGenerationId(env.generation)) {
        return null;
    }
    if (typeof env.callDescribePlan !== "function" || typeof env.setHighlight !== "function" || typeof env.clearHighlight !== "function") {
        return null;
    }
    if (typeof env.observe !== "function" || typeof env.subscribe !== "function" || typeof env.log !== "function") {
        return null;
    }
    const bridge = new ActiveGroupHighlight(env);
    const detaches: Array<() => void> = [];
    const kinds: ReadonlyArray<ActiveGroupSignal> = ["focus", "domain", "tree", "fullscreen"];
    for (const kind of kinds) {
        let detach: (() => void) | null = null;
        try {
            detach = env.subscribe(kind, () => {
                try {
                    bridge.invalidate();
                } catch (error) {
                    void error;
                }
                try {
                    bridge.refresh();
                } catch (error) {
                    void error;
                }
            });
        } catch (error) {
            void error;
            detach = null;
        }
        if (typeof detach !== "function") {
            // The per-window fullscreen signal is best-effort (mirrors the
            // plan adapter's fullScreenChanged seam): a missing source never
            // fails enable, the effect-side eligibility gate still hides.
            if (kind === "fullscreen") {
                continue;
            }
            for (const done of detaches) {
                try {
                    done();
                } catch (error) {
                    void error;
                }
            }
            try {
                env.clearHighlight();
            } catch (error) {
                void error;
            }
            return null;
        }
        detaches.push(detach);
    }
    try {
        bridge.refresh();
    } catch (error) {
        void error;
    }
    return {
        stop: (): void => {
            for (const done of detaches) {
                try {
                    done();
                } catch (error) {
                    void error;
                }
            }
            try {
                env.clearHighlight();
            } catch (error) {
                void error;
            }
        },
        refresh: (): void => {
            try {
                bridge.refresh();
            } catch (error) {
                void error;
            }
        },
        invalidate: (): void => {
            try {
                bridge.invalidate();
            } catch (error) {
                void error;
            }
        },
    };
}
