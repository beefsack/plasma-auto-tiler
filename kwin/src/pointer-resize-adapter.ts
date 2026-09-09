// Bounded standalone pointer resize adapter (opt-in only).
//
// Product-shaped but with no normal startup route: ordinary production
// startup never runs this module (src/entry.ts must not import it, and no
// controller route under src/controller*.ts may import it or reference the
// DescribePointerResize route). The only activation is the explicit exported
// PointerResizeAdapter class plus the separate entry helper, called by no
// production source.
//
// Future exclusive wiring contract: any future caller must supply an explicit
// hasExclusiveResizeAuthority boundary proving no prior handler runs in the
// same call for the same command domain; the adapter rechecks it at start,
// before every request, and again before native writes, and the entry
// requires it as a function (never a bare boolean). A false value rejects
// before any native write so legacy resize and geometry authority cannot
// co-exist. The module never reads, mirrors, or mutates the legacy tiling
// tree and never shares ownership with it.
//
// Rust owns normalized domains, pointer resize intent, capabilities,
// preconditions, revision binding, and reconciliation via the narrow JSON
// action protocol over DescribePointerResize. This module owns KWin
// observation, native identity mapping, gesture classification from the
// public interactive move/resize state plus stepped proposed geometry,
// revalidation, sequential native frameGeometry writes of neighbours only,
// and post-observation. One gesture at a time, one in-flight command, one
// coalesced latest step, one direction per gesture. Any owner, service,
// correlation, revision, precondition, eligibility, geometry, focus, or
// post-observation fault fails closed and disables. All logs are fixed
// redacted tokens carrying no captions, app ids, native ids, PIDs, paths,
// owners, or raw extents. Only minimal public events are used. No repeating
// timer and no configure wait; a single one-shot service timeout bounds each
// D-Bus stage following the shared adapter convention.
//
// Gesture model: the entry attaches the three public per-window interactive
// signals and forwards exact native refs here. At start the adapter captures
// the exact native ref/id/domain mapping, the accepted auth
// revision/generation, the source rect, the work area, and the
// membership/fingerprint/revalidate contract, and classifies the gesture
// from the established public interactive move/resize flags only. A pure
// interactive move never sends a pointer request and never writes neighbours.
// Resize steps normalize the stepped proposed source geometry (the live
// native rect may lag the proposal) and derive a single changed edge,
// direction, and absolute integer boundary from it. Equivalent boundaries
// dedup. At most one D-Bus flight exists; while pending only the latest
// normalized differing step is retained in a single slot. Finish sends one
// final latest normalized step when needed, then the flight runs
// acknowledge/verify and commits the latest accepted revision.
//
// Neighbour writes are non-atomic: exact rectangles are applied only when
// changed and only for planned neighbours (never the native-driven source),
// sequentially in the deterministic shared grow-before-shrink order, with
// synchronous recursion suppression around each own write. There is no
// configure barrier; unrelated or foreign signals invalidate terminally.

export const POINTER_RESIZE_SERVICE = "org.plasmaautotiler.Planner";
export const POINTER_RESIZE_OBJECT = "/org/plasmaautotiler/Planner";
export const POINTER_RESIZE_INTERFACE = "org.plasmaautotiler.Planner1";
export const POINTER_RESIZE_METHOD = "DescribePointerResize";

export const POINTER_RESIZE_CONTRACT_VERSION = 1;
export const POINTER_RESIZE_MAX_REQUEST_BYTES = 64 * 1024;
export const POINTER_RESIZE_MAX_REPLY_BYTES = 64 * 1024;
export const POINTER_RESIZE_TIMEOUT_MS = 2000;
export const POINTER_RESIZE_MAX_CORRELATION_LEN = 128;
export const POINTER_RESIZE_MAX_OWNER_LEN = 128;
export const POINTER_RESIZE_MAX_GENERATION_LEN = 64;
export const POINTER_RESIZE_MAX_REVISION = 1000000;
export const POINTER_RESIZE_MAX_ID_LEN = 128;
export const POINTER_RESIZE_MAX_WINDOWS = 64;
export const POINTER_RESIZE_MAX_GEOMETRY = 64;
export const POINTER_RESIZE_MAX_SHARES = 64;
export const POINTER_RESIZE_MAX_SEQ = 1000000;

import { orderGeometryWrites } from "./geometry-order";

const POINTER_LOG = "plasma-auto-tiler:pointer-resize";

export type PointerResizeDirection = "left" | "right" | "up" | "down";

export interface PointerResizeRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface PointerResizeObservedWindow {
    readonly id: string;
    readonly ref: object;
    readonly rect: PointerResizeRect;
    readonly output: string;
    readonly workspace: string;
}

export interface PointerResizeObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: PointerResizeRect;
    readonly domainGap: number;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<PointerResizeObservedWindow>;
    readonly activeRef: object | null;
    readonly fingerprint: string;
    // Revalidation compares membership, refs, domains, and every
    // non-source rect against the captured observation. The interactive
    // source rect is owned by the native gesture and may legitimately move,
    // so the caller names the exact source id to exempt from rect matching.
    readonly revalidate: (sourceId: string) => boolean;
}

export interface PointerResizeLiveState {
    readonly move: boolean;
    readonly resize: boolean;
}

export interface PointerResizeEnv {
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
    readonly observe: () => PointerResizeObserved | null;
    readonly setGeometry: (target: object, rect: PointerResizeRect) => boolean;
    readonly active: () => object | null;
    readonly hasExclusiveResizeAuthority: () => boolean;
    readonly readLiveState: (target: object) => PointerResizeLiveState | null;
}

export interface PointerResizeDesired {
    readonly window: string;
    readonly leaf: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: PointerResizeRect;
}

export interface PointerResizeDesiredFocus {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly leaf: string;
}

// Deterministic bounded observation fingerprint (FNV-1a 32-bit over
// `output\x1fworkspace\x1ffocused\x1fids...`, sorted ids). Same canonical
// binding the Rust resize_fingerprint uses for both keyboard and pointer
// requests; carried as a string in the native cache and as a number on the
// wire.
export function pointerResizeFingerprint(
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
    if (typeof value !== "string" || value.length === 0 || value.length > POINTER_RESIZE_MAX_ID_LEN) {
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
        value.length <= POINTER_RESIZE_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= POINTER_RESIZE_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > POINTER_RESIZE_MAX_GENERATION_LEN) {
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
        value <= POINTER_RESIZE_MAX_REVISION
    );
}

