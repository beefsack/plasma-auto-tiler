import { connectSignal, isConnectableSignal, readSignal } from "./signal-capability";
export const DRAG_ORACLE_SERVICE = "org.plasmaautotiler.DragOracle"; export const DRAG_ORACLE_OBJECT = "/org/plasmaautotiler/DragOracle"; export const DRAG_ORACLE_INTERFACE = "org.plasmaautotiler.DragOracle1"; export const DRAG_ORACLE_METHOD = "LastVerdict";
export const DRAG_ORACLE_MAX_REPLY_BYTES = 64 * 1024; export const DRAG_ORACLE_MAX_TOKEN_LEN = 128; export const DRAG_ORACLE_MAX_REASON_LEN = 64; export const DRAG_ORACLE_MAX_ID_LEN = 128;
const ROUTE_DIAG = "plasma-auto-tiler:route-diag"; const VERDICT_PREFIX = `${ROUTE_DIAG}:drag-verdict`; const UNAVAILABLE_LINE = `${ROUTE_DIAG}:drag-unavailable`; const ENTRY_REJECT = `${ROUTE_DIAG}:drag-entry-invalid`; const MAX_LIST = 1024;
const EMPTY_IDENTITY_REASONS: ReadonlyArray<string> = ["no-observation", "oracle-unavailable", "oracle-panic", "empty-identity", "identity-invalid", "identity-too-long", "geometry-invalid", "geometry-out-of-range"];
const VERDICT_REASONS: ReadonlyArray<string> = [...EMPTY_IDENTITY_REASONS, "no-change", "ok-moved"];
export interface DragOraclePullEnv { readonly callDbus: (service: string, path: string, iface: string, method: string, callback: (reply: unknown) => void) => void; readonly log: (message: string) => void; }
export interface DragOraclePullOverrides { readonly workspace?: unknown; readonly callDbus?: DragOraclePullEnv["callDbus"]; readonly log?: (message: string) => void; }
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
export class DragOraclePull {
    constructor(private readonly env: DragOraclePullEnv) {}
    pullVerdict(): void {
        const call = this.env.callDbus;
        if (typeof call !== "function") { this.logUnavailable(); return; }
        try { call(DRAG_ORACLE_SERVICE, DRAG_ORACLE_OBJECT, DRAG_ORACLE_INTERFACE, DRAG_ORACLE_METHOD, (reply) => { this.onReply(reply); }); } catch (_e) { this.logUnavailable(); }
    }
    private onReply(reply: unknown): void {
        let verdict: DragOracleVerdict | null = null;
        try { verdict = parseDragOracleVerdict(reply); } catch (_e) { verdict = null; }
        if (verdict === null) { this.logUnavailable(); return; }
        try { this.env.log(formatDragOracleVerdict(verdict)); } catch (_e) { /* fail-closed */ }
    }
    private logUnavailable(): void { try { this.env.log(UNAVAILABLE_LINE); } catch (_e) { /* fail-closed */ } }
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
    const fail = (): null => {
        try {
            log(ENTRY_REJECT);
        } catch (_e) {
            // Ignore console failures fail-closed.
        }
        return null;
    };
    if (typeof liveWorkspace !== "object" || liveWorkspace === null) return fail();
    let callDbus = overrides.callDbus;
    if (callDbus === undefined) {
        try {
            const native: unknown = callDBus;
            if (typeof native !== "function") return fail();
            const bound = native as (...args: ReadonlyArray<unknown>) => void;
            callDbus = (service, path, iface, method, callback) => {
                bound(service, path, iface, method, callback);
            };
        } catch (_e) {
            return fail();
        }
    }
    const surface = liveWorkspace as Record<string, unknown>;
    const lister = surface["windowList"];
    if (typeof lister !== "function") return fail();
    let raw: unknown = undefined;
    try {
        raw = Reflect.apply(lister as (...args: ReadonlyArray<never>) => unknown, surface, []);
    } catch (_e) {
        return fail();
    }
    const list = decodeList(raw, MAX_LIST);
    if (list === null) return fail();
    const pull = new DragOraclePull({ callDbus, log });
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
        const onFinished = (): void => {
            try {
                pull.pullVerdict();
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
            return fail();
        }
        attached.push(detach);
    }
    if (attached.length === 0) return fail();
    let addedDetach: (() => void) | null = null;
    try {
        const addedSurface = readSignal(surface, "windowAdded");
        if (!isConnectableSignal(addedSurface)) {
            detachAll();
            return fail();
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
        return fail();
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
