// Bounded COSMIC send-to-workspace adapter (standalone, dev-only, disabled by
// default).
//
// Product-shaped but with no normal startup route: ordinary production startup
// never runs this module (src/entry.ts must not import it and no controller
// route may import it; the module constraints below are the explicit wiring
// contract). The only activation is the explicit exported
// WorkspaceSendAdapter class plus the separate entry helper, called by no
// production source.
//
// This adapter carries the existing portable COSMIC same-output
// distinct-workspace send operation over the ONE existing DescribePlan D-Bus
// transport. Rust owns all planning, topology, membership, focus, and rejection
// policy. This module owns KWin observation of the focused output's source and
// target desktops, owner activation/pinning, the request/ack/verify phases,
// exact source+target re-validation, sequential native frameGeometry writes
// plus the mover's Window.desktops membership write, then the legacy follow
// (switch to the target desktop and focus the moved window) only after an
// exact validated accepted/applied send and a verified correct
// target/object/domain post-observation, signals, and structured route
// diagnostics.
//
// Activation mirrors the movement/focus/resize adapters exactly: one bounded
// GetNameOwner, an absent owner runs exactly one StartServiceByName(service,0)
// phase accepting only 1 PrimaryOwner / 2 AlreadyOwner, followed by exactly one
// post-start GetNameOwner, pinning one unique `:N.M` owner addressed by every
// planner call. One timer, no retry, no polling. Same-UID authorization stays
// solely the Planner's existing single check; it is never duplicated here.
//
// The planner commits only after an exact accepted acknowledgement and a
// matching verified post-observation: request proposes and retains one pending
// two-domain Session, then ack then verify each bind one owner/generation/
// correlation/base-revision. Pending mismatch, loss, refused ack, or failed
// verification is terminal divergence with no legacy recovery.
//
// Refusal routes are exact bounded tokens: no-planner, owner-loss,
// stale-revision, cross-output, same-workspace, absent-focus, non-tiled-focus,
// desktop-cap (observed desktop count above the KWin cap of 25), and
// last-desktop (no distinct target desktop can exist). Every failure disables
// the adapter and emits one structured best-effort
// `plasma-auto-tiler:route-diag` line with fixed fields (component, stage,
// correlation, generation, revision, event, outcome) carrying no sensitive,
// native, or payload data. A post-plan failure additionally sends one bounded
// best-effort `send-to-workspace-ack` `adapter-lost` to the still pinned
// unique owner before disabling; never the well-known name, never a retry.
//
// All logs are fixed redacted tokens. Only minimal public events are used and
// all are detached on disable. No polling.

import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "./domain-gap";
import { orderGeometryWrites } from "./geometry-order";

export const WORKSPACE_SEND_SERVICE = "org.plasmaautotiler.Planner";
export const WORKSPACE_SEND_OBJECT = "/org/plasmaautotiler/Planner";
export const WORKSPACE_SEND_INTERFACE = "org.plasmaautotiler.Planner1";
export const WORKSPACE_SEND_METHOD = "DescribePlan";

// Session D-Bus activation transport (one-flight, bounded, no poll/retry).
// Discovery is GetNameOwner on the well-known Planner name, pinned to one
// exact unique owner (`:N.M`) before any planner call. When absent, exactly
// one StartServiceByName(service, 0) phase runs, accepting only result codes
// 1 (PrimaryOwner) / 2 (AlreadyOwner), followed by exactly one more owner
// resolution and pin. Flags value 0 is fixed; the entry appends it as the
// second native D-Bus argument.
export const WORKSPACE_SEND_DBUS_SERVICE = "org.freedesktop.DBus";
export const WORKSPACE_SEND_DBUS_OBJECT = "/org/freedesktop/DBus";
export const WORKSPACE_SEND_DBUS_INTERFACE = "org.freedesktop.DBus";
export const WORKSPACE_SEND_GET_OWNER_METHOD = "GetNameOwner";
export const WORKSPACE_SEND_START_METHOD = "StartServiceByName";
export const WORKSPACE_SEND_START_FLAGS = 0;
export const WORKSPACE_SEND_START_PRIMARY = 1;
export const WORKSPACE_SEND_START_ALREADY = 2;

export const WORKSPACE_SEND_CONTRACT_VERSION = 1;
export const WORKSPACE_SEND_MAX_REQUEST_BYTES = 64 * 1024;
export const WORKSPACE_SEND_MAX_REPLY_BYTES = 64 * 1024;
export const WORKSPACE_SEND_TIMEOUT_MS = 5000;
export const WORKSPACE_SEND_MAX_CORRELATION_LEN = 128;
export const WORKSPACE_SEND_MAX_OWNER_LEN = 128;
export const WORKSPACE_SEND_MAX_GENERATION_LEN = 64;
export const WORKSPACE_SEND_MAX_REVISION = 1000000;
export const WORKSPACE_SEND_MAX_ID_LEN = 128;
// KWin's hard desktop cap: an observation reporting over 25 desktops is
// refused fail-closed with the desktop-cap token. Window capacity is a
// separate bound; the observed source+target window set stays capped at 64
// by validation (any overflow is a scope-invalid refusal, never a desktop
// claim).
export const WORKSPACE_SEND_MAX_DESKTOPS = 25;
export const WORKSPACE_SEND_MAX_WINDOWS = 64;
export const WORKSPACE_SEND_MAX_GEOMETRY = 64;
export const WORKSPACE_SEND_MAX_SEQ = 1000000;

export const WORKSPACE_SEND_COMPONENT = "cosmic-send";

const LOG_PREFIX = "plasma-auto-tiler:route-diag";

export interface WorkspaceSendRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface WorkspaceSendObservedWindow {
    readonly id: string;
    readonly ref: object;
    readonly rect: WorkspaceSendRect;
}

export interface WorkspaceSendObserved {
    readonly sourceOutput: string;
    readonly sourceWorkspace: string;
    readonly sourceBounds: WorkspaceSendRect;
    readonly targetOutput: string;
    readonly targetWorkspace: string;
    readonly targetBounds: WorkspaceSendRect;
    readonly focusedId: string;
    readonly sourceWindows: ReadonlyArray<WorkspaceSendObservedWindow>;
    readonly targetWindows: ReadonlyArray<WorkspaceSendObservedWindow>;
    readonly activeRef: object | null;
    readonly moverRef: object | null;
    readonly targetDesktopRef: object | null;
    readonly targetExists: boolean;
    readonly desktopCount: number;
    readonly sourceFingerprint: string;
    readonly targetFingerprint: string;
}

// Primitive-only snapshot retained across the async D-Bus boundary. Never
// holds Window objects, refs, or revalidation closures: ids, geometry values,
// scope, and fingerprints only. Targets are always resolved from a fresh
// synchronous observation while handling replies.
export interface WorkspaceSendSnapshotWindow {
    readonly id: string;
    readonly rect: WorkspaceSendRect;
}

export interface WorkspaceSendSnapshot {
    readonly sourceOutput: string;
    readonly sourceWorkspace: string;
    readonly sourceBounds: WorkspaceSendRect;
    readonly targetOutput: string;
    readonly targetWorkspace: string;
    readonly targetBounds: WorkspaceSendRect;
    readonly focusedId: string;
    readonly sourceWindows: ReadonlyArray<WorkspaceSendSnapshotWindow>;
    readonly targetWindows: ReadonlyArray<WorkspaceSendSnapshotWindow>;
    readonly sourceFingerprint: string;
    readonly targetFingerprint: string;
}

