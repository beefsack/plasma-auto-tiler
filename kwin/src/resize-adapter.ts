// Bounded static keyboard resize adapter (standalone, opt-in only).
//
// Product-shaped but with no normal startup route: ordinary production
// startup never runs this module (src/entry.ts must not import it, and no
// controller route under src/controller*.ts may import it or reference the
// DescribeResize route; the module constraints below are the explicit future
// wiring contract). The only activation is the explicit exported
// ResizeAdapter class plus the separate entry helper, called by no
// production source.
//
// Future exclusive wiring contract: any future caller must supply an explicit
// hasExclusiveResizeAuthority boundary proving no prior handler runs in the
// same call for the same command domain; the adapter rechecks it before the
// request and again before native writes, and the entry requires it as a
// function (never a bare boolean). A false value rejects before any native
// write so legacy resize and geometry authority cannot co-exist. The module
// never reads, mirrors, or mutates the legacy tiling tree and never falls
// back.
//
// Rust owns normalized domains, resize intent, capabilities, preconditions,
// revision binding, and reconciliation via the narrow JSON action protocol.
// This module owns KWin observation, native identity mapping, revalidation,
// sequential native frameGeometry writes, focus retention, signals, and
// post-observation. One exact owner/generation binding, one in-flight command,
// one direction per request. Any owner, service, correlation, revision,
// precondition, eligibility, geometry, focus, or post-observation fault fails
// closed and disables. All logs are fixed redacted tokens carrying no
// captions, app ids, native ids, PIDs, paths, owners, or raw extents. Only
// minimal public events are used and all are detached on disable. No polling.
//
// Native writes are non-atomic: exact frameGeometry rectangles are applied
// sequentially in a deterministic native-boundary order (growing covering
// rectangles first, stable lexical tie-break), only when changed, then focus
// is retained on the focused window. There is no configure barrier and no
// timer polling; adapter-originated geometry signals are guarded while
// unrelated geometry changes invalidate terminally.

export const RESIZE_SERVICE = "org.plasmaautotiler.Planner";
export const RESIZE_OBJECT = "/org/plasmaautotiler/Planner";
export const RESIZE_INTERFACE = "org.plasmaautotiler.Planner1";
export const RESIZE_METHOD = "DescribeResize";

// Session D-Bus activation transport (one-flight, bounded, no poll/retry).
// Discovery is GetNameOwner on the well-known Planner name, pinned to one
// exact unique owner (`:N.M`) before any planner call. When absent, exactly
// one StartServiceByName(service, 0) phase runs, accepting only result codes
// 1 (PrimaryOwner) / 2 (AlreadyOwner), followed by exactly one more owner
// resolution and pin. Flags value 0 is fixed; the production entry appends
// it as the second native D-Bus argument.
export const RESIZE_DBUS_SERVICE = "org.freedesktop.DBus";
export const RESIZE_DBUS_OBJECT = "/org/freedesktop/DBus";
export const RESIZE_DBUS_INTERFACE = "org.freedesktop.DBus";
export const RESIZE_GET_OWNER_METHOD = "GetNameOwner";
export const RESIZE_START_METHOD = "StartServiceByName";
export const RESIZE_START_FLAGS = 0;
export const RESIZE_START_PRIMARY = 1;
export const RESIZE_START_ALREADY = 2;

export const RESIZE_CONTRACT_VERSION = 1;
export const RESIZE_MAX_REQUEST_BYTES = 64 * 1024;
export const RESIZE_MAX_REPLY_BYTES = 64 * 1024;
export const RESIZE_TIMEOUT_MS = 2000;
export const RESIZE_MAX_CORRELATION_LEN = 128;
export const RESIZE_MAX_OWNER_LEN = 128;
export const RESIZE_MAX_GENERATION_LEN = 64;
export const RESIZE_MAX_REVISION = 1000000;
export const RESIZE_MAX_ID_LEN = 128;
export const RESIZE_MAX_WINDOWS = 64;
export const RESIZE_MAX_GEOMETRY = 64;
export const RESIZE_MAX_SHARES = 64;
export const RESIZE_MAX_SEQ = 1000000;

import { orderGeometryWrites } from "./geometry-order";

const LOG_PREFIX = "plasma-auto-tiler:resize";

import { formatRouteDiag } from "./route-diag";

export type ResizeDirection = "left" | "right" | "up" | "down";
export type ResizeMode = "inwards" | "outwards";
export type ResizeSignal = "active" | "added" | "removed" | "output" | "desktop" | "geometry";

export interface ResizeRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface ResizeObservedWindow {
    readonly id: string;
    readonly ref: object;
    readonly rect: ResizeRect;
    readonly output: string;
    readonly workspace: string;
}

export interface ResizeObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: ResizeRect;
    readonly domainGap: number;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<ResizeObservedWindow>;
    readonly activeRef: object | null;
    readonly fingerprint: string;
    readonly revalidate: () => boolean;
}

export interface ResizeAdapterEnv {
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
    readonly observe: () => ResizeObserved | null;
    readonly setGeometry: (target: object, rect: ResizeRect) => boolean;
    readonly setActive: (target: object) => boolean;
    readonly active: () => object | null;
    readonly hasExclusiveResizeAuthority: () => boolean;
    readonly subscribe: (kind: ResizeSignal, handler: () => void) => () => void;
}

