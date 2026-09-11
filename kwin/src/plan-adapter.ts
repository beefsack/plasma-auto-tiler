// Bounded Stage 4 DescribePlan adapter (single production route).
//
// KWin-side observation and actuation only. Rust owns all tiling, order,
// membership, and rejection policy through the stateless DescribePlan route:
// the adapter sends the complete normalized observation (stable opaque ids,
// frame rectangles, output, workspace, focus) plus one parameterized command
// and applies the complete reply geometries in the shared canonical
// grow-before-shrink order. Rejections are always recoverable: the adapter
// never disables itself after a reply and a fresh observation recovers on
// the next command. Stale replies are fenced against newer observations by
// epoch plus correlation.
//
// Diagnostics are bounded to exactly two redacted line shapes: one per
// dispatched command (correlation, kind, window count, outcome) and one per
// Rust rejection kind. No scope, signal, identity, or payload detail is
// logged and no other log call exists in this module.

import { orderGeometryWrites } from "./geometry-order";

export const PLAN_SERVICE = "org.plasmaautotiler.Planner";
export const PLAN_OBJECT = "/org/plasmaautotiler/Planner";
export const PLAN_INTERFACE = "org.plasmaautotiler.Planner1";
export const PLAN_METHOD = "DescribePlan";

export const PLAN_CONTRACT_VERSION = 1;
export const PLAN_MAX_REQUEST_BYTES = 64 * 1024;
export const PLAN_MAX_REPLY_BYTES = 64 * 1024;
export const PLAN_TIMEOUT_MS = 2000;
export const PLAN_DEBOUNCE_MS = 120;
export const PLAN_MAX_CORRELATION_LEN = 128;
export const PLAN_MAX_OWNER_LEN = 128;
export const PLAN_MAX_GENERATION_LEN = 64;
export const PLAN_MAX_ID_LEN = 128;
export const PLAN_MAX_WINDOWS = 64;
export const PLAN_MAX_GEOMETRY = 64;
export const PLAN_MAX_SEQ = 1000000;

const LOG_PREFIX = "plasma-auto-tiler:plan";

export type PlanDirection = "left" | "right" | "up" | "down";
export type PlanResizeMode = "inwards" | "outwards";
export type PlanSignal = "added" | "removed" | "activated" | "geometry" | "scope";
export type PlanOp = "admit" | "remove" | "move" | "focus" | "resize";

export interface PlanRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface PlanObservedWindow {
    readonly id: string;
    readonly ref: object;
    readonly rect: PlanRect;
    readonly output: string;
    readonly workspace: string;
}

export interface PlanObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: PlanRect;
    readonly domainGap: number;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<PlanObservedWindow>;
    readonly activeRef: object;
    readonly fingerprint: string;
    readonly revalidate: () => boolean;
}

export interface PlanAdapterEnv {
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
    readonly observe: () => PlanObserved | null;
    readonly setGeometry: (target: object, rect: PlanRect) => boolean;
    readonly setActive: (target: object) => boolean;
    readonly active: () => object | null;
    readonly subscribe: (kind: PlanSignal, handler: () => void) => () => void;
}

export interface PlanEnableAuth {
    readonly owner: unknown;
    readonly generation: unknown;
}

