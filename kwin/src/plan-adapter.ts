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
export const MAX_RECONCILE_ATTEMPTS = 3;
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
export type PlanSignal = "added" | "removed" | "activated" | "geometry" | "scope" | "fullscreen";
export type PlanOp = "admit" | "remove" | "move" | "focus" | "resize" | "reconcile" | "pointer-resize";

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
    readonly fullscreen: boolean;
}

export interface PlanObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: PlanRect;
    readonly domainGap: number;
    readonly domainOuterGap: number;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<PlanObservedWindow>;
    readonly activeRef: object;
    readonly fingerprint: string;
    readonly revalidate: () => boolean;
}

// Primitive-only snapshot retained across the async D-Bus boundary. Never
// holds Window objects, refs, or revalidation closures: ids, geometry values,
// scope, and fingerprint only. Targets are always resolved from a fresh
// synchronous observation while handling the reply.
export interface PlanSnapshotWindow {
    readonly id: string;
    readonly rect: PlanRect;
    readonly output: string;
    readonly workspace: string;
    readonly fullscreen: boolean;
}

export interface PlanSnapshot {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: PlanRect;
    readonly domainGap: number;
    readonly domainOuterGap: number;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<PlanSnapshotWindow>;
    readonly fingerprint: string;
}

export function snapshotOf(observed: PlanObserved): PlanSnapshot {
    const windows = observed.windows.map((entry) => ({
        id: entry.id,
        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        output: entry.output,
        workspace: entry.workspace,
        fullscreen: entry.fullscreen,
    }));
    return {
        domainOutput: observed.domainOutput,
        domainWorkspace: observed.domainWorkspace,
        domainBounds: {
            x: observed.domainBounds.x,
            y: observed.domainBounds.y,
            w: observed.domainBounds.w,
            h: observed.domainBounds.h,
        },
        domainGap: observed.domainGap,
        domainOuterGap: observed.domainOuterGap,
        focusedId: observed.focusedId,
        windows,
        fingerprint: observed.fingerprint,
    };
}

// Clamp a rect into the domain bounds, preserving size where it fits. The
// result is always a valid contained carried rect; used only as the retained
// representation for a fullscreen window observed before any retained
// baseline exists (admitted while already fullscreen).
function clampCarriedRect(rect: PlanRect, bounds: PlanRect): PlanRect {
    const w = Math.min(rect.w, bounds.w);
    const h = Math.min(rect.h, bounds.h);
    const maxX = bounds.x + bounds.w - w;
    const maxY = bounds.y + bounds.h - h;
    return {
        x: Math.min(Math.max(rect.x, bounds.x), maxX),
        y: Math.min(Math.max(rect.y, bounds.y), maxY),
        w,
        h,
    };
}

function snapshotsEqual(a: PlanSnapshot, b: PlanSnapshot): boolean {
    if (
        a.domainOutput !== b.domainOutput ||
        a.domainWorkspace !== b.domainWorkspace ||
        a.domainGap !== b.domainGap ||
        a.domainOuterGap !== b.domainOuterGap ||
        a.focusedId !== b.focusedId ||
        a.fingerprint !== b.fingerprint
    ) {
        return false;
    }
    if (
        a.domainBounds.x !== b.domainBounds.x ||
        a.domainBounds.y !== b.domainBounds.y ||
        a.domainBounds.w !== b.domainBounds.w ||
        a.domainBounds.h !== b.domainBounds.h
    ) {
        return false;
    }
    if (a.windows.length !== b.windows.length) {
        return false;
    }
    const byId = new Map<string, PlanSnapshotWindow>();
    for (const entry of a.windows) {
        byId.set(entry.id, entry);
    }
    for (const entry of b.windows) {
        const other = byId.get(entry.id);
        if (other === undefined) {
            return false;
        }
        if (
            other.rect.x !== entry.rect.x ||
            other.rect.y !== entry.rect.y ||
            other.rect.w !== entry.rect.w ||
            other.rect.h !== entry.rect.h ||
            other.output !== entry.output ||
            other.workspace !== entry.workspace ||
            other.fullscreen !== entry.fullscreen
        ) {
            return false;
        }
    }
    return true;
}

