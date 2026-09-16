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
// Ordinary diagnostics retain terminal command outcomes, rejections, scope,
// fence, and refusal evidence. Dispatch and per-member geometry detail are
// trace-only so background reconciliation cannot flood the KWin journal. No
// captions or sensitive payload detail is logged beyond the stable opaque
// window id.

import { orderGeometryWrites } from "./geometry-order";
import { KWIN_TRACE_ENABLED } from "./trace";

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
export const PLAN_MAX_DOMAINS = 16;

const LOG_PREFIX = "plasma-auto-tiler:plan";

export type PlanDirection = "left" | "right" | "up" | "down";
export type PlanResizeMode = "inwards" | "outwards";
export type PlanSignal = "added" | "removed" | "activated" | "geometry" | "scope" | "fullscreen" | "maximize" | "desktops";
export type PlanOp = "admit" | "remove" | "move" | "focus" | "resize" | "reconcile" | "pointer-resize" | "toggle-float";
export type NativeStateWriteOutcome = "invoked" | "missing" | "threw";
export type MaximizeClearOutcome = NativeStateWriteOutcome;

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
    readonly maximized: boolean;
    readonly floating?: boolean;
    readonly sticky?: boolean;
    readonly resourceClass?: string;
}

export interface PlanObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: PlanRect;
    readonly domainGap: number;
    readonly domainOuterGap: number;
    readonly focusedId: string;
    // The active native window is intentionally floating and therefore not a
    // planner member. A surviving tiled member may supply focusedId solely for
    // the removal observation; interactive tiled commands must refuse.
    readonly activeExcluded?: boolean;
    readonly windows: ReadonlyArray<PlanObservedWindow>;
    readonly activeRef: object;
    readonly fingerprint: string;
    readonly revalidate: () => boolean;
}

// Primitive-only snapshot retained across the async D-Bus boundary. Never
// holds Window objects, refs, or revalidation closures: ids, geometry values,
// resource classes, scope, and fingerprint only. Targets are resolved from a
// fresh synchronous observation while handling the reply.
export interface PlanSnapshotWindow {
    readonly id: string;
    readonly rect: PlanRect;
    readonly output: string;
    readonly workspace: string;
    readonly fullscreen: boolean;
    readonly maximized: boolean;
    readonly floating: boolean;
    readonly sticky?: boolean;
    readonly resourceClass: string;
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
        maximized: entry.maximized,
        floating: entry.floating === true,
        sticky: entry.sticky === true,
        resourceClass: isOpaqueId(entry.resourceClass) ? entry.resourceClass : "unknown",
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

function rectContained(inner: PlanRect, outer: PlanRect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.w <= outer.x + outer.w &&
        inner.y + inner.h <= outer.y + outer.h
    );
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
            other.fullscreen !== entry.fullscreen ||
            other.maximized !== entry.maximized
        ) {
            return false;
        }
    }
    return true;
}