function isDirection(value: unknown): value is PointerResizeDirection {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isPointerMode(value: unknown): value is string {
    return value === "inwards" || value === "outwards";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isFiniteInt(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isTargetRect(value: unknown): value is PointerResizeRect {
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

function sameRect(a: PointerResizeRect, b: PointerResizeRect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function rectContained(inner: PointerResizeRect, outer: PointerResizeRect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.w <= outer.x + outer.w &&
        inner.y + inner.h <= outer.y + outer.h
    );
}

// Normalize a stepped proposed source geometry. Accepts the public KWin
// rect spelling ({x, y, width, height}) and the compact spelling
// ({x, y, w, h}); fractional pointer values round to integers. Returns null
// when the payload is malformed or out of bounds.
export function normalizePointerRect(value: unknown): PointerResizeRect | null {
    if (!isRecord(value)) {
        return null;
    }
    const xRaw = value["x"];
    const yRaw = value["y"];
    const wRaw = value["width"] !== undefined ? value["width"] : value["w"];
    const hRaw = value["height"] !== undefined ? value["height"] : value["h"];
    if (!isFiniteNumber(xRaw) || !isFiniteNumber(yRaw) || !isFiniteNumber(wRaw) || !isFiniteNumber(hRaw)) {
        return null;
    }
    const candidate = { x: Math.round(xRaw), y: Math.round(yRaw), w: Math.round(wRaw), h: Math.round(hRaw) };
    return isTargetRect(candidate) ? candidate : null;
}

export interface PointerResizeEdge {
    readonly direction: PointerResizeDirection;
    readonly boundary: number;
}

// Derive a single changed edge, direction, and absolute integer boundary by
// comparing the stepped proposed source geometry against the captured start
// rect. Exactly one edge must move with the opposite edge fixed; anything
// else (no change, corner drags, position shifts, inconsistent extents) is
// not a single-edge resize. Returns null for no change and the string
// "mixed" for a non-single-edge change.
export function derivePointerEdge(
    start: PointerResizeRect,
    stepped: PointerResizeRect,
): PointerResizeEdge | "mixed" | null {
    const startRight = start.x + start.w;
    const startBottom = start.y + start.h;
    const steppedRight = stepped.x + stepped.w;
    const steppedBottom = stepped.y + stepped.h;
    const horizontalSame = stepped.x === start.x && stepped.w === start.w;
    const verticalSame = stepped.y === start.y && stepped.h === start.h;
    if (horizontalSame && verticalSame) {
        return null;
    }
    if (!horizontalSame && !verticalSame) {
        return "mixed";
    }
    if (!horizontalSame) {
        if (stepped.x !== start.x && steppedRight === startRight) {
            return { direction: "left", boundary: stepped.x };
        }
        if (stepped.x === start.x && steppedRight !== startRight) {
            return { direction: "right", boundary: steppedRight };
        }
        return "mixed";
    }
    if (stepped.y !== start.y && steppedBottom === startBottom) {
        return { direction: "up", boundary: stepped.y };
    }
    if (stepped.y === start.y && steppedBottom !== startBottom) {
        return { direction: "down", boundary: steppedBottom };
    }
    return "mixed";
}

const POINTER_KIND = "ResizeSplitShare";
const POINTER_CAPABILITY = "keyboard-resize";
const POINTER_PRECONDITIONS: readonly string[] = Object.freeze([
    "focused-leaf-occupied-by-focused-window",
    "target-boundary-valid",
    "resize-targets-same-domain",
    "adapter-must-verify-postconditions",
]);
const POINTER_OPERATION_KEYS: readonly string[] = Object.freeze([
    "kind",
    "domain_output",
    "domain_workspace",
    "focused_leaf",
    "focused_window",
    "direction",
    "mode",
    "target_group",
    "focused_child",
    "neighbor_child",
    "focused_index",
    "neighbor_index",
    "old_shares",
    "new_shares",
]);

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

function isNonNegativeInt(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isShareVector(value: unknown): value is number[] {
    if (!Array.isArray(value) || value.length < 2 || value.length > POINTER_RESIZE_MAX_SHARES) {
        return false;
    }
    for (const entry of value) {
        if (!isNonNegativeInt(entry) || entry === 0) {
            return false;
        }
    }
    return true;
}

function validateOperationShape(operation: unknown): boolean {
    if (!isRecord(operation)) {
        return false;
    }
    if (!hasExactKeys(operation, POINTER_OPERATION_KEYS)) {
        return false;
    }
    if (operation["kind"] !== POINTER_KIND) {
        return false;
    }
    if (
        !isOpaqueId(operation["domain_output"]) ||
        !isOpaqueId(operation["domain_workspace"]) ||
        !isOpaqueId(operation["focused_leaf"]) ||
        !isOpaqueId(operation["focused_window"]) ||
        !isOpaqueId(operation["target_group"]) ||
        !isOpaqueId(operation["focused_child"]) ||
        !isOpaqueId(operation["neighbor_child"])
    ) {
        return false;
    }
    if (!isDirection(operation["direction"])) {
        return false;
    }
    // Shared operation DTO now carries required mode (inwards|outwards).
    // Pointer behavior itself stays boundary-driven and never invents a
    // keyboard step: no press_index, no mode-driven shares.
    if (!isPointerMode(operation["mode"])) {
        return false;
    }
    if (!isNonNegativeInt(operation["focused_index"]) || !isNonNegativeInt(operation["neighbor_index"])) {
        return false;
    }
    if (operation["focused_index"] === operation["neighbor_index"]) {
        return false;
    }
    if (operation["focused_child"] === operation["neighbor_child"]) {
        return false;
    }
    if (!isShareVector(operation["old_shares"]) || !isShareVector(operation["new_shares"])) {
        return false;
    }
    const oldShares = operation["old_shares"] as number[];
    const newShares = operation["new_shares"] as number[];
    if (oldShares.length !== newShares.length) {
        return false;
    }
    if ((operation["focused_index"] as number) >= oldShares.length) {
        return false;
    }
    if ((operation["neighbor_index"] as number) >= oldShares.length) {
        return false;
    }
    // Adjacent pair and direction-consistent neighbor exactly as Rust
    // `valid_pointer_resize_operation` enforces before any neighbor write:
    // the pair must be directly adjacent and the neighbor must lie in the
    // resize direction from the focused child.
    const focusedIndex = operation["focused_index"] as number;
    const neighborIndex = operation["neighbor_index"] as number;
    if (Math.abs(focusedIndex - neighborIndex) !== 1) {
        return false;
    }
    const direction = operation["direction"] as string;
    const step = direction === "right" || direction === "down" ? 1 : -1;
    if (neighborIndex - focusedIndex !== step) {
        return false;
    }
    let same = true;
    for (let index = 0; index < oldShares.length; index += 1) {
        if (oldShares[index] !== newShares[index]) {
            same = false;
            break;
        }
    }
    return !same;
}

function validateGeometryEntry(value: unknown): value is PointerResizeDesired {
    if (!isRecord(value)) {
        return false;
    }
    if (!hasExactKeys(value, ["window", "leaf", "output", "workspace", "rect"])) {
        return false;
    }
    if (
        !isOpaqueId(value["window"]) ||
        !isOpaqueId(value["leaf"]) ||
        !isOpaqueId(value["output"]) ||
        !isOpaqueId(value["workspace"])
    ) {
        return false;
    }
    const rect = value["rect"];
    if (!isRecord(rect)) {
        return false;
    }
    if (!hasExactKeys(rect, ["x", "y", "w", "h"])) {
        return false;
    }
    return isTargetRect({ x: rect["x"], y: rect["y"], w: rect["w"], h: rect["h"] });
}

function validateDesiredFocus(value: unknown): value is PointerResizeDesiredFocus {
    if (!isRecord(value)) {
        return false;
    }
    if (!hasExactKeys(value, ["domain_output", "domain_workspace", "leaf"])) {
        return false;
    }
    return (
        isOpaqueId(value["domain_output"]) &&
        isOpaqueId(value["domain_workspace"]) &&
        isOpaqueId(value["leaf"])
    );
}

interface PlannedPointer {
    readonly correlationId: string;
    readonly baseRevision: number;
    readonly preconditions: ReadonlyArray<string>;
    readonly operation: Record<string, unknown>;
    readonly geometry: ReadonlyArray<PointerResizeDesired>;
    readonly focus: PointerResizeDesiredFocus;
}

function validatePlanned(reply: unknown, correlationId: string): PlannedPointer | null {
    if (!isRecord(reply)) {
        return null;
    }
    if (
        !hasExactKeys(reply, [
            "v",
            "correlation_id",
            "outcome",
            "base_revision",
            "capability",
            "preconditions",
            "operation",
            "desired_geometry",
            "desired_focus",
        ])
    ) {
        return null;
    }
    if (reply["v"] !== POINTER_RESIZE_CONTRACT_VERSION) {
        return null;
    }
    if (reply["correlation_id"] !== correlationId) {
        return null;
    }
    if (reply["outcome"] !== "planned") {
        return null;
    }
    if (reply["capability"] !== POINTER_CAPABILITY) {
        return null;
    }
    const preconditions = reply["preconditions"];
    if (!Array.isArray(preconditions) || preconditions.length !== POINTER_PRECONDITIONS.length) {
        return null;
    }
    for (let index = 0; index < POINTER_PRECONDITIONS.length; index += 1) {
        if (preconditions[index] !== POINTER_PRECONDITIONS[index]) {
            return null;
        }
    }
    if (!validateOperationShape(reply["operation"])) {
        return null;
    }
    const baseRevision = reply["base_revision"];
    if (!isRevision(baseRevision)) {
        return null;
    }
    const geometryRaw = reply["desired_geometry"];
    if (!Array.isArray(geometryRaw) || geometryRaw.length === 0 || geometryRaw.length > POINTER_RESIZE_MAX_GEOMETRY) {
        return null;
    }
    const geometry: PointerResizeDesired[] = [];
    const seenWindow = new Set<string>();
    for (const entry of geometryRaw) {
        if (!validateGeometryEntry(entry)) {
            return null;
        }
        const typed = entry as unknown as PointerResizeDesired;
        if (seenWindow.has(typed.window)) {
            return null;
        }
        seenWindow.add(typed.window);
        geometry.push({
            window: typed.window,
            leaf: typed.leaf,
            output: typed.output,
            workspace: typed.workspace,
            rect: { x: typed.rect.x, y: typed.rect.y, w: typed.rect.w, h: typed.rect.h },
        });
    }
    const focusRaw = reply["desired_focus"];
    if (!validateDesiredFocus(focusRaw)) {
        return null;
    }
    const focusRecord = focusRaw as unknown as Record<string, unknown>;
    return {
        correlationId,
        baseRevision: baseRevision as number,
        preconditions: Object.freeze([...(preconditions as string[])]),
        operation: reply["operation"] as Record<string, unknown>,
        geometry: Object.freeze(geometry),
        focus: {
            domainOutput: focusRecord["domain_output"] as string,
            domainWorkspace: focusRecord["domain_workspace"] as string,
            leaf: focusRecord["leaf"] as string,
        },
    };
}

function validateObserved(observed: PointerResizeObserved | null): observed is PointerResizeObserved {
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
    if (windows.length === 0 || windows.length > POINTER_RESIZE_MAX_WINDOWS) {
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
    if (!Number.isInteger(observed.domainGap) || observed.domainGap < 0 || observed.domainGap > 64) {
        return false;
    }
    const seen = new Set<string>();
    let focusedFound = false;
    for (const entry of windows) {
        if (typeof entry !== "object" || entry === null) {
            return false;
        }
        const candidate = entry as PointerResizeObservedWindow;
        if (!isOpaqueId(candidate.id) || typeof candidate.ref !== "object" || candidate.ref === null) {
            return false;
        }
        // Single-domain pointer resize: every observed window must live in
        // the gesture domain. Anything else is a cross-domain mismatch.
        if (candidate.output !== observed.domainOutput || candidate.workspace !== observed.domainWorkspace) {
            return false;
        }
        if (!isTargetRect({ x: candidate.rect.x, y: candidate.rect.y, w: candidate.rect.w, h: candidate.rect.h })) {
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

// Deterministic native-boundary application order: shared canonical
// grow-before-shrink order via geometry-order. Changed neighbours only;
// the interactive source is never ordered here because it is never written.
export function orderPointerWrites(
    oldById: ReadonlyMap<string, PointerResizeRect>,
    desired: ReadonlyArray<PointerResizeDesired>,
): ReadonlyArray<PointerResizeDesired> {
    return orderGeometryWrites(oldById, desired);
}

export interface PointerResizeEnableAuth {
    readonly owner: unknown;
    readonly generation: unknown;
    readonly revision?: unknown;
}

interface PointerGesture {
    readonly sourceRef: object;
    readonly sourceId: string;
    readonly kind: "move" | "resize";
    direction: PointerResizeDirection | null;
    readonly startRect: PointerResizeRect;
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: PointerResizeRect;
    readonly focusedId: string;
    fingerprint: string;
    observed: PointerResizeObserved;
    finished: boolean;
    lastBoundary: PointerResizeEdge | null;
}

interface PendingPointerStep {
    readonly direction: PointerResizeDirection;
    readonly boundary: number;
}

export class PointerResizeAdapter {
    private enabled = false;
    private owner = "";
    private generation = "";
    private revision = 0;
    private gesture: PointerGesture | null = null;
    private inFlight = false;
    private token = 0;
    private activeToken = 0;
    private callbackSeen = false;
    private cancelTimer: (() => void) | null = null;
    private suppressing = false;
    private seq = 0;
    private pendingStep: PendingPointerStep | null = null;
    private pendingPlanned: PlannedPointer | null = null;
    private flightDirection: PointerResizeDirection | null = null;
    private flightRevision = 0;
    private lossReported = false;
    private appliedDesired = new Map<string, PointerResizeRect>();

    constructor(private readonly env: PointerResizeEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    get hasGesture(): boolean {
        return this.gesture !== null;
    }

    private reportAdapterLost(planned: PlannedPointer | null): void {
        if (planned === null || this.lossReported) {
            return;
        }
        this.lossReported = true;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: POINTER_RESIZE_CONTRACT_VERSION,
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
        if (payload.length === 0 || payload.length > POINTER_RESIZE_MAX_REQUEST_BYTES) {
            return;
        }
        try {
            this.env.callDbus(
                POINTER_RESIZE_SERVICE,
                POINTER_RESIZE_OBJECT,
                POINTER_RESIZE_INTERFACE,
                POINTER_RESIZE_METHOD,
                payload,
                () => {},
            );
        } catch (error) {
            void error;
        }
    }

    enable(auth: PointerResizeEnableAuth): boolean {
        if (this.enabled) {
            return false;
        }
        if (!isRecord(auth as unknown as Record<string, unknown>)) {
            this.reject("pointer-invalid-auth");
            return false;
        }
        if (!isOwnerId(auth.owner) || !isGeneration(auth.generation)) {
            this.reject("pointer-invalid-auth");
            return false;
        }
        const revision = auth.revision === undefined ? 0 : auth.revision;
        if (!isRevision(revision)) {
            this.reject("pointer-invalid-auth");
            return false;
        }
        this.owner = auth.owner as string;
        this.generation = auth.generation as string;
        this.revision = revision as number;
        this.enabled = true;
        this.gesture = null;
        this.inFlight = false;
        this.pendingStep = null;
        this.pendingPlanned = null;
        this.flightDirection = null;
        this.flightRevision = 0;
        this.suppressing = false;
        this.lossReported = false;
        this.appliedDesired.clear();
        this.log(`${POINTER_LOG}:ready`);
        return true;
    }

    disable(): void {
        if (!this.enabled && this.gesture === null && !this.inFlight) {
            return;
        }
        this.enabled = false;
        this.gesture = null;
        this.inFlight = false;
        this.pendingStep = null;
        this.pendingPlanned = null;
        this.flightDirection = null;
        this.flightRevision = 0;
        this.suppressing = false;
        this.appliedDesired.clear();
        this.clearTimer();
        this.log(`${POINTER_LOG}:disabled`);
    }

    // Entry forwards the exact native ref whose public interactive start
    // signal fired.
    windowStarted(source: unknown): void {
        if (!this.enabled) {
            this.reject("pointer-disabled");
            return;
        }
        if (this.suppressing) {
            return;
        }
        if (typeof source !== "object" || source === null) {
            this.reject("pointer-unknown-window");
            this.disable();
            return;
        }
        if (this.gesture !== null) {
            this.reject("pointer-gesture-conflict");
            this.disable();
            return;
        }
        if (!this.checkAuthority("pointer-exclusive-conflict")) {
            return;
        }
        const observed = this.readObserved();
        if (observed === null) {
            this.reject("pointer-stale-scope");
            this.disable();
            return;
        }
        let match: PointerResizeObservedWindow | null = null;
        for (const entry of observed.windows) {
            if (entry.ref === source) {
                match = entry;
                break;
            }
        }
        if (match === null) {
            this.reject("pointer-unknown-window");
            this.disable();
            return;
        }
        const state = this.readState(source);
        if (state === null) {
            this.reject("pointer-gesture-state");
            this.disable();
            return;
        }
        if (state.move === true && state.resize === false) {
            this.gesture = {
                sourceRef: source,
                sourceId: match.id,
                kind: "move",
                direction: null,
                startRect: { ...match.rect },
                domainOutput: observed.domainOutput,
                domainWorkspace: observed.domainWorkspace,
                domainBounds: { ...observed.domainBounds },
                focusedId: observed.focusedId,
                fingerprint: observed.fingerprint,
                observed,
                finished: false,
                lastBoundary: null,
            };
            this.log(`${POINTER_LOG}:move-ignored`);
            return;
        }
        if (state.move === false && state.resize === true) {
            this.gesture = {
                sourceRef: source,
                sourceId: match.id,
                kind: "resize",
                direction: null,
                startRect: { ...match.rect },
                domainOutput: observed.domainOutput,
                domainWorkspace: observed.domainWorkspace,
                domainBounds: { ...observed.domainBounds },
                focusedId: observed.focusedId,
                fingerprint: observed.fingerprint,
                observed,
                finished: false,
                lastBoundary: null,
            };
            this.log(`${POINTER_LOG}:started`);
            return;
        }
        this.reject("pointer-mixed-gesture");
        this.disable();
    }

    // Entry forwards the exact native ref whose public stepped signal fired
    // plus the proposed geometry payload. Classification uses the proposed
    // payload only: the live native rect may lag the proposal.
    windowStepped(source: unknown, payload: unknown): void {
        if (!this.enabled) {
            return;
        }
        if (this.suppressing) {
            return;
        }
        const gesture = this.gesture;
        if (gesture === null) {
            this.reject("pointer-step-without-gesture");
            this.disable();
            return;
        }
        if (source !== gesture.sourceRef) {
            this.reject("pointer-foreign-signal");
            this.disable();
            return;
        }
        if (gesture.finished) {
            this.reject("pointer-stale-step");
            return;
        }
        const state = this.readState(gesture.sourceRef);
        if (gesture.kind === "move") {
            if (state !== null && state.move === true && state.resize === false) {
                return;
            }
            this.reject("pointer-gesture-transition");
            this.disable();
            return;
        }
        if (state === null || state.move !== false || state.resize !== true) {
            this.reject("pointer-gesture-transition");
            this.disable();
            return;
        }
        const stepped = normalizePointerRect(payload);
        if (stepped === null) {
            this.reject("pointer-bad-payload");
            this.disable();
            return;
        }
        const edge = derivePointerEdge(gesture.startRect, stepped);
        if (edge === null) {
            return;
        }
        if (edge === "mixed") {
            this.reject("pointer-mixed-edge");
            this.disable();
            return;
        }
        if (gesture.direction === null) {
            gesture.direction = edge.direction;
        } else if (gesture.direction !== edge.direction) {
            this.reject("pointer-direction-drift");
            this.disable();
            return;
        }
        const last = gesture.lastBoundary;
        if (last !== null && last.direction === edge.direction && last.boundary === edge.boundary) {
            // Returning to the in-flight boundary supersedes any retained
            // coalesced step: clear it so no stale second request, revision,
            // or write occurs after the flight settles.
            if (this.inFlight) {
                this.pendingStep = null;
            }
            this.reject("pointer-dedup");
            return;
        }
        if (this.inFlight) {
            this.pendingStep = { direction: edge.direction, boundary: edge.boundary };
            this.log(`${POINTER_LOG}:coalesced`);
            return;
        }
        if (!this.checkAuthority("pointer-exclusive-conflict")) {
            return;
        }
        const fresh = this.readObserved();
        if (fresh === null || !this.scopeMatches(fresh, gesture)) {
            this.reject("pointer-stale-scope");
            this.disable();
            return;
        }
        this.sendRequest(fresh, gesture, edge.direction, edge.boundary);
    }

    // Entry forwards the exact native ref whose public finish signal fired.
    // A pure move finish preserves tile assignment with no writes. A resize
    // finish marks the gesture done; a pending flight (plus any coalesced
    // latest step) still finalizes through acknowledge/verify.
    windowFinished(source: unknown): void {
        if (!this.enabled) {
            return;
        }
        if (this.suppressing) {
            return;
        }
        const gesture = this.gesture;
        if (gesture === null) {
            return;
        }
        if (source !== gesture.sourceRef) {
            this.reject("pointer-foreign-signal");
            this.disable();
            return;
        }
        if (gesture.finished) {
            return;
        }
        gesture.finished = true;
        if (gesture.kind === "move") {
            this.gesture = null;
            this.log(`${POINTER_LOG}:move-finished`);
            return;
        }
        if (this.inFlight) {
            return;
        }
        const step = this.pendingStep;
        this.pendingStep = null;
        if (step !== null) {
            if (!this.checkAuthority("pointer-exclusive-conflict")) {
                return;
            }
            const fresh = this.readObserved();
            if (fresh === null || !this.scopeMatches(fresh, gesture)) {
                this.reject("pointer-stale-scope");
                this.disable();
                return;
            }
            this.sendRequest(fresh, gesture, step.direction, step.boundary);
            return;
        }
        this.gesture = null;
        this.log(`${POINTER_LOG}:finished`);
    }

    // Entry forwards the exact native ref whose public moveResizedChanged
    // signal fired. Signal-driven recursion guard: suppress
    // adapter-originated neighbour geometry events (synchronous own-write
    // reentrancy plus async events for written neighbours showing their
    // desired rects) while unrelated native geometry or live-state drift
    // invalidates the active gesture. The native-driven interactive source
    // rect is expected to progress and never invalidates here.
    windowGeometryChanged(source: unknown): void {
        if (!this.enabled) {
            return;
        }
        if (this.suppressing) {
            return;
        }
        const gesture = this.gesture;
        if (gesture === null || gesture.kind !== "resize") {
            return;
        }
        if (typeof source !== "object" || source === null) {
            return;
        }
        if (source === gesture.sourceRef) {
            return;
        }
        let fresh: PointerResizeObserved | null = null;
        try {
            fresh = this.readObserved();
        } catch (error) {
            void error;
            fresh = null;
        }
        if (fresh === null) {
            const lost = this.pendingPlanned;
            if (lost !== null) {
                this.reportAdapterLost(lost);
            }
            this.failApply("pointer-signal-invalid");
            return;
        }
        let liveId: string | null = null;
        let liveRect: PointerResizeRect | null = null;
        for (const entry of fresh.windows) {
            if (entry.ref === source) {
                liveId = entry.id;
                liveRect = entry.rect;
                break;
            }
        }
        if (liveId === null || liveRect === null) {
            const lost = this.pendingPlanned;
            if (lost !== null) {
                this.reportAdapterLost(lost);
            }
            this.failApply("pointer-signal-invalid");
            return;
        }
        // Own-neighbour event: a written neighbour showing its desired rect
        // is suppressed. An unwritten neighbour still matching its captured
        // scope rect carries no drift and is ignored.
        const wantWritten = this.appliedDesired.get(liveId);
        if (wantWritten !== undefined) {
            if (sameRect(wantWritten, liveRect)) {
                return;
            }
        } else {
            let captured: PointerResizeRect | null = null;
            for (const entry of gesture.observed.windows) {
                if (entry.id === liveId) {
                    captured = entry.rect;
                    break;
                }
            }
            if (captured !== null && sameRect(captured, liveRect)) {
                return;
            }
        }
        // Live-state drift (e.g. source no longer in resize) also
        // invalidates; otherwise the rect mismatch above already proves
        // unrelated native geometry drift.
        const lost = this.pendingPlanned;
        if (lost !== null) {
            this.reportAdapterLost(lost);
        }
        this.failApply("pointer-signal-invalid");
    }

    private checkAuthority(token: string): boolean {
        let authority = false;
        try {
            authority = this.env.hasExclusiveResizeAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reject(token);
            this.disable();
            return false;
        }
        return true;
    }

    private readObserved(): PointerResizeObserved | null {
        let observed: PointerResizeObserved | null = null;
        try {
            observed = this.env.observe();
        } catch (error) {
            void error;
            observed = null;
        }
        if (!validateObserved(observed)) {
            return null;
        }
        return observed as PointerResizeObserved;
    }

    private readState(target: object): PointerResizeLiveState | null {
        let state: PointerResizeLiveState | null = null;
        try {
            state = this.env.readLiveState(target);
        } catch (error) {
            void error;
            return null;
        }
        if (state === null || typeof state !== "object") {
            return null;
        }
        if (state.move !== true && state.move !== false) {
            return null;
        }
        if (state.resize !== true && state.resize !== false) {
            return null;
        }
        return state;
    }

    // Own-scope revalidation: authority already checked by callers; here the
    // fresh observation must bind the captured membership, domains, focus,
    // source identity, and every non-source rect. The interactive source
    // rect is natively driven and exempt from rect matching.
    private scopeMatches(fresh: PointerResizeObserved, gesture: PointerGesture): boolean {
        if (
            fresh.domainOutput !== gesture.domainOutput ||
            fresh.domainWorkspace !== gesture.domainWorkspace ||
            fresh.focusedId !== gesture.focusedId ||
            fresh.fingerprint !== gesture.fingerprint
        ) {
            return false;
        }
        let sourceFound = false;
        const capturedRects = new Map<string, PointerResizeRect>();
        for (const entry of gesture.observed.windows) {
            if (entry.id !== gesture.sourceId) {
                capturedRects.set(entry.id, entry.rect);
            }
        }
        for (const entry of fresh.windows) {
            if (entry.id === gesture.sourceId) {
                if (entry.ref !== gesture.sourceRef) {
                    return false;
                }
                sourceFound = true;
                continue;
            }
            const want = capturedRects.get(entry.id);
            if (want === undefined || !sameRect(want, entry.rect)) {
                return false;
            }
        }
        if (!sourceFound) {
            return false;
        }
        let ok = false;
        try {
            ok = fresh.revalidate(gesture.sourceId) === true;
        } catch (error) {
            void error;
            ok = false;
        }
        return ok;
    }

    private sendRequest(
        observed: PointerResizeObserved,
        gesture: PointerGesture,
        direction: PointerResizeDirection,
        boundary: number,
    ): void {
        if (this.seq < 0 || this.seq > POINTER_RESIZE_MAX_SEQ) {
            this.reject("pointer-seq-exhausted");
            this.disable();
            return;
        }
        const correlation = `${this.generation}-p${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("pointer-invalid-auth");
            this.disable();
            return;
        }
        const windows = observed.windows.map((entry) => ({
            window: entry.id,
            output: entry.output,
            workspace: entry.workspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        const sortedIds = observed.windows.map((entry) => entry.id).sort();
        let requestRevision = this.revision;
        if (requestRevision === 0) {
            requestRevision = sortedIds.length;
            this.revision = requestRevision;
        }
        const fingerprint = pointerResizeFingerprint(
            observed.domainOutput,
            observed.domainWorkspace,
            observed.focusedId,
            sortedIds,
        );
        let payload = "";
        try {
            // Pointer wire carries no keyboard mode/press_index: Rust
            // PointerRequestDto (src/resize_service.rs) defines no mode field
            // with deny_unknown_fields, evaluate_pointer_request never parses
            // mode, and session.propose_pointer_resize derives from direction
            // plus proposed_boundary only. The neutral/unused mode "outwards"
            // plus press_index 0 live only in Rust's internal seeding
            // RequestDto, never on this wire, so no keyboard step is invented.
            payload = JSON.stringify({
                v: POINTER_RESIZE_CONTRACT_VERSION,
                action: "request-pointer",
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                revision: requestRevision,
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
                direction,
                proposed_boundary: boundary,
                windows,
                capabilities: { keyboard_resize: true },
            });
        } catch (error) {
            void error;
            this.reject("pointer-invalid-intent");
            return;
        }
        if (payload.length > POINTER_RESIZE_MAX_REQUEST_BYTES) {
            this.reject("pointer-oversized");
            return;
        }
        gesture.lastBoundary = { direction, boundary };
        this.startFlight(payload, correlation, direction, requestRevision);
    }

    private startFlight(
        payload: string,
        correlation: string,
        direction: PointerResizeDirection,
        requestRevision: number,
    ): void {
        this.inFlight = true;
        this.pendingPlanned = null;
        this.flightDirection = direction;
        this.flightRevision = requestRevision;
        this.lossReported = false;
        this.appliedDesired.clear();
        this.callbackSeen = false;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(POINTER_RESIZE_TIMEOUT_MS, () => this.onTimeout(flight, "request"));
        } catch (error) {
            void error;
            this.inFlight = false;
            this.reject("pointer-timer-failed");
            this.disable();
            return;
        }
        this.cancelTimer = cancel;
        try {
            this.env.callDbus(
                POINTER_RESIZE_SERVICE,
                POINTER_RESIZE_OBJECT,
                POINTER_RESIZE_INTERFACE,
                POINTER_RESIZE_METHOD,
                payload,
                (reply) => this.onRequestReply(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.reject("pointer-dbus-failed");
            this.disable();
        }
    }

    private onTimeout(flight: number, stage: string): void {
        if (!this.inFlight || flight !== this.activeToken) {
            return;
        }
        const lost = this.pendingPlanned;
        if (lost !== null) {
            this.reportAdapterLost(lost);
        }
        this.clearTimer();
        this.inFlight = false;
        this.pendingPlanned = null;
        this.pendingStep = null;
        this.flightDirection = null;
        this.flightRevision = 0;
        this.reject(`pointer-timeout-${stage}`);
        this.disable();
    }

    private onRequestReply(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        if (typeof reply !== "string" || reply.length > POINTER_RESIZE_MAX_REPLY_BYTES) {
            this.inFlight = false;
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.inFlight = false;
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed)) {
            this.inFlight = false;
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "noop") {
            if (parsed["v"] !== POINTER_RESIZE_CONTRACT_VERSION) {
                this.inFlight = false;
                this.reject("pointer-service-fault");
                this.disable();
                return;
            }
            if (parsed["correlation_id"] !== correlation) {
                this.inFlight = false;
                this.reject("pointer-correlation-mismatch");
                this.disable();
                return;
            }
            this.inFlight = false;
            this.pendingPlanned = null;
            this.flightDirection = null;
            this.flightRevision = 0;
            this.log(`${POINTER_LOG}:noop`);
            this.settleFlight();
            return;
        }
        if (outcome === "rejected") {
            this.inFlight = false;
            this.pendingPlanned = null;
            this.pendingStep = null;
            this.reject("pointer-rejected");
            this.disable();
            return;
        }
        if (outcome === "diverged") {
            this.inFlight = false;
            this.pendingPlanned = null;
            this.pendingStep = null;
            this.reject("pointer-diverged");
            this.disable();
            return;
        }
        if (outcome !== "planned") {
            this.inFlight = false;
            this.pendingPlanned = null;
            this.pendingStep = null;
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        const planned = validatePlanned(parsed, correlation);
        if (planned === null) {
            this.inFlight = false;
            this.pendingPlanned = null;
            this.pendingStep = null;
            this.reject("pointer-precondition-mismatch");
            this.disable();
            return;
        }
        if (planned.baseRevision !== this.flightRevision) {
            this.inFlight = false;
            this.pendingPlanned = null;
            this.pendingStep = null;
            this.reject("pointer-revision-mismatch");
            this.disable();
            return;
        }
        // Geometry must cover exactly the gesture window set: no partial,
        // no extra, no unknown windows.
        const gesture = this.gesture;
        if (gesture !== null) {
            const observedIds = new Set(gesture.observed.windows.map((entry) => entry.id));
            if (planned.geometry.length !== observedIds.size) {
                this.inFlight = false;
                this.pendingPlanned = null;
                this.pendingStep = null;
                this.reject("pointer-precondition-mismatch");
                this.disable();
                return;
            }
            for (const entry of planned.geometry) {
                if (!observedIds.has(entry.window)) {
                    this.inFlight = false;
                    this.pendingPlanned = null;
                    this.pendingStep = null;
                    this.reject("pointer-precondition-mismatch");
                    this.disable();
                    return;
                }
                if (entry.output !== gesture.domainOutput || entry.workspace !== gesture.domainWorkspace) {
                    this.inFlight = false;
                    this.pendingPlanned = null;
                    this.pendingStep = null;
                    this.reject("pointer-precondition-mismatch");
                    this.disable();
                    return;
                }
            }
            if (
                planned.focus.domainOutput !== gesture.domainOutput ||
                planned.focus.domainWorkspace !== gesture.domainWorkspace
            ) {
                this.inFlight = false;
                this.pendingPlanned = null;
                this.pendingStep = null;
                this.reject("pointer-precondition-mismatch");
                this.disable();
                return;
            }
        }
        this.pendingPlanned = planned;
        this.applyPlanned(flight);
    }

    private applyPlanned(flight: number): void {
        const planned = this.pendingPlanned;
        const gesture = this.gesture;
        const wantedDirection = this.flightDirection;
        if (planned === null || gesture === null || gesture.kind !== "resize" || wantedDirection === null) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-target-mismatch");
            return;
        }
        // The planned operation must name the focused window and direction.
        const operation = planned.operation;
        if (
            operation["focused_window"] !== gesture.focusedId ||
            operation["direction"] !== wantedDirection ||
            operation["domain_output"] !== gesture.domainOutput ||
            operation["domain_workspace"] !== gesture.domainWorkspace
        ) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-target-mismatch");
            return;
        }
        if (!this.checkApplyAuthority(planned)) {
            return;
        }
        const fresh = this.readObserved();
        if (fresh === null) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-stale-scope");
            return;
        }
        if (!this.scopeMatches(fresh, gesture)) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-stale-revalidate");
            return;
        }
        // Apply only changed planned neighbours (never the native-driven
        // source) in deterministic shared order.
        const oldById = new Map<string, PointerResizeRect>();
        for (const entry of fresh.windows) {
            if (entry.id !== gesture.sourceId) {
                oldById.set(entry.id, entry.rect);
            }
        }
        const neighbours: PointerResizeDesired[] = [];
        for (const entry of planned.geometry) {
            if (entry.window !== gesture.sourceId) {
                neighbours.push(entry);
            }
        }
        const ordered = orderPointerWrites(oldById, neighbours);
        const byId = new Map<string, object>();
        for (const entry of fresh.windows) {
            byId.set(entry.id, entry.ref);
        }
        const desiredById = new Map<string, PointerResizeDesired>();
        for (const entry of planned.geometry) {
            desiredById.set(entry.window, entry);
        }
        const capturedRects = new Map<string, PointerResizeRect>();
        for (const entry of gesture.observed.windows) {
            if (entry.id !== gesture.sourceId) {
                capturedRects.set(entry.id, entry.rect);
            }
        }
        this.suppressing = false;
        let partial = false;
        let partialToken = "pointer-partial-apply";
        const writtenIds = new Set<string>();
        for (const entry of ordered) {
            if (!this.enabled || !this.inFlight || this.gesture !== gesture) {
                partial = true;
                partialToken = "pointer-signal-invalid";
                break;
            }
            const target = byId.get(entry.window);
            if (typeof target !== "object" || target === null) {
                partial = true;
                break;
            }
            // Exact target identity before each write.
            let liveRef: object | null = null;
            try {
                const refetch = this.env.observe();
                if (refetch !== null) {
                    for (const candidate of refetch.windows) {
                        if (candidate.id === entry.window) {
                            liveRef = candidate.ref;
                            break;
                        }
                    }
                }
            } catch (error) {
                void error;
                liveRef = null;
            }
            if (liveRef !== target) {
                partial = true;
                break;
            }
            if (!this.checkApplyAuthoritySilent()) {
                this.reportAdapterLost(planned);
                this.failApply("pointer-exclusive-conflict");
                return;
            }
            if (!rectContained(entry.rect, gesture.domainBounds)) {
                partial = true;
                break;
            }
            // Guard only the synchronous own-write emission: suppression
            // covers the setGeometry call itself.
            let written = false;
            this.suppressing = true;
            try {
                written = this.env.setGeometry(target, entry.rect) === true;
            } catch (error) {
                void error;
                written = false;
            } finally {
                this.suppressing = false;
            }
            if (!written) {
                partial = true;
                break;
            }
            writtenIds.add(entry.window);
            this.appliedDesired.set(entry.window, { ...entry.rect });
            // Active-transaction revalidation from public state: written
            // neighbours must show their desired rects, every other
            // neighbour must still match the captured scope, and the source
            // must still resolve to the exact gesture ref (its rect stays
            // natively owned).
            try {
                const refetch = this.env.observe();
                if (refetch === null) {
                    partial = true;
                    partialToken = "pointer-signal-invalid";
                    break;
                }
                if (refetch.windows.length !== gesture.observed.windows.length) {
                    partial = true;
                    partialToken = "pointer-signal-invalid";
                    break;
                }
                for (const candidate of refetch.windows) {
                    if (candidate.id === gesture.sourceId) {
                        if (candidate.ref !== gesture.sourceRef) {
                            partial = true;
                            partialToken = "pointer-signal-invalid";
                            break;
                        }
                        continue;
                    }
                    const want = writtenIds.has(candidate.id)
                        ? (desiredById.get(candidate.id) as PointerResizeDesired).rect
                        : capturedRects.get(candidate.id);
                    if (want === undefined || !sameRect(want, candidate.rect)) {
                        partial = true;
                        partialToken = "pointer-signal-invalid";
                        break;
                    }
                }
                if (partial) {
                    break;
                }
            } catch (error) {
                void error;
                partial = true;
                partialToken = "pointer-signal-invalid";
                break;
            }
        }
        this.suppressing = false;
        void flight;
        if (partial) {
            this.reportAdapterLost(planned);
            this.failApply(partialToken);
            return;
        }
        this.sendAcknowledge(flight, planned);
    }

    private checkApplyAuthority(planned: PlannedPointer): boolean {
        let authority = false;
        try {
            authority = this.env.hasExclusiveResizeAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-exclusive-conflict");
            return false;
        }
        return true;
    }

    private checkApplyAuthoritySilent(): boolean {
        try {
            return this.env.hasExclusiveResizeAuthority() === true;
        } catch (error) {
            void error;
            return false;
        }
    }

    private failApply(token: string): void {
        this.inFlight = false;
        this.pendingPlanned = null;
        this.pendingStep = null;
        this.flightDirection = null;
        this.flightRevision = 0;
        this.suppressing = false;
        this.appliedDesired.clear();
        this.reject(token);
        this.disable();
    }

    private sendAcknowledge(flight: number, planned: PlannedPointer): void {
        void flight;
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: POINTER_RESIZE_CONTRACT_VERSION,
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
            this.failApply("pointer-service-fault");
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(POINTER_RESIZE_TIMEOUT_MS, () => this.onTimeout(next, "ack"));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.failApply("pointer-timer-failed");
            return;
        }
        this.cancelTimer = cancel;
        try {
            this.env.callDbus(
                POINTER_RESIZE_SERVICE,
                POINTER_RESIZE_OBJECT,
                POINTER_RESIZE_INTERFACE,
                POINTER_RESIZE_METHOD,
                payload,
                (reply) => this.onAckReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.reportAdapterLost(planned);
            this.failApply("pointer-dbus-failed");
        }
    }

    private onAckReply(reply: unknown, flight: number, planned: PlannedPointer): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        if (typeof reply !== "string" || reply.length > POINTER_RESIZE_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.failApply("pointer-service-fault");
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "acknowledged") {
            this.reportAdapterLost(planned);
            this.failApply("pointer-service-fault");
            return;
        }
        if (parsed["v"] !== POINTER_RESIZE_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-service-fault");
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-correlation-mismatch");
            return;
        }
        if (parsed["base_revision"] !== planned.baseRevision) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-revision-mismatch");
            return;
        }
        this.sendVerify(planned);
    }

    private sendVerify(planned: PlannedPointer): void {
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        const gesture = this.gesture;
        if (gesture === null || gesture.kind !== "resize") {
            this.reportAdapterLost(planned);
            this.failApply("pointer-target-mismatch");
            return;
        }
        const fresh = this.readObserved();
        if (fresh === null) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-post-stale");
            return;
        }
        let ok = false;
        try {
            ok = fresh.revalidate(gesture.sourceId) === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-post-stale");
            return;
        }
        if (
            fresh.domainOutput !== planned.focus.domainOutput ||
            fresh.domainWorkspace !== planned.focus.domainWorkspace ||
            fresh.focusedId !== gesture.focusedId
        ) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-post-mismatch");
            return;
        }
        // Post-observation must project exactly to the desired geometry,
        // freshly observed for both the native-driven source and the
        // adapter-written neighbours.
        const freshById = new Map<string, PointerResizeObservedWindow>();
        for (const entry of fresh.windows) {
            freshById.set(entry.id, entry);
        }
        if (freshById.size !== planned.geometry.length) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-post-mismatch");
            return;
        }
        const leafByWindow = new Map<string, string>();
        for (const entry of planned.geometry) {
            leafByWindow.set(entry.window, entry.leaf);
        }
        const verifiedGeometry: Array<Record<string, unknown>> = [];
        for (const entry of planned.geometry) {
            const live = freshById.get(entry.window);
            if (live === undefined) {
                this.reportAdapterLost(planned);
                this.failApply("pointer-post-mismatch");
                return;
            }
            if (!sameRect(live.rect, entry.rect)) {
                this.reportAdapterLost(planned);
                this.failApply("pointer-post-mismatch");
                return;
            }
            if (live.output !== entry.output || live.workspace !== entry.workspace) {
                this.reportAdapterLost(planned);
                this.failApply("pointer-post-mismatch");
                return;
            }
            verifiedGeometry.push({
                window: live.id,
                leaf: leafByWindow.get(live.id) as string,
                output: live.output,
                workspace: live.workspace,
                rect: { x: live.rect.x, y: live.rect.y, w: live.rect.w, h: live.rect.h },
            });
        }
        let activeRef: object | null = null;
        try {
            activeRef = this.env.active();
        } catch (error) {
            void error;
            activeRef = null;
        }
        const focusedRef = freshById.get(gesture.focusedId)?.ref ?? null;
        if (activeRef !== focusedRef || focusedRef === null) {
            this.reportAdapterLost(planned);
            this.failApply("pointer-post-mismatch");
            return;
        }
        const sortedIds = fresh.windows.map((entry) => entry.id).sort();
        const fingerprint = pointerResizeFingerprint(
            planned.focus.domainOutput,
            planned.focus.domainWorkspace,
            gesture.focusedId,
            sortedIds,
        );
        let payload = "";
        try {
            payload = JSON.stringify({
                v: POINTER_RESIZE_CONTRACT_VERSION,
                action: "verify",
                correlation_id: planned.correlationId,
                owner: this.owner,
                generation: this.generation,
                revision: planned.baseRevision,
                fingerprint,
                verified: true,
                verified_preconditions: [...planned.preconditions],
                verified_operation: { ...(planned.operation as Record<string, unknown>) },
                verified_geometry: verifiedGeometry,
                verified_focus: {
                    domain_output: planned.focus.domainOutput,
                    domain_workspace: planned.focus.domainWorkspace,
                    leaf: planned.focus.leaf,
                },
            });
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.failApply("pointer-service-fault");
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(POINTER_RESIZE_TIMEOUT_MS, () => this.onTimeout(next, "verify"));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.failApply("pointer-timer-failed");
            return;
        }
        this.cancelTimer = cancel;
        try {
            this.env.callDbus(
                POINTER_RESIZE_SERVICE,
                POINTER_RESIZE_OBJECT,
                POINTER_RESIZE_INTERFACE,
                POINTER_RESIZE_METHOD,
                payload,
                (reply) => this.onVerifyReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.reportAdapterLost(planned);
            this.failApply("pointer-dbus-failed");
        }
    }

    private onVerifyReply(reply: unknown, flight: number, planned: PlannedPointer): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        this.inFlight = false;
        this.pendingPlanned = null;
        this.flightDirection = null;
        if (typeof reply !== "string" || reply.length > POINTER_RESIZE_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "committed") {
            this.reportAdapterLost(planned);
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        if (parsed["v"] !== POINTER_RESIZE_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.reject("pointer-service-fault");
            this.disable();
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.reject("pointer-correlation-mismatch");
            this.disable();
            return;
        }
        const revision = parsed["revision"];
        if (
            typeof revision === "number" &&
            Number.isInteger(revision) &&
            revision === this.flightRevision + 1
        ) {
            this.revision = revision;
        } else {
            this.reportAdapterLost(planned);
            this.reject("pointer-revision-mismatch");
            this.disable();
            return;
        }
        this.flightRevision = 0;
        this.appliedDesired.clear();
        this.log(`${POINTER_LOG}:applied`);
        if (!this.refreshCapture(this.gesture, planned)) {
            this.pendingStep = null;
            this.reject("pointer-scope-changed");
            this.disable();
            return;
        }
        this.settleFlight();
    }

    // After a commit the gesture capture must advance: neighbours now
    // legitimately show the committed plan, so the stale start capture is
    // replaced by a fresh observation bound to that plan. Anything else
    // (membership, domain, focus, source identity, neighbour drift) fails
    // closed without an adapter-lost report: Rust already committed and
    // holds no pending plan.
    private refreshCapture(gesture: PointerGesture | null, planned: PlannedPointer): boolean {
        if (gesture === null || gesture.kind !== "resize") {
            return false;
        }
        const fresh = this.readObserved();
        if (fresh === null) {
            return false;
        }
        if (
            fresh.domainOutput !== gesture.domainOutput ||
            fresh.domainWorkspace !== gesture.domainWorkspace ||
            fresh.focusedId !== gesture.focusedId
        ) {
            return false;
        }
        const plannedById = new Map<string, PointerResizeDesired>();
        for (const entry of planned.geometry) {
            plannedById.set(entry.window, entry);
        }
        if (fresh.windows.length !== plannedById.size) {
            return false;
        }
        for (const entry of fresh.windows) {
            const want = plannedById.get(entry.id);
            if (want === undefined) {
                return false;
            }
            if (entry.output !== want.output || entry.workspace !== want.workspace) {
                return false;
            }
            if (entry.id === gesture.sourceId) {
                if (entry.ref !== gesture.sourceRef) {
                    return false;
                }
                continue;
            }
            if (!sameRect(entry.rect, want.rect)) {
                return false;
            }
        }
        let ok = false;
        try {
            ok = fresh.revalidate(gesture.sourceId) === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            return false;
        }
        gesture.observed = fresh;
        gesture.fingerprint = fresh.fingerprint;
        return true;
    }

    // After a flight resolves without terminal failure: send the coalesced
    // latest step when one exists (never stale intermediates), else close a
    // finished gesture. The gesture stays open for further steps otherwise.
    private settleFlight(): void {
        const gesture = this.gesture;
        const step = this.pendingStep;
        this.pendingStep = null;
        if (gesture === null || gesture.kind !== "resize") {
            return;
        }
        if (step !== null) {
            if (!this.checkAuthority("pointer-exclusive-conflict")) {
                return;
            }
            const fresh = this.readObserved();
            if (fresh === null || !this.scopeMatches(fresh, gesture)) {
                this.reject("pointer-stale-scope");
                this.disable();
                return;
            }
            if (gesture.direction !== null && gesture.direction !== step.direction) {
                this.reject("pointer-direction-drift");
                this.disable();
                return;
            }
            gesture.direction = step.direction;
            this.sendRequest(fresh, gesture, step.direction, step.boundary);
            return;
        }
        if (gesture.finished) {
            this.gesture = null;
            this.log(`${POINTER_LOG}:finished`);
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

    private reject(token: string): void {
        try {
            this.env.log(`${POINTER_LOG}:reject:${token}`);
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