function sameScope(a: PlanSnapshot, b: PlanSnapshot): boolean {
    if (
        a.domainOutput !== b.domainOutput ||
        a.domainWorkspace !== b.domainWorkspace ||
        a.domainGap !== b.domainGap ||
        a.domainOuterGap !== b.domainOuterGap ||
        a.domainBounds.x !== b.domainBounds.x ||
        a.domainBounds.y !== b.domainBounds.y ||
        a.domainBounds.w !== b.domainBounds.w ||
        a.domainBounds.h !== b.domainBounds.h ||
        a.windows.length !== b.windows.length
    ) {
        return false;
    }
    const byId = new Map<string, PlanSnapshotWindow>();
    for (const entry of a.windows) {
        byId.set(entry.id, entry);
    }
    for (const entry of b.windows) {
        const other = byId.get(entry.id);
        if (other === undefined || other.output !== entry.output || other.workspace !== entry.workspace) {
            return false;
        }
    }
    return true;
}

// Work-area reprojection is valid only when the logical domain and complete
// window set are unchanged. Client rectangles are deliberately ignored here:
// they are drift inputs, never a source of retained shares.
function sameDomainAndWindowSet(a: PlanSnapshot, b: PlanSnapshot): boolean {
    if (
        a.domainOutput !== b.domainOutput ||
        a.domainWorkspace !== b.domainWorkspace ||
        a.domainGap !== b.domainGap ||
        a.domainOuterGap !== b.domainOuterGap ||
        a.windows.length !== b.windows.length
    ) {
        return false;
    }
    const byId = new Map<string, PlanSnapshotWindow>();
    for (const entry of a.windows) {
        byId.set(entry.id, entry);
    }
    for (const entry of b.windows) {
        const other = byId.get(entry.id);
        if (other === undefined || other.output !== entry.output || other.workspace !== entry.workspace) {
            return false;
        }
    }
    return true;
}

function sameReprojectionScope(a: PlanSnapshot, b: PlanSnapshot): boolean {
    return (
        sameDomainAndWindowSet(a, b) &&
        a.domainBounds.x === b.domainBounds.x &&
        a.domainBounds.y === b.domainBounds.y &&
        a.domainBounds.w === b.domainBounds.w &&
        a.domainBounds.h === b.domainBounds.h
    );
}

// Geometry-only equality ignoring focus and fingerprint: true when the same
// scope/window set carries identical rectangles. Used to separate a
// focus/fingerprint-only change (adopt the new baseline, no reconcile) from
// genuine same-scope geometry drift (reassert via reconcile). A window that
// is fullscreen in `b` is excluded: its rectangle is compositor-owned while
// fullscreen, so it never counts as drift and never triggers a reflow.
function sameRects(a: PlanSnapshot, b: PlanSnapshot): boolean {
    if (a.windows.length !== b.windows.length) {
        return false;
    }
    const byId = new Map<string, PlanSnapshotWindow>();
    for (const entry of a.windows) {
        byId.set(entry.id, entry);
    }
    for (const entry of b.windows) {
        const other = byId.get(entry.id);
        if (other === undefined) {
            return false;
        }
        if (entry.fullscreen) {
            continue;
        }
        if (
            other.rect.x !== entry.rect.x ||
            other.rect.y !== entry.rect.y ||
            other.rect.w !== entry.rect.w ||
            other.rect.h !== entry.rect.h
        ) {
            return false;
        }
    }
    return true;
}