export interface WorkspaceSendAdapterEnv {
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
    readonly observe: (targetWorkspace: string) => WorkspaceSendObserved | null;
    readonly setGeometry: (target: object, rect: WorkspaceSendRect) => boolean;
    readonly setDesktops: (target: object, refs: ReadonlyArray<object>) => boolean;
    readonly switchToTarget?: (desktopRef: object) => boolean;
    readonly focusWindow?: (windowRef: object) => boolean;
    // Narrow mover desktop-change subscription seam for the bounded signal
    // fence. Production entries bind this to the mover Window.desktopsChanged
    // public signal via the shared signal-capability helpers. One-shot: the
    // adapter detaches after the first echo and on every terminal path.
    // Absent only in legacy isolated core tests, which retain the exact
    // synchronous post-write observe path.
    readonly subscribeMoverDesktops?: (moverRef: object, handler: () => void) => (() => void) | null;
    // Narrow geometry-change subscription seam for the bounded signal fence.
    // Production entries bind this to each changed Window.frameGeometryChanged
    // public signal via the shared signal-capability helpers. One-shot per
    // window: detached after its echo and on every terminal path. Absent only
    // in legacy isolated tests, which retain the mover-only fence.
    readonly subscribeWindowGeometry?: (windowRef: object, handler: () => void) => (() => void) | null;
}

export interface WorkspaceSendEnableAuth {
    readonly owner: unknown;
    readonly generation: unknown;
}

