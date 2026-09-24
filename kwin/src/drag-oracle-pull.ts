import { connectSignal, isConnectableSignal, readSignal } from "./signal-capability";
import { KWIN_TRACE_ENABLED } from "./trace";
export const DRAG_ORACLE_SERVICE = "org.plasmaautotiler.DragOracle"; export const DRAG_ORACLE_OBJECT = "/org/plasmaautotiler/DragOracle"; export const DRAG_ORACLE_INTERFACE = "org.plasmaautotiler.DragOracle1"; export const DRAG_ORACLE_METHOD = "LastVerdict";
export const DRAG_ORACLE_MAX_REPLY_BYTES = 64 * 1024; export const DRAG_ORACLE_MAX_TOKEN_LEN = 128; export const DRAG_ORACLE_MAX_REASON_LEN = 64; export const DRAG_ORACLE_MAX_ID_LEN = 128;
const ROUTE_DIAG = "plasma-auto-tiler:route-diag"; const VERDICT_PREFIX = `${ROUTE_DIAG}:drag-verdict`; const PULL_DISPATCH_LINE = `${ROUTE_DIAG}:drag-pull action=dispatch`; const CALL_MISSING_LINE = `${ROUTE_DIAG}:drag-call-missing`; const CALL_THROWN_LINE = `${ROUTE_DIAG}:drag-call-thrown`; const REPLY_INVALID_LINE = `${ROUTE_DIAG}:drag-reply-invalid correlation=none`; const ROUTE_MISSING_LINE = `${ROUTE_DIAG}:drag-route-missing`; const CANCELLED_PREFIX = `${ROUTE_DIAG}:drag-cancelled`; const ENTRY_WORKSPACE_MISSING = `${ROUTE_DIAG}:drag-entry-workspace-missing`; const ENTRY_CALL_MISSING = `${ROUTE_DIAG}:drag-entry-call-missing`; const ENTRY_CALL_THROWN = `${ROUTE_DIAG}:drag-entry-call-thrown`; const ENTRY_LIST_MISSING = `${ROUTE_DIAG}:drag-entry-list-missing`; const ENTRY_LIST_THROWN = `${ROUTE_DIAG}:drag-entry-list-thrown`; const ENTRY_LIST_INVALID = `${ROUTE_DIAG}:drag-entry-list-invalid`; const ENTRY_FINISHED_INVALID = `${ROUTE_DIAG}:drag-entry-finished-invalid`; const ENTRY_NO_WINDOWS = `${ROUTE_DIAG}:drag-entry-no-windows`; const ENTRY_NO_FINISHED = `${ROUTE_DIAG}:drag-entry-no-finished`; const ENTRY_ADDED_INVALID = `${ROUTE_DIAG}:drag-entry-added-invalid`; const ENTRY_ADDED_CONNECT_FAILED = `${ROUTE_DIAG}:drag-entry-added-connect-failed`; const MAX_LIST = 1024;
const EMPTY_IDENTITY_REASONS: ReadonlyArray<string> = ["no-observation", "oracle-unavailable", "oracle-panic", "empty-identity", "identity-invalid", "identity-too-long", "geometry-invalid", "geometry-out-of-range"];
const VERDICT_REASONS: ReadonlyArray<string> = [...EMPTY_IDENTITY_REASONS, "no-change", "ok-moved"];
export interface DragOracleFinishContext { readonly ref: object; readonly finishEpoch: number; }
export interface DragOraclePullEnv { readonly callDbus: (service: string, path: string, iface: string, method: string, callback: (reply: unknown) => void) => void; readonly log: (message: string) => void; readonly routePointer?: ((verdict: DragOracleVerdict, ctx: DragOracleFinishContext | undefined) => void) | undefined; readonly onSettled?: ((verdict: DragOracleVerdict | null, ctx: DragOracleFinishContext | undefined) => void) | undefined; }
export interface DragOraclePullOverrides { readonly workspace?: unknown; readonly callDbus?: DragOraclePullEnv["callDbus"] | undefined; readonly log?: ((message: string) => void) | undefined; readonly routePointer?: ((verdict: DragOracleVerdict, ctx: DragOracleFinishContext | undefined) => void) | undefined; readonly onSettled?: ((verdict: DragOracleVerdict | null, ctx: DragOracleFinishContext | undefined) => void) | undefined; readonly makeFinishContext?: ((ref: object) => DragOracleFinishContext) | undefined; }
export interface DragOraclePullHandle { readonly stop: () => void; }
export interface DragOracleFinalRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; }
export interface DragOracleVerdict { readonly cancelled: boolean; readonly finalRect: DragOracleFinalRect; readonly windowIdentity: string; readonly correlation: string; readonly reason: string; }
function isCorrelation(value: unknown): value is string { return typeof value === "string" && value.length <= DRAG_ORACLE_MAX_TOKEN_LEN && /^drag-[0-9]+$/.test(value); }
function isReason(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= DRAG_ORACLE_MAX_REASON_LEN && VERDICT_REASONS.indexOf(value) >= 0; }
function isOpaqueId(value: unknown): value is string { return typeof value === "string" && value.length <= DRAG_ORACLE_MAX_ID_LEN && /^[A-Za-z0-9_.\-]*$/.test(value); }
function isFiniteInt(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isFinalRect(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const keys = Object.keys(value);
    if (keys.length !== 4 || keys.indexOf("x") < 0 || keys.indexOf("y") < 0 || keys.indexOf("w") < 0 || keys.indexOf("h") < 0) return false;
    const x = value["x"];
    const y = value["y"];
    const w = value["w"];
    const h = value["h"];
    if (!isFiniteInt(x) || !isFiniteInt(y) || !isFiniteInt(w) || !isFiniteInt(h)) return false;
    return w > 0 && h > 0 && x >= -16384 && x <= 16384 && y >= -16384 && y <= 16384 && w <= 16384 && h <= 16384;
}
function hasExactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean { if (Object.keys(value).length !== keys.length) return false; for (const k of keys) if (!Object.prototype.hasOwnProperty.call(value, k)) return false; return true; }
export function parseDragOracleVerdict(reply: unknown): DragOracleVerdict | null {
    let text: unknown = reply;
    if (Array.isArray(reply)) { if (reply.length === 0) return null; text = reply[0]; }
    if (typeof text !== "string" || text.length === 0 || text.length > DRAG_ORACLE_MAX_REPLY_BYTES) return null;
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch (_e) { return null; }
    if (!isRecord(parsed)) return null;
    if (!hasExactKeys(parsed, ["v", "cancelled", "finalRect", "windowIdentity", "correlation", "reason"])) return null;
    if (parsed["v"] !== 1) return null;
    const cancelled = parsed["cancelled"];
    if (cancelled !== true && cancelled !== false) return null;
    if (!isFinalRect(parsed["finalRect"])) return null;
    const identity = parsed["windowIdentity"];
    if (!isOpaqueId(identity)) return null;
    if (!isCorrelation(parsed["correlation"])) return null;
    if (!isReason(parsed["reason"])) return null;
    if ((identity as string).length === 0) {
        if (cancelled !== true) return null;
        if (EMPTY_IDENTITY_REASONS.indexOf(parsed["reason"] as string) < 0) return null;
    }
    const rect = parsed["finalRect"] as Record<string, unknown>;
    return { cancelled: cancelled as boolean, finalRect: { x: rect["x"] as number, y: rect["y"] as number, w: rect["w"] as number, h: rect["h"] as number }, windowIdentity: identity as string, correlation: parsed["correlation"] as string, reason: parsed["reason"] as string };
}
export function formatDragOracleVerdict(verdict: Pick<DragOracleVerdict, "cancelled" | "correlation" | "reason">): string { return `${VERDICT_PREFIX} cancelled=${verdict.cancelled === true ? "true" : "false"} correlation=${verdict.correlation} reason=${verdict.reason}`; }
// Grabbed-edge helpers: the grabbed edge(s) are captured at Started,
// final targets resolve from the authoritative final rect. Secondary
// (non-grabbed) edge deltas are ignored, never a rejection.
//
// KWin research (script + effect interfaces available to this project):
// Window exposes only move/resize booleans plus
// interactiveMoveResizeStarted/Stepped/Finished; Stepped carries geometry
// only, Finished carries no edge or cancel flag (window.h, window.cpp).
// The effect route (EffectWindow windowStart/Step/FinishUserMovedResized,
// EffectsHandler mouseChanged) likewise carries no grabbed edge. No
// reliable KWin-reported grabbed edge exists on either route, and no
// KWin-pinned corner-handle size is reachable from the available
// interfaces or the repo's pinned-source docs, so identification uses the
// nearest edge(s) to workspace.cursorPos at start with a corner only when
// the pointer sits within a small fixed radius of both physical edges.
// The radius is absolute pixels, not a window fraction: a proportional
// zone (e.g. outer thirds) misclassifies ordinary edge grips on wide or
// tall windows, where most of the edge lies hundreds of pixels from the
// corner. 16px is conservative: a corner classification means the pointer
// is unambiguously on both edges, while genuine corner presses (pointer
// essentially on the corner pixel at grab) are captured. A corner press
// just outside the radius reads single-axis (partial intent applies);
// an edge grip just inside still reads corner (the whole corner then
// refuses only if an axis is truly unusable). Stepped geometry is never
// used as grabbed intent.
export const ORACLE_CORNER_RADIUS_PX = 16;
export type OracleGrabSource = "nearest-pointer";
export interface OracleGrabbed { readonly horizontal: "left" | "right" | null; readonly vertical: "up" | "down" | null; }
export interface OraclePointer { readonly x: number; readonly y: number; }
export function identifyGrabbedEdges(start: DragOracleFinalRect, pointer: OraclePointer | null): { grabbed: OracleGrabbed; source: OracleGrabSource } | null {
    try {
        if (pointer === null) return null;
        if (!Number.isSafeInteger(pointer.x) || !Number.isSafeInteger(pointer.y)) return null;
        const px = pointer.x;
        const py = pointer.y;
        const dLeft = Math.abs(px - start.x);
        const dRight = Math.abs(px - (start.x + start.w));
        const dUp = Math.abs(py - start.y);
        const dDown = Math.abs(py - (start.y + start.h));
        for (const d of [dLeft, dRight, dUp, dDown]) if (!Number.isFinite(d)) return null;
        const hNearest = dLeft <= dRight ? "left" : "right";
        const vNearest = dUp <= dDown ? "up" : "down";
        const dH = hNearest === "left" ? dLeft : dRight;
        const dV = vNearest === "up" ? dUp : dDown;
        if (dH <= ORACLE_CORNER_RADIUS_PX && dV <= ORACLE_CORNER_RADIUS_PX) {
            return { grabbed: { horizontal: hNearest as "left" | "right", vertical: vNearest as "up" | "down" }, source: "nearest-pointer" };
        }
        if (dH <= dV) return { grabbed: { horizontal: hNearest as "left" | "right", vertical: null }, source: "nearest-pointer" };
        return { grabbed: { horizontal: null, vertical: vNearest as "up" | "down" }, source: "nearest-pointer" };
    } catch (_e) {
        return null;
    }
}
export interface OracleResizeTarget { readonly direction: string; readonly boundary: number; }
// Targets resolve in fixed horizontal-first order (left/right before
// up/down), so a corner pair is always [horizontal, vertical] for the
// atomic dual-axis intent. Null when no grabbed axis moved.
export function resolveOracleResizeTargets(start: DragOracleFinalRect, final: DragOracleFinalRect, grabbed: OracleGrabbed): { targets: OracleResizeTarget[]; ignored: string[] } | null {
    try {
        const targets: OracleResizeTarget[] = [];
        const ignored: string[] = [];
        const startRight = start.x + start.w;
        const startBottom = start.y + start.h;
        const finalRight = final.x + final.w;
        const finalBottom = final.y + final.h;
        const pushOrIgnore = (dir: string, startEdge: number, finalEdge: number, isGrabbed: boolean): void => {
            if (isGrabbed) {
                if (finalEdge !== startEdge) targets.push({ direction: dir, boundary: finalEdge });
            } else if (finalEdge !== startEdge) {
                ignored.push(`${dir}:${String(startEdge)}->${String(finalEdge)}`);
            }
        };
        pushOrIgnore("left", start.x, final.x, grabbed.horizontal === "left");
        pushOrIgnore("right", startRight, finalRight, grabbed.horizontal === "right");
        pushOrIgnore("up", start.y, final.y, grabbed.vertical === "up");
        pushOrIgnore("down", startBottom, finalBottom, grabbed.vertical === "down");
        if (targets.length === 0) return null;
        return { targets, ignored };
    } catch (_e) {
        return null;
    }
}
// Legacy strict helper kept for trace-only measurement: stepped payload
// only, never live geometry. Exactly one edge must move with the opposite
// fixed; otherwise null (no-change) or mixed. The pointer route no longer
// uses this; it uses identifyGrabbedEdges + resolveOracleResizeTargets.
export function deriveOracleEdge(start: DragOracleFinalRect, final: DragOracleFinalRect): { direction: string; boundary: number } | "mixed" | null {
    const startRight = start.x + start.w;
    const startBottom = start.y + start.h;
    const finalRight = final.x + final.w;
    const finalBottom = final.y + final.h;
    const hSame = final.x === start.x && final.w === start.w;
    const vSame = final.y === start.y && final.h === start.h;
    if (hSame && vSame) return null;
    if (!hSame && !vSame) return "mixed";
    if (!hSame) {
        if (final.x !== start.x && finalRight === startRight) return { direction: "left", boundary: final.x };
        if (final.x === start.x && finalRight !== startRight) return { direction: "right", boundary: finalRight };
        return "mixed";
    }
    if (final.y !== start.y && finalBottom === startBottom) return { direction: "up", boundary: final.y };
    if (final.y === start.y && finalBottom !== startBottom) return { direction: "down", boundary: finalBottom };
    return "mixed";
}
export class DragOraclePull {
    constructor(private readonly env: DragOraclePullEnv) {}
    pullVerdict(ctx?: DragOracleFinishContext): void {
        const call = this.env.callDbus;
        if (typeof call !== "function") { this.logToken(CALL_MISSING_LINE); this.notifySettled(null, ctx); return; }
        this.logPullDispatch();
        try { call(DRAG_ORACLE_SERVICE, DRAG_ORACLE_OBJECT, DRAG_ORACLE_INTERFACE, DRAG_ORACLE_METHOD, (reply) => { this.onReply(reply, ctx); }); } catch (_e) { this.logToken(CALL_THROWN_LINE); this.notifySettled(null, ctx); }
    }
    private onReply(reply: unknown, ctx: DragOracleFinishContext | undefined): void {
        let verdict: DragOracleVerdict | null = null;
        try { verdict = parseDragOracleVerdict(reply); } catch (_e) { verdict = null; }
        if (verdict === null) { this.logToken(REPLY_INVALID_LINE); this.notifySettled(null, ctx); return; }
        if (KWIN_TRACE_ENABLED) try { this.env.log(formatDragOracleVerdict(verdict)); } catch (_e) { /* fail-closed */ }
        // Cancelled verdicts (including Esc/no-change) are a strict no-op:
        // no planner call, no share change. Non-cancelled verdicts route
        // exactly once through the injected pointer route, which owns strict
        // derivation and fail-closed reasons. No retry or fallback here.
        // Every parsed verdict (including cancelled) notifies the optional
        // finish-keyed completion exactly once so the entry can consume its
        // per-window captured start; the notification runs after routing so
        // the route still observes the captured start. A cancelled verdict
        // always emits one bounded normal-mode line (correlation and reason
        // are closed-vocabulary validated tokens) so the rejection is
        // visible without trace; logging never affects behavior.
        if (verdict.cancelled === true) {
            try { this.env.log(`${CANCELLED_PREFIX} correlation=${verdict.correlation} reason=${verdict.reason}`); } catch (_e) { /* fail-closed */ }
            this.notifySettled(verdict, ctx);
            return;
        }
        const route = this.env.routePointer;
        if (typeof route !== "function") { this.logToken(ROUTE_MISSING_LINE); this.notifySettled(verdict, ctx); return; }
        try { route(verdict, ctx); } catch (_e) { /* fail-closed */ }
        this.notifySettled(verdict, ctx);
    }
    private notifySettled(verdict: DragOracleVerdict | null, ctx: DragOracleFinishContext | undefined): void {
        try {
            const settled = this.env.onSettled;
            if (typeof settled === "function") settled(verdict, ctx);
        } catch (_e) { /* fail-closed */ }
    }
    private logToken(line: string): void { try { this.env.log(line); } catch (_e) { /* fail-closed */ } }
    private logPullDispatch(): void { if (KWIN_TRACE_ENABLED) try { this.env.log(PULL_DISPATCH_LINE); } catch (_e) { /* fail-closed */ } }
}
function resolveLexicalWorkspace(): unknown {
    try {
        const candidate: unknown = workspace;
        if (typeof candidate === "object" && candidate !== null) return candidate;
    } catch (_e) {
        // Missing global fails closed below.
    }
    return null;
}
function decodeList(value: unknown, maxLength: number): ReadonlyArray<unknown> | null {
    if (typeof value !== "object" || value === null) return null;
    if (Array.isArray(value)) return value.length <= maxLength ? value : null;
    let length: unknown = undefined;
    try {
        length = Reflect.get(value, "length");
    } catch (_e) {
        return null;
    }
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > maxLength) return null;
    const out: unknown[] = [];
    for (let i = 0; i < length; i += 1) {
        let el: unknown = undefined;
        try {
            el = Reflect.get(value, String(i));
        } catch (_e) {
            return null;
        }
        if (el === undefined) return null;
        out.push(el);
    }
    return out;
}
export function startDragOraclePullEntry(overrides: DragOraclePullOverrides = {}): DragOraclePullHandle | null {
    const liveWorkspace: unknown = overrides.workspace !== undefined ? overrides.workspace : resolveLexicalWorkspace();
    const log = overrides.log !== undefined ? overrides.log : (message: string): void => {
        try {
            console.log(message);
        } catch (_e) {
            // Ignore console failures fail-closed.
        }
    };
    const fail = (line: string): null => {
        try {
            log(line);
        } catch (_e) {
            // Ignore console failures fail-closed.
        }
        return null;
    };
    if (typeof liveWorkspace !== "object" || liveWorkspace === null) return fail(ENTRY_WORKSPACE_MISSING);
    let callDbus = overrides.callDbus;
    if (callDbus === undefined) {
        try {
            const native: unknown = callDBus;
            if (typeof native !== "function") return fail(ENTRY_CALL_MISSING);
            const bound = native as (...args: ReadonlyArray<unknown>) => void;
            callDbus = (service, path, iface, method, callback) => {
                bound(service, path, iface, method, callback);
            };
        } catch (_e) {
            return fail(ENTRY_CALL_THROWN);
        }
    }
    const surface = liveWorkspace as Record<string, unknown>;
    const lister = surface["windowList"];
    if (typeof lister !== "function") return fail(ENTRY_LIST_MISSING);
    let raw: unknown = undefined;
    try {
        raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
    } catch (_e) {
        return fail(ENTRY_LIST_THROWN);
    }
    const list = decodeList(raw, MAX_LIST);
    if (list === null) return fail(ENTRY_LIST_INVALID);
    const pullEnv: DragOraclePullEnv = { callDbus, log };
    if (overrides.routePointer !== undefined) (pullEnv as { routePointer?: unknown }).routePointer = overrides.routePointer;
    if (overrides.onSettled !== undefined) (pullEnv as { onSettled?: unknown }).onSettled = overrides.onSettled;
    const pull = new DragOraclePull(pullEnv);
    let localFinishEpoch = 0;
    const makeCtx = overrides.makeFinishContext ?? ((ref: object): DragOracleFinishContext => ({ ref, finishEpoch: (localFinishEpoch += 1) }));
    const attached: Array<() => void> = [];
    const detachAll = (): void => {
        for (const done of attached) {
            try {
                done();
            } catch (_e) {
                // Ignore detach failures fail-closed.
            }
        }
    };
    const tryAttachFinished = (item: unknown): (() => void) | "skip" | null => {
        if (typeof item !== "object" || item === null) return "skip";
        let finishedSurface: unknown = undefined;
        try {
            finishedSurface = readSignal(item as object, "interactiveMoveResizeFinished");
        } catch (_e) {
            return "skip";
        }
        if (!isConnectableSignal(finishedSurface)) return "skip";
        const finishedRef = item as object;
        const onFinished = (): void => {
            let ctx: DragOracleFinishContext | undefined = undefined;
            try {
                ctx = makeCtx(finishedRef);
            } catch (_e) {
                ctx = undefined;
            }
            try {
                pull.pullVerdict(ctx);
            } catch (_e) {
                // Pull never throws; guard fail-closed.
            }
        };
        try {
            const detach = connectSignal(finishedSurface, onFinished);
            if (detach === null) return null;
            return detach;
        } catch (_e) {
            return null;
        }
    };
    for (const item of list) {
        const detach = tryAttachFinished(item);
        if (detach === "skip") continue;
        if (detach === null) {
            detachAll();
            return fail(ENTRY_FINISHED_INVALID);
        }
        attached.push(detach);
    }
    if (attached.length === 0) {
        return fail(list.length === 0 ? ENTRY_NO_WINDOWS : ENTRY_NO_FINISHED);
    }
    let addedDetach: (() => void) | null = null;
    try {
        const addedSurface = readSignal(surface, "windowAdded");
        if (!isConnectableSignal(addedSurface)) {
            detachAll();
            return fail(ENTRY_ADDED_INVALID);
        }
        addedDetach = connectSignal(addedSurface, (added) => {
            try {
                const detach = tryAttachFinished(added);
                if (detach === null || detach === "skip") return;
                attached.push(detach);
            } catch (_e) {
                // Ignore late-window failures fail-closed.
            }
        });
    } catch (_e) {
        addedDetach = null;
    }
    if (addedDetach === null) {
        detachAll();
        return fail(ENTRY_ADDED_CONNECT_FAILED);
    }
    const stopAdded: () => void = addedDetach;
    return {
        stop: () => {
            try {
                stopAdded();
            } catch (_e) {
                // Ignore detach failures fail-closed.
            }
            detachAll();
        },
    };
}