function matchesRemovalSnapshot(fresh: PlanSnapshot, before: PlanSnapshot, removed: string): boolean {
    if (
        fresh.domainOutput !== before.domainOutput ||
        fresh.domainWorkspace !== before.domainWorkspace ||
        fresh.domainGap !== before.domainGap ||
        fresh.domainOuterGap !== before.domainOuterGap ||
        fresh.domainBounds.x !== before.domainBounds.x ||
        fresh.domainBounds.y !== before.domainBounds.y ||
        fresh.domainBounds.w !== before.domainBounds.w ||
        fresh.domainBounds.h !== before.domainBounds.h ||
        fresh.windows.length + 1 !== before.windows.length
    ) {
        return false;
    }
    const beforeById = new Map<string, PlanSnapshotWindow>();
    for (const entry of before.windows) {
        if (entry.id !== removed) {
            beforeById.set(entry.id, entry);
        }
    }
    if (beforeById.size !== fresh.windows.length) {
        return false;
    }
    for (const entry of fresh.windows) {
        if (!beforeById.has(entry.id)) {
            return false;
        }
    }
    return fresh.windows.length === 0
        ? fresh.focusedId === ""
        : fresh.windows.some((entry) => entry.id === fresh.focusedId);
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
// is fullscreen or maximized in `b` is excluded: its rectangle is
// compositor-owned while fullscreen or maximized, so it never counts as
// drift and never triggers a reflow.
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
        if (entry.fullscreen || entry.maximized) {
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
        if (entry.fullscreen || entry.maximized) {
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
    // Hidden-domain observation for background tiling: every non-visible
    // (output, workspace) domain with tiled members, each carrying a
    // deterministic domain-local structural anchor as focusedId (never native
    // focus). Absent in isolated core tests; the entry supplies it in
    // production. Hidden flights only ever admit/remove/reconcile geometry
    // and never route focus or interactive commands.
    readonly observeHidden?: () => ReadonlyArray<PlanObserved>;
    readonly clearMaximize: (target: object) => MaximizeClearOutcome;
    readonly setMaximize?: (target: object, maximized: boolean) => NativeStateWriteOutcome;
    readonly setAllDesktops?: (target: object, allDesktops: boolean) => NativeStateWriteOutcome;
    readonly setGeometry: (target: object, rect: PlanRect) => boolean;
    readonly setFloating?: (id: string, floating: boolean) => void;
    readonly setActive: (target: object) => boolean;
    readonly active: () => object | null;
    readonly subscribe: (kind: PlanSignal, handler: (target?: object) => void) => () => void;
    readonly noteRemoved?: (id: string) => void;
    // Entry-owned coordination: true while a workspace-send flight is active.
    // While blocked, lifecycle auto intents are dropped (a single normal
    // resync after send completes converges) and foreground commands refuse
    // with the existing busy-refused diagnostic. No queues or coalescing.
    readonly isSendActive?: () => boolean;
    // Observational active-group refresh after exactly one successful
    // geometry-plan boundary (admit/move/remove/resize `planned-applied`).
    // Synchronous, single call, no retries/polling; must never block
    // foreground logical commands. Never invoked on stale/rejected/error
    // or unfinished boundaries.
    readonly onPlannedApplied?: (op: PlanOp) => void;
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

// Bounded rejection token fields: lowercase dashes only. Never echo payload
// bytes other than the Planner's fixed token vocabulary.
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

function sanitizeDetail(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > 64) {
        return null;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const ok = (code >= 97 && code <= 122) || code === 45;
        if (!ok) {
            return null;
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
    readonly floatGeometry: { readonly window: string; readonly rect: PlanRect } | null;
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
    if (!Array.isArray(geometryRaw) || geometryRaw.length > PLAN_MAX_GEOMETRY) {
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
        const floatGeometry = validateFloatGeometry(reply["float_geometry"]);
        return floatGeometry === undefined ? null : { correlationId, geometry: Object.freeze(geometry), focus, floatGeometry };
    }
    const floatGeometry = validateFloatGeometry(reply["float_geometry"]);
    return floatGeometry === undefined ? null : { correlationId, geometry: Object.freeze(geometry), focus: null, floatGeometry };
}

function validateFloatGeometry(value: unknown): { readonly window: string; readonly rect: PlanRect } | null | undefined {
    if (value === undefined || value === null) return null;
    if (!isRecord(value) || !hasExactKeys(value, ["window", "rect"]) || !isOpaqueId(value["window"]) || !isTargetRect(value["rect"])) return undefined;
    const rect = value["rect"] as unknown as Record<string, unknown>;
    return { window: value["window"] as string, rect: { x: rect["x"] as number, y: rect["y"] as number, w: rect["w"] as number, h: rect["h"] as number } };
}

function validateObserved(observed: PlanObserved | null): observed is PlanObserved {
    if (observed === null || typeof observed !== "object") {
        return false;
    }
    if (!isOpaqueId(observed.domainOutput) || !isOpaqueId(observed.domainWorkspace)) {
        return false;
    }
    if (observed.activeExcluded !== undefined && typeof observed.activeExcluded !== "boolean") {
        return false;
    }
    if (observed.windows.length === 0) {
        return observed.activeExcluded === true && observed.focusedId === "";
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
        if (typeof candidate.maximized !== "boolean") {
            return false;
        }
        if (candidate.floating !== undefined && typeof candidate.floating !== "boolean") {
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
    readonly admissionMaximizeClears: ReadonlyArray<string>;
    readonly floatTarget: { readonly window: string; readonly floating: boolean } | null;
    readonly stickyTarget: { readonly window: string; readonly previousFloating: boolean } | null;
    // True for a hidden-domain (background) flight: geometry only, never
    // focus or interactive commands. Serialized through the same
    // single-flight and send-blocking as foreground.
    readonly background: boolean;
}

interface AutoIntent {
    readonly op: PlanOp;
    readonly snapshot: PlanSnapshot;
    readonly removed: string | null;
    readonly body: Record<string, unknown>;
    readonly pointerSource?: string | null;
    readonly workAreaReprojection?: boolean;
    readonly admissionMaximizeClears?: ReadonlyArray<string>;
    readonly floatTarget?: { readonly window: string; readonly floating: boolean } | null;
    readonly stickyTarget?: { readonly window: string; readonly previousFloating: boolean } | null;
    readonly background?: boolean;
}

interface PointerEcho {
    readonly correlation: string;
    readonly source: string;
    readonly scope: PlanSnapshot;
    readonly neighbours: ReadonlyArray<{ window: string; rect: PlanRect }>;
}

function snapshotsEqualAllowingAdmissionMaximize(
    fresh: PlanSnapshot,
    expected: PlanSnapshot,
    cleared: ReadonlyArray<string>,
): boolean {
    if (
        fresh.domainOutput !== expected.domainOutput ||
        fresh.domainWorkspace !== expected.domainWorkspace ||
        fresh.domainGap !== expected.domainGap ||
        fresh.domainOuterGap !== expected.domainOuterGap ||
        fresh.focusedId !== expected.focusedId ||
        fresh.fingerprint !== expected.fingerprint ||
        fresh.domainBounds.x !== expected.domainBounds.x ||
        fresh.domainBounds.y !== expected.domainBounds.y ||
        fresh.domainBounds.w !== expected.domainBounds.w ||
        fresh.domainBounds.h !== expected.domainBounds.h ||
        fresh.windows.length !== expected.windows.length
    ) {
        return false;
    }
    const clearedIds = new Set(cleared);
    const expectedById = new Map<string, PlanSnapshotWindow>();
    for (const entry of expected.windows) {
        expectedById.set(entry.id, entry);
    }
    for (const entry of fresh.windows) {
        const other = expectedById.get(entry.id);
        if (
            other === undefined ||
            entry.rect.x !== other.rect.x ||
            entry.rect.y !== other.rect.y ||
            entry.rect.w !== other.rect.w ||
            entry.rect.h !== other.rect.h ||
            entry.output !== other.output ||
            entry.workspace !== other.workspace ||
            entry.fullscreen !== other.fullscreen ||
            (entry.maximized !== other.maximized && !(clearedIds.has(entry.id) && entry.maximized))
        ) {
            return false;
        }
    }
    return true;
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
    // The Planner retains one session per (output, workspace), so retain the
    // matching applied projection for every live Planner domain as well.
    private lastGoodByDomain = new Map<string, PlanSnapshot>();
    private reconcileAttempts = 0;
    private parked = false;
    // Per-domain background reconcile accounting, keyed exactly like
    // lastGoodByDomain. Foreground counters above are never touched by
    // hidden-domain flights so background drift can never park foreground.
    private backgroundAttempts = new Map<string, number>();
    private backgroundParked = new Set<string>();
    // Reentrancy guard for the finishFlight hidden-domain chain: a
    // synchronously failing background dispatch must not recurse.
    private chainingHidden = false;
    private repeatFocused: string | null = null;
    private repeatDirection: PlanDirection | null = null;
    private repeatMode: PlanResizeMode | null = null;
    private repeatNext = 0;
    private repeatFingerprint = "";
    private pointerEcho: PointerEcho | null = null;
    private maximizeAdmissionEcho: object | null = null;
    private maximizeAdmissionAttempts = new Set<string>();
    private maximizeToggleEcho: { ref: object; id: string; resourceClass: string } | null = null;
    private stickyEcho: { ref: object; id: string; resourceClass: string; allDesktops: boolean; previousFloating: boolean } | null = null;
    private stickyPreviousFloating = new Map<string, boolean>();
    private maximizeToggleAttempts = new Map<object, boolean>();
    private stickyAttempts = new Map<object, boolean>();

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
        const kinds: ReadonlyArray<PlanSignal> = ["added", "removed", "activated", "geometry", "scope", "fullscreen", "maximize", "desktops"];
        const attached: Array<() => void> = [];
        for (const kind of kinds) {
            let detach: (() => void) | null = null;
            try {
                detach = this.env.subscribe(kind, (target) => this.onSignal(kind, target));
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
        this.lastGoodByDomain.clear();
        this.reconcileAttempts = 0;
        this.parked = false;
        this.backgroundAttempts.clear();
        this.backgroundParked.clear();
        this.pointerEcho = null;
        this.maximizeAdmissionEcho = null;
        this.maximizeAdmissionAttempts.clear();
        this.maximizeToggleEcho = null;
        this.stickyEcho = null;
        this.stickyPreviousFloating.clear();
        this.maximizeToggleAttempts.clear();
        this.stickyAttempts.clear();
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
        this.lastGoodByDomain.clear();
        this.reconcileAttempts = 0;
        this.parked = false;
        this.backgroundAttempts.clear();
        this.backgroundParked.clear();
        this.pointerEcho = null;
        this.maximizeAdmissionEcho = null;
        this.maximizeAdmissionAttempts.clear();
        this.maximizeToggleEcho = null;
        this.stickyEcho = null;
        this.stickyPreviousFloating.clear();
        this.maximizeToggleAttempts.clear();
        this.stickyAttempts.clear();
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
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:focus-refused-disabled`);
            return;
        }
        if (!isDirection(direction)) {
            this.logToken(`${LOG_PREFIX}:focus-refused-invalid-direction`);
            return;
        }
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=focus`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=focus`);
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:focus-refused-observe`);
            return;
        }
        if (observed.activeExcluded) {
            this.logToken(`${LOG_PREFIX}:focus-refused-floating`);
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

    // A maximized focused window mirrors fullscreen isolation: it keeps its
    // planner-tree slot but is never actuated or reflowed. Directional
    // move/resize on it would change its retained position/share, so it is
    // refused fail-closed before dispatch. Focus is exempt: it carries no
    // geometry write.
    private windowIsMaximized(observed: PlanObserved, windowId: string): boolean {
        for (const entry of observed.windows) {
            if (entry.id === windowId && entry.maximized) {
                return true;
            }
        }
        return false;
    }

    // Carried snapshot for dispatch and baseline comparison: a fullscreen or
    // maximized member carries its retained in-bounds rectangle (the last
    // planned projection) in place of the compositor-owned fullscreen or
    // maximized frame rect, which can exceed the work area and would otherwise
    // be rejected as window-out-of-bounds. A member with no retained
    // projection yet is clamped into the domain bounds. The raw frame rect is
    // never carried for a fullscreen or maximized member. A known tiled member
    // can transiently report an out-of-bounds frame while KWin applies a state
    // change, so carry its applied projection rather than invalidating the
    // complete snapshot. Unknown non-overlay windows still fail closed.
    private carriedSnapshot(observed: PlanObserved): PlanSnapshot {
        const snapshot = snapshotOf(observed);
        const retained = this.lastGoodFor(snapshot);
        if (retained === null && !snapshot.windows.some((entry) => entry.fullscreen || entry.maximized)) {
            return snapshot;
        }
        const retainedById = new Map<string, PlanRect>();
        if (retained !== null) {
            for (const entry of retained.windows) {
                retainedById.set(entry.id, entry.rect);
            }
        }
        const windows = snapshot.windows.map((entry) => {
            const retainedRect = retainedById.get(entry.id);
            if (!entry.fullscreen && !entry.maximized && (retainedRect === undefined || rectContained(entry.rect, snapshot.domainBounds))) {
                return entry;
            }
            const rect =
                retainedRect !== undefined
                    ? clampCarriedRect(retainedRect, snapshot.domainBounds)
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
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:move-refused-disabled`);
            return;
        }
        if (!isDirection(direction)) {
            this.logToken(`${LOG_PREFIX}:move-refused-invalid-direction`);
            return;
        }
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=move`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=move`);
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:move-refused-observe`);
            return;
        }
        if (observed.activeExcluded) {
            this.logToken(`${LOG_PREFIX}:move-refused-floating`);
            return;
        }
        if (this.windowIsFullscreen(observed, observed.focusedId)) {
            this.logToken(`${LOG_PREFIX}:move-refused-fullscreen`);
            return;
        }
        if (this.windowIsMaximized(observed, observed.focusedId)) {
            this.logToken(`${LOG_PREFIX}:move-refused-maximize`);
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
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:resize-refused-disabled`);
            return;
        }
        if (!isDirection(direction)) {
            this.logToken(`${LOG_PREFIX}:resize-refused-invalid-direction`);
            return;
        }
        if (!isResizeMode(mode)) {
            this.logToken(`${LOG_PREFIX}:resize-refused-invalid-mode`);
            return;
        }
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=resize`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=resize`);
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:resize-refused-observe`);
            return;
        }
        if (observed.activeExcluded) {
            this.logToken(`${LOG_PREFIX}:resize-refused-floating`);
            return;
        }
        if (this.windowIsFullscreen(observed, observed.focusedId)) {
            this.logToken(`${LOG_PREFIX}:resize-refused-fullscreen`);
            return;
        }
        if (this.windowIsMaximized(observed, observed.focusedId)) {
            this.logToken(`${LOG_PREFIX}:resize-refused-maximize`);
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

    requestFloat(): void {
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:float-refused-disabled`);
            return;
        }
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-float`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-float`);
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:float-refused-observe`);
            return;
        }
        const target = observed.windows.find((entry) => entry.id === observed.focusedId);
        if (target === undefined) {
            this.logToken(`${LOG_PREFIX}:float-refused-observe`);
            return;
        }
        const floating = target.floating === true;
        if (!floating && observed.activeExcluded) {
            this.logToken(`${LOG_PREFIX}:float-refused-not-tiled`);
            return;
        }
        if (!floating && target.fullscreen) {
            this.logToken(`${LOG_PREFIX}:float-refused-fullscreen`);
            return;
        }
        if (!floating && target.maximized) {
            this.logToken(`${LOG_PREFIX}:float-refused-maximize`);
            return;
        }
        const snapshot = this.carriedSnapshot(observed);
        // Float selects the session-retained placement (the request carries no
        // rect, so the session never recomputes a center for a window that has
        // floated before). Unfloat carries the live frame rect so a user
        // moved/resized float is retained for the next float.
        const rect = floating
            ? { x: target.rect.x, y: target.rect.y, w: target.rect.w, h: target.rect.h }
            : null;
        this.dispatch({
            op: "toggle-float",
            snapshot,
            removed: floating ? null : target.id,
            body: rect === null ? { op: "toggle-float", window: target.id } : { op: "toggle-float", window: target.id, float_rect: rect },
            floatTarget: { window: target.id, floating: !floating },
        });
    }

    requestMaximize(): void {
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:maximize-refused-disabled`);
            return;
        }
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-maximize`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-maximize`);
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:maximize-refused-observe`);
            return;
        }
        const target = observed.windows.find((entry) => entry.id === observed.focusedId);
        if (target === undefined) {
            this.logToken(`${LOG_PREFIX}:maximize-refused-observe`);
            return;
        }
        const resourceClass = isOpaqueId(target.resourceClass) ? target.resourceClass : "unknown";
        if (target.fullscreen) {
            this.logToken(`${LOG_PREFIX}:maximize-refused-fullscreen window=${target.id} resource_class=${resourceClass}`);
            return;
        }
        const wanted = !target.maximized;
        if (this.maximizeToggleAttempts.get(target.ref) === wanted) {
            this.logToken(`${LOG_PREFIX}:maximize-refused-attempted window=${target.id} resource_class=${resourceClass}`);
            return;
        }
        this.maximizeToggleAttempts.set(target.ref, wanted);
        this.maximizeToggleEcho = { ref: target.ref, id: target.id, resourceClass };
        this.logToken(`${LOG_PREFIX}:maximize-toggle window=${target.id} resource_class=${resourceClass} target=${wanted ? "maximized" : "restored"} outcome=issued`);
        this.logToken(`${LOG_PREFIX}:maximize-toggle-echo-armed`);
        let outcome: NativeStateWriteOutcome = "threw";
        try {
            outcome = this.env.setMaximize === undefined ? "missing" : this.env.setMaximize(target.ref, wanted);
        } catch (error) {
            void error;
        }
        this.logToken(`${LOG_PREFIX}:maximize-toggle window=${target.id} resource_class=${resourceClass} target=${wanted ? "maximized" : "restored"} outcome=${outcome}`);
        if (this.maximizeToggleEcho !== null) {
            this.maximizeToggleEcho = null;
            this.logToken(`${LOG_PREFIX}:maximize-toggle-echo-cleared-no-signal`);
        }
    }

    requestSticky(): void {
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-disabled`);
            return;
        }
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-sticky`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-sticky`);
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-observe`);
            return;
        }
        const target = observed.windows.find((entry) => entry.id === observed.focusedId);
        if (target === undefined) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-observe`);
            return;
        }
        const resourceClass = isOpaqueId(target.resourceClass) ? target.resourceClass : "unknown";
        if (target.fullscreen) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-fullscreen window=${target.id} resource_class=${resourceClass}`);
            return;
        }
        if (target.maximized) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-maximize window=${target.id} resource_class=${resourceClass}`);
            return;
        }
        if (target.sticky === true) {
            const previousFloating = this.stickyPreviousFloating.get(target.id);
            if (previousFloating === undefined) {
                this.logToken(`${LOG_PREFIX}:sticky-refused-untracked window=${target.id} resource_class=${resourceClass}`);
                return;
            }
            this.issueSticky(target, false, previousFloating);
            return;
        }
        const previousFloating = target.floating === true;
        this.stickyPreviousFloating.set(target.id, previousFloating);
        if (previousFloating) {
            this.issueSticky(target, true, previousFloating);
            return;
        }
        const snapshot = this.carriedSnapshot(observed);
        this.dispatch({
            op: "toggle-float",
            snapshot,
            removed: target.id,
            body: { op: "toggle-float", window: target.id },
            floatTarget: { window: target.id, floating: true },
            stickyTarget: { window: target.id, previousFloating },
        });
    }

    private issueSticky(target: PlanObservedWindow, allDesktops: boolean, previousFloating: boolean): void {
        const resourceClass = isOpaqueId(target.resourceClass) ? target.resourceClass : "unknown";
        if (this.stickyAttempts.get(target.ref) === allDesktops) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-attempted window=${target.id} resource_class=${resourceClass}`);
            return;
        }
        this.stickyAttempts.set(target.ref, allDesktops);
        this.stickyEcho = { ref: target.ref, id: target.id, resourceClass, allDesktops, previousFloating };
        this.logToken(`${LOG_PREFIX}:sticky-toggle window=${target.id} resource_class=${resourceClass} target=${allDesktops ? "all-desktops" : "current-desktop"} outcome=issued`);
        this.logToken(`${LOG_PREFIX}:sticky-echo-armed`);
        let outcome: NativeStateWriteOutcome = "threw";
        try {
            outcome = this.env.setAllDesktops === undefined ? "missing" : this.env.setAllDesktops(target.ref, allDesktops);
        } catch (error) {
            void error;
        }
        this.logToken(`${LOG_PREFIX}:sticky-toggle window=${target.id} resource_class=${resourceClass} target=${allDesktops ? "all-desktops" : "current-desktop"} outcome=${outcome}`);
        if (this.stickyEcho !== null) {
            this.stickyEcho = null;
            this.logToken(`${LOG_PREFIX}:sticky-echo-cleared-no-signal`);
        }
    }

    // Slice 2 oracle route: exactly one strict pointer-resize from the
    // authoritative final rect. Strict decoding only; fail-closed false when
    // the window, direction, or boundary cannot be safely bound. Defers
    // through the single pending slot when a flight is active, never bypasses
    // it, retries, or guesses.
    requestPointerResize(windowId: unknown, direction: unknown, boundary: unknown): boolean {
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-disabled`);
            return false;
        }
        if (!isOpaqueId(windowId)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-identity`);
            return false;
        }
        if (!isDirection(direction)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-direction`);
            return false;
        }
        if (!isFiniteInt(boundary) || (boundary as number) < -16384 || (boundary as number) > 16384) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-boundary`);
            return false;
        }
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=pointer-resize`);
            return false;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-observe`);
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
            this.logToken(`${LOG_PREFIX}:pointer-refused-absent`);
            return false;
        }
        if (this.windowIsFullscreen(observed, windowId as string)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-fullscreen`);
            return false;
        }
        if (this.windowIsMaximized(observed, windowId as string)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-maximize`);
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

    private blockedBySend(): boolean {
        try {
            const fn = this.env.isSendActive;
            if (typeof fn !== "function") {
                return false;
            }
            return fn() === true;
        } catch (error) {
            void error;
            return true;
        }
    }

    private onSignal(kind?: PlanSignal, target?: object): void {
        if (!this.enabled) {
            return;
        }
        if (kind === "maximize" && this.maximizeAdmissionEcho !== null) {
            if (target === this.maximizeAdmissionEcho) {
                this.maximizeAdmissionEcho = null;
                this.logToken(`${LOG_PREFIX}:maximize-admission-echo-consumed`);
                return;
            }
            this.maximizeAdmissionEcho = null;
            this.logToken(`${LOG_PREFIX}:maximize-admission-echo-mismatched`);
        }
        if (kind === "maximize" && this.maximizeToggleEcho !== null) {
            if (target === this.maximizeToggleEcho.ref) {
                this.maximizeToggleEcho = null;
                this.logToken(`${LOG_PREFIX}:maximize-toggle-echo-consumed`);
                return;
            }
            this.maximizeToggleEcho = null;
            this.logToken(`${LOG_PREFIX}:maximize-toggle-echo-mismatched`);
        }
        if (kind === "desktops" && this.stickyEcho !== null) {
            const echo = this.stickyEcho;
            if (target === echo.ref) {
                this.stickyEcho = null;
                this.logToken(`${LOG_PREFIX}:sticky-echo-consumed`);
                if (!echo.allDesktops) {
                    this.stickyPreviousFloating.delete(echo.id);
                    if (!echo.previousFloating) {
                        this.requestFloat();
                    }
                }
                return;
            }
            this.stickyEcho = null;
            this.logToken(`${LOG_PREFIX}:sticky-echo-mismatched`);
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

    // Shared debounced entry: foreground lifecycle first, then at most one
    // hidden-domain lifecycle step. Foreground behavior is unchanged and
    // always wins: a foreground intent (dispatched or deferred) suppresses the
    // background scan for this round, and the finishFlight chain converges
    // remaining hidden domains afterwards.
    private refreshNow(): void {
        if (this.chainingHidden) {
            this.refreshForegroundNow();
            return;
        }
        this.chainingHidden = true;
        try {
            this.refreshForegroundNow();
            if (!this.enabled || this.inFlight || this.deferredAuto !== null) {
                return;
            }
            if (this.blockedBySend()) {
                return;
            }
            this.refreshHiddenNow();
        } finally {
            this.chainingHidden = false;
        }
    }

    private refreshForegroundNow(): void {
        if (!this.enabled) {
            return;
        }
        if (this.blockedBySend()) {
            this.deferredAuto = null;
            return;
        }
        let fresh = this.freshObserved();
        if (fresh === null) {
            return;
        }
        const prior = this.lastGoodFor(snapshotOf(fresh));
        const prepared = this.clearMaximizeAtAdmission(fresh, prior);
        if (prepared === null) {
            return;
        }
        fresh = prepared.observed;
        const freshSnapshot = this.carriedSnapshot(fresh);
        this.epoch += 1;
        this.noteObservation(freshSnapshot.fingerprint);
        // Membership baselines advance only after a planned reply is applied.
        const previous = this.lastGoodFor(freshSnapshot);
        if (previous === null) {
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
                admissionMaximizeClears: prepared.cleared,
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
        const knownOutOfBounds = fresh.windows.some(
            (entry) =>
                !entry.fullscreen &&
                !entry.maximized &&
                previous.windows.some((retained) => retained.id === entry.id) &&
                !rectContained(entry.rect, freshSnapshot.domainBounds),
        );
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
                    admissionMaximizeClears: prepared.cleared,
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
                this.maximizeAdmissionAttempts.delete(entry.id);
                try {
                    this.env.noteRemoved?.(entry.id);
                } catch (error) {
                    void error;
                }
            }
        }
        if (intent !== null) {
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
        if (snapshotsEqual(freshSnapshot, previous) && !knownOutOfBounds) {
            if (this.pointerEcho !== null) {
                this.logToken(`${LOG_PREFIX}:echo-fence-cleared-equality`);
            }
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
            const oldBounds = previous.domainBounds;
            const newBounds = freshSnapshot.domainBounds;
            this.logToken(
                `${LOG_PREFIX}:scope-transition old=${String(oldBounds.x)},${String(oldBounds.y)},${String(oldBounds.w)},${String(oldBounds.h)} new=${String(newBounds.x)},${String(newBounds.y)},${String(newBounds.w)},${String(newBounds.h)}`,
            );
            this.logToken(`${LOG_PREFIX}:work-area-reprojection selected=retained`);
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
        if (sameRects(previous, freshSnapshot) && !knownOutOfBounds) {
            this.pointerEcho = null;
            this.setLastGood(freshSnapshot);
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
            this.setLastGood(freshSnapshot);
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
                this.logToken(`${LOG_PREFIX}:echo-fence-consumed`);
                this.setLastGood(freshSnapshot);
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
            this.logToken(`${LOG_PREFIX}:echo-fence-mismatched`);
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

    // Background tiling: adopt/reconcile hidden (non-visible output,
    // workspace) domains without touching desktop visibility or native focus.
    // Runs only while idle (no flight, no deferred foreground intent) and
    // never while a send flight blocks Plan. Dispatches at most one
    // admit/remove/reconcile flight per round through the shared single-flight;
    // the finishFlight chain picks up the next domain. Per-domain baselines
    // advance only on applied replies via the shared writeGeometries path, and
    // the existing domain/window protocol caps fail closed here as everywhere.
    private refreshHiddenNow(): void {
        if (!this.enabled || this.inFlight || this.deferredAuto !== null) {
            return;
        }
        if (this.blockedBySend()) {
            return;
        }
        let hidden: ReadonlyArray<PlanObserved> = [];
        try {
            const observeHidden = this.env.observeHidden;
            if (typeof observeHidden !== "function") {
                return;
            }
            hidden = observeHidden();
        } catch (error) {
            void error;
            return;
        }
        if (!Array.isArray(hidden)) {
            return;
        }
        const valid: PlanObserved[] = [];
        for (const entry of hidden) {
            if (validateObserved(entry)) {
                valid.push(entry);
            }
        }
        // Bounded-domain cap stays fail-closed for new background admission
        // (hiddenIntentFor/setLastGood refuse without evicting foreground),
        // but explicit empty-source cleanup for an already-retained domain is
        // still considered at cap so a committed last remove can release its
        // slot. Over-limit hidden sets (no room left for the foreground) skip
        // new domains entirely; retained domains still converge below. Cap
        // counts only non-empty observations: explicit empty evidence never
        // occupies a slot.
        const nonEmpty = valid.filter((entry) => entry.windows.length > 0);
        const emptyExplicit = valid.filter((entry) => entry.windows.length === 0);
        const overLimit = nonEmpty.length >= PLAN_MAX_DOMAINS;
        for (const observed of nonEmpty) {
            if (overLimit && !this.lastGoodByDomain.has(this.domainKey(snapshotOf(observed)))) {
                continue;
            }
            const intent = this.hiddenIntentFor(observed);
            if (intent !== null) {
                this.dispatch(intent);
                return;
            }
        }
        // Empty-source cleanup only from explicit fresh, complete
        // empty-domain evidence whose output is not tainted/unclassifiable.
        // Absence is unknown (exception transition, tainted output,
        // unreadable domain, or overall failure) and must never synthesize
        // an empty snapshot. Per-domain baselines and cap slots are cleaned
        // only via applied removes; attempts/parked use the per-domain
        // background accounting. No visibility history or polling is invented.
        let foregroundKey: string | null = null;
        try {
            const foreground = this.freshObserved();
            if (foreground !== null) {
                foregroundKey = this.domainKey(snapshotOf(foreground));
            }
        } catch (error) {
            void error;
            foregroundKey = null;
        }
        for (const observed of emptyExplicit) {
            const key = this.domainKey(observed);
            if (foregroundKey !== null && key === foregroundKey) {
                continue;
            }
            const previous = this.lastGoodByDomain.get(key);
            if (previous === undefined || previous.windows.length === 0) {
                continue;
            }
            // Single-remove transaction only: when several members vanish
            // together the exact missing set cannot be committed safely, so
            // stay fail-closed without dispatching (no retry noise, no false
            // commit). The retained baseline is kept; see residual notes.
            if (previous.windows.length !== 1) {
                continue;
            }
            const intent = this.hiddenIntentFor(observed);
            if (intent !== null) {
                this.dispatch(intent);
                return;
            }
        }
    }

    private freshHiddenFor(domain: Pick<PlanSnapshot, "domainOutput" | "domainWorkspace">): PlanObserved | null {
        let hidden: ReadonlyArray<PlanObserved> = [];
        try {
            const observeHidden = this.env.observeHidden;
            if (typeof observeHidden !== "function") {
                return null;
            }
            hidden = observeHidden();
        } catch (error) {
            void error;
            return null;
        }
        if (!Array.isArray(hidden)) {
            return null;
        }
        for (const entry of hidden) {
            if (
                validateObserved(entry) &&
                entry.domainOutput === domain.domainOutput &&
                entry.domainWorkspace === domain.domainWorkspace
            ) {
                return entry;
            }
        }
        // Absence is unknown, never empty: exception-only, tainted, or
        // unreadable domains are omitted by the observer and must remain
        // untouched. Only an explicit empty-domain observation counts as
        // empty evidence. No synthesis here.
        return null;
    }

    // Single hidden-domain lifecycle step mirroring the foreground
    // admit/remove/reconcile derivation, minus focus advancement, echo fences,
    // and interactive commands. The anchor focusedId is recomputed
    // deterministically from the same members and rects, so the shared
    // snapshot-equality reply checks apply unchanged.
    private hiddenIntentFor(observed: PlanObserved): AutoIntent | null {
        const key = this.domainKey(observed);
        if (this.backgroundParked.has(key) || (this.backgroundAttempts.get(key) ?? 0) >= MAX_RECONCILE_ATTEMPTS) {
            if (!this.backgroundParked.has(key)) {
                this.backgroundParked.add(key);
                this.logToken(`${LOG_PREFIX}:reconcile-parked`);
            }
            return null;
        }
        // Exception-only domains stay observable to protect a retained
        // baseline but never dispatch admission/reconcile/removal solely for
        // exception members. Existing exceptional geometry/no-focus behavior
        // is preserved by leaving the baseline untouched.
        if (observed.windows.length > 0) {
            let hasEligibleTiled = false;
            for (const entry of observed.windows) {
                if (!entry.fullscreen && !entry.maximized && entry.floating !== true && entry.sticky !== true) {
                    hasEligibleTiled = true;
                    break;
                }
            }
            if (!hasEligibleTiled) {
                return null;
            }
        } else {
            // Explicit empty evidence never admits: without a retained
            // baseline there is nothing to retire.
            if (this.lastGoodFor(snapshotOf(observed)) === null) {
                return null;
            }
        }
        const prepared = this.clearMaximizeAtAdmission(observed, this.lastGoodFor(snapshotOf(observed)), () =>
            this.freshHiddenFor(observed),
        );
        if (prepared === null) {
            return null;
        }
        const freshSnapshot = this.carriedSnapshot(prepared.observed);
        const previous = this.lastGoodFor(freshSnapshot);
        if (previous === null) {
            if (!this.lastGoodByDomain.has(this.domainKey(freshSnapshot)) && this.lastGoodByDomain.size >= PLAN_MAX_DOMAINS) {
                return null;
            }
            return {
                op: "admit",
                snapshot: freshSnapshot,
                removed: null,
                body: {
                    op: "admit",
                    window: freshSnapshot.focusedId,
                    output: freshSnapshot.domainOutput,
                    workspace: freshSnapshot.domainWorkspace,
                },
                admissionMaximizeClears: prepared.cleared,
                background: true,
            };
        }
        const before = new Set<string>();
        for (const entry of previous.windows) {
            before.add(entry.id);
        }
        const after = new Set<string>();
        for (const entry of freshSnapshot.windows) {
            after.add(entry.id);
        }
        for (const entry of previous.windows) {
            if (!after.has(entry.id)) {
                this.maximizeAdmissionAttempts.delete(entry.id);
                try {
                    this.env.noteRemoved?.(entry.id);
                } catch (error) {
                    void error;
                }
            }
        }
        for (const entry of freshSnapshot.windows) {
            if (!before.has(entry.id)) {
                return {
                    op: "admit",
                    snapshot: freshSnapshot,
                    removed: null,
                    body: {
                        op: "admit",
                        window: entry.id,
                        output: freshSnapshot.domainOutput,
                        workspace: freshSnapshot.domainWorkspace,
                    },
                    admissionMaximizeClears: prepared.cleared,
                    background: true,
                };
            }
        }
        const missing: string[] = [];
        for (const entry of previous.windows) {
            if (!after.has(entry.id)) {
                missing.push(entry.id);
            }
        }
        // Single-remove transaction only: several simultaneous disappearances
        // cannot be committed safely, so stay fail-closed without dispatching
        // (no retry noise, no false commit). The baseline is preserved.
        if (missing.length > 1) {
            return null;
        }
        if (missing.length === 1) {
            const single = missing[0] as string;
            return {
                op: "remove",
                snapshot: previous,
                removed: single,
                body: { op: "remove", window: single },
                background: true,
            };
        }
        const knownOutOfBounds = prepared.observed.windows.some(
            (entry) =>
                !entry.fullscreen &&
                !entry.maximized &&
                before.has(entry.id) &&
                !rectContained(entry.rect, freshSnapshot.domainBounds),
        );
        if (snapshotsEqual(freshSnapshot, previous) && !knownOutOfBounds) {
            this.clearBackgroundReconcile(freshSnapshot);
            return null;
        }
        if (
            sameDomainAndWindowSet(previous, freshSnapshot) &&
            (previous.domainBounds.x !== freshSnapshot.domainBounds.x ||
                previous.domainBounds.y !== freshSnapshot.domainBounds.y ||
                previous.domainBounds.w !== freshSnapshot.domainBounds.w ||
                previous.domainBounds.h !== freshSnapshot.domainBounds.h)
        ) {
            const oldBounds = previous.domainBounds;
            const newBounds = freshSnapshot.domainBounds;
            this.logToken(
                `${LOG_PREFIX}:scope-transition old=${String(oldBounds.x)},${String(oldBounds.y)},${String(oldBounds.w)},${String(oldBounds.h)} new=${String(newBounds.x)},${String(newBounds.y)},${String(newBounds.w)},${String(newBounds.h)}`,
            );
            this.logToken(`${LOG_PREFIX}:work-area-reprojection selected=retained`);
            this.clearBackgroundReconcile(freshSnapshot);
            return {
                op: "reconcile",
                snapshot: this.reprojectionSnapshot(prepared.observed, previous),
                removed: null,
                body: { op: "reconcile" },
                workAreaReprojection: true,
                background: true,
            };
        }
        if (sameRects(previous, freshSnapshot) && !knownOutOfBounds) {
            this.setLastGood(freshSnapshot, true);
            this.clearBackgroundReconcile(freshSnapshot);
            return null;
        }
        if (!sameScope(previous, freshSnapshot)) {
            this.setLastGood(freshSnapshot, true);
            this.clearBackgroundReconcile(freshSnapshot);
            return null;
        }
        return {
            op: "reconcile",
            snapshot: freshSnapshot,
            removed: null,
            body: { op: "reconcile" },
            background: true,
        };
    }

    private noteBackgroundTerminal(snapshot: Pick<PlanSnapshot, "domainOutput" | "domainWorkspace">): void {
        const key = this.domainKey(snapshot);
        const attempts = (this.backgroundAttempts.get(key) ?? 0) + 1;
        this.backgroundAttempts.set(key, attempts);
        if (attempts >= MAX_RECONCILE_ATTEMPTS && !this.backgroundParked.has(key)) {
            this.backgroundParked.add(key);
            // Bounded parking transition, same token as foreground, exactly
            // once per parked hidden domain.
            this.logToken(`${LOG_PREFIX}:reconcile-parked`);
        }
    }

    private clearBackgroundReconcile(snapshot: Pick<PlanSnapshot, "domainOutput" | "domainWorkspace">): void {
        const key = this.domainKey(snapshot);
        this.backgroundAttempts.delete(key);
        this.backgroundParked.delete(key);
    }

    private clearMaximizeAtAdmission(
        observed: PlanObserved,
        previous: PlanSnapshot | null,
        refetch: () => PlanObserved | null = () => this.freshObserved(),
    ): { observed: PlanObserved; cleared: ReadonlyArray<string> } | null {
        const known = new Set<string>();
        if (previous !== null) {
            for (const entry of previous.windows) {
                known.add(entry.id);
            }
        }
        const attempted: Array<{ id: string; ref: object; resourceClass: string }> = [];
        for (const entry of observed.windows) {
            if (entry.fullscreen || !entry.maximized || known.has(entry.id) || this.maximizeAdmissionAttempts.has(entry.id)) {
                continue;
            }
            this.maximizeAdmissionAttempts.add(entry.id);
            const resourceClass = isOpaqueId(entry.resourceClass) ? entry.resourceClass : "unknown";
            this.logToken(`${LOG_PREFIX}:maximize-admission-clear window=${entry.id} resource_class=${resourceClass} outcome=issued`);
            this.maximizeAdmissionEcho = entry.ref;
            this.logToken(`${LOG_PREFIX}:maximize-admission-echo-armed`);
            let outcome: MaximizeClearOutcome = "threw";
            try {
                outcome = this.env.clearMaximize(entry.ref);
            } catch (error) {
                void error;
            }
            this.logToken(
                `${LOG_PREFIX}:maximize-admission-clear window=${entry.id} resource_class=${resourceClass} outcome=${outcome}`,
            );
            if (this.maximizeAdmissionEcho !== null) {
                this.maximizeAdmissionEcho = null;
                this.logToken(`${LOG_PREFIX}:maximize-admission-echo-cleared-no-signal`);
            }
            attempted.push({ id: entry.id, ref: entry.ref, resourceClass });
        }
        if (attempted.length === 0) {
            return { observed, cleared: Object.freeze([]) };
        }
        const fresh = refetch();
        if (fresh === null) {
            return null;
        }
        const byId = new Map<string, PlanObservedWindow>();
        for (const entry of fresh.windows) {
            byId.set(entry.id, entry);
        }
        const cleared: string[] = [];
        for (const attempt of attempted) {
            const entry = byId.get(attempt.id);
            if (entry === undefined || entry.ref !== attempt.ref) {
                this.logToken(`${LOG_PREFIX}:maximize-admission-clear window=${attempt.id} resource_class=${attempt.resourceClass} outcome=observed-absent`);
            } else if (entry.maximized) {
                this.logToken(`${LOG_PREFIX}:maximize-admission-clear window=${attempt.id} resource_class=${attempt.resourceClass} outcome=observed-maximized`);
                cleared.push(attempt.id);
            } else {
                this.logToken(`${LOG_PREFIX}:maximize-admission-clear window=${attempt.id} resource_class=${attempt.resourceClass} outcome=observed-cleared`);
                cleared.push(attempt.id);
            }
        }
        const result = fresh;
        return { observed: result, cleared: Object.freeze(cleared) };
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
            // Bounded parking transition: exactly once per park, never per
            // signal. A later work-area reprojection clears the park.
            this.logToken(`${LOG_PREFIX}:reconcile-parked`);
        }
    }

    private dispatch(intent: AutoIntent): void {
        if (!this.enabled || this.inFlight) {
            return;
        }
        if (this.blockedBySend()) {
            return;
        }
        if (intent.workAreaReprojection === true) {
            if (intent.background === true) {
                this.clearBackgroundReconcile(intent.snapshot);
            } else {
                this.resetReconcileState();
            }
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
            ...(entry.floating === true ? { floating: true } : {}),
            // Internal fit opt-out for any floating, sticky, fullscreen, or
            // maximized member. Rust declines fitting when any entry sets it;
            // normal seed/reflow exception behavior is unchanged.
            ...(entry.floating === true || entry.sticky === true || entry.fullscreen || entry.maximized ? { fit_excluded: true } : {}),
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
            admissionMaximizeClears: intent.admissionMaximizeClears ?? Object.freeze([]),
            floatTarget: intent.floatTarget ?? null,
            stickyTarget: intent.stickyTarget ?? null,
            background: intent.background === true,
        };
        // Bounded route entry: every dispatched flight opens with the same
        // cmd line shape and `outcome=dispatch`, then closes with its terminal
        // outcome line (planned-applied, rejected, timeout, ...). Together the
        // two lines make every user action observable with entry and verdict.
        this.diag(intent.op, correlation, sortedIds.length, "dispatch");
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
            if (intent.background === true) {
                this.noteBackgroundTerminal(intent.snapshot);
            } else {
                this.noteReconcileTerminal(intent.op, intent.workAreaReprojection === true);
            }
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
            if (intent.background === true) {
                this.noteBackgroundTerminal(intent.snapshot);
            } else {
                this.noteReconcileTerminal(intent.op, intent.workAreaReprojection === true);
            }
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
            if (lost.background === true) {
                this.noteBackgroundTerminal(lost.snapshot);
            } else {
                this.noteReconcileTerminal(lost.op, lost.workAreaReprojection);
            }
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
            const detail = sanitizeDetail(parsed["detail"]);
            this.inFlight = false;
            this.pending = null;
            this.diag(flightState.op, flightState.correlation, flightState.windowCount, "rejected");
            this.rejectKind(kind, detail, flightState.snapshot);
            if (flightState.background === true) {
                this.noteBackgroundTerminal(flightState.snapshot);
            } else {
                this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
            }
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
            if (flightState.background === true) {
                this.noteBackgroundTerminal(flightState.snapshot);
            } else {
                this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
            }
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
            if (entry.floating !== true || (flightState.floatTarget?.window === entry.id && flightState.floatTarget.floating === false)) {
                wanted.add(entry.id);
            }
        }
        if (flightState.removed !== null) {
            wanted.delete(flightState.removed);
        }
        if (flightState.op === "toggle-float") {
            const target = flightState.floatTarget;
            if (target === null || (target.floating && (planned.floatGeometry === null || planned.floatGeometry.window !== target.window)) || (!target.floating && planned.floatGeometry !== null)) {
                return false;
            }
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
        // Reply-boundary re-observation resolves targets from the flight's own
        // domain only, so hidden-domain geometry is never applied to
        // foreground refs and vice versa.
        const fresh =
            flightState.background === true ? this.freshHiddenFor(flightState.snapshot) : this.freshObserved();
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
        if (flightState.op === "toggle-float") {
            const freshSnapshot = this.carriedSnapshot(fresh);
            if (!snapshotsEqual(freshSnapshot, flightState.snapshot)) {
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        if (flightState.removed === null) {
            const freshSnapshot = this.carriedSnapshot(fresh);
            if (
                !snapshotsEqual(freshSnapshot, flightState.snapshot) &&
                !(flightState.op === "admit" && snapshotsEqualAllowingAdmissionMaximize(freshSnapshot, flightState.snapshot, flightState.admissionMaximizeClears))
            ) {
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        const freshSnapshot = this.carriedSnapshot(fresh);
        if (!matchesRemovalSnapshot(freshSnapshot, flightState.snapshot, flightState.removed)) {
            this.failFlight(flightState, "stale-scope");
            return;
        }
        this.writeGeometries(planned, flightState, fresh);
    }

    private writeGeometries(
        planned: PlannedReply,
        flightState: PendingFlight,
        current: PlanObserved,
    ): void {
        const byRef = new Map<string, object>();
        const oldById = new Map<string, PlanRect>();
        const fullscreenById = new Set<string>();
        const maximizedById = new Set<string>();
        const floatingById = new Set<string>();
        const resourceClassById = new Map<string, string>();
        for (const entry of current.windows) {
            byRef.set(entry.id, entry.ref);
            oldById.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
            if (entry.fullscreen) {
                fullscreenById.add(entry.id);
            }
            if (entry.maximized) {
                maximizedById.add(entry.id);
            }
            if (entry.floating === true) {
                floatingById.add(entry.id);
            }
            resourceClassById.set(entry.id, isOpaqueId(entry.resourceClass) ? entry.resourceClass : "unknown");
        }
        const ordered = orderGeometryWrites(oldById, planned.geometry);
        // Focus is focus-only: never rewrite geometry, only move the active
        // window. Matches the standalone focus adapter single-write contract;
        // move/admit/remove/resize still apply complete geometries above.
        // KWin leaves the drag source at its raw pointer rectangle. Reassert the
        // retained projection so its inset sibling gap is restored too.
        if (flightState.op !== "focus") {
            // Bounded per-member disposition lines: every member of the applied
            // command carries its exact write outcome (skipped fullscreen,
            // skipped maximized, already equal, written, or write-failed) with
            // the stable opaque window id and target rect. Fullscreen takes
            // precedence over maximize, and either overlay state takes
            // precedence over equality.
            const orderedById = new Set<string>();
            for (const entry of ordered) {
                orderedById.add(entry.window);
            }
            for (const entry of planned.geometry) {
                if (fullscreenById.has(entry.window)) {
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "skip-fullscreen", entry.rect);
                } else if (maximizedById.has(entry.window)) {
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "skip-maximized", entry.rect);
                } else if (floatingById.has(entry.window) && flightState.floatTarget?.window !== entry.window) {
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "skip-floating", entry.rect);
                } else if (!orderedById.has(entry.window)) {
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "skip-already-equal", entry.rect);
                }
            }
            for (const entry of ordered) {
                if (fullscreenById.has(entry.window) || maximizedById.has(entry.window) || (floatingById.has(entry.window) && flightState.floatTarget?.window !== entry.window)) {
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
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "write-failed", entry.rect);
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "written", entry.rect);
            }
            const transition = flightState.floatTarget;
            if (transition !== null && transition.floating) {
                const floatGeometry = planned.floatGeometry;
                const target = byRef.get(transition.window);
                if (floatGeometry === null || target === undefined || !this.env.setGeometry(target, floatGeometry.rect)) {
                    this.writeDiag(transition.window, resourceClassById.get(transition.window) ?? "unknown", "float-write-failed", floatGeometry?.rect ?? { x: 0, y: 0, w: 1, h: 1 });
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                this.writeDiag(transition.window, resourceClassById.get(transition.window) ?? "unknown", "float-written", floatGeometry.rect);
                try { this.env.setFloating?.(transition.window, true); } catch (error) { void error; this.failFlight(flightState, "write-failed"); return; }
            } else if (transition !== null) {
                try { this.env.setFloating?.(transition.window, false); } catch (error) { void error; this.failFlight(flightState, "write-failed"); return; }
            }
            const sticky = flightState.stickyTarget;
            if (sticky !== null) {
                const target = current.windows.find((entry) => entry.id === sticky.window);
                if (target === undefined) {
                    this.failFlight(flightState, "precondition-mismatch");
                    return;
                }
                this.issueSticky(target, true, sticky.previousFloating);
            }
        }
        const focus = planned.focus;
        // Hidden-domain flights never route focus: the anchor focusedId is a
        // structural placeholder, and applying it would steal native focus and
        // switch desktop visibility.
        if (focus !== null && flightState.background !== true) {
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
                // Every member (including a fullscreen or maximized one)
                // records the planner's retained projection from the reply: the
                // tree slot must survive enter/exit, and the carried baseline
                // never stores the compositor-owned frame rect.
                const rect = rectById.get(entry.id) ?? entry.rect;
                const transition = flightState.floatTarget;
                const floating = transition !== null && transition.window === entry.id ? transition.floating : entry.floating;
                const floatRect = transition !== null && transition.window === entry.id && transition.floating ? planned.floatGeometry?.rect : undefined;
                const next = floatRect ?? rect;
                return { id: entry.id, rect: { x: next.x, y: next.y, w: next.w, h: next.h }, output: entry.output, workspace: entry.workspace, fullscreen: entry.fullscreen, maximized: entry.maximized, floating, resourceClass: entry.resourceClass };
            });
            // A committed remove that empties the domain retires its baseline
            // and all background accounting at the same applied boundary so
            // the slot is released. Zero-window baselines are never retained.
            if (flightState.op === "remove" && windows.length === 0) {
                const emptyKey = this.domainKey(base);
                this.lastGoodByDomain.delete(emptyKey);
                if (flightState.background === true) {
                    this.clearBackgroundReconcile(base);
                }
                if (flightState.removed !== null) {
                    this.maximizeAdmissionAttempts.delete(flightState.removed);
                    try {
                        this.env.noteRemoved?.(flightState.removed);
                    } catch (error) {
                        void error;
                    }
                }
            } else {
                const retained = this.setLastGood({ ...base, windows: Object.freeze(windows) }, flightState.background === true);
                if (flightState.background === true && !retained) {
                    // Background cap-race: the applied result cannot be retained
                    // without evicting the foreground baseline. Fail closed without
                    // clearing accounting (which would retry forever): count the
                    // terminal attempt so the domain parks boundedly instead.
                    this.failFlight(flightState, "cap-race");
                    return;
                }
            }
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
                this.logToken(`${LOG_PREFIX}:echo-fence-armed`);
            }
            if (flightState.op === "reconcile") {
                if (flightState.background === true) {
                    this.clearBackgroundReconcile(flightState.snapshot);
                } else {
                    this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
                }
            } else if (flightState.background === true) {
                this.clearBackgroundReconcile(flightState.snapshot);
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
        // Exactly one observational active-group refresh after an actual
        // successful geometry-plan boundary, even when focus is unchanged.
        // Geometry writes emit no highlight signal, so without this edge the
        // entry-owned highlight would stay stale. Only admit/move/remove/
        // resize qualify; focus/reconcile/pointer-resize/toggle-float never
        // refresh here (focus already re-queries via its signal). Stale,
        // rejected, error, and unfinished boundaries return through
        // failFlight or earlier exits and never reach this edge. The callback
        // is best-effort and non-blocking: it must not delay the deferred
        // foreground command below.
        if (
            flightState.background !== true &&
            (flightState.op === "admit" ||
                flightState.op === "move" ||
                flightState.op === "remove" ||
                flightState.op === "resize")
        ) {
            try {
                this.env.onPlannedApplied?.(flightState.op);
            } catch (error) {
                void error;
            }
        }
        this.finishFlight();
    }

    private failFlight(flightState: PendingFlight, outcome: string): void {
        this.inFlight = false;
        this.pending = null;
        this.diag(flightState.op, flightState.correlation, flightState.windowCount, outcome);
        if (flightState.background === true) {
            this.noteBackgroundTerminal(flightState.snapshot);
        } else {
            this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
        }
        this.finishFlight();
    }

    // After every flight, exactly one deferred signal-driven auto command
    // runs so admit/remove converge without queues or retries. When idle with
    // nothing deferred, one hidden-domain step chains so background domains
    // converge across successive flights without polling or new timers.
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
        if (!this.inFlight && this.deferredAuto === null && !this.chainingHidden) {
            this.chainingHidden = true;
            try {
                this.refreshHiddenNow();
            } finally {
                this.chainingHidden = false;
            }
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
        if (outcome === "dispatch" && !KWIN_TRACE_ENABLED) {
            return;
        }
        try {
            this.env.log(`${LOG_PREFIX}:cmd=${correlation} kind=${op} windows=${String(windows)} outcome=${outcome}`);
        } catch (error) {
            void error;
        }
    }

    private logToken(message: string): void {
        try {
            this.env.log(message);
        } catch (error) {
            void error;
        }
    }

    private writeDiag(window: string, resourceClass: string, disposition: string, rect: PlanRect): void {
        if (!KWIN_TRACE_ENABLED && disposition !== "write-failed" && disposition !== "float-write-failed") {
            return;
        }
        this.logToken(
            `${LOG_PREFIX}:write window=${window} resource_class=${resourceClass} disposition=${disposition} rect=${String(rect.x)},${String(rect.y)},${String(rect.w)},${String(rect.h)}`,
        );
    }

    private rejectKind(kind: string, detail: string | null, snapshot: PlanSnapshot | null = null): void {
        try {
            const suffix = kind === "snapshot-invalid" && detail !== null ? ` detail=${detail}` : "";
            if (kind === "snapshot-invalid" && detail === "window-out-of-bounds" && snapshot !== null) {
                const outside = snapshot.windows.find((entry) => !rectContained(entry.rect, snapshot.domainBounds));
                if (outside !== undefined) {
                    this.env.log(
                        `${LOG_PREFIX}:rejected kind=${kind}${suffix} window=${outside.id} resource_class=${outside.resourceClass} rect=${String(outside.rect.x)},${String(outside.rect.y)},${String(outside.rect.w)},${String(outside.rect.h)} bounds=${String(snapshot.domainBounds.x)},${String(snapshot.domainBounds.y)},${String(snapshot.domainBounds.w)},${String(snapshot.domainBounds.h)}`,
                    );
                    return;
                }
            }
            this.env.log(`${LOG_PREFIX}:rejected kind=${kind}${suffix}`);
        } catch (error) {
            void error;
        }
    }

    private domainKey(snapshot: Pick<PlanSnapshot, "domainOutput" | "domainWorkspace">): string {
        return `${snapshot.domainOutput}\u0000${snapshot.domainWorkspace}`;
    }

    private lastGoodFor(snapshot: Pick<PlanSnapshot, "domainOutput" | "domainWorkspace">): PlanSnapshot | null {
        return this.lastGoodByDomain.get(this.domainKey(snapshot)) ?? null;
    }

    private setLastGood(snapshot: PlanSnapshot, background = false): boolean {
        const key = this.domainKey(snapshot);
        if (!this.lastGoodByDomain.has(key) && this.lastGoodByDomain.size >= PLAN_MAX_DOMAINS) {
            if (background) {
                // Fail closed without evicting the foreground baseline: a
                // hidden candidate never forces foreground re-admission.
                return false;
            }
            // Match the Planner's bounded-domain eviction before retaining the
            // projection that committed the replacement domain.
            this.lastGoodByDomain.clear();
        }
        this.lastGoodByDomain.set(key, snapshot);
        return true;
    }
}