// Deterministic bounded observation fingerprint (FNV-1a 32-bit over
// `output\x1fworkspace\x1fids...`, sorted ids, no focus) covering one source
// or target scope. Sent as the numeric fingerprint field and cached as the
// string identity so dispatch, validation, and repeat tracking bind one value.
export function workspaceFingerprint(
    output: string,
    workspace: string,
    sortedIds: readonly string[],
): number {
    let hash = 2166136261;
    const feed = (text: string): void => {
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index) & 0xff;
            hash = Math.imul(hash, 16777619);
        }
    };
    feed(output);
    hash ^= 0x1f;
    hash = Math.imul(hash, 16777619);
    feed(workspace);
    for (const id of sortedIds) {
        hash ^= 0x1f;
        hash = Math.imul(hash, 16777619);
        feed(id);
    }
    return hash >>> 0;
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > WORKSPACE_SEND_MAX_ID_LEN) {
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
        value.length <= WORKSPACE_SEND_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= WORKSPACE_SEND_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > WORKSPACE_SEND_MAX_GENERATION_LEN) {
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
        value <= WORKSPACE_SEND_MAX_REVISION
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInt(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isTargetRect(value: unknown): value is WorkspaceSendRect {
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

// Bounded rejection-kind token: lowercase dashes only, otherwise redacted to
// `unknown`. Never echoes payload bytes.
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

// Exact lifecycle precondition vector for a same-output move-tiled plan.
const KNOWN_PRECONDITIONS: readonly string[] = Object.freeze([
    "window-observed",
    "desired-topology-valid",
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

interface WorkspaceGeometryEntry {
    readonly window: string;
    readonly leaf: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: WorkspaceSendRect;
}

interface WorkspaceFollowFocus {
    readonly output: string;
    readonly workspace: string;
    readonly leaf: string;
}

interface WorkspacePlanned {
    readonly correlationId: string;
    readonly baseRevision: number;
    readonly geometry: ReadonlyArray<WorkspaceGeometryEntry>;
    readonly preconditions: readonly string[];
    readonly operation: Record<string, unknown>;
    readonly followFocus: WorkspaceFollowFocus;
}

function validateGeometryEntry(value: unknown): WorkspaceGeometryEntry | null {
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

function validateMoveTiledOperation(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value)) {
        return null;
    }
    const fields: readonly string[] = [
        "op",
        "window",
        "leaf",
        "source_output",
        "source_workspace",
        "target_output",
        "target_workspace",
    ];
    if (!hasExactKeys(value, fields)) {
        return null;
    }
    if (value["op"] !== "move-tiled") {
        return null;
    }
    for (const field of ["window", "leaf", "source_output", "source_workspace", "target_output", "target_workspace"]) {
        if (!isOpaqueId(value[field])) {
            return null;
        }
    }
    return value;
}

function validatePlanned(reply: unknown, correlationId: string): WorkspacePlanned | null {
    if (!isRecord(reply)) {
        return null;
    }
    if (reply["v"] !== WORKSPACE_SEND_CONTRACT_VERSION) {
        return null;
    }
    if (reply["correlation_id"] !== correlationId) {
        return null;
    }
    if (reply["outcome"] !== "planned") {
        return null;
    }
    if (reply["kind"] !== "send-to-workspace") {
        return null;
    }
    const baseRevision = reply["base_revision"];
    if (!isRevision(baseRevision)) {
        return null;
    }
    const preconditions = reply["preconditions"];
    if (!isExactPreconditions(preconditions)) {
        return null;
    }
    const operation = validateMoveTiledOperation(reply["operation"]);
    if (operation === null) {
        return null;
    }
    // Legacy follow is Rust-owned: the planned desired focus must name the
    // moved leaf in the operation target domain. Any other focus is a
    // mismatched reply and never follows.
    const focusRaw = reply["desired_focus"];
    if (!isRecord(focusRaw) || !hasExactKeys(focusRaw, ["domain_output", "domain_workspace", "leaf"])) {
        return null;
    }
    if (
        !isOpaqueId(focusRaw["domain_output"]) ||
        !isOpaqueId(focusRaw["domain_workspace"]) ||
        !isOpaqueId(focusRaw["leaf"])
    ) {
        return null;
    }
    if (
        (focusRaw["domain_output"] as string) !== (operation["target_output"] as string) ||
        (focusRaw["domain_workspace"] as string) !== (operation["target_workspace"] as string) ||
        (focusRaw["leaf"] as string) !== (operation["leaf"] as string)
    ) {
        return null;
    }
    const geometryRaw = reply["desired_geometry"];
    if (!Array.isArray(geometryRaw) || geometryRaw.length === 0 || geometryRaw.length > WORKSPACE_SEND_MAX_GEOMETRY) {
        return null;
    }
    const geometry: WorkspaceGeometryEntry[] = [];
    const seen = new Set<string>();
    for (const entry of geometryRaw) {
        const valid = validateGeometryEntry(entry);
        if (valid === null || seen.has(valid.window)) {
            return null;
        }
        seen.add(valid.window);
        geometry.push(valid);
    }
    return {
        correlationId,
        baseRevision: baseRevision as number,
        geometry: Object.freeze(geometry),
        preconditions: Object.freeze([...(preconditions as string[])]),
        operation,
        followFocus: Object.freeze({
            output: focusRaw["domain_output"] as string,
            workspace: focusRaw["domain_workspace"] as string,
            leaf: focusRaw["leaf"] as string,
        }),
    };
}

function validateObserved(observed: WorkspaceSendObserved | null): observed is WorkspaceSendObserved {
    if (observed === null || typeof observed !== "object") {
        return false;
    }
    if (!isOpaqueId(observed.sourceOutput) || !isOpaqueId(observed.sourceWorkspace)) {
        return false;
    }
    if (!isOpaqueId(observed.targetOutput) || !isOpaqueId(observed.targetWorkspace)) {
        return false;
    }
    if (
        !isTargetRect({
            x: observed.sourceBounds.x,
            y: observed.sourceBounds.y,
            w: observed.sourceBounds.w,
            h: observed.sourceBounds.h,
        }) ||
        !isTargetRect({
            x: observed.targetBounds.x,
            y: observed.targetBounds.y,
            w: observed.targetBounds.w,
            h: observed.targetBounds.h,
        })
    ) {
        return false;
    }
    if (observed.focusedId !== "" && !isOpaqueId(observed.focusedId)) {
        return false;
    }
    const sourceWindows = observed.sourceWindows;
    const targetWindows = observed.targetWindows;
    if (!Array.isArray(sourceWindows) || !Array.isArray(targetWindows)) {
        return false;
    }
    if (sourceWindows.length + targetWindows.length > WORKSPACE_SEND_MAX_WINDOWS) {
        return false;
    }
    const seen = new Set<string>();
    for (const entry of [...sourceWindows, ...targetWindows]) {
        if (typeof entry !== "object" || entry === null) {
            return false;
        }
        const candidate = entry as WorkspaceSendObservedWindow;
        if (!isOpaqueId(candidate.id) || typeof candidate.ref !== "object" || candidate.ref === null) {
            return false;
        }
        if (!isTargetRect({ x: candidate.rect.x, y: candidate.rect.y, w: candidate.rect.w, h: candidate.rect.h })) {
            return false;
        }
        if (seen.has(candidate.id)) {
            return false;
        }
        seen.add(candidate.id);
    }
    if (observed.focusedId !== "" && !sourceWindows.some((w) => w.id === observed.focusedId)) {
        return false;
    }
    if (typeof observed.activeRef !== "object" && observed.activeRef !== null) {
        return false;
    }
    if (typeof observed.moverRef !== "object" && observed.moverRef !== null) {
        return false;
    }
    if (typeof observed.targetDesktopRef !== "object" && observed.targetDesktopRef !== null) {
        return false;
    }
    if (typeof observed.targetExists !== "boolean" || typeof observed.desktopCount !== "number") {
        return false;
    }
    if (typeof observed.sourceFingerprint !== "string" || observed.sourceFingerprint.length === 0) {
        return false;
    }
    if (typeof observed.targetFingerprint !== "string" || observed.targetFingerprint.length === 0) {
        return false;
    }
    return true;
}

export function snapshotOf(observed: WorkspaceSendObserved): WorkspaceSendSnapshot {
    const sourceWindows = observed.sourceWindows.map((entry) => ({
        id: entry.id,
        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
    }));
    const targetWindows = observed.targetWindows.map((entry) => ({
        id: entry.id,
        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
    }));
    return {
        sourceOutput: observed.sourceOutput,
        sourceWorkspace: observed.sourceWorkspace,
        sourceBounds: {
            x: observed.sourceBounds.x,
            y: observed.sourceBounds.y,
            w: observed.sourceBounds.w,
            h: observed.sourceBounds.h,
        },
        targetOutput: observed.targetOutput,
        targetWorkspace: observed.targetWorkspace,
        targetBounds: {
            x: observed.targetBounds.x,
            y: observed.targetBounds.y,
            w: observed.targetBounds.w,
            h: observed.targetBounds.h,
        },
        focusedId: observed.focusedId,
        sourceWindows: Object.freeze(sourceWindows),
        targetWindows: Object.freeze(targetWindows),
        sourceFingerprint: observed.sourceFingerprint,
        targetFingerprint: observed.targetFingerprint,
    };
}

function snapshotsEqual(a: WorkspaceSendSnapshot, b: WorkspaceSendSnapshot): boolean {
    if (
        a.sourceOutput !== b.sourceOutput ||
        a.sourceWorkspace !== b.sourceWorkspace ||
        a.targetOutput !== b.targetOutput ||
        a.targetWorkspace !== b.targetWorkspace ||
        a.focusedId !== b.focusedId ||
        a.sourceFingerprint !== b.sourceFingerprint ||
        a.targetFingerprint !== b.targetFingerprint ||
        a.sourceBounds.x !== b.sourceBounds.x ||
        a.sourceBounds.y !== b.sourceBounds.y ||
        a.sourceBounds.w !== b.sourceBounds.w ||
        a.sourceBounds.h !== b.sourceBounds.h ||
        a.targetBounds.x !== b.targetBounds.x ||
        a.targetBounds.y !== b.targetBounds.y ||
        a.targetBounds.w !== b.targetBounds.w ||
        a.targetBounds.h !== b.targetBounds.h
    ) {
        return false;
    }
    if (a.sourceWindows.length !== b.sourceWindows.length || a.targetWindows.length !== b.targetWindows.length) {
        return false;
    }
    const sourceById = new Map<string, WorkspaceSendSnapshotWindow>();
    for (const entry of a.sourceWindows) {
        sourceById.set(entry.id, entry);
    }
    for (const entry of b.sourceWindows) {
        const other = sourceById.get(entry.id);
        if (
            other === undefined ||
            other.rect.x !== entry.rect.x ||
            other.rect.y !== entry.rect.y ||
            other.rect.w !== entry.rect.w ||
            other.rect.h !== entry.rect.h
        ) {
            return false;
        }
    }
    const targetById = new Map<string, WorkspaceSendSnapshotWindow>();
    for (const entry of a.targetWindows) {
        targetById.set(entry.id, entry);
    }
    for (const entry of b.targetWindows) {
        const other = targetById.get(entry.id);
        if (
            other === undefined ||
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

interface WorkspacePendingFlight {
    readonly correlation: string;
    readonly snapshot: WorkspaceSendSnapshot;
    readonly targetWorkspace: string;
    readonly moverId: string;
    readonly windowCount: number;
    readonly requestPayload: string;
    readonly targetDesktopRef: object | null;
    baseRevision: number;
    preconditions: readonly string[];
    operation: Record<string, unknown> | null;
    planned: WorkspacePlanned | null;
    verifiedObserved: WorkspaceSendObserved | null;
}

export class WorkspaceSendAdapter {
    private enabled = false;
    private startupEnabled = false;
    private owner = "";
    private generation = "";
    private inFlight = false;
    private token = 0;
    private activeToken = 0;
    private callbackSeen = false;
    private cancelTimer: (() => void) | null = null;
    private pinnedOwner: string | null = null;
    private activationStep = 0;
    private pending: WorkspacePendingFlight | null = null;
    private seq = 0;
    private lossReported = false;
    private echoDetach: (() => void) | null = null;
    private echoArmed = false;
    private moverSeen = false;
    private geoDetaches = new Map<string, () => void>();
    private geoPending = new Set<string>();

    constructor(private readonly env: WorkspaceSendAdapterEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    enable(auth: WorkspaceSendEnableAuth): boolean {
        if (this.enabled || this.startupEnabled) {
            return false;
        }
        if (!isRecord(auth as unknown as Record<string, unknown>)) {
            return false;
        }
        if (!isOwnerId(auth.owner) || !isGeneration(auth.generation)) {
            return false;
        }
        this.owner = auth.owner as string;
        this.generation = auth.generation as string;
        this.enabled = true;
        this.startupEnabled = true;
        this.inFlight = false;
        this.pending = null;
        this.seq = 0;
        this.lossReported = false;
        this.echoDetach = null;
        this.echoArmed = false;
        this.moverSeen = false;
        this.geoDetaches = new Map<string, () => void>();
        this.geoPending = new Set<string>();
        return true;
    }

    disable(): void {
        if (!this.enabled && !this.inFlight) {
            return;
        }
        // A planned flight torn down here (explicit disable or entry stop) is
        // terminal divergence: report exactly one bounded best-effort
        // `send-to-workspace-ack` `adapter-lost` to the still pinned unique
        // owner before clearing. Never fires before a valid plan, never the
        // well-known name, never a retry; logger/DBus failure is ignored and
        // never changes the disable outcome.
        this.reportAdapterLost();
        this.enabled = false;
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.clearTimer();
        this.clearEcho();
    }

    requestSend(targetWorkspace: unknown): boolean {
        if (!this.enabled || this.inFlight) {
            return false;
        }
        if (!isOpaqueId(targetWorkspace)) {
            return false;
        }
        if (this.seq < 0 || this.seq > WORKSPACE_SEND_MAX_SEQ) {
            return false;
        }
        const observed = this.freshObserved(targetWorkspace);
        if (observed === null) {
            this.refuse("scope-invalid");
            return false;
        }
        // Refusal routes are exact bounded tokens (see module doc).
        if (observed.desktopCount < 2) {
            this.refuse("last-desktop");
            return false;
        }
        if (!observed.targetExists) {
            this.refuse("target-workspace-missing");
            return false;
        }
        if (observed.targetOutput !== observed.sourceOutput) {
            this.refuse("cross-output");
            return false;
        }
        if (observed.targetWorkspace === observed.sourceWorkspace) {
            this.refuse("same-workspace");
            return false;
        }
        if (observed.activeRef === null) {
            this.refuse("absent-focus");
            return false;
        }
        if (observed.focusedId === "" || !observed.sourceWindows.some((w) => w.id === observed.focusedId)) {
            this.refuse("non-tiled-focus");
            return false;
        }
        if (observed.desktopCount > WORKSPACE_SEND_MAX_DESKTOPS) {
            this.refuse("desktop-cap");
            return false;
        }
        const correlation = `${this.generation}-w${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            return false;
        }
        const snapshot = snapshotOf(observed);
        const payload = this.buildRequestPayload(observed, correlation);
        if (payload === null || payload.length > WORKSPACE_SEND_MAX_REQUEST_BYTES) {
            return false;
        }
        this.startFlight(correlation, snapshot, observed.targetWorkspace, observed.focusedId, observed.targetDesktopRef, payload);
        return this.inFlight;
    }

    private freshObserved(targetWorkspace: string): WorkspaceSendObserved | null {
        let observed: WorkspaceSendObserved | null = null;
        try {
            observed = this.env.observe(targetWorkspace);
        } catch (error) {
            void error;
            observed = null;
        }
        if (!validateObserved(observed)) {
            return null;
        }
        return observed as WorkspaceSendObserved;
    }

    private buildRequestPayload(observed: WorkspaceSendObserved, correlation: string): string | null {
        const sourceWindows = observed.sourceWindows.map((entry) => ({
            window: entry.id,
            output: observed.sourceOutput,
            workspace: observed.sourceWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        const targetWindows = observed.targetWindows.map((entry) => ({
            window: entry.id,
            output: observed.targetOutput,
            workspace: observed.targetWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        let payload = "";
        try {
            payload = JSON.stringify({
                v: WORKSPACE_SEND_CONTRACT_VERSION,
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                revision: 0,
                fingerprint: this.scopeFingerprint(observed),
                domain: {
                    output: observed.sourceOutput,
                    workspace: observed.sourceWorkspace,
                    bounds: {
                        x: observed.sourceBounds.x,
                        y: observed.sourceBounds.y,
                        w: observed.sourceBounds.w,
                        h: observed.sourceBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                target_domain: {
                    output: observed.targetOutput,
                    workspace: observed.targetWorkspace,
                    bounds: {
                        x: observed.targetBounds.x,
                        y: observed.targetBounds.y,
                        w: observed.targetBounds.w,
                        h: observed.targetBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                focused_window: observed.focusedId,
                windows: sourceWindows,
                target_windows: targetWindows,
                command: {
                    op: "send-to-workspace",
                    window: observed.focusedId,
                    target_output: observed.targetOutput,
                    target_workspace: observed.targetWorkspace,
                },
            });
        } catch (error) {
            void error;
            return null;
        }
        return payload;
    }

    private buildAckPayload(observed: WorkspaceSendObserved, correlation: string, revision: number): string | null {
        const sourceWindows = observed.sourceWindows.map((entry) => ({
            window: entry.id,
            output: observed.sourceOutput,
            workspace: observed.sourceWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        const targetWindows = observed.targetWindows.map((entry) => ({
            window: entry.id,
            output: observed.targetOutput,
            workspace: observed.targetWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        let payload = "";
        try {
            payload = JSON.stringify({
                v: WORKSPACE_SEND_CONTRACT_VERSION,
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                revision,
                fingerprint: this.scopeFingerprint(observed),
                domain: {
                    output: observed.sourceOutput,
                    workspace: observed.sourceWorkspace,
                    bounds: {
                        x: observed.sourceBounds.x,
                        y: observed.sourceBounds.y,
                        w: observed.sourceBounds.w,
                        h: observed.sourceBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                target_domain: {
                    output: observed.targetOutput,
                    workspace: observed.targetWorkspace,
                    bounds: {
                        x: observed.targetBounds.x,
                        y: observed.targetBounds.y,
                        w: observed.targetBounds.w,
                        h: observed.targetBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                focused_window: observed.focusedId,
                windows: sourceWindows,
                target_windows: targetWindows,
                command: { op: "send-to-workspace-ack", ack_outcome: "accepted" },
            });
        } catch (error) {
            void error;
            return null;
        }
        return payload;
    }

    private buildVerifyPayload(observed: WorkspaceSendObserved, correlation: string, revision: number): string | null {
        const pending = this.pending;
        if (pending === null || pending.preconditions === null || pending.operation === null) {
            return null;
        }
        const sourceWindows = observed.sourceWindows.map((entry) => ({
            window: entry.id,
            output: observed.sourceOutput,
            workspace: observed.sourceWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        const targetWindows = observed.targetWindows.map((entry) => ({
            window: entry.id,
            output: observed.targetOutput,
            workspace: observed.targetWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
        let payload = "";
        try {
            payload = JSON.stringify({
                v: WORKSPACE_SEND_CONTRACT_VERSION,
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                revision,
                fingerprint: this.scopeFingerprint(observed),
                domain: {
                    output: observed.sourceOutput,
                    workspace: observed.sourceWorkspace,
                    bounds: {
                        x: observed.sourceBounds.x,
                        y: observed.sourceBounds.y,
                        w: observed.sourceBounds.w,
                        h: observed.sourceBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                target_domain: {
                    output: observed.targetOutput,
                    workspace: observed.targetWorkspace,
                    bounds: {
                        x: observed.targetBounds.x,
                        y: observed.targetBounds.y,
                        w: observed.targetBounds.w,
                        h: observed.targetBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                focused_window: observed.focusedId,
                windows: sourceWindows,
                target_windows: targetWindows,
                command: {
                    op: "send-to-workspace-verify",
                    verified: true,
                    preconditions: pending.preconditions,
                    operation: pending.operation,
                },
            });
        } catch (error) {
            void error;
            return null;
        }
        return payload;
    }

    private scopeFingerprint(observed: WorkspaceSendObserved): number {
        const sourceIds = observed.sourceWindows.map((entry) => entry.id).sort();
        const targetIds = observed.targetWindows.map((entry) => entry.id).sort();
        const source = workspaceFingerprint(observed.sourceOutput, observed.sourceWorkspace, sourceIds);
        const target = workspaceFingerprint(observed.targetOutput, observed.targetWorkspace, targetIds);
        return (source ^ target) >>> 0;
    }

    private startFlight(
        correlation: string,
        snapshot: WorkspaceSendSnapshot,
        targetWorkspace: string,
        moverId: string,
        targetDesktopRef: object | null,
        payload: string,
    ): void {
        this.inFlight = true;
        this.callbackSeen = false;
        this.clearEcho();
        this.pending = {
            correlation,
            snapshot,
            targetWorkspace,
            moverId,
            windowCount: snapshot.sourceWindows.length + snapshot.targetWindows.length,
            requestPayload: payload,
            targetDesktopRef,
            baseRevision: 0,
            preconditions: [],
            operation: null,
            planned: null,
            verifiedObserved: null,
        };
        this.pinnedOwner = null;
        this.activationStep = 1;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(WORKSPACE_SEND_TIMEOUT_MS, () => this.onTimeout(flight, "request"));
        } catch (error) {
            void error;
            this.inFlight = false;
            this.activationStep = 0;
            this.pending = null;
            this.refuse("timeout");
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
                WORKSPACE_SEND_DBUS_SERVICE,
                WORKSPACE_SEND_DBUS_OBJECT,
                WORKSPACE_SEND_DBUS_INTERFACE,
                WORKSPACE_SEND_GET_OWNER_METHOD,
                WORKSPACE_SEND_SERVICE,
                (reply) => this.onOwnerInitial(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.disable();
        }
    }

    private onOwnerInitial(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 1) {
            return;
        }
        if (isUniqueOwner(reply)) {
            this.pinnedOwner = reply;
            this.activationStep = 4;
            this.diag("request", correlation, 0, "activate", "owner-pinned");
            this.sendPlannerRequest(flight, correlation);
            return;
        }
        // Absent name: exactly one StartServiceByName(service, 0) phase.
        this.activationStep = 2;
        this.diag("request", correlation, 0, "activate", "activating");
        try {
            this.env.callDbus(
                WORKSPACE_SEND_DBUS_SERVICE,
                WORKSPACE_SEND_DBUS_OBJECT,
                WORKSPACE_SEND_DBUS_INTERFACE,
                WORKSPACE_SEND_START_METHOD,
                WORKSPACE_SEND_SERVICE,
                (startReply) => this.onStartResult(startReply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.disable();
        }
    }

    private onStartResult(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 2) {
            return;
        }
        if (reply !== WORKSPACE_SEND_START_PRIMARY && reply !== WORKSPACE_SEND_START_ALREADY) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.disable();
            return;
        }
        // Exactly one bounded post-activation owner resolution, then pin
        // before any planner call. No retry on failure.
        this.activationStep = 3;
        try {
            this.env.callDbus(
                WORKSPACE_SEND_DBUS_SERVICE,
                WORKSPACE_SEND_DBUS_OBJECT,
                WORKSPACE_SEND_DBUS_INTERFACE,
                WORKSPACE_SEND_GET_OWNER_METHOD,
                WORKSPACE_SEND_SERVICE,
                (ownerReply) => this.onOwnerAfterStart(ownerReply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.disable();
        }
    }

    private onOwnerAfterStart(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 3) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.disable();
            return;
        }
        this.pinnedOwner = reply;
        this.activationStep = 4;
        this.diag("request", correlation, 0, "activate", "owner-pinned");
        this.sendPlannerRequest(flight, correlation);
    }

    private sendPlannerRequest(flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 4) {
            return;
        }
        const pending = this.pending;
        if (pending === null || !isUniqueOwner(this.pinnedOwner)) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.disable();
            return;
        }
        this.callbackSeen = false;
        try {
            this.env.callDbus(
                this.pinnedOwner,
                WORKSPACE_SEND_OBJECT,
                WORKSPACE_SEND_INTERFACE,
                WORKSPACE_SEND_METHOD,
                pending.requestPayload,
                (reply) => this.onRequestReply(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.failTerminal(flight, correlation, "owner-loss");
        }
    }

    private onRequestReply(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        const pending = this.pending;
        if (pending === null || !isUniqueOwner(this.pinnedOwner) || this.activationStep !== 4) {
            return;
        }
        this.callbackSeen = true;
        // The single whole-flight timer stays armed through the ack and verify
        // phases; it is released only on final commit or failure.
        if (typeof reply !== "string" || reply.length > WORKSPACE_SEND_MAX_REPLY_BYTES) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        if (!isRecord(parsed)) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        if (parsed["v"] !== WORKSPACE_SEND_CONTRACT_VERSION) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        if (parsed["correlation_id"] !== correlation) {
            this.failFlight(flight, correlation, "correlation-mismatch");
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "rejected" || outcome === "diverged") {
            const kind = sanitizeKind(parsed["kind"]);
            this.failFlight(flight, correlation, kind);
            return;
        }
        if (outcome !== "planned") {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        const planned = validatePlanned(parsed, correlation);
        if (planned === null) {
            this.failFlight(flight, correlation, "precondition-mismatch");
            return;
        }
        if (!this.geometryCovers(planned, pending)) {
            this.failFlight(flight, correlation, "precondition-mismatch");
            return;
        }
        if (!this.operationMatchesSnapshot(planned, pending)) {
            this.failFlight(flight, correlation, "precondition-mismatch");
            return;
        }
        this.applyPlanned(planned, flight, correlation);
    }

    // Complete-reply binding: the reply geometry must cover exactly the
    // observed source+target window set. Unknown or partial windows never
    // reach native writes.
    private geometryCovers(planned: WorkspacePlanned, flightState: WorkspacePendingFlight): boolean {
        const wanted = new Set<string>();
        for (const entry of flightState.snapshot.sourceWindows) {
            wanted.add(entry.id);
        }
        for (const entry of flightState.snapshot.targetWindows) {
            wanted.add(entry.id);
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

    // Operation-to-snapshot binding from Rust's established intent: the
    // move-tiled operation must name the flight mover plus the exact captured
    // source/target domains. Any other target/object is a mismatched reply
    // and never follows.
    private operationMatchesSnapshot(planned: WorkspacePlanned, flightState: WorkspacePendingFlight): boolean {
        const operation = planned.operation;
        const snapshot = flightState.snapshot;
        if (
            (operation["window"] as string) !== flightState.moverId ||
            (operation["source_output"] as string) !== snapshot.sourceOutput ||
            (operation["source_workspace"] as string) !== snapshot.sourceWorkspace ||
            (operation["target_output"] as string) !== snapshot.targetOutput ||
            (operation["target_workspace"] as string) !== snapshot.targetWorkspace
        ) {
            return false;
        }
        if (
            planned.followFocus.output !== snapshot.targetOutput ||
            planned.followFocus.workspace !== snapshot.targetWorkspace ||
            planned.followFocus.leaf !== (operation["leaf"] as string)
        ) {
            return false;
        }
        return true;
    }

    // Reply-boundary revalidation: never touch a possibly-destroyed Window
    // observed before dispatch. Re-observe synchronously, exact-revalidate the
    // source+target scope against the flight snapshot, then apply geometry and
    // the mover's desktop membership. With the mover echo seam present the
    // verified post-observation runs only after the mover desktopsChanged echo
    // plus every required geometry echo; without the seam the exact
    // synchronous post-write observe path runs for legacy isolated tests.
    // Then ack.
    private applyPlanned(planned: WorkspacePlanned, flight: number, correlation: string): void {
        const pending = this.pending;
        if (pending === null) {
            this.failFlight(flight, correlation, "stale-scope");
            return;
        }
        const fresh = this.freshObserved(pending.targetWorkspace);
        if (fresh === null) {
            this.failFlight(flight, correlation, "stale-revision");
            return;
        }
        if (!snapshotsEqual(snapshotOf(fresh), pending.snapshot)) {
            this.failFlight(flight, correlation, "stale-revision");
            return;
        }
        // Bind the accepted plan to the flight before any native write so a
        // post-plan failure reports the exact owner/generation/correlation/
        // base revision to the planner.
        pending.baseRevision = planned.baseRevision;
        pending.preconditions = planned.preconditions;
        pending.operation = planned.operation;
        pending.planned = planned;
        const subscribe = this.env.subscribeMoverDesktops;
        if (typeof subscribe !== "function") {
            // Native writes: direct geometry in the shared grow-before-shrink
            // order, then only the mover's desktop membership. Desktop follow and
            // mover focus happen only after the verify commit (see onVerifyReply).
            if (!this.writeGeometries(planned, pending, fresh)) {
                this.failFlight(flight, correlation, "write-failed");
                return;
            }
            if (!this.writeMoverDesktops(pending, fresh)) {
                this.failFlight(flight, correlation, "write-failed");
                return;
            }
            this.completePostWrite(planned, flight, correlation);
            return;
        }
        // Bounded signal fence grounded in actual expected native writes: arm
        // one-shot mover plus required geometry echoes before any native
        // write, then write geometry plus mover membership and defer the
        // strict post-observation plus accepted ack until the mover membership
        // echo and every required geometry-write echo have occurred.
        // Unchanged geometry never waits for a signal.
        const moverRef = this.resolveMoverRef(pending, fresh);
        if (moverRef === null) {
            this.failFlight(flight, correlation, "write-failed");
            return;
        }
        let detach: (() => void) | null = null;
        try {
            detach = subscribe(moverRef, () => this.onMoverEcho(flight, correlation));
        } catch (error) {
            void error;
            detach = null;
        }
        if (detach === null || typeof detach !== "function") {
            this.failFlight(flight, correlation, "write-failed");
            return;
        }
        this.echoDetach = detach;
        this.echoArmed = true;
        this.moverSeen = false;
        this.geoDetaches = new Map<string, () => void>();
        this.geoPending = new Set<string>();
        const changedIds = this.changedGeometryIds(planned, fresh);
        const subscribeGeo = this.env.subscribeWindowGeometry;
        if (changedIds.length > 0 && typeof subscribeGeo === "function") {
            const byRef = new Map<string, object>();
            for (const entry of fresh.sourceWindows) {
                byRef.set(entry.id, entry.ref);
            }
            for (const entry of fresh.targetWindows) {
                byRef.set(entry.id, entry.ref);
            }
            for (const id of changedIds) {
                const ref = byRef.get(id);
                if (ref === undefined) {
                    this.clearEcho();
                    this.failFlight(flight, correlation, "write-failed");
                    return;
                }
                const windowId = id;
                let geoDetach: (() => void) | null = null;
                try {
                    geoDetach = subscribeGeo(ref, () => this.onGeometryEcho(windowId, flight, correlation));
                } catch (error) {
                    void error;
                    geoDetach = null;
                }
                if (geoDetach === null || typeof geoDetach !== "function") {
                    this.clearEcho();
                    this.failFlight(flight, correlation, "write-failed");
                    return;
                }
                this.geoDetaches.set(windowId, geoDetach);
                this.geoPending.add(windowId);
            }
        }
        // Native writes: direct geometry in the shared grow-before-shrink
        // order, then only the mover's desktop membership. Desktop follow and
        // mover focus happen only after the verify commit (see onVerifyReply).
        if (!this.writeGeometries(planned, pending, fresh)) {
            this.clearEcho();
            this.failFlight(flight, correlation, "write-failed");
            return;
        }
        if (!this.writeMoverDesktops(pending, fresh)) {
            this.clearEcho();
            this.failFlight(flight, correlation, "write-failed");
            return;
        }
        this.diag("request", correlation, planned.baseRevision, "plan-echo", "waiting");
        if (this.geoPending.size > 0) {
            this.diag("request", correlation, planned.baseRevision, "plan-geometry", "waiting");
        }
    }

    private resolveMoverRef(pending: WorkspacePendingFlight, current: WorkspaceSendObserved): object | null {
        for (const entry of current.sourceWindows) {
            if (entry.id === pending.moverId) {
                return entry.ref;
            }
        }
        for (const entry of current.targetWindows) {
            if (entry.id === pending.moverId) {
                return entry.ref;
            }
        }
        return null;
    }

    private changedGeometryIds(planned: WorkspacePlanned, current: WorkspaceSendObserved): string[] {
        const freshById = new Map<string, WorkspaceSendRect>();
        for (const entry of current.sourceWindows) {
            freshById.set(entry.id, entry.rect);
        }
        for (const entry of current.targetWindows) {
            freshById.set(entry.id, entry.rect);
        }
        const changed: string[] = [];
        for (const entry of planned.geometry) {
            const fresh = freshById.get(entry.window);
            if (fresh === undefined) {
                continue;
            }
            if (fresh.x !== entry.rect.x || fresh.y !== entry.rect.y || fresh.w !== entry.rect.w || fresh.h !== entry.rect.h) {
                changed.push(entry.window);
            }
        }
        return changed;
    }

    private onMoverEcho(flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || !this.echoArmed) {
            return;
        }
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null) {
            return;
        }
        // One-shot: detach before any further fence progress so a duplicate
        // echo cannot produce a duplicate membership write or ack.
        const detach = this.echoDetach;
        this.echoDetach = null;
        this.echoArmed = false;
        if (detach !== null) {
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
        this.moverSeen = true;
        this.diag("request", correlation, planned.baseRevision, "plan-echo", "consumed");
        this.tryMaybeComplete(flight, correlation);
    }

    private onGeometryEcho(windowId: string, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken) {
            return;
        }
        if (!this.geoPending.has(windowId)) {
            return;
        }
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null) {
            return;
        }
        const detach = this.geoDetaches.get(windowId);
        if (detach !== undefined) {
            this.geoDetaches.delete(windowId);
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
        this.geoPending.delete(windowId);
        this.diag("request", correlation, planned.baseRevision, "plan-geometry", "consumed");
        this.tryMaybeComplete(flight, correlation);
    }

    private tryMaybeComplete(flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken) {
            return;
        }
        if (!this.moverSeen || this.geoPending.size > 0) {
            return;
        }
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null) {
            return;
        }
        this.completePostWrite(planned, flight, correlation);
    }

    private completePostWrite(planned: WorkspacePlanned, flight: number, correlation: string): void {
        const pending = this.pending;
        if (pending === null) {
            this.failFlight(flight, correlation, "stale-scope");
            return;
        }
        // Exact re-observation after the writes becomes the verified
        // post-observation carried by the ack and verify requests. It must
        // bind strictly to the retained plan: every desired window observed
        // once with the planned rectangle, the mover absent from source and
        // present in target, all other windows retaining their planned
        // memberships, and the source/target domains, bounds, and target ref
        // still matching the captured scope. Any mismatch is terminal without
        // a verify commit.
        const verified = this.freshObserved(pending.targetWorkspace);
        if (verified === null) {
            this.failFlight(flight, correlation, "stale-revision");
            return;
        }
        const postMismatch = this.verifyPlannedPost(planned, pending, verified);
        if (postMismatch !== "") {
            this.failFlight(flight, correlation, postMismatch);
            return;
        }
        pending.verifiedObserved = verified;
        const payload = this.buildAckPayload(verified, correlation, planned.baseRevision);
        if (payload === null || payload.length > WORKSPACE_SEND_MAX_REQUEST_BYTES) {
            this.failFlight(flight, correlation, "precondition-mismatch");
            return;
        }
        this.diag("request", correlation, planned.baseRevision, "plan", "planned");
        this.sendAck(flight, correlation, payload);
    }

    private clearEcho(): void {
        const detach = this.echoDetach;
        this.echoDetach = null;
        this.echoArmed = false;
        this.moverSeen = false;
        if (detach !== null) {
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
        for (const geoDetach of this.geoDetaches.values()) {
            try {
                geoDetach();
            } catch (error) {
                void error;
            }
        }
        this.geoDetaches = new Map<string, () => void>();
        this.geoPending = new Set<string>();
    }

    private writeGeometries(
        planned: WorkspacePlanned,
        _flightState: WorkspacePendingFlight,
        current: WorkspaceSendObserved,
    ): boolean {
        const byRef = new Map<string, object>();
        const oldById = new Map<string, WorkspaceSendRect>();
        for (const entry of current.sourceWindows) {
            byRef.set(entry.id, entry.ref);
            oldById.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
        }
        for (const entry of current.targetWindows) {
            byRef.set(entry.id, entry.ref);
            oldById.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
        }
        const ordered = orderGeometryWrites(oldById, planned.geometry);
        for (const entry of ordered) {
            const target = byRef.get(entry.window);
            if (target === undefined) {
                return false;
            }
            let written = false;
            try {
                written = this.env.setGeometry(target, entry.rect) === true;
            } catch (error) {
                void error;
                written = false;
            }
            if (!written) {
                return false;
            }
        }
        return true;
    }

    private writeMoverDesktops(pending: WorkspacePendingFlight, current: WorkspaceSendObserved): boolean {
        if (current.targetDesktopRef === null) {
            return false;
        }
        let mover: object | null = null;
        for (const entry of current.sourceWindows) {
            if (entry.id === pending.moverId) {
                mover = entry.ref;
                break;
            }
        }
        if (mover === null) {
            for (const entry of current.targetWindows) {
                if (entry.id === pending.moverId) {
                    mover = entry.ref;
                    break;
                }
            }
        }
        if (mover === null) {
            return false;
        }
        let written = false;
        try {
            written = this.env.setDesktops(mover, [current.targetDesktopRef]) === true;
        } catch (error) {
            void error;
            written = false;
        }
        return written;
    }

    // Strict post-observation binding against the retained plan. Returns ""
    // when the post-observation is exact, otherwise the terminal refusal token
    // (`stale-revision` for scope drift, `post-observation-mismatch` for any
    // geometry or membership divergence). Never commits a divergent state.
    private verifyPlannedPost(
        planned: WorkspacePlanned,
        pending: WorkspacePendingFlight,
        verified: WorkspaceSendObserved,
    ): string {
        // Captured scope: source/target domains, bounds, target existence, and
        // the exact target desktop ref must be unchanged.
        const snapshot = pending.snapshot;
        if (
            verified.sourceOutput !== snapshot.sourceOutput ||
            verified.sourceWorkspace !== snapshot.sourceWorkspace ||
            verified.targetOutput !== snapshot.targetOutput ||
            verified.targetWorkspace !== snapshot.targetWorkspace ||
            verified.sourceBounds.x !== snapshot.sourceBounds.x ||
            verified.sourceBounds.y !== snapshot.sourceBounds.y ||
            verified.sourceBounds.w !== snapshot.sourceBounds.w ||
            verified.sourceBounds.h !== snapshot.sourceBounds.h ||
            verified.targetBounds.x !== snapshot.targetBounds.x ||
            verified.targetBounds.y !== snapshot.targetBounds.y ||
            verified.targetBounds.w !== snapshot.targetBounds.w ||
            verified.targetBounds.h !== snapshot.targetBounds.h ||
            verified.targetDesktopRef !== pending.targetDesktopRef ||
            verified.targetExists !== true
        ) {
            return "stale-revision";
        }
        const byId = new Map<string, { rect: WorkspaceSendRect; inSource: boolean; inTarget: boolean }>();
        for (const entry of verified.sourceWindows) {
            byId.set(entry.id, { rect: entry.rect, inSource: true, inTarget: false });
        }
        for (const entry of verified.targetWindows) {
            byId.set(entry.id, { rect: entry.rect, inSource: false, inTarget: true });
        }
        // Every planned desired window exists exactly once with the planned
        // rectangle; the observed set must not exceed the plan.
        const seen = new Set<string>();
        for (const entry of planned.geometry) {
            if (seen.has(entry.window)) {
                return "post-observation-mismatch";
            }
            seen.add(entry.window);
            const found = byId.get(entry.window);
            if (
                found === undefined ||
                found.rect.x !== entry.rect.x ||
                found.rect.y !== entry.rect.y ||
                found.rect.w !== entry.rect.w ||
                found.rect.h !== entry.rect.h
            ) {
                return "post-observation-mismatch";
            }
        }
        if (seen.size !== byId.size) {
            return "post-observation-mismatch";
        }
        // The mover is absent from the source and present in the target.
        const mover = byId.get(pending.moverId);
        if (mover === undefined || mover.inSource || !mover.inTarget) {
            return "post-observation-mismatch";
        }
        // All other windows retain their planned source/target memberships.
        for (const entry of snapshot.sourceWindows) {
            if (entry.id === pending.moverId) {
                continue;
            }
            const found = byId.get(entry.id);
            if (found === undefined || !found.inSource || found.inTarget) {
                return "post-observation-mismatch";
            }
        }
        for (const entry of snapshot.targetWindows) {
            if (entry.id === pending.moverId) {
                continue;
            }
            const found = byId.get(entry.id);
            if (found === undefined || found.inSource || !found.inTarget) {
                return "post-observation-mismatch";
            }
        }
        return "";
    }

    private sendAck(flight: number, correlation: string, payload: string): void {
        if (!this.inFlight || flight !== this.activeToken || !isUniqueOwner(this.pinnedOwner)) {
            return;
        }
        this.callbackSeen = false;
        try {
            this.env.callDbus(
                this.pinnedOwner,
                WORKSPACE_SEND_OBJECT,
                WORKSPACE_SEND_INTERFACE,
                WORKSPACE_SEND_METHOD,
                payload,
                (reply) => this.onAckReply(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.failFlight(flight, correlation, "owner-loss");
        }
    }

    private onAckReply(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        const pending = this.pending;
        if (pending === null || pending.verifiedObserved === null) {
            this.failFlight(flight, correlation, "stale-scope");
            return;
        }
        this.callbackSeen = true;
        // The single whole-flight timer stays armed through the verify phase.
        if (typeof reply !== "string" || reply.length > WORKSPACE_SEND_MAX_REPLY_BYTES) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        if (!isRecord(parsed) || parsed["v"] !== WORKSPACE_SEND_CONTRACT_VERSION) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        if (parsed["correlation_id"] !== correlation) {
            this.failFlight(flight, correlation, "correlation-mismatch");
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "rejected" || outcome === "diverged") {
            this.failFlight(flight, correlation, sanitizeKind(parsed["kind"]));
            return;
        }
        if (outcome !== "acknowledged") {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        this.diag("ack", correlation, pending.baseRevision, "ack", "acknowledged");
        // Scope may have changed between the ack and the verify: take a fresh
        // observation and rerun the strict post-observation binding so stale
        // data never reaches a verify. Any mismatch fails closed with one
        // best-effort adapter-lost report.
        const fresh = this.freshObserved(pending.targetWorkspace);
        if (fresh === null || pending.planned === null) {
            this.failFlight(flight, correlation, "stale-revision");
            return;
        }
        const mismatch = this.verifyPlannedPost(pending.planned, pending, fresh);
        if (mismatch !== "") {
            this.failFlight(flight, correlation, mismatch);
            return;
        }
        const payload = this.buildVerifyPayload(fresh, correlation, pending.baseRevision);
        if (payload === null || payload.length > WORKSPACE_SEND_MAX_REQUEST_BYTES) {
            this.failFlight(flight, correlation, "precondition-mismatch");
            return;
        }
        this.sendVerify(flight, correlation, payload);
    }

    private sendVerify(flight: number, correlation: string, payload: string): void {
        if (!this.inFlight || flight !== this.activeToken || !isUniqueOwner(this.pinnedOwner)) {
            return;
        }
        this.callbackSeen = false;
        try {
            this.env.callDbus(
                this.pinnedOwner,
                WORKSPACE_SEND_OBJECT,
                WORKSPACE_SEND_INTERFACE,
                WORKSPACE_SEND_METHOD,
                payload,
                (reply) => this.onVerifyReply(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.failFlight(flight, correlation, "owner-loss");
        }
    }

    private onVerifyReply(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        const pending = this.pending;
        if (pending === null) {
            this.failFlight(flight, correlation, "stale-scope");
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        if (typeof reply !== "string" || reply.length > WORKSPACE_SEND_MAX_REPLY_BYTES) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        if (!isRecord(parsed) || parsed["v"] !== WORKSPACE_SEND_CONTRACT_VERSION) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        if (parsed["correlation_id"] !== correlation) {
            this.failFlight(flight, correlation, "correlation-mismatch");
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "rejected" || outcome === "diverged") {
            this.failFlight(flight, correlation, sanitizeKind(parsed["kind"]));
            return;
        }
        if (outcome !== "committed") {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        const revision = parsed["base_revision"];
        if (!isRevision(revision)) {
            this.failFlight(flight, correlation, "service-fault");
            return;
        }
        this.diag("verify", correlation, revision as number, "verify", "committed");
        this.followAfterCommit(flight, correlation, revision as number);
        this.inFlight = false;
        this.pending = null;
        this.activationStep = 0;
        this.clearEcho();
    }

    // Legacy follow after a fully committed send: switch to the Rust-planned
    // target desktop and focus the moved window. Runs only for the current
    // fenced flight after an exact validated accepted/applied send plus a
    // verified correct target/object/domain post-observation. Rejected, stale,
    // mismatched, or duplicate echoes never reach here (they fail or ignore
    // the flight before commit). A fresh post-commit observation re-runs the
    // strict planned-post binding; any drift skips follow silently without a
    // second admit/remove, without adapter-lost (Rust already committed and
    // holds no pending), and without retry. Missing follow hooks also skip
    // silently so unit harnesses without a desktop surface still commit.
    private followAfterCommit(flight: number, correlation: string, revision: number): void {
        if (!this.inFlight || flight !== this.activeToken) {
            return;
        }
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null) {
            return;
        }
        const switchToTarget = this.env.switchToTarget;
        const focusWindow = this.env.focusWindow;
        if (typeof switchToTarget !== "function" || typeof focusWindow !== "function") {
            return;
        }
        const fresh = this.freshObserved(pending.targetWorkspace);
        if (fresh === null) {
            return;
        }
        if (this.verifyPlannedPost(planned, pending, fresh) !== "") {
            return;
        }
        if (fresh.targetDesktopRef === null || fresh.targetDesktopRef !== pending.targetDesktopRef) {
            return;
        }
        let moverRef: object | null = null;
        for (const entry of fresh.targetWindows) {
            if (entry.id === pending.moverId) {
                moverRef = entry.ref;
                break;
            }
        }
        if (moverRef === null) {
            return;
        }
        let switched = false;
        try {
            switched = switchToTarget(fresh.targetDesktopRef) === true;
        } catch (error) {
            void error;
            switched = false;
        }
        if (!switched) {
            return;
        }
        let focused = false;
        try {
            focused = focusWindow(moverRef) === true;
        } catch (error) {
            void error;
            focused = false;
        }
        if (!focused) {
            return;
        }
        this.diag("follow", correlation, revision, "follow", "completed");
    }

    private failFlight(flight: number, correlation: string, outcome: string): void {
        if (flight !== this.activeToken) {
            return;
        }
        const pending = this.pending;
        const revision = pending === null ? 0 : pending.baseRevision;
        // Post-plan terminal divergence: one bounded best-effort
        // `send-to-workspace-ack` `adapter-lost` to the still pinned owner
        // before disabling. Never the well-known name, never a retry, and a
        // failed report never changes the failure behavior.
        this.reportAdapterLost();
        this.inFlight = false;
        this.pending = null;
        this.activationStep = 0;
        this.pinnedOwner = null;
        this.clearEcho();
        this.diag("result", correlation, revision, "result", outcome);
        this.disable();
    }

    private failTerminal(flight: number, correlation: string, outcome: string): void {
        this.failFlight(flight, correlation, outcome);
    }

    private onTimeout(flight: number, stage: string): void {
        if (!this.inFlight || flight !== this.activeToken) {
            return;
        }
        const pending = this.pending;
        const correlation = pending === null ? "" : pending.correlation;
        const revision = pending === null ? 0 : pending.baseRevision;
        this.clearTimer();
        // Post-plan timeout (ack/verify waiting on a valid planned reply) also
        // reports one best-effort adapter-lost to the pinned owner. The
        // whole-flight deadline stays the only terminal deadline while the
        // mover echo is pending.
        this.reportAdapterLost();
        this.inFlight = false;
        this.pending = null;
        this.activationStep = 0;
        this.pinnedOwner = null;
        this.clearEcho();
        this.diag("result", correlation, revision, `timeout-${stage}`, "timeout");
        this.disable();
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

    // Bounded best-effort terminal divergence for a received plan that can no
    // longer be completed locally. One narrow fire-and-forget
    // `send-to-workspace-ack` with `ack_outcome: "adapter-lost"` bound to the
    // exact pending owner/generation/correlation/base revision. No timer, no
    // retry, no native write; the noop callback never touches flight state so
    // stray replies cannot race. Never fires before a valid planned reply
    // exists (pending.operation/preconditions are only set after
    // `validatePlanned`), never falls back to the well-known name, and a
    // failed report never changes the failure behavior.
    private reportAdapterLost(): void {
        const pending = this.pending;
        if (
            pending === null ||
            pending.operation === null ||
            pending.preconditions === null ||
            this.lossReported
        ) {
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
                v: WORKSPACE_SEND_CONTRACT_VERSION,
                correlation_id: pending.correlation,
                owner: this.owner,
                generation: this.generation,
                revision: pending.baseRevision,
                fingerprint: this.snapshotFingerprint(pending.snapshot),
                domain: {
                    output: pending.snapshot.sourceOutput,
                    workspace: pending.snapshot.sourceWorkspace,
                    bounds: {
                        x: pending.snapshot.sourceBounds.x,
                        y: pending.snapshot.sourceBounds.y,
                        w: pending.snapshot.sourceBounds.w,
                        h: pending.snapshot.sourceBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                target_domain: {
                    output: pending.snapshot.targetOutput,
                    workspace: pending.snapshot.targetWorkspace,
                    bounds: {
                        x: pending.snapshot.targetBounds.x,
                        y: pending.snapshot.targetBounds.y,
                        w: pending.snapshot.targetBounds.w,
                        h: pending.snapshot.targetBounds.h,
                    },
                    gap: DOMAIN_GAP,
                    outer_gap: OUTER_DOMAIN_GAP,
                },
                focused_window: "",
                windows: [],
                target_windows: [],
                command: { op: "send-to-workspace-ack", ack_outcome: "adapter-lost" },
            });
        } catch (error) {
            void error;
            return;
        }
        if (payload.length === 0 || payload.length > WORKSPACE_SEND_MAX_REQUEST_BYTES) {
            return;
        }
        try {
            this.env.callDbus(
                target,
                WORKSPACE_SEND_OBJECT,
                WORKSPACE_SEND_INTERFACE,
                WORKSPACE_SEND_METHOD,
                payload,
                () => {},
            );
        } catch (error) {
            void error;
        }
    }

    // Scope fingerprint from the retained primitive-only snapshot (the request
    // observation already passed strict validation, so its fingerprints are
    // trusted without a live observation).
    private snapshotFingerprint(snapshot: WorkspaceSendSnapshot): number {
        const source = parseInt(snapshot.sourceFingerprint, 10) || 0;
        const target = parseInt(snapshot.targetFingerprint, 10) || 0;
        return (source ^ target) >>> 0;
    }

    // Refusal during pre-flight (no correlation yet): one structured route
    // diagnostic with an exact bounded token, then disable fail-closed.
    private refuse(outcome: string): void {
        this.diag("request", "", 0, "refuse", outcome);
        this.disable();
    }

    private diag(stage: string, correlation: string, revision: number, event: string, outcome: string): void {
        try {
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} stage=${stage} correlation=${correlation} generation=${this.generation} revision=${String(revision)} event=${event} outcome=${outcome}`,
            );
        } catch (error) {
            void error;
        }
    }
}