export interface ResizeDesired {
    readonly window: string;
    readonly leaf: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: ResizeRect;
}

export interface ResizeDesiredFocus {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly leaf: string;
}

// Deterministic bounded observation fingerprint (FNV-1a 32-bit over
// `output\x1fworkspace\x1ffocused\x1fids...`, sorted ids). Mirrors the Rust
// resize_fingerprint binding exactly; sent as the numeric fingerprint.
export function resizeFingerprint(
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
    if (typeof value !== "string" || value.length === 0 || value.length > RESIZE_MAX_ID_LEN) {
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
        value.length <= RESIZE_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= RESIZE_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > RESIZE_MAX_GENERATION_LEN) {
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
        value <= RESIZE_MAX_REVISION
    );
}

function isDirection(value: unknown): value is ResizeDirection {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isResizeMode(value: unknown): value is ResizeMode {
    return value === "inwards" || value === "outwards";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInt(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isTargetRect(value: unknown): value is ResizeRect {
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

function sameRect(a: ResizeRect, b: ResizeRect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function rectContained(inner: ResizeRect, outer: ResizeRect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.w <= outer.x + outer.w &&
        inner.y + inner.h <= outer.y + outer.h
    );
}

const RESIZE_KIND = "ResizeSplitShare";
const RESIZE_CAPABILITY = "keyboard-resize";
const RESIZE_PRECONDITIONS: readonly string[] = Object.freeze([
    "focused-leaf-occupied-by-focused-window",
    "target-boundary-valid",
    "resize-targets-same-domain",
    "adapter-must-verify-postconditions",
]);
const RESIZE_OPERATION_KEYS: readonly string[] = Object.freeze([
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
    if (!Array.isArray(value) || value.length < 2 || value.length > RESIZE_MAX_SHARES) {
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
    if (!hasExactKeys(operation, RESIZE_OPERATION_KEYS)) {
        return false;
    }
    if (operation["kind"] !== RESIZE_KIND) {
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
    if (!isResizeMode(operation["mode"])) {
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
    let same = true;
    for (let index = 0; index < oldShares.length; index += 1) {
        if (oldShares[index] !== newShares[index]) {
            same = false;
            break;
        }
    }
    return !same;
}

function validateGeometryEntry(value: unknown): value is ResizeDesired {
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

function validateDesiredFocus(value: unknown): value is ResizeDesiredFocus {
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

interface PlannedResize {
    readonly correlationId: string;
    readonly baseRevision: number;
    readonly preconditions: ReadonlyArray<string>;
    readonly operation: Record<string, unknown>;
    readonly geometry: ReadonlyArray<ResizeDesired>;
    readonly focus: ResizeDesiredFocus;
}

function validatePlanned(reply: unknown, correlationId: string): PlannedResize | null {
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
    if (reply["v"] !== RESIZE_CONTRACT_VERSION) {
        return null;
    }
    if (reply["correlation_id"] !== correlationId) {
        return null;
    }
    if (reply["outcome"] !== "planned") {
        return null;
    }
    if (reply["capability"] !== RESIZE_CAPABILITY) {
        return null;
    }
    const preconditions = reply["preconditions"];
    if (!Array.isArray(preconditions) || preconditions.length !== RESIZE_PRECONDITIONS.length) {
        return null;
    }
    for (let index = 0; index < RESIZE_PRECONDITIONS.length; index += 1) {
        if (preconditions[index] !== RESIZE_PRECONDITIONS[index]) {
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
    if (!Array.isArray(geometryRaw) || geometryRaw.length === 0 || geometryRaw.length > RESIZE_MAX_GEOMETRY) {
        return null;
    }
    const geometry: ResizeDesired[] = [];
    const seenWindow = new Set<string>();
    for (const entry of geometryRaw) {
        if (!validateGeometryEntry(entry)) {
            return null;
        }
        const typed = entry as unknown as ResizeDesired;
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

function validateObserved(observed: ResizeObserved | null): observed is ResizeObserved {
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
    if (windows.length === 0 || windows.length > RESIZE_MAX_WINDOWS) {
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
        const candidate = entry as ResizeObservedWindow;
        if (!isOpaqueId(candidate.id) || typeof candidate.ref !== "object" || candidate.ref === null) {
            return false;
        }
        // Single-domain static resize: every observed window must live in the
        // request domain. Anything else is a cross-domain mismatch.
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
// grow-before-shrink order via geometry-order (same as movement).
// Preserves the existing resize entry point and behavior exactly.
export function orderResizeWrites(
    oldById: ReadonlyMap<string, ResizeRect>,
    desired: ReadonlyArray<ResizeDesired>,
): ReadonlyArray<ResizeDesired> {
    return orderGeometryWrites(oldById, desired);
}

export interface ResizeEnableAuth {
    readonly owner: unknown;
    readonly generation: unknown;
    readonly revision?: unknown;
}

export class ResizeAdapter {
    private enabled = false;
    private owner = "";
    private generation = "";
    private revision = 0;
    // Shared one-session revision binding: when the authority passes a
    // holder object, all four slices read and advance the same counter so
    // sequential commands across slices bind the single Rust revision. A
    // plain number keeps the previous per-adapter behavior.
    private revisionBinding: { current: number } | null = null;

    private isSharedRevisionBinding(value: unknown): value is { current: number } {
        if (typeof value !== "object" || value === null) {
            return false;
        }
        return typeof (value as Record<string, unknown>)["current"] === "number";
    }

    private readRevision(): number {
        if (this.revisionBinding !== null) {
            return this.revisionBinding.current;
        }
        return this.revision;
    }

    private writeRevision(value: number): void {
        this.revision = value;
        if (this.revisionBinding !== null) {
            this.revisionBinding.current = value;
        }
    }
    private inFlight = false;
    private token = 0;
    private activeToken = 0;
    private callbackSeen = false;
    private cancelTimer: (() => void) | null = null;
    private detaches: Array<() => void> = [];
    private invalidated = false;
    private suppressing = false;
    private seq = 0;
    private lastFingerprint = "";
    private lastDirection = "";
    private lastMode = "";
    private lastPressIndex = -1;
    private repeatFocused: string | null = null;
    private repeatDirection: ResizeDirection | null = null;
    private repeatMode: ResizeMode | null = null;
    private repeatNext = 0;
    private pending: PlannedResize | null = null;
    private pendingObserved: ResizeObserved | null = null;
    private pendingDirection: ResizeDirection | null = null;
    private pendingMode: ResizeMode | null = null;
    private pendingFocused: string | null = null;
    private lossReported = false;
    // Session D-Bus activation pin: exact planner unique owner (`:N.M`)
    // resolved via GetNameOwner (plus one StartServiceByName phase only when
    // absent) before any planner call. Null means unpinned; planner calls
    // never fall back to the well-known name.
    private pinnedOwner: string | null = null;
    // 0 idle, 1 awaiting initial owner, 2 awaiting start result, 3 awaiting
    // post-start owner, 4 planner dispatched. Single flight, no retry.
    private activationStep = 0;

    constructor(private readonly env: ResizeAdapterEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    private clearDedup(): void {
        this.lastFingerprint = "";
        this.lastDirection = "";
        this.lastMode = "";
        this.lastPressIndex = -1;
        this.repeatFocused = null;
        this.repeatDirection = null;
        this.repeatMode = null;
        this.repeatNext = 0;
    }

    private reportAdapterLost(planned: PlannedResize | null): void {
        if (planned === null || this.lossReported) {
            return;
        }
        // Pinned-owner only: never fall back to the well-known name. When
        // unpinned (activation never completed) there is no endpoint to
        // notify, so stay fail-closed without transport.
        const target = this.pinnedOwner;
        if (!isUniqueOwner(target)) {
            return;
        }
        this.lossReported = true;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: RESIZE_CONTRACT_VERSION,
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
        if (payload.length === 0 || payload.length > RESIZE_MAX_REQUEST_BYTES) {
            return;
        }
        try {
            this.env.callDbus(
                target,
                RESIZE_OBJECT,
                RESIZE_INTERFACE,
                RESIZE_METHOD,
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

    enable(auth: ResizeEnableAuth): boolean {
        if (this.enabled) {
            return false;
        }
        if (!isRecord(auth as unknown as Record<string, unknown>)) {
            this.reject("resize-invalid-auth");
            return false;
        }
        if (!isOwnerId(auth.owner) || !isGeneration(auth.generation)) {
            this.reject("resize-invalid-auth");
            return false;
        }
        const revision = auth.revision === undefined ? 0 : auth.revision;
        if (this.isSharedRevisionBinding(revision)) {
            if (!isRevision(revision.current)) {
                this.reject("resize-invalid-auth");
                return false;
            }
        } else if (!isRevision(revision)) {
            this.reject("resize-invalid-auth");
            return false;
        }
        const kinds: readonly ResizeSignal[] = ["active", "added", "removed", "output", "desktop", "geometry"];
        const attached: Array<() => void> = [];
        for (const kind of kinds) {
            let detach: (() => void) | null = null;
            try {
                detach = this.env.subscribe(kind, () => this.onSignal(kind));
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
                this.reject("resize-signal-failed");
                return false;
            }
            attached.push(detach);
        }
        this.detaches = attached;
        this.owner = auth.owner as string;
        this.generation = auth.generation as string;
        if (this.isSharedRevisionBinding(revision)) {
            this.revisionBinding = revision;
            this.writeRevision(revision.current);
        } else {
            this.revisionBinding = null;
            this.revision = revision as number;
        }
        this.enabled = true;
        this.invalidated = false;
        this.suppressing = false;
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        this.pendingMode = null;
        this.pendingFocused = null;
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
        this.pendingMode = null;
        this.pendingFocused = null;
        this.suppressing = false;
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

    requestResize(direction: unknown, mode: unknown): void {
        if (!this.enabled) {
            this.reject("resize-disabled");
            return;
        }
        if (this.inFlight) {
            this.reject("resize-busy");
            return;
        }
        if (!isDirection(direction)) {
            this.reject("resize-invalid-intent");
            return;
        }
        // No compatibility default: missing/invalid mode rejects before D-Bus.
        if (!isResizeMode(mode)) {
            this.reject("resize-invalid-intent");
            return;
        }
        let authority = false;
        try {
            authority = this.env.hasExclusiveResizeAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reject("resize-exclusive-conflict");
            this.disable();
            return;
        }
        let observed: ResizeObserved | null = null;
        try {
            observed = this.env.observe();
        } catch (error) {
            void error;
            observed = null;
        }
        if (!validateObserved(observed)) {
            this.reject("resize-stale-scope");
            this.disable();
            return;
        }
        const current = observed as ResizeObserved;
        // Explicit portable key-repeat state per uninterrupted same
        // (focused window, edge, mode) stream: 0 is the initial press, then
        // incrementing. Resets when identity/edge/mode changes.
        let pressIndex = 0;
        if (
            this.repeatFocused === current.focusedId &&
            this.repeatDirection === direction &&
            this.repeatMode === mode
        ) {
            pressIndex = this.repeatNext;
        }
        // Dedup binds mode and repeat index so held-key repeats transmit
        // rather than incorrectly deduping on fingerprint+direction alone.
        if (
            current.fingerprint === this.lastFingerprint &&
            direction === this.lastDirection &&
            mode === this.lastMode &&
            pressIndex === this.lastPressIndex
        ) {
            this.reject("resize-dedup");
            return;
        }
        if (this.seq < 0 || this.seq > RESIZE_MAX_SEQ) {
            this.reject("resize-seq-exhausted");
            this.disable();
            return;
        }
        const correlation = `${this.generation}-r${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("resize-invalid-auth");
            this.disable();
            return;
        }
        const windows = current.windows.map((entry) => ({
            window: entry.id,
            output: entry.output,
            workspace: entry.workspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        const sortedIds = current.windows.map((entry) => entry.id).sort();
        let requestRevision = this.readRevision();
        if (requestRevision === 0) {
            requestRevision = sortedIds.length;
            // Shared trio holder must never be poisoned by a non-seed
            // revision: only the exact-three seed revision may be stored.
            // The wire still carries N so Rust rejects fail-closed;
            // standalone per-adapter revision keeps the previous N binding.
            if (this.revisionBinding !== null) {
                if (sortedIds.length === 3) {
                    this.writeRevision(requestRevision);
                }
            } else {
                this.writeRevision(requestRevision);
            }
        }
        const fingerprint = resizeFingerprint(
            current.domainOutput,
            current.domainWorkspace,
            current.focusedId,
            sortedIds,
        );
        let payload = "";
        try {
            payload = JSON.stringify({
                v: RESIZE_CONTRACT_VERSION,
                action: "request",
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                revision: requestRevision,
                fingerprint,
                domain: {
                    output: current.domainOutput,
                    workspace: current.domainWorkspace,
                    bounds: {
                        x: current.domainBounds.x,
                        y: current.domainBounds.y,
                        w: current.domainBounds.w,
                        h: current.domainBounds.h,
                    },
                    gap: current.domainGap,
                },
                focused_window: current.focusedId,
                direction,
                mode,
                press_index: pressIndex,
                windows,
                capabilities: { keyboard_resize: true, pointer_resize: false },
            });
        } catch (error) {
            void error;
            this.reject("resize-invalid-intent");
            return;
        }
        if (payload.length > RESIZE_MAX_REQUEST_BYTES) {
            this.reject("resize-oversized");
            return;
        }
        this.lastFingerprint = current.fingerprint;
        this.lastDirection = direction;
        this.lastMode = mode;
        this.lastPressIndex = pressIndex;
        this.repeatFocused = current.focusedId;
        this.repeatDirection = direction;
        this.repeatMode = mode;
        this.repeatNext = pressIndex + 1;
        this.diag("req", correlation, [
            ["rev", requestRevision],
            ["windows", sortedIds.length],
        ]);
        this.startFlight(payload, correlation, direction, mode, current);
    }

    private onSignal(kind: ResizeSignal): void {
        if (kind === "geometry" && this.suppressing) {
            return;
        }
        this.invalidated = true;
        // An invalidating signal breaks the uninterrupted repeat stream.
        this.clearDedup();
    }

    private startFlight(
        payload: string,
        correlation: string,
        direction: ResizeDirection,
        mode: ResizeMode,
        observed: ResizeObserved,
    ): void {
        this.inFlight = true;
        this.invalidated = false;
        this.suppressing = false;
        this.pending = null;
        this.pendingObserved = observed;
        this.pendingDirection = direction;
        this.pendingMode = mode;
        this.pendingFocused = observed.focusedId;
        this.lossReported = false;
        this.callbackSeen = false;
        this.pinnedOwner = null;
        this.activationStep = 1;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(RESIZE_TIMEOUT_MS, () => this.onTimeout(flight, "request", correlation));
        } catch (error) {
            void error;
            this.inFlight = false;
            this.activationStep = 0;
            this.diag("result", correlation, [["result", "timer-failed"]]);
            this.reject("resize-timer-failed");
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
                RESIZE_DBUS_SERVICE,
                RESIZE_DBUS_OBJECT,
                RESIZE_DBUS_INTERFACE,
                RESIZE_GET_OWNER_METHOD,
                RESIZE_SERVICE,
                (reply) => this.onOwnerInitial(reply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.diag("result", correlation, [["result", "dbus-failed"]]);
            this.reject("resize-dbus-failed");
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
            this.diag("owner", correlation, [["transition", "pinned"]]);
            this.sendPlannerRequest(flight, payload, correlation);
            return;
        }
        // Absent name: exactly one StartServiceByName(service, 0) phase. The
        // flags value 0 is fixed (RESIZE_START_FLAGS); the production entry
        // appends it as the second native D-Bus argument.
        this.activationStep = 2;
        this.diag("owner", correlation, [["transition", "activating"]]);
        try {
            this.env.callDbus(
                RESIZE_DBUS_SERVICE,
                RESIZE_DBUS_OBJECT,
                RESIZE_DBUS_INTERFACE,
                RESIZE_START_METHOD,
                RESIZE_SERVICE,
                (startReply) => this.onStartResult(startReply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.diag("result", correlation, [["result", "dbus-failed"]]);
            this.reject("resize-dbus-failed");
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
        if (reply !== RESIZE_START_PRIMARY && reply !== RESIZE_START_ALREADY) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMode = null;
            this.pendingFocused = null;
            this.diag("owner", correlation, [["transition", "activation-failed"]]);
            this.diag("result", correlation, [["result", "activation-failed"]]);
            this.reject("resize-activation-failed");
            this.disable();
            return;
        }
        // Exactly one bounded post-activation owner resolution, then pin
        // before any planner call. No retry on failure.
        this.activationStep = 3;
        try {
            this.env.callDbus(
                RESIZE_DBUS_SERVICE,
                RESIZE_DBUS_OBJECT,
                RESIZE_DBUS_INTERFACE,
                RESIZE_GET_OWNER_METHOD,
                RESIZE_SERVICE,
                (ownerReply) => this.onOwnerAfterStart(ownerReply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.diag("result", correlation, [["result", "dbus-failed"]]);
            this.reject("resize-dbus-failed");
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
            this.pendingMode = null;
            this.pendingFocused = null;
            this.diag("owner", correlation, [["transition", "owner-missing"]]);
            this.diag("result", correlation, [["result", "owner-missing"]]);
            this.reject("resize-owner-missing");
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
            this.diag("owner", correlation, [["transition", "owner-missing"]]);
            this.diag("result", correlation, [["result", "owner-missing"]]);
            this.reject("resize-owner-missing");
            this.disable();
            return;
        }
        try {
            this.env.callDbus(
                target,
                RESIZE_OBJECT,
                RESIZE_INTERFACE,
                RESIZE_METHOD,
                payload,
                (reply) => this.onRequestReply(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.diag("result", correlation, [["result", "dbus-failed"]]);
            this.reject("resize-dbus-failed");
            this.disable();
        }
    }

    private onTimeout(flight: number, stage: string, correlation?: string): void {
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
        this.pendingMode = null;
        this.pendingFocused = null;
        const timeoutCorr = correlation ?? lost?.correlationId;
        if (typeof timeoutCorr === "string" && timeoutCorr.length > 0) {
            this.diag("result", timeoutCorr, [
                ["result", "timeout"],
                ["detail", stage],
            ]);
        }
        this.reject(`resize-timeout-${stage}`);
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
        if (typeof reply !== "string" || reply.length > RESIZE_MAX_REPLY_BYTES) {
            this.inFlight = false;
            this.diag("result", correlation, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.inFlight = false;
            this.diag("result", correlation, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed)) {
            this.inFlight = false;
            this.diag("result", correlation, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "noop") {
            if (parsed["v"] !== RESIZE_CONTRACT_VERSION) {
                this.inFlight = false;
                this.diag("result", correlation, [["result", "service-fault"]]);
                this.reject("resize-service-fault");
                this.disable();
                return;
            }
            if (parsed["correlation_id"] !== correlation) {
                this.inFlight = false;
                this.diag("result", correlation, [["result", "correlation-mismatch"]]);
                this.reject("resize-correlation-mismatch");
                this.disable();
                return;
            }
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMode = null;
            this.pendingFocused = null;
            // Idle reset: drop the pin so the next idle command re-resolves
            // and re-pins. Adapter stays enabled (no disable here).
            this.pinnedOwner = null;
            this.activationStep = 0;
            this.diag("result", correlation, [["result", "noop"]]);
            this.log(`${LOG_PREFIX}:noop`);
            return;
        }
        if (outcome === "rejected") {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMode = null;
            this.pendingFocused = null;
            this.diag("result", correlation, [["result", "rejected"]]);
            this.reject("resize-rejected");
            this.disable();
            return;
        }
        if (outcome === "diverged") {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMode = null;
            this.pendingFocused = null;
            this.diag("result", correlation, [["result", "diverged"]]);
            this.reject("resize-diverged");
            this.disable();
            return;
        }
        if (outcome !== "planned") {
            this.inFlight = false;
            this.diag("result", correlation, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        const planned = validatePlanned(parsed, correlation);
        if (planned === null) {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMode = null;
            this.pendingFocused = null;
            this.diag("result", correlation, [["result", "precondition-mismatch"]]);
            this.reject("resize-precondition-mismatch");
            this.disable();
            return;
        }
        if (planned.baseRevision !== this.readRevision()) {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMode = null;
            this.pendingFocused = null;
            this.diag("result", correlation, [["result", "revision-mismatch"]]);
            this.reject("resize-revision-mismatch");
            this.disable();
            return;
        }
        // Geometry must cover exactly the observed window set: no partial,
        // no extra, no unknown windows.
        const captured = this.pendingObserved;
        if (captured !== null) {
            const observedIds = new Set(captured.windows.map((entry) => entry.id));
            if (planned.geometry.length !== observedIds.size) {
                this.inFlight = false;
                this.pending = null;
                this.pendingObserved = null;
                this.pendingDirection = null;
                this.pendingMode = null;
                this.pendingFocused = null;
                this.diag("result", correlation, [["result", "precondition-mismatch"]]);
                this.reject("resize-precondition-mismatch");
                this.disable();
                return;
            }
            for (const entry of planned.geometry) {
                if (!observedIds.has(entry.window)) {
                    this.inFlight = false;
                    this.pending = null;
                    this.pendingObserved = null;
                    this.pendingDirection = null;
                    this.pendingMode = null;
                    this.pendingFocused = null;
                    this.diag("result", correlation, [["result", "precondition-mismatch"]]);
                    this.reject("resize-precondition-mismatch");
                    this.disable();
                    return;
                }
                if (entry.output !== captured.domainOutput || entry.workspace !== captured.domainWorkspace) {
                    this.inFlight = false;
                    this.pending = null;
                    this.pendingObserved = null;
                    this.pendingDirection = null;
                    this.pendingMode = null;
                    this.pendingFocused = null;
                    this.diag("result", correlation, [["result", "precondition-mismatch"]]);
                    this.reject("resize-precondition-mismatch");
                    this.disable();
                    return;
                }
            }
            // Desired focus must retain the request domain.
            if (
                planned.focus.domainOutput !== captured.domainOutput ||
                planned.focus.domainWorkspace !== captured.domainWorkspace
            ) {
                this.inFlight = false;
                this.pending = null;
                this.pendingObserved = null;
                this.pendingDirection = null;
                this.pendingMode = null;
                this.pendingFocused = null;
                this.diag("result", correlation, [["result", "precondition-mismatch"]]);
                this.reject("resize-precondition-mismatch");
                this.disable();
                return;
            }
        }
        this.pending = planned;
        this.diag("result", correlation, [
            ["result", "planned"],
            ["rev", planned.baseRevision],
        ]);
        this.applyPlanned(flight);
    }

    private applyPlanned(flight: number): void {
        const planned = this.pending;
        const captured = this.pendingObserved;
        const wantedDirection = this.pendingDirection;
        const wantedMode = this.pendingMode;
        const focused = this.pendingFocused;
        if (
            planned === null ||
            captured === null ||
            focused === null ||
            wantedDirection === null ||
            wantedMode === null
        ) {
            this.reportAdapterLost(planned);
            this.failApply("resize-target-mismatch");
            return;
        }
        // The planned operation must name the focused window, direction, and mode.
        const operation = planned.operation;
        if (
            operation["focused_window"] !== focused ||
            operation["direction"] !== wantedDirection ||
            operation["mode"] !== wantedMode ||
            operation["domain_output"] !== captured.domainOutput ||
            operation["domain_workspace"] !== captured.domainWorkspace
        ) {
            this.reportAdapterLost(planned);
            this.failApply("resize-target-mismatch");
            return;
        }
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.failApply("resize-signal-invalid");
            return;
        }
        let authority = false;
        try {
            authority = this.env.hasExclusiveResizeAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reportAdapterLost(planned);
            this.failApply("resize-exclusive-conflict");
            return;
        }
        let fresh: ResizeObserved | null = null;
        try {
            fresh = this.env.observe();
        } catch (error) {
            void error;
            fresh = null;
        }
        if (!validateObserved(fresh)) {
            this.reportAdapterLost(planned);
            this.failApply("resize-stale-scope");
            return;
        }
        const current = fresh as ResizeObserved;
        let ok = false;
        try {
            ok = current.revalidate() === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            this.reportAdapterLost(planned);
            this.failApply("resize-stale-revalidate");
            return;
        }
        if (current.fingerprint !== captured.fingerprint) {
            this.reportAdapterLost(planned);
            this.failApply("resize-stale-revalidate");
            return;
        }
        if (
            current.domainOutput !== captured.domainOutput ||
            current.domainWorkspace !== captured.domainWorkspace ||
            current.focusedId !== captured.focusedId
        ) {
            this.reportAdapterLost(planned);
            this.failApply("resize-stale-scope");
            return;
        }
        // Geometries must still match the captured preconditions.
        const capturedRects = new Map<string, ResizeRect>();
        for (const entry of captured.windows) {
            capturedRects.set(entry.id, entry.rect);
        }
        for (const entry of current.windows) {
            const want = capturedRects.get(entry.id);
            if (want === undefined || !sameRect(want, entry.rect)) {
                this.reportAdapterLost(planned);
                this.failApply("resize-stale-revalidate");
                return;
            }
        }
        // Deterministic native-boundary order, changed-only.
        const ordered = orderResizeWrites(capturedRects, planned.geometry);
        const byId = new Map<string, object>();
        for (const entry of current.windows) {
            byId.set(entry.id, entry.ref);
        }
        this.suppressing = false;
        let applied = 0;
        let partial = false;
        let partialToken = "resize-partial-apply";
        const desiredById = new Map<string, ResizeDesired>();
        for (const entry of planned.geometry) {
            desiredById.set(entry.window, entry);
        }
        const writtenIds = new Set<string>();
        for (const entry of ordered) {
            // A queued public signal between writes invalidates terminally;
            // the loop polls no timer and waits on no configure barrier.
            if (this.invalidated) {
                partial = true;
                partialToken = "resize-signal-invalid";
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
            // Re-check exclusive authority before each write.
            let writeAuthority = false;
            try {
                writeAuthority = this.env.hasExclusiveResizeAuthority() === true;
            } catch (error) {
                void error;
                writeAuthority = false;
            }
            if (!writeAuthority) {
                this.reportAdapterLost(planned);
                this.failApply("resize-exclusive-conflict");
                return;
            }
            if (!rectContained(entry.rect, captured.domainBounds)) {
                partial = true;
                break;
            }
            // Guard only the synchronous own-write emission: suppression
            // covers the setGeometry call itself so an unrelated geometry
            // signal arriving between writes still invalidates.
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
            applied += 1;
            writtenIds.add(entry.window);
            if (this.invalidated) {
                partial = true;
                partialToken = "resize-signal-invalid";
                break;
            }
            // Active-transaction revalidation from public state (no polling,
            // no configure wait): already-written windows must show their
            // desired rects and every other window must still match the
            // captured preconditions, so an unrelated change swallowed with
            // an own-write emission cannot slip through as a snapshot-only
            // blind spot.
            try {
                const refetch = this.env.observe();
                if (refetch === null) {
                    partial = true;
                    partialToken = "resize-signal-invalid";
                    break;
                }
                if (refetch.windows.length !== captured.windows.length) {
                    partial = true;
                    partialToken = "resize-signal-invalid";
                    break;
                }
                for (const candidate of refetch.windows) {
                    const want = writtenIds.has(candidate.id)
                        ? (desiredById.get(candidate.id) as ResizeDesired).rect
                        : capturedRects.get(candidate.id);
                    if (want === undefined || !sameRect(want, candidate.rect)) {
                        partial = true;
                        partialToken = "resize-signal-invalid";
                        break;
                    }
                }
                if (partial) {
                    break;
                }
            } catch (error) {
                void error;
                partial = true;
                partialToken = "resize-signal-invalid";
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
        // Retain focus on the focused window.
        const focusedRef = byId.get(focused);
        if (typeof focusedRef !== "object" || focusedRef === null) {
            this.reportAdapterLost(planned);
            this.failApply("resize-target-mismatch");
            return;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
            currentActive = null;
        }
        if (currentActive !== focusedRef) {
            let retained = false;
            try {
                retained = this.env.setActive(focusedRef) === true;
            } catch (error) {
                void error;
                retained = false;
            }
            if (!retained) {
                this.reportAdapterLost(planned);
                this.failApply("resize-focus-failed");
                return;
            }
        }
        void applied;
        this.sendAcknowledge(flight, planned);
    }

    private failApply(token: string): void {
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        this.pendingMode = null;
        this.pendingFocused = null;
        this.suppressing = false;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.reject(token);
        this.disable();
    }

    private sendAcknowledge(flight: number, planned: PlannedResize): void {
        void flight;
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "signal-invalid"]]);
            this.failApply("resize-signal-invalid");
            return;
        }
        const target = this.plannerService();
        if (!isUniqueOwner(target)) {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "owner-missing"]]);
            this.failApply("resize-owner-missing");
            return;
        }
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: RESIZE_CONTRACT_VERSION,
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
            this.diag("ack", planned.correlationId, [["result", "service-fault"]]);
            this.failApply("resize-service-fault");
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(RESIZE_TIMEOUT_MS, () => this.onTimeout(next, "ack", planned.correlationId));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "timer-failed"]]);
            this.failApply("resize-timer-failed");
            return;
        }
        this.cancelTimer = cancel;
        this.diag("ack", planned.correlationId, [["transition", "sent"]]);
        try {
            this.env.callDbus(
                target,
                RESIZE_OBJECT,
                RESIZE_INTERFACE,
                RESIZE_METHOD,
                payload,
                (reply) => this.onAckReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "dbus-failed"]]);
            this.failApply("resize-dbus-failed");
        }
    }

    private onAckReply(reply: unknown, flight: number, planned: PlannedResize): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "signal-invalid"]]);
            this.failApply("resize-signal-invalid");
            return;
        }
        if (typeof reply !== "string" || reply.length > RESIZE_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "service-fault"]]);
            this.failApply("resize-service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "service-fault"]]);
            this.failApply("resize-service-fault");
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "acknowledged") {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "service-fault"]]);
            this.failApply("resize-service-fault");
            return;
        }
        if (parsed["v"] !== RESIZE_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "service-fault"]]);
            this.failApply("resize-service-fault");
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "correlation-mismatch"]]);
            this.failApply("resize-correlation-mismatch");
            return;
        }
        if (parsed["base_revision"] !== planned.baseRevision) {
            this.reportAdapterLost(planned);
            this.diag("ack", planned.correlationId, [["result", "revision-mismatch"]]);
            this.failApply("resize-revision-mismatch");
            return;
        }
        this.diag("ack", planned.correlationId, [["result", "acknowledged"]]);
        this.sendVerify(planned);
    }

    private sendVerify(planned: PlannedResize): void {
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "signal-invalid"]]);
            this.failApply("resize-signal-invalid");
            return;
        }
        const target = this.plannerService();
        if (!isUniqueOwner(target)) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "owner-missing"]]);
            this.failApply("resize-owner-missing");
            return;
        }
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        let fresh: ResizeObserved | null = null;
        try {
            fresh = this.env.observe();
        } catch (error) {
            void error;
            fresh = null;
        }
        if (!validateObserved(fresh)) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "post-stale"]]);
            this.failApply("resize-post-stale");
            return;
        }
        const current = fresh as ResizeObserved;
        let ok = false;
        try {
            ok = current.revalidate() === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "post-stale"]]);
            this.failApply("resize-post-stale");
            return;
        }
        if (
            current.domainOutput !== planned.focus.domainOutput ||
            current.domainWorkspace !== planned.focus.domainWorkspace
        ) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "post-mismatch"]]);
            this.failApply("resize-post-mismatch");
            return;
        }
        // Post-observation must still focus the resized window in the desired
        // domain: either a domain drift or a focus mismatch rejects before
        // any verify payload is built.
        const focusedId = this.pendingFocused;
        if (focusedId === null || current.focusedId !== focusedId) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "post-mismatch"]]);
            this.failApply("resize-post-mismatch");
            return;
        }
        // Post-observation must project exactly to the desired geometry.
        const freshById = new Map<string, ResizeObservedWindow>();
        for (const entry of current.windows) {
            freshById.set(entry.id, entry);
        }
        if (freshById.size !== planned.geometry.length) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "post-mismatch"]]);
            this.failApply("resize-post-mismatch");
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
                this.diag("verify", planned.correlationId, [["result", "post-mismatch"]]);
                this.failApply("resize-post-mismatch");
                return;
            }
            if (!sameRect(live.rect, entry.rect)) {
                this.reportAdapterLost(planned);
                this.diag("verify", planned.correlationId, [["result", "post-mismatch"]]);
                this.failApply("resize-post-mismatch");
                return;
            }
            if (live.output !== entry.output || live.workspace !== entry.workspace) {
                this.reportAdapterLost(planned);
                this.diag("verify", planned.correlationId, [["result", "post-mismatch"]]);
                this.failApply("resize-post-mismatch");
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
        // Focus must be retained on the focused window.
        let activeRef: object | null = null;
        try {
            activeRef = this.env.active();
        } catch (error) {
            void error;
            activeRef = null;
        }
        const focusedRef = freshById.get(this.pendingFocused as string)?.ref ?? null;
        if (activeRef !== focusedRef || focusedRef === null) {
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "post-mismatch"]]);
            this.failApply("resize-post-mismatch");
            return;
        }
        const sortedIds = current.windows.map((entry) => entry.id).sort();
        const fingerprint = resizeFingerprint(
            planned.focus.domainOutput,
            planned.focus.domainWorkspace,
            this.pendingFocused as string,
            sortedIds,
        );
        let payload = "";
        try {
            payload = JSON.stringify({
                v: RESIZE_CONTRACT_VERSION,
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
            this.diag("verify", planned.correlationId, [["result", "service-fault"]]);
            this.failApply("resize-service-fault");
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(RESIZE_TIMEOUT_MS, () => this.onTimeout(next, "verify", planned.correlationId));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "timer-failed"]]);
            this.failApply("resize-timer-failed");
            return;
        }
        this.cancelTimer = cancel;
        this.diag("verify", planned.correlationId, [["transition", "sent"]]);
        try {
            this.env.callDbus(
                target,
                RESIZE_OBJECT,
                RESIZE_INTERFACE,
                RESIZE_METHOD,
                payload,
                (reply) => this.onVerifyReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.reportAdapterLost(planned);
            this.diag("verify", planned.correlationId, [["result", "dbus-failed"]]);
            this.failApply("resize-dbus-failed");
        }
    }

    private onVerifyReply(reply: unknown, flight: number, planned: PlannedResize): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        this.pendingMode = null;
        this.pendingFocused = null;
        this.suppressing = false;
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.diag("outcome", planned.correlationId, [["result", "signal-invalid"]]);
            this.reject("resize-signal-invalid");
            this.disable();
            return;
        }
        if (typeof reply !== "string" || reply.length > RESIZE_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.diag("outcome", planned.correlationId, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.diag("outcome", planned.correlationId, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "committed") {
            this.reportAdapterLost(planned);
            this.diag("outcome", planned.correlationId, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        if (parsed["v"] !== RESIZE_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.diag("outcome", planned.correlationId, [["result", "service-fault"]]);
            this.reject("resize-service-fault");
            this.disable();
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.diag("outcome", planned.correlationId, [["result", "correlation-mismatch"]]);
            this.reject("resize-correlation-mismatch");
            this.disable();
            return;
        }
        const revision = parsed["revision"];
        if (typeof revision === "number" && Number.isInteger(revision) && revision === this.readRevision() + 1) {
            this.writeRevision(revision);
        } else {
            this.reportAdapterLost(planned);
            this.diag("outcome", planned.correlationId, [["result", "revision-mismatch"]]);
            this.reject("resize-revision-mismatch");
            this.disable();
            return;
        }
        // Idle reset: drop the pin so the next idle command re-resolves.
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.diag("outcome", planned.correlationId, [
            ["result", "committed"],
            ["rev", revision],
        ]);
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

    // Correlated route diagnostic: fixed vocabulary plus the opaque per-flight
    // correlation and integer counts only. Never captions, geometry, or PIDs.
    private diag(
        stage: "req" | "owner" | "result" | "ack" | "verify" | "outcome",
        correlation: string,
        extra: ReadonlyArray<readonly [string, unknown]> = [],
    ): void {
        try {
            this.env.log(formatRouteDiag(stage, [["corr", correlation], ...extra]));
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