// Pointer-only tolerance: identical to snapshotsEqual except the drag
// source rectangle may drift (final native echo before the D-Bus reply).
function rectsEqualExceptSource(a: PlanSnapshot, b: PlanSnapshot, sourceId: string): boolean {
    if (
        a.domainOutput !== b.domainOutput ||
        a.domainWorkspace !== b.domainWorkspace ||
        a.domainGap !== b.domainGap ||
        a.domainOuterGap !== b.domainOuterGap ||
        a.focusedId !== b.focusedId ||
        a.fingerprint !== b.fingerprint
    ) {
        return false;
    }
    if (
        a.domainBounds.x !== b.domainBounds.x ||
        a.domainBounds.y !== b.domainBounds.y ||
        a.domainBounds.w !== b.domainBounds.w ||
        a.domainBounds.h !== b.domainBounds.h
    ) {
        return false;
    }
    if (a.windows.length !== b.windows.length) {
        return false;
    }
    const byId = new Map<string, PlanSnapshotWindow>();
    for (const entry of a.windows) {
        byId.set(entry.id, entry);
    }
    for (const entry of b.windows) {
        const other = byId.get(entry.id);
        if (other === undefined || other.output !== entry.output || other.workspace !== entry.workspace) {
            return false;
        }
        if (entry.id === sourceId) {
            continue;
        }
        if (entry.fullscreen) {
            continue;
        }
        if (
            other.rect.x !== entry.rect.x ||
            other.rect.y !== entry.rect.y ||
            other.rect.w !== entry.rect.w ||
            other.rect.h !== entry.rect.h
        ) {
            return false;
        }
    }
    return byId.has(sourceId);
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
    readonly noteRemoved?: (id: string) => void;
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
    if (!isFiniteInt(observed.domainOuterGap) || observed.domainOuterGap < 0 || observed.domainOuterGap > 64) {
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
        if (typeof candidate.fullscreen !== "boolean") {
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
    readonly snapshot: PlanSnapshot;
    readonly removed: string | null;
    readonly windowCount: number;
    readonly pointerSource: string | null;
    readonly workAreaReprojection: boolean;
}

interface AutoIntent {
    readonly op: PlanOp;
    readonly snapshot: PlanSnapshot;
    readonly removed: string | null;
    readonly body: Record<string, unknown>;
    readonly pointerSource?: string | null;
    readonly workAreaReprojection?: boolean;
}

interface PointerEcho {
    readonly correlation: string;
    readonly source: string;
    readonly scope: PlanSnapshot;
    readonly neighbours: ReadonlyArray<{ window: string; rect: PlanRect }>;
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
    private lastGood: PlanSnapshot | null = null;
    private reconcileAttempts = 0;
    private parked = false;
    private repeatFocused: string | null = null;
    private repeatDirection: PlanDirection | null = null;
    private repeatMode: PlanResizeMode | null = null;
    private repeatNext = 0;
    private repeatFingerprint = "";
    private pointerEcho: PointerEcho | null = null;

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
        const kinds: ReadonlyArray<PlanSignal> = ["added", "removed", "activated", "geometry", "scope", "fullscreen"];
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
        this.reconcileAttempts = 0;
        this.parked = false;
        this.pointerEcho = null;
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
        this.reconcileAttempts = 0;
        this.parked = false;
        this.pointerEcho = null;
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
        const snapshot = this.carriedSnapshot(observed);
        this.noteObservation(snapshot.fingerprint);
        this.dispatch({
            op: "focus",
            snapshot,
            removed: null,
            body: { op: "focus", window: snapshot.focusedId, direction },
        });
    }

    // A fullscreen focused window keeps its planner-tree slot but is never
    // actuated or reflowed: directional move/resize on it would change its
    // retained position/share, so it is refused fail-closed before dispatch.
    // Focus is exempt: it carries no geometry write.
    private windowIsFullscreen(observed: PlanObserved, windowId: string): boolean {
        for (const entry of observed.windows) {
            if (entry.id === windowId && entry.fullscreen) {
                return true;
            }
        }
        return false;
    }

    // Carried snapshot for dispatch and baseline comparison: a fullscreen
    // member carries its retained in-bounds rectangle (the last planned
    // projection) in place of the compositor-owned fullscreen frame rect,
    // which can exceed the work area and would otherwise be rejected as
    // window-out-of-bounds. A fullscreen member with no retained projection
    // yet is clamped into the domain bounds. The raw frame rect is never
    // carried for a fullscreen member.
    private carriedSnapshot(observed: PlanObserved): PlanSnapshot {
        const snapshot = snapshotOf(observed);
        if (!snapshot.windows.some((entry) => entry.fullscreen)) {
            return snapshot;
        }
        const retainedById = new Map<string, PlanRect>();
        if (this.lastGood !== null) {
            for (const entry of this.lastGood.windows) {
                retainedById.set(entry.id, entry.rect);
            }
        }
        const windows = snapshot.windows.map((entry) => {
            if (!entry.fullscreen) {
                return entry;
            }
            const retained = retainedById.get(entry.id);
            const rect =
                retained !== undefined
                    ? clampCarriedRect(retained, snapshot.domainBounds)
                    : clampCarriedRect(entry.rect, snapshot.domainBounds);
            return { ...entry, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
        });
        return { ...snapshot, windows: Object.freeze(windows) };
    }

    // Reprojection carries the prior planner allocation for every member. The
    // current client rectangles are drift inputs only, and are clamped solely
    // to keep the transport representation inside the new work area.
    private reprojectionSnapshot(observed: PlanObserved, retained: PlanSnapshot): PlanSnapshot {
        const snapshot = snapshotOf(observed);
        const retainedById = new Map<string, PlanRect>();
        for (const entry of retained.windows) {
            retainedById.set(entry.id, entry.rect);
        }
        const windows = snapshot.windows.map((entry) => {
            const carried = retainedById.get(entry.id) ?? entry.rect;
            const rect = clampCarriedRect(carried, snapshot.domainBounds);
            return { ...entry, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
        });
        return { ...snapshot, windows: Object.freeze(windows) };
    }

    requestMove(direction: unknown): void {
        if (!this.enabled || this.inFlight || !isDirection(direction)) {
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            return;
        }
        if (this.windowIsFullscreen(observed, observed.focusedId)) {
            return;
        }
        const snapshot = this.carriedSnapshot(observed);
        this.noteObservation(snapshot.fingerprint);
        this.dispatch({
            op: "move",
            snapshot,
            removed: null,
            body: { op: "move", window: snapshot.focusedId, direction },
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
        if (this.windowIsFullscreen(observed, observed.focusedId)) {
            return;
        }
        const snapshot = this.carriedSnapshot(observed);
        this.noteObservation(snapshot.fingerprint);
        let pressIndex = 0;
        if (
            this.repeatFocused === snapshot.focusedId &&
            this.repeatDirection === direction &&
            this.repeatMode === mode
        ) {
            pressIndex = this.repeatNext;
        }
        this.repeatFocused = snapshot.focusedId;
        this.repeatDirection = direction;
        this.repeatMode = mode;
        this.repeatNext = pressIndex + 1;
        this.dispatch({
            op: "resize",
            snapshot,
            removed: null,
            body: { op: "resize", window: snapshot.focusedId, direction, mode, press_index: pressIndex },
        });
    }

    // Slice 2 oracle route: exactly one strict pointer-resize from the
    // authoritative final rect. Strict decoding only; fail-closed false when
    // the window, direction, or boundary cannot be safely bound. Defers
    // through the single pending slot when a flight is active, never bypasses
    // it, retries, or guesses.
    requestPointerResize(windowId: unknown, direction: unknown, boundary: unknown): boolean {
        if (!this.enabled || !isOpaqueId(windowId) || !isDirection(direction)) {
            return false;
        }
        if (!isFiniteInt(boundary) || (boundary as number) < -16384 || (boundary as number) > 16384) {
            return false;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            return false;
        }
        let found = false;
        for (const entry of observed.windows) {
            if (entry.id === (windowId as string)) {
                found = true;
                break;
            }
        }
        if (!found) {
            return false;
        }
        if (this.windowIsFullscreen(observed, windowId as string)) {
            return false;
        }
        const snapshot = this.carriedSnapshot(observed);
        this.noteObservation(snapshot.fingerprint);
        const intent: AutoIntent = {
            op: "pointer-resize",
            snapshot,
            removed: null,
            body: { op: "pointer-resize", window: windowId as string, direction, boundary },
            pointerSource: windowId as string,
        };
        if (this.inFlight) {
            this.deferredAuto = intent;
            return true;
        }
        this.dispatch(intent);
        return this.inFlight;
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

    private resetReconcileState(): void {
        this.reconcileAttempts = 0;
        this.parked = false;
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

    private refreshNow(): void {
        if (!this.enabled) {
            return;
        }
        const fresh = this.freshObserved();
        if (fresh === null) {
            return;
        }
        const freshSnapshot = this.carriedSnapshot(fresh);
        this.epoch += 1;
        this.noteObservation(freshSnapshot.fingerprint);
        const previous = this.lastGood;
        if (previous === null) {
            this.lastGood = freshSnapshot;
            this.reconcileAttempts = 0;
            this.parked = false;
            this.deferredAuto = {
                op: "admit",
                snapshot: freshSnapshot,
                removed: null,
                body: {
                    op: "admit",
                    window: freshSnapshot.focusedId,
                    output: freshSnapshot.domainOutput,
                    workspace: freshSnapshot.domainWorkspace,
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
        for (const entry of freshSnapshot.windows) {
            after.add(entry.id);
        }
        let intent: AutoIntent | null = null;
        for (const entry of freshSnapshot.windows) {
            if (!before.has(entry.id)) {
                intent = {
                    op: "admit",
                    snapshot: freshSnapshot,
                    removed: null,
                    body: { op: "admit", window: entry.id, output: freshSnapshot.domainOutput, workspace: freshSnapshot.domainWorkspace },
                };
                break;
            }
        }
        if (intent === null) {
            for (const entry of previous.windows) {
                if (!after.has(entry.id)) {
                    intent = {
                        op: "remove",
                        snapshot: previous,
                        removed: entry.id,
                        body: { op: "remove", window: entry.id },
                    };
                    break;
                }
            }
        }
        for (const entry of previous.windows) {
            if (!after.has(entry.id)) {
                try {
                    this.env.noteRemoved?.(entry.id);
                } catch (error) {
                    void error;
                }
            }
        }
        if (intent !== null) {
            this.lastGood = freshSnapshot;
            this.reconcileAttempts = 0;
            this.parked = false;
            this.pointerEcho = null;
            this.deferredAuto = intent;
            if (this.inFlight) {
                return;
            }
            const next = this.deferredAuto;
            this.deferredAuto = null;
            if (next !== null) {
                this.dispatch(next);
            }
            return;
        }
        if (snapshotsEqual(freshSnapshot, previous)) {
            this.pointerEcho = null;
            this.reconcileAttempts = 0;
            this.parked = false;
            if (this.deferredAuto !== null && this.deferredAuto.op === "reconcile") {
                this.deferredAuto = null;
            }
            if (this.inFlight) {
                return;
            }
            const next = this.deferredAuto;
            this.deferredAuto = null;
            if (next !== null) {
                this.dispatch(next);
            }
            return;
        }
        if (
            sameDomainAndWindowSet(previous, freshSnapshot) &&
            (previous.domainBounds.x !== freshSnapshot.domainBounds.x ||
                previous.domainBounds.y !== freshSnapshot.domainBounds.y ||
                previous.domainBounds.w !== freshSnapshot.domainBounds.w ||
                previous.domainBounds.h !== freshSnapshot.domainBounds.h)
        ) {
            this.pointerEcho = null;
            this.resetReconcileState();
            this.deferredAuto = {
                op: "reconcile",
                snapshot: this.reprojectionSnapshot(fresh, previous),
                removed: null,
                body: { op: "reconcile" },
                workAreaReprojection: true,
            };
            if (this.inFlight) {
                return;
            }
            const next = this.deferredAuto;
            this.deferredAuto = null;
            if (next !== null) {
                this.dispatch(next);
            }
            return;
        }
        if (sameRects(previous, freshSnapshot)) {
            this.pointerEcho = null;
            this.lastGood = freshSnapshot;
            this.reconcileAttempts = 0;
            this.parked = false;
            if (this.inFlight) {
                return;
            }
            const next = this.deferredAuto;
            this.deferredAuto = null;
            if (next !== null) {
                this.dispatch(next);
            }
            return;
        }
        if (!sameScope(previous, freshSnapshot)) {
            this.lastGood = freshSnapshot;
            this.reconcileAttempts = 0;
            this.parked = false;
            this.pointerEcho = null;
            if (this.inFlight) {
                return;
            }
            const next = this.deferredAuto;
            this.deferredAuto = null;
            if (next !== null) {
                this.dispatch(next);
            }
            return;
        }
        // Slice 2 echo fence: exactly one one-shot neighbour-write expectation
        // keyed by pointer correlation and source. Consume only when same-scope
        // fresh neighbour rectangles equal the planned rectangles; update
        // lastGood and return. Any mismatch falls through to bounded
        // reconciliation. Never applies to broad scope signals above.
        const echo = this.pointerEcho;
        if (echo !== null) {
            this.pointerEcho = null;
            if (this.echoMatches(freshSnapshot, echo)) {
                this.lastGood = freshSnapshot;
                this.reconcileAttempts = 0;
                this.parked = false;
                if (this.deferredAuto !== null && this.deferredAuto.op === "reconcile") {
                    this.deferredAuto = null;
                }
                if (this.inFlight) {
                    return;
                }
                const next = this.deferredAuto;
                this.deferredAuto = null;
                if (next !== null) {
                    this.dispatch(next);
                }
                return;
            }
        }
        if (this.parked || this.reconcileAttempts >= MAX_RECONCILE_ATTEMPTS) {
            this.parked = true;
            return;
        }
        this.deferredAuto = {
            op: "reconcile",
            snapshot: freshSnapshot,
            removed: null,
            body: { op: "reconcile" },
        };
        if (this.inFlight) {
            return;
        }
        const pendingReconcile = this.deferredAuto;
        this.deferredAuto = null;
        if (pendingReconcile !== null) {
            this.dispatch(pendingReconcile);
        }
    }

    private echoMatches(fresh: PlanSnapshot, echo: PointerEcho): boolean {
        if (!sameScope(fresh, echo.scope)) {
            return false;
        }
        const byId = new Map<string, PlanRect>();
        for (const entry of fresh.windows) {
            byId.set(entry.id, entry.rect);
        }
        if (!byId.has(echo.source)) {
            return false;
        }
        for (const expected of echo.neighbours) {
            const actual = byId.get(expected.window);
            if (
                actual === undefined ||
                actual.x !== expected.rect.x ||
                actual.y !== expected.rect.y ||
                actual.w !== expected.rect.w ||
                actual.h !== expected.rect.h
            ) {
                return false;
            }
        }
        return true;
    }

    private noteReconcileTerminal(op: PlanOp, workAreaReprojection = false): void {
        if (
            op !== "reconcile" ||
            workAreaReprojection ||
            this.deferredAuto?.workAreaReprojection === true
        ) {
            return;
        }
        this.reconcileAttempts += 1;
        if (this.reconcileAttempts >= MAX_RECONCILE_ATTEMPTS) {
            this.parked = true;
        }
    }

    private dispatch(intent: AutoIntent): void {
        if (!this.enabled || this.inFlight) {
            return;
        }
        if (intent.workAreaReprojection === true) {
            this.resetReconcileState();
        }
        if (this.seq < 0 || this.seq > PLAN_MAX_SEQ) {
            return;
        }
        const correlation = `${this.generation}-p${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            return;
        }
        const snapshot = intent.snapshot;
        const sortedIds = snapshot.windows.map((entry) => entry.id).sort();
        const fingerprint = planFingerprint(
            snapshot.domainOutput,
            snapshot.domainWorkspace,
            snapshot.focusedId,
            sortedIds,
        );
        const windows = snapshot.windows.map((entry) => ({
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
                    output: snapshot.domainOutput,
                    workspace: snapshot.domainWorkspace,
                    bounds: {
                        x: snapshot.domainBounds.x,
                        y: snapshot.domainBounds.y,
                        w: snapshot.domainBounds.w,
                        h: snapshot.domainBounds.h,
                    },
                    gap: snapshot.domainGap,
                    outer_gap: snapshot.domainOuterGap,
                },
                focused_window: snapshot.focusedId,
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
            snapshot,
            removed: intent.removed,
            windowCount: sortedIds.length,
            pointerSource: intent.pointerSource ?? null,
            workAreaReprojection: intent.workAreaReprojection === true,
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
            this.noteReconcileTerminal(intent.op, intent.workAreaReprojection === true);
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
            this.noteReconcileTerminal(intent.op, intent.workAreaReprojection === true);
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
            this.noteReconcileTerminal(lost.op, lost.workAreaReprojection);
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
            this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
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
            this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
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
    // (remove). Unknown or partial windows never reach native writes. The
    // wanted set is derived from the primitive dispatch snapshot only.
    private geometryCovers(planned: PlannedReply, flightState: PendingFlight): boolean {
        const wanted = new Set<string>();
        for (const entry of flightState.snapshot.windows) {
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

    // Reply-boundary revalidation: never touch a possibly-destroyed Window
    // observed before dispatch. Re-observe synchronously, compare the captured
    // primitive snapshot, and resolve all geometry/focus targets only from the
    // fresh observation.
    private applyPlanned(planned: PlannedReply, flightState: PendingFlight): void {
        const fresh = this.freshObserved();
        if (fresh === null) {
            this.failFlight(flightState, "stale-scope");
            return;
        }
        if (flightState.workAreaReprojection) {
            const freshSnapshot = this.carriedSnapshot(fresh);
            if (!sameReprojectionScope(freshSnapshot, flightState.snapshot)) {
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        if (flightState.op === "pointer-resize") {
            const source = flightState.pointerSource;
            if (source === null) {
                this.failFlight(flightState, "stale-scope");
                return;
            }
            const freshSnapshot = this.carriedSnapshot(fresh);
            if (!rectsEqualExceptSource(freshSnapshot, flightState.snapshot, source)) {
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        if (flightState.removed === null) {
            const freshSnapshot = this.carriedSnapshot(fresh);
            if (!snapshotsEqual(freshSnapshot, flightState.snapshot)) {
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        if (fresh.fingerprint !== this.latestFingerprint()) {
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
        const fullscreenById = new Set<string>();
        for (const entry of current.windows) {
            byRef.set(entry.id, entry.ref);
            oldById.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
            if (entry.fullscreen) {
                fullscreenById.add(entry.id);
            }
        }
        const ordered = orderGeometryWrites(oldById, planned.geometry);
        // Focus is focus-only: never rewrite geometry, only move the active
        // window. Matches the standalone focus adapter single-write contract;
        // move/admit/remove/resize still apply complete geometries above.
        // KWin leaves the drag source at its raw pointer rectangle. Reassert the
        // retained projection so its inset sibling gap is restored too.
        if (flightState.op !== "focus") {
            for (const entry of ordered) {
                if (fullscreenById.has(entry.window)) {
                    continue;
                }
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
        if (flightState.op !== "focus") {
            const base = this.carriedSnapshot(current);
            const rectById = new Map<string, PlanRect>();
            for (const entry of planned.geometry) {
                rectById.set(entry.window, entry.rect);
            }
            const windows = base.windows.map((entry) => {
                // Every member (including a fullscreen one) records the
                // planner's retained projection from the reply: the tree slot
                // must survive enter/exit, and the carried baseline never
                // stores the compositor-owned fullscreen frame rect.
                const rect = rectById.get(entry.id) ?? entry.rect;
                return { id: entry.id, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, output: entry.output, workspace: entry.workspace, fullscreen: entry.fullscreen };
            });
            this.lastGood = { ...base, windows: Object.freeze(windows) };
            if (flightState.op === "pointer-resize" && flightState.pointerSource !== null) {
                const neighbours = planned.geometry
                    .filter((entry) => entry.window !== flightState.pointerSource)
                    .map((entry) => ({
                        window: entry.window,
                        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
                    }));
                this.pointerEcho = {
                    correlation: flightState.correlation,
                    source: flightState.pointerSource,
                    scope: flightState.snapshot,
                    neighbours: Object.freeze(neighbours),
                };
            }
            if (flightState.op === "reconcile") {
                this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
            } else {
                this.reconcileAttempts = 0;
                this.parked = false;
            }
        } else {
            this.reconcileAttempts = 0;
            this.parked = false;
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
        this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
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
            if (
                next.op === "reconcile" &&
                next.workAreaReprojection !== true &&
                (this.parked || this.reconcileAttempts >= MAX_RECONCILE_ATTEMPTS)
            ) {
                return;
            }
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