// Deterministic bounded observation fingerprint (FNV-1a 32-bit over
// `output\x1fworkspace\x1ffocused\x1fids...`, sorted ids). Sent as the
// numeric fingerprint; the string cache identity in observations carries the
// same value so dispatch, validation, and repeat tracking bind one value.
export function planFingerprint(
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

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > PLAN_MAX_ID_LEN) {
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

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= PLAN_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > PLAN_MAX_GENERATION_LEN) {
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

function isCorrelationId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= PLAN_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isDirection(value: unknown): value is PlanDirection {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isResizeMode(value: unknown): value is PlanResizeMode {
    return value === "inwards" || value === "outwards";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInt(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isTargetRect(value: unknown): value is PlanRect {
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

// Bounded rejection-kind token for the single rejection-kind line: lowercase
// dashes only, otherwise redacted to `unknown`. Never echoes payload bytes.
function sanitizeKind(value: unknown): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 64) {
        return "unknown";
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const ok = (code >= 97 && code <= 122) || code === 45;
        if (!ok) {
            return "unknown";
        }
    }
    return value;
}

interface PlanGeometryEntry {
    readonly window: string;
    readonly leaf: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: PlanRect;
}

interface PlanFocusBody {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly leaf: string;
}

interface PlannedReply {
    readonly correlationId: string;
    readonly geometry: ReadonlyArray<PlanGeometryEntry>;
    readonly focus: PlanFocusBody | null;
}

function validateGeometryEntry(value: unknown): PlanGeometryEntry | null {
    if (!isRecord(value)) {
        return null;
    }
    if (!hasExactKeys(value, ["window", "leaf", "output", "workspace", "rect"])) {
        return null;
    }
    if (
        !isOpaqueId(value["window"]) ||
        !isOpaqueId(value["leaf"]) ||
        !isOpaqueId(value["output"]) ||
        !isOpaqueId(value["workspace"])
    ) {
        return null;
    }
    const rawRect: unknown = value["rect"];
    if (!isTargetRect(rawRect)) {
        return null;
    }
    const rect = rawRect as unknown as Record<string, unknown>;
    return {
        window: value["window"] as string,
        leaf: value["leaf"] as string,
        output: value["output"] as string,
        workspace: value["workspace"] as string,
        rect: {
            x: rect["x"] as number,
            y: rect["y"] as number,
            w: rect["w"] as number,
            h: rect["h"] as number,
        },
    };
}

function validateFocusBody(value: unknown): PlanFocusBody | null {
    if (!isRecord(value)) {
        return null;
    }
    if (!hasExactKeys(value, ["domain_output", "domain_workspace", "leaf"])) {
        return null;
    }
    if (
        !isOpaqueId(value["domain_output"]) ||
        !isOpaqueId(value["domain_workspace"]) ||
        !isOpaqueId(value["leaf"])
    ) {
        return null;
    }
    return {
        domainOutput: value["domain_output"] as string,
        domainWorkspace: value["domain_workspace"] as string,
        leaf: value["leaf"] as string,
    };
}

function validatePlanned(reply: unknown, correlationId: string): PlannedReply | null {
    if (!isRecord(reply)) {
        return null;
    }
    if (reply["v"] !== PLAN_CONTRACT_VERSION) {
        return null;
    }
    if (reply["correlation_id"] !== correlationId) {
        return null;
    }
    if (reply["outcome"] !== "planned") {
        return null;
    }
    const geometryRaw = reply["desired_geometry"];
    if (!Array.isArray(geometryRaw) || geometryRaw.length === 0 || geometryRaw.length > PLAN_MAX_GEOMETRY) {
        return null;
    }
    const geometry: PlanGeometryEntry[] = [];
    const seen = new Set<string>();
    for (const entry of geometryRaw) {
        const valid = validateGeometryEntry(entry);
        if (valid === null || seen.has(valid.window)) {
            return null;
        }
        seen.add(valid.window);
        geometry.push(valid);
    }
    const focusRaw = reply["desired_focus"];
    if (focusRaw !== undefined && focusRaw !== null) {
        const focus = validateFocusBody(focusRaw);
        if (focus === null) {
            return null;
        }
        return { correlationId, geometry: Object.freeze(geometry), focus };
    }
    return { correlationId, geometry: Object.freeze(geometry), focus: null };
}

function validateObserved(observed: PlanObserved | null): observed is PlanObserved {
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
    if (windows.length === 0 || windows.length > PLAN_MAX_WINDOWS) {
        return false;
    }
    if (
        !isTargetRect({
            x: observed.domainBounds.x,
            y: observed.domainBounds.y,
            w: observed.domainBounds.w,
            h: observed.domainBounds.h,
        })
    ) {
        return false;
    }
    if (!isFiniteInt(observed.domainGap) || observed.domainGap < 0 || observed.domainGap > 64) {
        return false;
    }
    const seen = new Set<string>();
    let focusedFound = false;
    for (const entry of windows) {
        if (typeof entry !== "object" || entry === null) {
            return false;
        }
        const candidate = entry as PlanObservedWindow;
        if (!isOpaqueId(candidate.id) || typeof candidate.ref !== "object" || candidate.ref === null) {
            return false;
        }
        if (candidate.output !== observed.domainOutput || candidate.workspace !== observed.domainWorkspace) {
            return false;
        }
        if (
            !isTargetRect({ x: candidate.rect.x, y: candidate.rect.y, w: candidate.rect.w, h: candidate.rect.h })
        ) {
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
    if (typeof observed.activeRef !== "object" || observed.activeRef === null) {
        return false;
    }
    if (typeof observed.revalidate !== "function") {
        return false;
    }
    return true;
}

interface PendingFlight {
    readonly correlation: string;
    readonly op: PlanOp;
    readonly epoch: number;
    readonly observed: PlanObserved;
    readonly removed: string | null;
    readonly windowCount: number;
}

interface AutoIntent {
    readonly op: PlanOp;
    readonly observed: PlanObserved;
    readonly removed: string | null;
    readonly body: Record<string, unknown>;
}

export class PlanAdapter {
    private enabled = false;
    private owner = "";
    private generation = "";
    private detaches: Array<() => void> = [];
    private inFlight = false;
    private token = 0;
    private activeToken = 0;
    private callbackSeen = false;
    private cancelTimer: (() => void) | null = null;
    private debounceCancel: (() => void) | null = null;
    private pending: PendingFlight | null = null;
    private deferredAuto: AutoIntent | null = null;
    private epoch = 0;
    private seq = 0;
    private lastGood: PlanObserved | null = null;
    private repeatFocused: string | null = null;
    private repeatDirection: PlanDirection | null = null;
    private repeatMode: PlanResizeMode | null = null;
    private repeatNext = 0;
    private repeatFingerprint = "";

    constructor(private readonly env: PlanAdapterEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    enable(auth: PlanEnableAuth): boolean {
        if (this.enabled) {
            return false;
        }
        if (!isRecord(auth as unknown as Record<string, unknown>)) {
            return false;
        }
        if (!isOwnerId(auth.owner) || !isGeneration(auth.generation)) {
            return false;
        }
        const kinds: ReadonlyArray<PlanSignal> = ["added", "removed", "activated", "geometry", "scope"];
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
                return false;
            }
            attached.push(detach);
        }
        this.detaches = attached;
        this.owner = auth.owner as string;
        this.generation = auth.generation as string;
        this.enabled = true;
        this.inFlight = false;
        this.pending = null;
        this.deferredAuto = null;
        this.epoch = 0;
        this.lastGood = null;
        this.clearRepeat();
        return true;
    }

    disable(): void {
        if (!this.enabled && this.detaches.length === 0) {
            return;
        }
        this.enabled = false;
        this.inFlight = false;
        this.pending = null;
        this.deferredAuto = null;
        this.lastGood = null;
        this.clearRepeat();
        this.clearTimer();
        this.clearDebounce();
        for (const detach of this.detaches) {
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
        this.detaches = [];
    }

    requestFocus(direction: unknown): void {
        if (!this.enabled || this.inFlight || !isDirection(direction)) {
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            return;
        }
        this.noteObservation(observed.fingerprint);
        this.dispatch({
            op: "focus",
            observed,
            removed: null,
            body: { op: "focus", window: observed.focusedId, direction },
        });
    }

    requestMove(direction: unknown): void {
        if (!this.enabled || this.inFlight || !isDirection(direction)) {
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            return;
        }
        this.noteObservation(observed.fingerprint);
        this.dispatch({
            op: "move",
            observed,
            removed: null,
            body: { op: "move", window: observed.focusedId, direction },
        });
    }

    requestResize(direction: unknown, mode: unknown): void {
        if (!this.enabled || this.inFlight || !isDirection(direction) || !isResizeMode(mode)) {
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            return;
        }
        this.noteObservation(observed.fingerprint);
        let pressIndex = 0;
        if (
            this.repeatFocused === observed.focusedId &&
            this.repeatDirection === direction &&
            this.repeatMode === mode
        ) {
            pressIndex = this.repeatNext;
        }
        this.repeatFocused = observed.focusedId;
        this.repeatDirection = direction;
        this.repeatMode = mode;
        this.repeatNext = pressIndex + 1;
        this.dispatch({
            op: "resize",
            observed,
            removed: null,
            body: { op: "resize", window: observed.focusedId, direction, mode, press_index: pressIndex },
        });
    }

    requestResync(): void {
        this.onSignal();
    }

    private clearRepeat(): void {
        this.repeatFocused = null;
        this.repeatDirection = null;
        this.repeatMode = null;
        this.repeatNext = 0;
        this.repeatFingerprint = "";
    }

    private noteObservation(fingerprint: string): void {
        if (fingerprint !== this.repeatFingerprint) {
            this.repeatFingerprint = fingerprint;
            this.repeatFocused = null;
            this.repeatDirection = null;
            this.repeatMode = null;
            this.repeatNext = 0;
        }
    }

    private freshObserved(): PlanObserved | null {
        let observed: PlanObserved | null = null;
        try {
            observed = this.env.observe();
        } catch (error) {
            void error;
            observed = null;
        }
        if (!validateObserved(observed)) {
            return null;
        }
        return observed as PlanObserved;
    }

    private onSignal(): void {
        if (!this.enabled) {
            return;
        }
        if (this.debounceCancel !== null) {
            return;
        }
        try {
            this.debounceCancel = this.env.scheduleOnce(PLAN_DEBOUNCE_MS, () => {
                this.debounceCancel = null;
                this.refreshNow();
            });
        } catch (error) {
            void error;
            this.debounceCancel = null;
        }
    }

    // Debounced signal resync: always takes a fresh observation (bumping the
    // fencing epoch) but defers the auto command while a flight is active.
    // Membership growth yields one admit, shrinkage yields one remove against
    // the pre-removal snapshot; anything else only refreshes the baseline.
    private refreshNow(): void {
        if (!this.enabled) {
            return;
        }
        const fresh = this.freshObserved();
        if (fresh === null) {
            return;
        }
        this.epoch += 1;
        this.noteObservation(fresh.fingerprint);
        const previous = this.lastGood;
        if (previous === null) {
            this.lastGood = fresh;
            this.deferredAuto = {
                op: "admit",
                observed: fresh,
                removed: null,
                body: {
                    op: "admit",
                    window: fresh.focusedId,
                    output: fresh.domainOutput,
                    workspace: fresh.domainWorkspace,
                },
            };
            if (!this.inFlight) {
                const next = this.deferredAuto;
                this.deferredAuto = null;
                if (next !== null) {
                    this.dispatch(next);
                }
            }
            return;
        }
        const before = new Set<string>();
        for (const entry of previous.windows) {
            before.add(entry.id);
        }
        const after = new Set<string>();
        for (const entry of fresh.windows) {
            after.add(entry.id);
        }
        let intent: AutoIntent | null = null;
        for (const entry of fresh.windows) {
            if (!before.has(entry.id)) {
                intent = {
                    op: "admit",
                    observed: fresh,
                    removed: null,
                    body: { op: "admit", window: entry.id, output: fresh.domainOutput, workspace: fresh.domainWorkspace },
                };
                break;
            }
        }
        if (intent === null) {
            for (const entry of previous.windows) {
                if (!after.has(entry.id)) {
                    intent = {
                        op: "remove",
                        observed: previous,
                        removed: entry.id,
                        body: { op: "remove", window: entry.id },
                    };
                    break;
                }
            }
        }
        this.lastGood = fresh;
        if (intent !== null) {
            this.deferredAuto = intent;
        }
        if (this.inFlight) {
            return;
        }
        const next = this.deferredAuto;
        this.deferredAuto = null;
        if (next !== null) {
            this.dispatch(next);
        }
    }

    private dispatch(intent: { op: PlanOp; observed: PlanObserved; removed: string | null; body: Record<string, unknown> }): void {
        if (!this.enabled || this.inFlight) {
            return;
        }
        if (this.seq < 0 || this.seq > PLAN_MAX_SEQ) {
            return;
        }
        const correlation = `${this.generation}-p${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            return;
        }
        const observed = intent.observed;
        const sortedIds = observed.windows.map((entry) => entry.id).sort();
        const fingerprint = planFingerprint(
            observed.domainOutput,
            observed.domainWorkspace,
            observed.focusedId,
            sortedIds,
        );
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
                owner: this.owner,
                generation: this.generation,
                revision: 0,
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
                },
                focused_window: observed.focusedId,
                windows,
                command: intent.body,
            });
        } catch (error) {
            void error;
            return;
        }
        if (payload.length > PLAN_MAX_REQUEST_BYTES) {
            return;
        }
        this.inFlight = true;
        this.pending = {
            correlation,
            op: intent.op,
            epoch: this.epoch,
            observed,
            removed: intent.removed,
            windowCount: sortedIds.length,
        };
        this.callbackSeen = false;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        try {
            const cancel = this.env.scheduleOnce(PLAN_TIMEOUT_MS, () => this.onTimeout(flight));
            this.cancelTimer = cancel;
        } catch (error) {
            void error;
            this.inFlight = false;
            this.pending = null;
            this.diag(intent.op, correlation, sortedIds.length, "timer-failed");
            this.finishFlight();
            return;
        }
        try {
            this.env.callDbus(
                PLAN_SERVICE,
                PLAN_OBJECT,
                PLAN_INTERFACE,
                PLAN_METHOD,
                payload,
                (reply) => this.onRequestReply(reply, flight),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.pending = null;
            this.diag(intent.op, correlation, sortedIds.length, "dbus-failed");
            this.finishFlight();
        }
    }

    private onTimeout(flight: number): void {
        if (!this.inFlight || flight !== this.activeToken) {
            return;
        }
        const lost = this.pending;
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        if (lost !== null) {
            this.diag(lost.op, lost.correlation, lost.windowCount, "timeout");
        }
        this.finishFlight();
    }

    private onRequestReply(reply: unknown, flight: number): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        if (typeof reply !== "string" || reply.length > PLAN_MAX_REPLY_BYTES) {
            this.failFlight(flightState, "service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.failFlight(flightState, "service-fault");
            return;
        }
        if (!isRecord(parsed)) {
            this.failFlight(flightState, "service-fault");
            return;
        }
        if (parsed["v"] !== PLAN_CONTRACT_VERSION) {
            this.failFlight(flightState, "service-fault");
            return;
        }
        if (parsed["correlation_id"] !== flightState.correlation) {
            this.failFlight(flightState, "correlation-mismatch");
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "rejected") {
            const kind = sanitizeKind(parsed["kind"]);
            this.inFlight = false;
            this.pending = null;
            this.diag(flightState.op, flightState.correlation, flightState.windowCount, "rejected");
            this.rejectKind(kind);
            this.finishFlight();
            return;
        }
        if (outcome !== "planned") {
            this.failFlight(flightState, "service-fault");
            return;
        }
        // Fence stale replies: a newer observation arrived after dispatch.
        if (flightState.epoch !== this.epoch) {
            this.inFlight = false;
            this.pending = null;
            this.diag(flightState.op, flightState.correlation, flightState.windowCount, "stale-dropped");
            this.finishFlight();
            return;
        }
        const planned = validatePlanned(parsed, flightState.correlation);
        if (planned === null) {
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        if (!this.geometryCovers(planned, flightState)) {
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        this.applyPlanned(planned, flightState);
    }

    // Complete-reply binding: the reply geometry must cover exactly the
    // request window set (admit/move/focus/resize) or exactly the survivors
    // (remove). Unknown or partial windows never reach native writes.
    private geometryCovers(planned: PlannedReply, flightState: PendingFlight): boolean {
        const wanted = new Set<string>();
        for (const entry of flightState.observed.windows) {
            wanted.add(entry.id);
        }
        if (flightState.removed !== null) {
            wanted.delete(flightState.removed);
        }
        if (planned.geometry.length !== wanted.size) {
            return false;
        }
        for (const entry of planned.geometry) {
            if (!wanted.has(entry.window)) {
                return false;
            }
        }
        return true;
    }

    private applyPlanned(planned: PlannedReply, flightState: PendingFlight): void {
        const captured = flightState.observed;
        if (flightState.removed === null) {
            let ok = false;
            try {
                ok = captured.revalidate() === true;
            } catch (error) {
                void error;
                ok = false;
            }
            if (!ok) {
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.writeGeometries(planned, flightState, captured);
            return;
        }
        const fresh = this.freshObserved();
        if (fresh === null || fresh.fingerprint !== this.latestFingerprint()) {
            this.failFlight(flightState, "stale-scope");
            return;
        }
        this.writeGeometries(planned, flightState, fresh);
    }

    private latestFingerprint(): string {
        return this.lastGood === null ? "" : this.lastGood.fingerprint;
    }

    private writeGeometries(
        planned: PlannedReply,
        flightState: PendingFlight,
        current: PlanObserved,
    ): void {
        const byRef = new Map<string, object>();
        const oldById = new Map<string, PlanRect>();
        for (const entry of current.windows) {
            byRef.set(entry.id, entry.ref);
            oldById.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
        }
        const ordered = orderGeometryWrites(oldById, planned.geometry);
        for (const entry of ordered) {
            const target = byRef.get(entry.window);
            if (target === undefined) {
                this.failFlight(flightState, "precondition-mismatch");
                return;
            }
            let written = false;
            try {
                written = this.env.setGeometry(target, entry.rect) === true;
            } catch (error) {
                void error;
                written = false;
            }
            if (!written) {
                this.failFlight(flightState, "write-failed");
                return;
            }
        }
        const focus = planned.focus;
        if (focus !== null) {
            let focusWindow: string | null = null;
            for (const entry of planned.geometry) {
                if (entry.leaf === focus.leaf) {
                    focusWindow = entry.window;
                    break;
                }
            }
            if (
                focusWindow !== null &&
                focus.domainOutput === current.domainOutput &&
                focus.domainWorkspace === current.domainWorkspace
            ) {
                const target = byRef.get(focusWindow);
                if (target !== undefined) {
                    let currentActive: object | null = null;
                    try {
                        currentActive = this.env.active();
                    } catch (error) {
                        void error;
                        currentActive = null;
                    }
                    if (currentActive !== target) {
                        let focused = false;
                        try {
                            focused = this.env.setActive(target) === true;
                        } catch (error) {
                            void error;
                            focused = false;
                        }
                        if (!focused) {
                            this.failFlight(flightState, "write-failed");
                            return;
                        }
                    }
                }
            }
        }
        this.inFlight = false;
        this.pending = null;
        this.diag(flightState.op, flightState.correlation, flightState.windowCount, "planned-applied");
        this.finishFlight();
    }

    private failFlight(flightState: PendingFlight, outcome: string): void {
        this.inFlight = false;
        this.pending = null;
        this.diag(flightState.op, flightState.correlation, flightState.windowCount, outcome);
        this.finishFlight();
    }

    // After every flight, exactly one deferred signal-driven auto command
    // runs so admit/remove converge without queues or retries.
    private finishFlight(): void {
        if (!this.enabled) {
            return;
        }
        const next = this.deferredAuto;
        this.deferredAuto = null;
        if (next !== null && !this.inFlight) {
            this.dispatch(next);
        }
    }

    private clearTimer(): void {
        const cancel = this.cancelTimer;
        this.cancelTimer = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    private clearDebounce(): void {
        const cancel = this.debounceCancel;
        this.debounceCancel = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    private diag(op: PlanOp, correlation: string, windows: number, outcome: string): void {
        try {
            this.env.log(`${LOG_PREFIX}:cmd=${correlation} kind=${op} windows=${String(windows)} outcome=${outcome}`);
        } catch (error) {
            void error;
        }
    }

    private rejectKind(kind: string): void {
        try {
            this.env.log(`${LOG_PREFIX}:rejected kind=${kind}`);
        } catch (error) {
            void error;
        }
    }
}
