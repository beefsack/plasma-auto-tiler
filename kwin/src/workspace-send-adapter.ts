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
// plus the mover's Window.desktops membership write. A fresh exact native
// membership observation may then switch to the target desktop and focus the
// mover before unrelated geometry convergence; Rust acknowledgement and commit
// still require the complete exact post-observation and structured route
// diagnostics.
//
// Activation first uses NameHasOwner's normal boolean reply. A present owner is
// resolved and pinned; only a confirmed absent name runs one
// StartServiceByName(service, 0) phase accepting 1 PrimaryOwner / 2
// AlreadyOwner, followed by one post-start GetNameOwner. Every planner call
// targets that pinned unique `:N.M` owner. One timer, no retry, no polling.
// Same-UID authorization stays solely the Planner's existing single check.
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
// last-desktop (no distinct target desktop can exist). Pre-flight refusals
// (scope-invalid plus the requestSend validation tokens above) log one
// structured best-effort `plasma-auto-tiler:route-diag` line and return false
// with the adapter still enabled, so a later valid send can proceed. Every
// post-flight/planner/stale/owner/generation/partial/timeout divergence
// disables the adapter and emits one structured best-effort
// `plasma-auto-tiler:route-diag` line with fixed fields (component, stage,
// correlation, generation, revision, event, outcome) carrying no sensitive,
// native, or payload data. A post-plan failure additionally sends one bounded
// best-effort `send-to-workspace-ack` `adapter-lost` to the still pinned
// unique owner before disabling; never the well-known name, never a retry.
//
// All logs are fixed redacted tokens. Only minimal public events are used and
// all are detached on disable. No polling.

import { DOMAIN_GAP_DEFAULT, DomainGaps, normalizeGap, OUTER_DOMAIN_GAP_DEFAULT, readDomainGaps } from "./domain-gap";
import { orderGeometryWrites } from "./geometry-order";
import { KWIN_TRACE_ENABLED } from "./trace";

export const WORKSPACE_SEND_SERVICE = "org.plasmaautotiler.Planner";
export const WORKSPACE_SEND_OBJECT = "/org/plasmaautotiler/Planner";
export const WORKSPACE_SEND_INTERFACE = "org.plasmaautotiler.Planner1";
export const WORKSPACE_SEND_METHOD = "DescribePlan";

// Session D-Bus activation transport (one-flight, bounded, no poll/retry).
// NameHasOwner observes presence without relying on GetNameOwner's error reply,
// which KWin Script does not deliver to callbacks. A present name is resolved
// and pinned; an absent name runs exactly one StartServiceByName(service, 0)
// phase accepting only result codes 1 (PrimaryOwner) / 2 (AlreadyOwner), then
// resolves and pins one unique owner before any planner call. Flags value 0 is
// fixed; the entry appends it as the second native D-Bus argument.
export const WORKSPACE_SEND_DBUS_SERVICE = "org.freedesktop.DBus";
export const WORKSPACE_SEND_DBUS_OBJECT = "/org/freedesktop/DBus";
export const WORKSPACE_SEND_DBUS_INTERFACE = "org.freedesktop.DBus";
export const WORKSPACE_SEND_HAS_OWNER_METHOD = "NameHasOwner";
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
    // Session-local redacted follow diagnostics only. tgt_* is the flight
    // target native mapping (targetOrdinal: index in the live `desktops` list
    // order, targetNumber: KWin native `x11DesktopNumber`, -1 when unreadable).
    // cur_* is the live current desktop for the selected output at observation
    // time (currentOrdinal/currentNumber likewise, currentIdEq: current stable
    // id === target stable id, currentRefEq: current wrapper === target
    // wrapper, diagnostic only). outputOrdinal is the index of the selected
    // output in `screens` (-1 when unreadable). Populated by production
    // observation; absent in dev harnesses and legacy isolated tests. Never
    // validated for correctness: invalid values sanitize to -1 in diagnostics
    // and never affect commit, follow, or enablement.
    readonly targetOrdinal?: number;
    readonly targetNumber?: number;
    readonly outputOrdinal?: number;
    readonly currentOrdinal?: number;
    readonly currentNumber?: number;
    readonly currentIdEq?: number;
    readonly currentRefEq?: number;
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
    readonly observe: (targetWorkspace: string, pinnedSourceWorkspace?: string) => WorkspaceSendObserved | null;
    // Settlement edge for entry-owned coordination: invoked exactly once
    // after a committed send no longer blocks Plan and after follow/focus
    // ordering. Never invoked for pre-dispatch clean recovery or uncertain
    // terminal divergence.
    readonly onCommitted?: () => void;
    readonly setGeometry: (target: object, rect: WorkspaceSendRect) => boolean;
    readonly readGeometry?: (target: object) => WorkspaceSendRect | null;
    readonly setDesktops: (target: object, refs: ReadonlyArray<object>) => boolean;
    readonly switchToTarget?: (desktopRef: object, diagnostic: WorkspaceFollowNativeDiagnostic) => boolean;
    readonly focusWindow?: (windowRef: object, diagnostic: WorkspaceFollowNativeDiagnostic) => boolean;
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

// Bounded per-flight sequencing is diagnostic-only. Production native hooks use
// it to place their synchronous call/readback records among adapter records.
export interface WorkspaceFollowNativeDiagnostic {
    readonly correlation: string;
    readonly revision: number;
    readonly nextSequence: () => number;
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

// Bounded redacted integer for follow diagnostics: a finite integer inside
// [min, max] passes through, anything else (absent, wrong type,
// out-of-range, log/observe exception residue) sanitizes to -1. Never throws.
function toDiagInt(value: unknown, min: number, max: number): number {
    try {
        if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
            return -1;
        }
        return value;
    } catch (error) {
        void error;
        return -1;
    }
}

// Requested logical ordinal from requestWorkspaceMove (0 permitted for the
// trailing target, 1..9 otherwise). Diagnostic only: anything else sanitizes
// to -1 and never gates behavior. Never throws.
function toDiagOrdinal(value: unknown): number {
    return toDiagInt(value, 0, 9);
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

// Flight-pinned basis for follow diagnostics only. Carries the mover stable
// id, the flight stable target id plus request target output, the flight
// target wrapper for diagnostic equality, and the requested logical ordinal
// from the plan entry (0 permitted for the trailing target, -1 when absent).
// srcInSource/srcInTarget freeze the immutable dispatch-time source
// membership (1 present, 0 absent, -1 unknown). Never logged in raw form and
// never used for follow decisions.
interface WorkspaceFollowDiagBasis {
    readonly moverId: string;
    readonly targetWorkspace: string;
    readonly targetOutput: string;
    readonly targetDesktopRef: object | null;
    readonly requestedOrdinal: number;
    readonly srcInSource: number;
    readonly srcInTarget: number;
}

// Immutable dispatch-time mover membership from the dispatch snapshot.
// Returns 1/0 per scope, -1 when unreadable. Never throws and never logs raw
// identifiers. Called once at dispatch; results are stored on the pending
// flight and never rederived.
function snapshotMoverFlags(
    snapshot: WorkspaceSendSnapshot,
    moverId: string,
): { srcInSource: number; srcInTarget: number } {
    try {
        let inSource = 0;
        let inTarget = 0;
        for (const entry of snapshot.sourceWindows) {
            if (entry.id === moverId) {
                inSource = 1;
                break;
            }
        }
        for (const entry of snapshot.targetWindows) {
            if (entry.id === moverId) {
                inTarget = 1;
                break;
            }
        }
        return { srcInSource: inSource, srcInTarget: inTarget };
    } catch (error) {
        void error;
        return { srcInSource: -1, srcInTarget: -1 };
    }
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
    // Requested logical ordinal from the plan entry (0 permitted for the
    // trailing target, -1 when absent/invalid). Diagnostic only: never gates
    // request, commit, follow, or enablement.
    readonly requestedOrdinal: number;
    // Immutable dispatch-time mover membership, computed once at dispatch
    // from the dispatch snapshot and never rederived. Diagnostic only.
    readonly srcInSource: number;
    readonly srcInTarget: number;
    baseRevision: number;
    preconditions: readonly string[];
    operation: Record<string, unknown> | null;
    planned: WorkspacePlanned | null;
    verifiedObserved: WorkspaceSendObserved | null;
    acked: boolean;
    // Native move/follow is a distinct, at-most-once partial-success result.
    // It never advances the Rust acknowledgement or layout commit phases.
    followStarted: boolean;
    followOutcome: string;
    // Armed geometry-fence size recorded after subscriptions succeed.
    // Diagnostic only: never gates behavior.
    fenceTotal: number;
}

interface GeometryReadbackDetail {
    readonly outcome: string;
    readonly dx: number;
    readonly dy: number;
    readonly dw: number;
    readonly dh: number;
}

interface GeometryVerifyDetail {
    readonly reason: string;
    readonly geoIdx: number;
    readonly role: string;
    readonly dx: number;
    readonly dy: number;
    readonly dw: number;
    readonly dh: number;
}

// Source-grounded request-phase recovery rule: Planner::
// evaluate_workspace_request (src/planner_protocol.rs) stores
// `workspace_pending` only on the Ok(plan) path, and its only
// pre-existing-pending rejection is kind "pending-exists"; pre-existing
// pending divergence is outcome "diverged". Therefore a well-formed request
// reply (valid version/correlation, outcome "rejected", bounded valid kind
// per sanitizeKind) with any kind other than "pending-exists" proves Rust
// retained no pending and ran before any native write (planned === null here).
// Only "pending-exists" and malformed "unknown" stay terminal on this path.
// Version/correlation envelope mismatch, outcome "diverged", lost/timeout/
// request-send ambiguity/owner loss, and every post-plan ack/verify response
// stay terminal elsewhere. Post-plan/native-mutated phases never use this.
const TERMINAL_REQUEST_REJECTION = "pending-exists";

export interface WorkspaceSendGaps {
    readonly innerGap?: unknown;
    readonly outerGap?: unknown;
}

export class WorkspaceSendAdapter {
    private enabled = false;
    private startupEnabled = false;
    private owner = "";
    private generation = "";
    // Startup-bound validated gap configuration: resolved once at
    // construction, reused for every request builder. No reload or
    // in-flight mutation.
    private readonly innerGap: number;
    private readonly outerGap: number;
    private inFlight = false;
    // A post-plan terminal result can leave native membership ahead of Rust's
    // committed domain. Keep Plan from adopting that uncommitted visible state.
    private planBlocked = false;
    private token = 0;
    private activeToken = 0;
    private deadlineToken = 0;
    private activeDeadline = 0;
    private timeoutDepth = 0;
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
    private geoRefs = new Map<string, object>();
    private geoDiagSeq = 0;
    private diagSeq = 0;
    // KWin signals may be delivered synchronously from a setter. Do not let
    // them complete a flight or switch desktops while the write stack is live.
    private nativeWriteDepth = 0;
    private nativeFollowDepth = 0;

    constructor(
        private readonly env: WorkspaceSendAdapterEnv,
        gaps?: WorkspaceSendGaps,
    ) {
        let resolved: DomainGaps | null = null;
        try {
            if (gaps !== undefined) {
                resolved = { innerGap: normalizeGap(gaps.innerGap), outerGap: normalizeGap(gaps.outerGap) };
            } else {
                resolved = readDomainGaps();
            }
        } catch (error) {
            void error;
            resolved = null;
        }
        if (resolved === null) {
            this.innerGap = DOMAIN_GAP_DEFAULT;
            this.outerGap = OUTER_DOMAIN_GAP_DEFAULT;
        } else {
            this.innerGap = resolved.innerGap;
            this.outerGap = resolved.outerGap;
        }
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    get blocksPlan(): boolean {
        return this.inFlight || this.planBlocked;
    }

    // Derived from the existing retained flight only. Entry diagnostics use
    // this to label a refused shortcut without retaining another history.
    get activeCorrelation(): string {
        return this.pending?.correlation ?? "";
    }

    get activeStage(): string {
        const pending = this.pending;
        if (!this.inFlight || pending === null) {
            return "idle";
        }
        if (this.activationStep !== 5) {
            return "activation";
        }
        if (pending.planned === null) {
            return "request";
        }
        if (pending.verifiedObserved === null) {
            return "fence";
        }
        return pending.acked ? "verify" : "ack";
    }

    // Bounded transaction identities for native cleanup ordering: the exact
    // pending source/target workspace ids, present only while a valid plan is
    // bound (post-plan, pre-commit/terminal). Empty before a plan or after
    // the flight settles, so retention is strictly transaction-lifetime.
    // Primitive ids only, never refs or history.
    get pendingWorkspaces(): ReadonlyArray<string> {
        const pending = this.pending;
        if (!this.inFlight || pending === null || pending.planned === null) {
            return Object.freeze([]);
        }
        return Object.freeze([pending.snapshot.sourceWorkspace, pending.snapshot.targetWorkspace]);
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
        this.geoRefs = new Map<string, object>();
        this.geoDiagSeq = 0;
        this.diagSeq = 0;
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
        // Silent pre-commit teardown emits one best-effort redacted terminal
        // diagnostic before the loss report so a future exact occurrence can
        // distinguish an incomplete mover/geometry fence, a
        // `stale-revision` versus `post-observation-mismatch` verifier
        // outcome, and direct disable teardown versus unknown log delivery.
        // Diagnostic-only: never gates, retries, writes, or re-enables.
        this.logDisableTerminal();
        this.reportAdapterLost();
        this.enabled = false;
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.activeDeadline = 0;
        this.clearTimer();
        this.clearEcho();
    }

    requestSend(targetWorkspace: unknown, requestedOrdinal?: unknown): boolean {
        if (!this.enabled) {
            this.refuse("disabled");
            return false;
        }
        if (this.inFlight) {
            this.diag("request", this.activeCorrelation, this.pending?.baseRevision ?? 0, "refuse", "in-flight");
            return false;
        }
        if (!isOpaqueId(targetWorkspace)) {
            this.refuse("target-invalid");
            return false;
        }
        if (this.seq < 0 || this.seq > WORKSPACE_SEND_MAX_SEQ) {
            this.refuse("sequence-invalid");
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
            this.refuse("correlation-invalid");
            return false;
        }
        const snapshot = snapshotOf(observed);
        const payload = this.buildRequestPayload(observed, correlation);
        if (payload === null || payload.length > WORKSPACE_SEND_MAX_REQUEST_BYTES) {
            this.refuse("payload-invalid");
            return false;
        }
        // Diagnostic-only handoff: an invalid ordinal sanitizes to -1 in logs
        // and never refuses or otherwise gates the send.
        this.startFlight(
            correlation,
            snapshot,
            observed,
            observed.targetWorkspace,
            observed.focusedId,
            observed.targetDesktopRef,
            payload,
            toDiagOrdinal(requestedOrdinal),
        );
        return this.inFlight;
    }

    private freshObserved(targetWorkspace: string, pinnedSourceWorkspace?: string): WorkspaceSendObserved | null {
        let observed: WorkspaceSendObserved | null = null;
        try {
            observed = this.env.observe(targetWorkspace, pinnedSourceWorkspace);
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
        observed: WorkspaceSendObserved,
        targetWorkspace: string,
        moverId: string,
        targetDesktopRef: object | null,
        payload: string,
        requestedOrdinal: number,
    ): void {
        this.inFlight = true;
        this.callbackSeen = false;
        this.clearEcho();
        this.geoDiagSeq = 0;
        this.diagSeq = 0;
        const flags = snapshotMoverFlags(snapshot, moverId);
        this.pending = {
            correlation,
            snapshot,
            targetWorkspace,
            moverId,
            windowCount: snapshot.sourceWindows.length + snapshot.targetWindows.length,
            requestPayload: payload,
            targetDesktopRef,
            requestedOrdinal,
            srcInSource: flags.srcInSource,
            srcInTarget: flags.srcInTarget,
            baseRevision: 0,
            preconditions: [],
            operation: null,
            planned: null,
            verifiedObserved: null,
            acked: false,
            followStarted: false,
            followOutcome: "not-reached",
            fenceTotal: 0,
        };
        // True command-dispatch observation at the request boundary, using the
        // original dispatch observation and revision 0. Best-effort only.
        this.emitFollowDiag(
            correlation,
            0,
            "send-dispatched",
            observed,
            {
                moverId,
                targetWorkspace: snapshot.targetWorkspace,
                targetOutput: snapshot.targetOutput,
                targetDesktopRef,
                requestedOrdinal,
                srcInSource: flags.srcInSource,
                srcInTarget: flags.srcInTarget,
            },
            -1,
            -1,
        );
        this.pinnedOwner = null;
        this.activationStep = 1;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        this.deadlineToken += 1;
        this.activeDeadline = this.deadlineToken;
        const deadline = this.activeDeadline;
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(WORKSPACE_SEND_TIMEOUT_MS, () => this.onTimeout(flight, "request", deadline));
        } catch (error) {
            void error;
            this.inFlight = false;
            this.activationStep = 0;
            this.pending = null;
            this.activeDeadline = 0;
            this.refuse("timeout");
            return;
        }
        this.cancelTimer = cancel;
        // Phase 1: distinguish presence through NameHasOwner's normal boolean
        // reply. KWin does not call back for GetNameOwner's absent-name error.
        try {
            this.env.callDbus(
                WORKSPACE_SEND_DBUS_SERVICE,
                WORKSPACE_SEND_DBUS_OBJECT,
                WORKSPACE_SEND_DBUS_INTERFACE,
                WORKSPACE_SEND_HAS_OWNER_METHOD,
                WORKSPACE_SEND_SERVICE,
                (reply) => this.onNamePresence(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.activeDeadline = 0;
        }
    }

    private onNamePresence(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 1) {
            return;
        }
        if (reply === true) {
            this.activationStep = 2;
            try {
                this.env.callDbus(
                    WORKSPACE_SEND_DBUS_SERVICE,
                    WORKSPACE_SEND_DBUS_OBJECT,
                    WORKSPACE_SEND_DBUS_INTERFACE,
                    WORKSPACE_SEND_GET_OWNER_METHOD,
                    WORKSPACE_SEND_SERVICE,
                    (ownerReply) => this.onOwnerInitial(ownerReply, flight, correlation),
                );
            } catch (error) {
                void error;
                this.clearTimer();
                this.inFlight = false;
                this.activationStep = 0;
                this.pending = null;
                this.diag("request", correlation, 0, "activate", "no-planner");
                this.activeDeadline = 0;
            }
            return;
        }
        if (reply !== false) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.activeDeadline = 0;
            return;
        }
        // Absent name: exactly one StartServiceByName(service, 0) phase.
        this.activationStep = 3;
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
            this.activeDeadline = 0;
        }
    }

    private onOwnerInitial(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 2) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.activeDeadline = 0;
            return;
        }
        this.pinnedOwner = reply;
        this.activationStep = 5;
        this.diag("request", correlation, 0, "activate", "owner-pinned");
        this.sendPlannerRequest(flight, correlation);
    }

    private onStartResult(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 3) {
            return;
        }
        if (reply !== WORKSPACE_SEND_START_PRIMARY && reply !== WORKSPACE_SEND_START_ALREADY) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.activeDeadline = 0;
            return;
        }
        // Exactly one bounded post-activation owner resolution, then pin
        // before any planner call. No retry on failure.
        this.activationStep = 4;
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
            this.activeDeadline = 0;
        }
    }

    private onOwnerAfterStart(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 4) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pending = null;
            this.diag("request", correlation, 0, "activate", "no-planner");
            this.activeDeadline = 0;
            return;
        }
        this.pinnedOwner = reply;
        this.activationStep = 5;
        this.diag("request", correlation, 0, "activate", "owner-pinned");
        this.sendPlannerRequest(flight, correlation);
    }

    private sendPlannerRequest(flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 5) {
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
            this.activeDeadline = 0;
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
        if (pending === null || !isUniqueOwner(this.pinnedOwner) || this.activationStep !== 5) {
            return;
        }
        // Late duplicate request replies after the plan is bound (including
        // after a pre-ack timeout settlement) must never replay native writes.
        // Missing/malformed/lost replies, timeouts, owner loss, and transport
        // ambiguity are never treated as no-pending: Rust may create pending
        // before the client receives the reply.
        if (pending.planned !== null) {
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
        if (outcome === "diverged") {
            this.failFlight(flight, correlation, sanitizeKind(parsed["kind"]));
            return;
        }
        if (outcome === "rejected") {
            const kind = sanitizeKind(parsed["kind"]);
            // Source-grounded remote-clean recovery: any well-formed
            // request-phase rejection other than "pending-exists" proves Rust
            // retained no pending (pending is only stored on the planned path
            // after the pending-exists gate). No native write has occurred
            // (planned === null checked above), so no adapter-lost is sent,
            // the adapter stays enabled, and the next distinct send may
            // proceed. "pending-exists", malformed "unknown", outcome
            // "diverged", and every post-plan rejection with native mutation
            // stay terminal.
            if (kind !== "unknown" && kind !== TERMINAL_REQUEST_REJECTION) {
                this.recoverClean(flight, correlation, kind);
                return;
            }
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
        const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
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
            this.nativeWriteDepth += 1;
            const geometryWritten = this.writeGeometries(planned, pending, fresh);
            if (!geometryWritten) {
                this.nativeWriteDepth -= 1;
                this.failFlight(flight, correlation, "write-failed");
                return;
            }
            // Pre-write observation immediately before mover membership write.
            this.emitFollowDiag(correlation, planned.baseRevision, "send-pre-mover", fresh, this.diagBasisOf(pending), -1, -1);
            const moverWritten = this.writeMoverDesktops(pending, fresh);
            this.nativeWriteDepth -= 1;
            if (!moverWritten) {
                this.failFlight(flight, correlation, "write-failed");
                return;
            }
            this.followAfterNativeMove(flight, correlation);
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
                this.geoRefs.set(windowId, ref);
            }
        }
        pending.fenceTotal = this.geoPending.size;
        this.nativeWriteDepth += 1;
        const geometryWritten = this.writeGeometries(planned, pending, fresh);
        if (!geometryWritten) {
            this.nativeWriteDepth -= 1;
            this.clearEcho();
            this.failFlight(flight, correlation, "write-failed");
            return;
        }
        // Pre-write observation immediately before mover membership write.
        this.emitFollowDiag(correlation, planned.baseRevision, "send-pre-mover", fresh, this.diagBasisOf(pending), -1, -1);
        const moverWritten = this.writeMoverDesktops(pending, fresh);
        this.nativeWriteDepth -= 1;
        if (!moverWritten) {
            this.clearEcho();
            this.failFlight(flight, correlation, "write-failed");
            return;
        }
        this.followAfterNativeMove(flight, correlation);
        // Synchronous fence callbacks may have consumed every echo while the
        // native writes were guarded. Resume completion only after follow has
        // returned from its switch/focus setter stack.
        this.tryMaybeComplete(flight, correlation);
        if (!this.inFlight || flight !== this.activeToken) {
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
        const entry = this.geometryEntry(planned, windowId);
        if (KWIN_TRACE_ENABLED) {
            this.logGeometryDiag({
                correlation,
                revision: planned.baseRevision,
                event: "plan-geometry",
                outcome: "consumed",
                planned,
                pending,
                entry,
                writeOrdinal: -1,
                writeTotal: -1,
                writeReturned: -1,
                readback: this.readGeometryDetail(this.geoRefs.get(windowId), entry?.rect),
            });
        }
        if (detach !== undefined) {
            this.geoDetaches.delete(windowId);
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
        this.geoPending.delete(windowId);
        this.geoRefs.delete(windowId);
        this.tryMaybeComplete(flight, correlation);
    }

    private tryMaybeComplete(flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.nativeWriteDepth > 0 || this.nativeFollowDepth > 0) {
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
        if (this.nativeWriteDepth > 0 || this.nativeFollowDepth > 0) {
            return;
        }
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
        // still matching the captured stable scope. Any mismatch is terminal without
        // a verify commit.
        const verified = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
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
        // The complete observation is also a valid membership proof when no
        // earlier native read observed the mover transfer.
        this.followAfterNativeMove(flight, correlation, verified);
        // Post-write observation: verified read shows the mover in target
        // while the basis keeps the frozen dispatch source. Best-effort only.
        this.emitFollowDiag(correlation, planned.baseRevision, "send-post-mover", verified, this.diagBasisOf(pending), -1, -1);
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
        this.geoRefs = new Map<string, object>();
    }

    private writeGeometries(
        planned: WorkspacePlanned,
        flightState: WorkspacePendingFlight,
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
        for (let writeOrdinal = 0; writeOrdinal < ordered.length; writeOrdinal += 1) {
            const entry = ordered[writeOrdinal];
            if (entry === undefined) {
                return false;
            }
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
            if (KWIN_TRACE_ENABLED) {
                this.logGeometryDiag({
                    correlation: planned.correlationId,
                    revision: planned.baseRevision,
                    event: "geometry-write",
                    outcome: "returned",
                    planned,
                    pending: flightState,
                    entry,
                    writeOrdinal,
                    writeTotal: ordered.length,
                    writeReturned: written ? 1 : 0,
                    readback: this.readGeometryDetail(target, entry.rect),
                });
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
            verified.targetDesktopRef === null ||
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

    // Native move-follow deliberately verifies only the transferred mover and
    // immutable flight scope. Retained geometry remains an acknowledgement and
    // commit gate in verifyPlannedPost, never a visibility/focus prerequisite.
    private verifyNativeMove(
        planned: WorkspacePlanned,
        pending: WorkspacePendingFlight,
        observed: WorkspaceSendObserved,
    ): object | null {
        const snapshot = pending.snapshot;
        if (
            pending.planned !== planned ||
            !this.operationMatchesSnapshot(planned, pending) ||
            observed.sourceOutput !== snapshot.sourceOutput ||
            observed.sourceWorkspace !== snapshot.sourceWorkspace ||
            observed.targetOutput !== snapshot.targetOutput ||
            observed.targetWorkspace !== snapshot.targetWorkspace ||
            observed.sourceBounds.x !== snapshot.sourceBounds.x ||
            observed.sourceBounds.y !== snapshot.sourceBounds.y ||
            observed.sourceBounds.w !== snapshot.sourceBounds.w ||
            observed.sourceBounds.h !== snapshot.sourceBounds.h ||
            observed.targetBounds.x !== snapshot.targetBounds.x ||
            observed.targetBounds.y !== snapshot.targetBounds.y ||
            observed.targetBounds.w !== snapshot.targetBounds.w ||
            observed.targetBounds.h !== snapshot.targetBounds.h ||
            observed.targetExists !== true ||
            observed.targetDesktopRef === null
        ) {
            return null;
        }
        if (observed.sourceWindows.some((entry) => entry.id === pending.moverId)) {
            return null;
        }
        for (const entry of observed.targetWindows) {
            if (entry.id === pending.moverId) {
                return entry.ref;
            }
        }
        return null;
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
        // Late duplicate ack replies (including after a pre-ack timeout
        // settlement already consumed the ack) must never replay verify.
        // Ack/verify timeouts stay uncertain and never re-interpret a
        // well-formed no-pending rejection as success.
        if (pending.acked) {
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
        pending.acked = true;
        this.diag("ack", correlation, pending.baseRevision, "ack", "acknowledged");
        // Scope may have changed between the ack and the verify: take a fresh
        // observation and rerun the strict post-observation binding so stale
        // data never reaches a verify. Any mismatch fails closed with one
        // best-effort adapter-lost report.
        const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
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
        // The committed exact observation remains a final one-shot follow
        // proof if an earlier native membership read was unavailable.
        this.followAfterNativeMove(flight, correlation);
        this.inFlight = false;
        // Settled-observation basis for the later follow-settled line below.
        // Captured before teardown so the existing settlement edge stays
        // correlated without a new subscription, timer, or poll. Source
        // membership stays frozen from the immutable dispatch snapshot.
        const settledBasis: WorkspaceFollowDiagBasis | null =
            this.pending === null ? null : this.diagBasisOf(this.pending);
        const settledSource: string | null = this.pending === null ? null : this.pending.snapshot.sourceWorkspace;
        this.pending = null;
        this.activationStep = 0;
        this.activeDeadline = 0;
        this.clearEcho();
        try {
            this.env.onCommitted?.();
        } catch (error) {
            void error;
        }
        // Relevant existing later lifecycle observation boundary: one
        // best-effort synchronous public re-observation after the settlement
        // edge, correlated with this flight. Diagnostic only: a null/absent
        // observation logs unknown fields and never affects commit, flight
        // teardown, resync, or enablement.
        let settled: WorkspaceSendObserved | null = null;
        try {
            settled =
                settledBasis === null || settledSource === null
                    ? null
                    : this.freshObserved(settledBasis.targetWorkspace, settledSource);
        } catch (error) {
            void error;
            settled = null;
        }
        this.emitFollowDiag(correlation, revision as number, "follow-settled", settled, settledBasis, -1, -1);
    }

    // Follow a confirmed native mover transfer once. The caller may supply a
    // just-verified complete observation; otherwise this takes one fresh read.
    // It intentionally does not acknowledge, commit, retire fences, or resync.
    private followAfterNativeMove(
        flight: number,
        correlation: string,
        observed?: WorkspaceSendObserved,
    ): void {
        if (
            !this.inFlight ||
            flight !== this.activeToken ||
            this.activationStep !== 5 ||
            this.nativeWriteDepth > 0 ||
            this.nativeFollowDepth > 0 ||
            !isUniqueOwner(this.pinnedOwner)
        ) {
            return;
        }
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null || pending.followStarted || pending.correlation !== correlation) {
            return;
        }
        const switchToTarget = this.env.switchToTarget;
        const focusWindow = this.env.focusWindow;
        if (typeof switchToTarget !== "function" || typeof focusWindow !== "function") {
            pending.followStarted = true;
            pending.followOutcome = "hooks-unavailable";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            return;
        }
        const fresh = observed ?? this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        if (fresh === null) {
            return;
        }
        const moverRef = this.verifyNativeMove(planned, pending, fresh);
        const targetDesktopRef = fresh.targetDesktopRef;
        if (moverRef === null || targetDesktopRef === null) {
            return;
        }
        // Flight-pinned diagnostic basis. The gates above stay the only
        // correctness checks (stable-id binding plus the existing ref gate);
        // current wrapper equality below is diagnostic only. Source membership
        // stays frozen from the immutable dispatch snapshot.
        const basis: WorkspaceFollowDiagBasis = this.diagBasisOf(pending);
        // Before-setter observation: the pre-switch `fresh` binding above.
        pending.followStarted = true;
        this.diag("follow", correlation, planned.baseRevision, "native-move-confirmed", "observed");
        this.emitFollowDiag(correlation, planned.baseRevision, "follow-pre", fresh, basis, -1, -1);
        let switched = false;
        this.nativeFollowDepth += 1;
        try {
            switched = switchToTarget(targetDesktopRef, {
                correlation,
                revision: planned.baseRevision,
                nextSequence: () => this.nextDiagSeq(),
            }) === true;
        } catch (error) {
            void error;
            switched = false;
        }
        // Immediate after-setter observation: one best-effort synchronous
        // public re-read. A null observation logs unknown fields; the switch
        // result below is unaffected.
        let postSwitch: WorkspaceSendObserved | null = null;
        try {
            postSwitch = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        } catch (error) {
            void error;
            postSwitch = null;
        }
        this.emitFollowDiag(
            correlation,
            planned.baseRevision,
            "follow-switched",
            postSwitch,
            basis,
            switched ? 1 : 0,
            -1,
        );
        if (!switched) {
            pending.followOutcome = "switch-unconfirmed";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            this.nativeFollowDepth -= 1;
            return;
        }
        if (!this.inFlight || flight !== this.activeToken || this.pending !== pending) {
            this.nativeFollowDepth -= 1;
            return;
        }
        let focused = false;
        try {
            focused = focusWindow(moverRef, {
                correlation,
                revision: planned.baseRevision,
                nextSequence: () => this.nextDiagSeq(),
            }) === true;
        } catch (error) {
            void error;
            focused = false;
        }
        // After-focus observation: one best-effort synchronous public
        // re-read. Diagnostic only; the focus result below is unaffected.
        let postFocus: WorkspaceSendObserved | null = null;
        try {
            postFocus = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        } catch (error) {
            void error;
            postFocus = null;
        }
        this.emitFollowDiag(
            correlation,
            planned.baseRevision,
            "follow-focused",
            postFocus,
            basis,
            1,
            focused ? 1 : 0,
        );
        if (!focused) {
            pending.followOutcome = "focus-unconfirmed";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            this.nativeFollowDepth -= 1;
            return;
        }
        // Truthful telemetry only: WorkspaceWrapper setCurrentDesktopForScreen
        // is void and only updates the current-desktop map; visible switch,
        // activation, effects, and scene updates are downstream with no
        // composited/visible completion signal. state-confirmed means only
        // the immediate native current-map readback plus mover focus were
        // confirmed, never physical visible completion.
        pending.followOutcome = "state-confirmed";
        this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
        this.nativeFollowDepth -= 1;
    }

    // Flight-pinned diagnostic basis using the dispatch-frozen source flags
    // stored on the pending flight. Never rederives from live reads.
    private diagBasisOf(pending: WorkspacePendingFlight): WorkspaceFollowDiagBasis {
        return {
            moverId: pending.moverId,
            targetWorkspace: pending.snapshot.targetWorkspace,
            targetOutput: pending.snapshot.targetOutput,
            targetDesktopRef: pending.targetDesktopRef,
            requestedOrdinal: pending.requestedOrdinal,
            srcInSource: pending.srcInSource,
            srcInTarget: pending.srcInTarget,
        };
    }

    // Best-effort redacted visible-follow observation. Emits one fixed
    // `route-diag component=cosmic-send stage=follow` line carrying only
    // session-local ordinals/counts plus 0/1/-1 equality flags (-1 unknown):
    // req_ord (requested logical ordinal from the plan entry, 0 permitted for
    // the trailing target), tgt_ord/tgt_num (flight target live list order and
    // KWin native x11DesktopNumber), cur_ord/cur_num (live current desktop for
    // the selected output), cur_id_eq (current stable id === flight target
    // stable id), cur_ref_eq (current wrapper === flight target wrapper,
    // diagnostic only), out_ord (selected output live screens index), out_eq
    // (selected output === request target output), desktops (live desktop
    // count), mover_in_target (mover by stable id present in live target
    // windows), active_is_mover (live active wrapper === live mover wrapper),
    // src_in_src/src_in_tgt (mover present in the immutable dispatch snapshot
    // source/target scopes, frozen at dispatch so later dynamic reads never
    // overwrite the source view), switched/focused (native hook results, -1
    // when not yet invoked).
    // Together the correlated dispatch/pre/post plus pre/switched/focused/
    // settled lines distinguish the requested target (req/tgt), live current
    // divergence (cur_*), output mismatch (out_*), and state reversal after
    // focus. The dispatch/pre pair (mover_in_target=0, src_in_src=1) and post
    // line (mover_in_target=1, same frozen source) mark the membership
    // transition. Raw
    // desktop ids, output identifiers, window native ids, object refs,
    // captions, app data, payload, and environment never enter logs. Wrapper
    // equality here is diagnostic only; existing follow gates stay unchanged.
    // Never throws or affects follow result, commit, focus behavior,
    // enablement, or flight state.
    private emitFollowDiag(
        correlation: string,
        revision: number,
        event: string,
        current: WorkspaceSendObserved | null,
        basis: WorkspaceFollowDiagBasis | null,
        switched: number,
        focused: number,
    ): void {
        try {
            const outcome = current === null ? "unknown" : "observed";
            const reqOrd = basis === null ? -1 : toDiagInt(basis.requestedOrdinal, 0, 9);
            const tgtOrd = current === null ? -1 : toDiagInt(current.targetOrdinal, 0, WORKSPACE_SEND_MAX_DESKTOPS);
            const tgtNum = current === null ? -1 : toDiagInt(current.targetNumber, 1, WORKSPACE_SEND_MAX_REVISION);
            const curOrd = current === null ? -1 : toDiagInt(current.currentOrdinal, 0, WORKSPACE_SEND_MAX_DESKTOPS);
            const curNum = current === null ? -1 : toDiagInt(current.currentNumber, 1, WORKSPACE_SEND_MAX_REVISION);
            const curIdEq =
                current === null ? -1 : current.currentIdEq === 0 || current.currentIdEq === 1 ? current.currentIdEq : -1;
            const curRefEq =
                current === null ? -1 : current.currentRefEq === 0 || current.currentRefEq === 1 ? current.currentRefEq : -1;
            const outOrd = current === null ? -1 : toDiagInt(current.outputOrdinal, 0, 1024);
            const desktops = current === null ? -1 : toDiagInt(current.desktopCount, 0, WORKSPACE_SEND_MAX_REVISION);
            let outEq = -1;
            try {
                if (current !== null && basis !== null) {
                    outEq =
                        current.sourceOutput === basis.targetOutput && current.targetOutput === basis.targetOutput ? 1 : 0;
                }
            } catch (error) {
                void error;
                outEq = -1;
            }
            let moverInTarget = -1;
            let moverWrapper: object | null = null;
            try {
                if (current !== null && basis !== null) {
                    moverInTarget = 0;
                    for (const entry of current.targetWindows) {
                        if (entry.id === basis.moverId) {
                            moverInTarget = 1;
                            moverWrapper = entry.ref;
                            break;
                        }
                    }
                    if (moverWrapper === null) {
                        for (const entry of current.sourceWindows) {
                            if (entry.id === basis.moverId) {
                                moverWrapper = entry.ref;
                                break;
                            }
                        }
                    }
                }
            } catch (error) {
                void error;
                moverInTarget = -1;
                moverWrapper = null;
            }
            let activeIsMover = -1;
            try {
                if (current === null || moverWrapper === null) {
                    activeIsMover = -1;
                } else {
                    activeIsMover = current.activeRef === moverWrapper ? 1 : 0;
                }
            } catch (error) {
                void error;
                activeIsMover = -1;
            }
            const switchedFlag = switched === 0 || switched === 1 ? switched : -1;
            const focusedFlag = focused === 0 || focused === 1 ? focused : -1;
            let srcInSrc = -1;
            let srcInTgt = -1;
            try {
                if (basis !== null) {
                    srcInSrc = basis.srcInSource === 0 || basis.srcInSource === 1 ? basis.srcInSource : -1;
                    srcInTgt = basis.srcInTarget === 0 || basis.srcInTarget === 1 ? basis.srcInTarget : -1;
                }
            } catch (error) {
                void error;
                srcInSrc = -1;
                srcInTgt = -1;
            }
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} stage=follow correlation=${correlation} generation=${this.generation} revision=${String(revision)} diag_seq=${String(this.nextDiagSeq())} event=${event} outcome=${outcome} req_ord=${String(reqOrd)} tgt_ord=${String(tgtOrd)} tgt_num=${String(tgtNum)} cur_ord=${String(curOrd)} cur_num=${String(curNum)} cur_id_eq=${String(curIdEq)} cur_ref_eq=${String(curRefEq)} out_ord=${String(outOrd)} out_eq=${String(outEq)} desktops=${String(desktops)} mover_in_target=${String(moverInTarget)} active_is_mover=${String(activeIsMover)} src_in_src=${String(srcInSrc)} src_in_tgt=${String(srcInTgt)} switched=${String(switchedFlag)} focused=${String(focusedFlag)}`,
            );
        } catch (error) {
            void error;
        }
    }

    private failFlight(flight: number, correlation: string, outcome: string): void {
        if (flight !== this.activeToken) {
            return;
        }
        const pending = this.pending;
        const revision = pending === null ? 0 : pending.baseRevision;
        const followOutcome = pending?.followOutcome;
        // Post-plan terminal divergence: one bounded best-effort
        // `send-to-workspace-ack` `adapter-lost` to the still pinned owner
        // before disabling. Never the well-known name, never a retry, and a
        // failed report never changes the failure behavior.
        if (pending?.planned !== null) {
            this.planBlocked = true;
        }
        this.reportAdapterLost();
        this.inFlight = false;
        this.pending = null;
        this.activationStep = 0;
        this.pinnedOwner = null;
        this.activeDeadline = 0;
        this.clearEcho();
        this.diag("result", correlation, revision, "result", outcome, followOutcome);
        this.disable();
    }

    // Narrow remote-clean recovery: no plan/pending exists on either side, so
    // no adapter-lost is reported, the adapter stays enabled with no flight,
    // and the retired deadline can never touch a future flight. Used only for
    // failures definitely before planner request dispatch (activation paths)
    // and for well-formed request-phase rejections other than
    // "pending-exists"/"unknown" (see rule above). Ambiguous send/timeout/
    // lost/malformed/owner-loss and every post-write path stay terminal via
    // failFlight.
    private recoverClean(flight: number, correlation: string, outcome: string): void {
        if (flight !== this.activeToken) {
            return;
        }
        this.clearTimer();
        this.clearEcho();
        this.inFlight = false;
        this.pending = null;
        this.activationStep = 0;
        this.pinnedOwner = null;
        this.activeDeadline = 0;
        this.callbackSeen = false;
        this.diag("result", correlation, 0, "result", outcome);
    }

    private failTerminal(flight: number, correlation: string, outcome: string): void {
        this.failFlight(flight, correlation, outcome);
    }

    private onTimeout(flight: number, stage: string, deadline: number): void {
        if (!this.inFlight || flight !== this.activeToken || deadline !== this.activeDeadline) {
            return;
        }
        // Synchronous settlement-deadline reentrancy (scheduleOnce invoking
        // its callback before returning) must never tear down the just-settled
        // flight: ignore any reentrant timeout while settlement is arming.
        if (this.timeoutDepth > 0) {
            return;
        }
        const pending = this.pending;
        const correlation = pending === null ? "" : pending.correlation;
        const revision = pending === null ? 0 : pending.baseRevision;
        const followOutcome = pending?.followOutcome;
        // Exact pre-ack settlement only: a valid planned flight that has not
        // yet verified (verifiedObserved === null) may have converged locally
        // while its geometry/membership echoes were withheld or missed. Make
        // one fresh complete source/target observation and run the existing
        // exact verifyPlannedPost. If exact, safely retire the exhausted
        // subscriptions and enter the original ack/verify continuation with
        // the same owner/generation/correlation/base revision/preconditions/
        // operation and one normal bounded deadline. No new native write,
        // replay, new transaction, polling, false ack, or busy-key change.
        // Ack/verify timeouts (verifiedObserved !== null) stay uncertain and
        // never replay or re-interpret no-pending success. Owner validation is
        // preserved; late events/callbacks/timers cannot duplicate ack/follow
        // or touch a future flight via token, deadline epoch, echo, and acked
        // guards.
        // Permanent disablement stays for uncertain divergence; only provably
        // safe pre-dispatch failures (no valid plan, no native write) and
        // well-formed request-phase rejections other than
        // "pending-exists"/"unknown" are treated as Rust-clean.
        // Missing/malformed/lost planned replies, request timeouts, owner
        // loss, and transport ambiguity are never treated as no-pending
        // because Rust can create pending before the client receives a reply.
        // Outcome diverged is never remote-clean: Rust retains the wedged
        // pending. Explicit well-formed rejections after a plan/ack stay
        // terminal because native writes already mutated KWin state.
        if (
            pending !== null &&
            pending.planned !== null &&
            pending.verifiedObserved === null &&
            !pending.acked &&
            isUniqueOwner(this.pinnedOwner)
        ) {
            const planned = pending.planned;
            const armedTotal = pending.fenceTotal;
            const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
            if (fresh === null) {
                this.logTimeoutSettle({
                    correlation,
                    revision,
                    outcome: "fresh-unavailable",
                    verify: this.geometryVerifyDetail("none", -1, "unknown"),
                    fence: this.timeoutFenceDetail(planned, armedTotal),
                });
            } else if (this.verifyPlannedPost(planned, pending, fresh) !== "") {
                const detail = this.timeoutVerifyDetail(planned, pending, fresh);
                this.logTimeoutSettle({
                    correlation,
                    revision,
                    outcome: "verify-failed",
                    verify: detail,
                    fence: this.timeoutFenceDetail(planned, armedTotal),
                });
            } else {
                const fencePre = this.timeoutFenceDetail(planned, armedTotal);
                this.clearEcho();
                pending.verifiedObserved = fresh;
                this.followAfterNativeMove(flight, correlation, fresh);
                const payload = this.buildAckPayload(fresh, correlation, planned.baseRevision);
                if (payload === null || payload.length > WORKSPACE_SEND_MAX_REQUEST_BYTES) {
                    this.logTimeoutSettle({
                        correlation,
                        revision,
                        outcome: "payload-invalid",
                        verify: this.geometryVerifyDetail("ok", -1, "unknown"),
                        fence: fencePre,
                    });
                } else {
                    this.clearTimer();
                    this.deadlineToken += 1;
                    this.activeDeadline = this.deadlineToken;
                    const nextDeadline = this.activeDeadline;
                    let cancel: (() => void) | null = null;
                    this.timeoutDepth += 1;
                    try {
                        cancel = this.env.scheduleOnce(WORKSPACE_SEND_TIMEOUT_MS, () => this.onTimeout(flight, "ack", nextDeadline));
                    } catch (error) {
                        void error;
                        cancel = null;
                    }
                    this.timeoutDepth -= 1;
                    if (cancel !== null && isUniqueOwner(this.pinnedOwner)) {
                        this.logTimeoutSettle({
                            correlation,
                            revision,
                            outcome: "settled",
                            verify: this.geometryVerifyDetail("ok", -1, "unknown"),
                            fence: fencePre,
                        });
                        this.cancelTimer = cancel;
                        this.diag("request", correlation, planned.baseRevision, "plan", "planned");
                        this.sendAck(flight, correlation, payload);
                        return;
                    }
                    this.logTimeoutSettle({
                        correlation,
                        revision,
                        outcome: cancel === null ? "schedule-unavailable" : "owner-invalid",
                        verify: this.geometryVerifyDetail("ok", -1, "unknown"),
                        fence: fencePre,
                    });
                    // Settlement arming failed: retire the fresh deadline so the
                    // failed epoch can never fire later.
                    this.activeDeadline = 0;
                }
            }
        } else if (
            pending !== null &&
            pending.planned !== null &&
            pending.verifiedObserved === null &&
            !pending.acked
        ) {
            // The only pre-ack settlement guard that can fail after a valid
            // planned flight exists is the pinned unique owner. Keep the
            // established terminal path unchanged, but identify it.
            this.logTimeoutSettle({
                correlation,
                revision,
                outcome: "owner-invalid",
                verify: this.geometryVerifyDetail("none", -1, "unknown"),
                fence: this.timeoutFenceDetail(pending.planned, pending.fenceTotal),
            });
        }
        if (pending?.planned !== null) {
            this.planBlocked = true;
        }
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
        this.activeDeadline = 0;
        this.clearEcho();
        this.diag("result", correlation, revision, `timeout-${stage}`, "timeout", pending?.followOutcome ?? followOutcome);
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
                    gap: this.innerGap,
                    outer_gap: this.outerGap,
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
    // diagnostic with an exact bounded token. Pre-flight refusals stay
    // enabled with no flight, timer, D-Bus, native, follow, or loss report so
    // a subsequent valid send can proceed.
    private refuse(outcome: string): void {
        this.diag("request", "", 0, "refuse", outcome);
    }

    private diag(
        stage: string,
        correlation: string,
        revision: number,
        event: string,
        outcome: string,
        terminalFollowOutcome?: string,
    ): void {
        if (
            !KWIN_TRACE_ENABLED &&
            stage !== "result" &&
            stage !== "follow" &&
            event !== "refuse" &&
            outcome !== "no-planner" &&
            !(event === "plan" && outcome === "planned") &&
            !(event === "ack" && outcome === "acknowledged") &&
            !(event === "verify" && outcome === "committed")
        ) {
            return;
        }
        try {
            const followed =
                terminalFollowOutcome === "state-confirmed" ||
                terminalFollowOutcome === "switch-unconfirmed" ||
                terminalFollowOutcome === "focus-unconfirmed" ||
                terminalFollowOutcome === "hooks-unavailable";
            const followGate =
                followed && (event === "result" || event.startsWith("timeout-"))
                    ? ` follow=${terminalFollowOutcome} gate=native-move`
                    : event === "refuse"
                    ? ` follow=not-reached gate=pre-commit phase=request reason=${outcome}`
                    : event === "result"
                      ? ` follow=not-reached gate=pre-commit phase=result reason=${outcome}`
                      : event === "activate" && outcome === "no-planner"
                        ? " follow=not-reached gate=pre-commit phase=activation reason=no-planner"
                        : event.startsWith("timeout-") && outcome === "timeout"
                          ? ` follow=not-reached gate=pre-commit phase=timeout reason=${event}`
                          : "";
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} stage=${stage} correlation=${correlation} generation=${this.generation} revision=${String(revision)} diag_seq=${String(this.nextDiagSeq())} event=${event} outcome=${outcome}${followGate}`,
            );
        } catch (error) {
            void error;
        }
    }

    // Best-effort redacted timeout-settlement diagnostic for the eligible
    // pre-ack path only. One compact object call, one log line, one try/catch.
    // Carries the settlement outcome, the verifier category (scope variants,
    // geometry with plan-relative index, observed-count, mover membership,
    // retained source/target membership), and the armed fence (armed total,
    // pending count, plan-relative pending indices, mover-seen). Counts and
    // indices only; never raw ids, geometry values, payloads, captions, focus
    // data, owner, or native refs. Never affects behavior.
    private logTimeoutSettle(detail: {
        readonly correlation: string;
        readonly revision: number;
        readonly outcome: string;
        readonly verify: GeometryVerifyDetail;
        readonly fence: { readonly pending: number; readonly total: number; readonly moverSeen: number; readonly idx: string };
    }): void {
        try {
            const followOutcome = this.pending?.followOutcome ?? "not-reached";
            const followGate = followOutcome === "not-reached" ? "pre-commit" : "native-move";
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} stage=timeout correlation=${detail.correlation} generation=${this.generation} revision=${String(toDiagInt(detail.revision, -1, WORKSPACE_SEND_MAX_REVISION))} diag_seq=${String(this.nextDiagSeq())} event=timeout-settle outcome=${sanitizeKind(detail.outcome)} follow=${sanitizeKind(followOutcome)} gate=${followGate} verify_reason=${sanitizeKind(detail.verify.reason)} verify_gates=${detail.verify.reason === "ok" ? "complete" : "incomplete"} verify_geo_idx=${String(toDiagInt(detail.verify.geoIdx, -1, WORKSPACE_SEND_MAX_GEOMETRY))} verify_role=${sanitizeKind(detail.verify.role)} verify_dx=${String(toDiagInt(detail.verify.dx, -32768, 32768))} verify_dy=${String(toDiagInt(detail.verify.dy, -32768, 32768))} verify_dw=${String(toDiagInt(detail.verify.dw, -32768, 32768))} verify_dh=${String(toDiagInt(detail.verify.dh, -32768, 32768))} geo_seq=${String(this.nextGeometryDiagSeq())} fence_pending=${String(toDiagInt(detail.fence.pending, -1, WORKSPACE_SEND_MAX_GEOMETRY))} fence_total=${String(toDiagInt(detail.fence.total, -1, WORKSPACE_SEND_MAX_GEOMETRY))} mover_seen=${String(toDiagInt(detail.fence.moverSeen, -1, 1))} fence_idx=${detail.fence.idx}`,
            );
        } catch (error) {
            void error;
        }
    }

    // Best-effort redacted terminal diagnostic for the otherwise silent
    // pre-commit `disable()` teardown of a valid planned flight. Emits exactly
    // one `event=disable-terminal` line before the bounded `adapter-lost`
    // report so a future exact occurrence distinguishes an incomplete
    // mover/geometry fence (`fence_pending`/`fence_total`/`fence_idx` plus
    // `mover_seen`), the exact verifier category (`verify_reason` with
    // plan-relative `verify_geo_idx`: `scope-*` for the `stale-revision`
    // branch versus geometry/membership reasons for
    // `post-observation-mismatch`, `none` when no fresh observation exists,
    // `ok` when converged but echoes withheld), and direct disable teardown
    // versus unknown log delivery (presence of this line proves the disable
    // path ran). Reuses the redacted `timeoutFenceDetail` /
    // `timeoutVerifyDetail` shapes; counts and plan-relative indices only,
    // never raw ids, geometry values, payloads, captions, focus data, owner,
    // or native refs. Fires only for the first reporter of a planned pre-commit
    // flight, so `failFlight`/`onTimeout` follow-ups (which already emit
    // `result`/`timeout-settle`) never double-emit. Any diagnostic failure is
    // ignored and never changes the disable outcome, timer, fence, or
    // enablement. Does not reconstruct any historical path.
    private logDisableTerminal(): void {
        try {
            const pending = this.pending;
            const planned = pending?.planned ?? null;
            if (
                pending === null ||
                planned === null ||
                pending.operation === null ||
                pending.preconditions === null ||
                this.lossReported ||
                !isUniqueOwner(this.pinnedOwner)
            ) {
                return;
            }
            const fence = this.timeoutFenceDetail(planned, pending.fenceTotal);
            const followOutcome = pending.followOutcome;
            const followGate = followOutcome === "not-reached" ? "pre-commit" : "native-move";
            let verify: GeometryVerifyDetail = this.geometryVerifyDetail("none", -1, "unknown");
            try {
                const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
                if (fresh !== null) {
                    verify = this.timeoutVerifyDetail(planned, pending, fresh);
                }
            } catch (error) {
                void error;
                verify = this.geometryVerifyDetail("unknown", -1, "unknown");
            }
            try {
                this.env.log(
                    `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} stage=request correlation=${pending.correlation} generation=${this.generation} revision=${String(toDiagInt(pending.baseRevision, -1, WORKSPACE_SEND_MAX_REVISION))} diag_seq=${String(this.nextDiagSeq())} event=disable-terminal outcome=disable-teardown follow=${sanitizeKind(followOutcome)} gate=${followGate} phase=disable reason=disable-teardown verify_reason=${sanitizeKind(verify.reason)} verify_gates=${verify.reason === "ok" ? "complete" : "incomplete"} verify_geo_idx=${String(toDiagInt(verify.geoIdx, -1, WORKSPACE_SEND_MAX_GEOMETRY))} verify_role=${sanitizeKind(verify.role)} verify_dx=${String(toDiagInt(verify.dx, -32768, 32768))} verify_dy=${String(toDiagInt(verify.dy, -32768, 32768))} verify_dw=${String(toDiagInt(verify.dw, -32768, 32768))} verify_dh=${String(toDiagInt(verify.dh, -32768, 32768))} geo_seq=${String(this.nextGeometryDiagSeq())} fence_pending=${String(toDiagInt(fence.pending, -1, WORKSPACE_SEND_MAX_GEOMETRY))} fence_total=${String(toDiagInt(fence.total, -1, WORKSPACE_SEND_MAX_GEOMETRY))} mover_seen=${String(toDiagInt(fence.moverSeen, -1, 1))} fence_idx=${fence.idx}`,
                );
            } catch (error) {
                void error;
            }
        } catch (error) {
            void error;
        }
    }

    // Armed fence snapshot: pending count from the live fence, total from the
    // count recorded at arming, pending ids mapped to stable plan-relative
    // indices. No logging, no state change.
    private timeoutFenceDetail(
        planned: WorkspacePlanned,
        armedTotal: number,
    ): { readonly pending: number; readonly total: number; readonly moverSeen: number; readonly idx: string } {
        try {
            return this.timeoutFenceDetailUnchecked(planned, armedTotal);
        } catch (error) {
            void error;
            return { pending: -1, total: -1, moverSeen: -1, idx: "-" };
        }
    }

    private timeoutFenceDetailUnchecked(
        planned: WorkspacePlanned,
        armedTotal: number,
    ): { readonly pending: number; readonly total: number; readonly moverSeen: number; readonly idx: string } {
        const indices: number[] = [];
        for (const id of this.geoPending) {
            for (let index = 0; index < planned.geometry.length; index += 1) {
                if (planned.geometry[index]?.window === id) {
                    indices.push(index);
                    break;
                }
            }
        }
        indices.sort((a, b) => a - b);
        return {
            pending: this.geoPending.size,
            total: armedTotal,
            moverSeen: this.moverSeen ? 1 : 0,
            idx: indices.length === 0 ? "-" : indices.join(","),
        };
    }

    private nextGeometryDiagSeq(): number {
        this.geoDiagSeq += 1;
        return this.geoDiagSeq;
    }

    private nextDiagSeq(): number {
        this.diagSeq += 1;
        return this.diagSeq;
    }

    private geometryEntry(planned: WorkspacePlanned, windowId: string): WorkspaceGeometryEntry | null {
        for (const entry of planned.geometry) {
            if (entry.window === windowId) {
                return entry;
            }
        }
        return null;
    }

    private geometryRole(pending: WorkspacePendingFlight, entry: WorkspaceGeometryEntry | null): string {
        if (entry === null) {
            return "unknown";
        }
        if (entry.window === pending.moverId) {
            return "mover";
        }
        if (pending.snapshot.sourceWindows.some((window) => window.id === entry.window)) {
            return "source-retained";
        }
        if (pending.snapshot.targetWindows.some((window) => window.id === entry.window)) {
            return "target-retained";
        }
        return "unknown";
    }

    private readGeometryDetail(target: object | undefined, expected: WorkspaceSendRect | undefined): GeometryReadbackDetail {
        if (target === undefined || expected === undefined || typeof this.env.readGeometry !== "function") {
            return { outcome: "unavailable", dx: -1, dy: -1, dw: -1, dh: -1 };
        }
        try {
            const actual = this.env.readGeometry(target);
            if (actual === null || !isTargetRect(actual)) {
                return { outcome: "unavailable", dx: -1, dy: -1, dw: -1, dh: -1 };
            }
            const dx = actual.x - expected.x;
            const dy = actual.y - expected.y;
            const dw = actual.w - expected.w;
            const dh = actual.h - expected.h;
            return { outcome: dx === 0 && dy === 0 && dw === 0 && dh === 0 ? "exact" : "mismatch", dx, dy, dw, dh };
        } catch (error) {
            void error;
            return { outcome: "unavailable", dx: -1, dy: -1, dw: -1, dh: -1 };
        }
    }

    private geometryVerifyDetail(
        reason: string,
        geoIdx: number,
        role: string,
        expected?: WorkspaceSendRect,
        actual?: WorkspaceSendRect,
    ): GeometryVerifyDetail {
        if (expected === undefined || actual === undefined) {
            return { reason, geoIdx, role, dx: -1, dy: -1, dw: -1, dh: -1 };
        }
        return {
            reason,
            geoIdx,
            role,
            dx: actual.x - expected.x,
            dy: actual.y - expected.y,
            dw: actual.w - expected.w,
            dh: actual.h - expected.h,
        };
    }

    private logGeometryDiag(detail: {
        readonly correlation: string;
        readonly revision: number;
        readonly event: string;
        readonly outcome: string;
        readonly planned: WorkspacePlanned;
        readonly pending: WorkspacePendingFlight;
        readonly entry: WorkspaceGeometryEntry | null;
        readonly writeOrdinal: number;
        readonly writeTotal: number;
        readonly writeReturned: number;
        readonly readback: GeometryReadbackDetail;
    }): void {
        if (!KWIN_TRACE_ENABLED) {
            return;
        }
        try {
            const geoIdx = detail.entry === null ? -1 : detail.planned.geometry.indexOf(detail.entry);
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} stage=request correlation=${detail.correlation} generation=${this.generation} revision=${String(toDiagInt(detail.revision, -1, WORKSPACE_SEND_MAX_REVISION))} diag_seq=${String(this.nextDiagSeq())} event=${sanitizeKind(detail.event)} outcome=${sanitizeKind(detail.outcome)} geo_idx=${String(toDiagInt(geoIdx, -1, WORKSPACE_SEND_MAX_GEOMETRY))} geo_role=${sanitizeKind(this.geometryRole(detail.pending, detail.entry))} write_ord=${String(toDiagInt(detail.writeOrdinal, -1, WORKSPACE_SEND_MAX_GEOMETRY))} write_total=${String(toDiagInt(detail.writeTotal, -1, WORKSPACE_SEND_MAX_GEOMETRY))} write_return=${String(toDiagInt(detail.writeReturned, -1, 1))} readback=${sanitizeKind(detail.readback.outcome)} dx=${String(toDiagInt(detail.readback.dx, -32768, 32768))} dy=${String(toDiagInt(detail.readback.dy, -32768, 32768))} dw=${String(toDiagInt(detail.readback.dw, -32768, 32768))} dh=${String(toDiagInt(detail.readback.dh, -32768, 32768))} geo_seq=${String(this.nextGeometryDiagSeq())}`,
            );
        } catch (error) {
            void error;
        }
    }

    // Diagnostic-only mirror of verifyPlannedPost categories. The verifier
    // itself stays the single behavior gate; this only names the branch for
    // the eligible-path log. First mismatch wins, same order as the verifier.
    private timeoutVerifyDetail(
        planned: WorkspacePlanned,
        pending: WorkspacePendingFlight,
        verified: WorkspaceSendObserved,
    ): GeometryVerifyDetail {
        try {
            return this.timeoutVerifyDetailUnchecked(planned, pending, verified);
        } catch (error) {
            void error;
            return this.geometryVerifyDetail("unknown", -1, "unknown");
        }
    }

    private timeoutVerifyDetailUnchecked(
        planned: WorkspacePlanned,
        pending: WorkspacePendingFlight,
        verified: WorkspaceSendObserved,
    ): GeometryVerifyDetail {
        const snapshot = pending.snapshot;
        if (verified.sourceOutput !== snapshot.sourceOutput) {
            return this.geometryVerifyDetail("scope-source-output", -1, "unknown");
        }
        if (verified.sourceWorkspace !== snapshot.sourceWorkspace) {
            return this.geometryVerifyDetail("scope-source-workspace", -1, "unknown");
        }
        if (verified.targetOutput !== snapshot.targetOutput) {
            return this.geometryVerifyDetail("scope-target-output", -1, "unknown");
        }
        if (verified.targetWorkspace !== snapshot.targetWorkspace) {
            return this.geometryVerifyDetail("scope-target-workspace", -1, "unknown");
        }
        if (
            verified.sourceBounds.x !== snapshot.sourceBounds.x ||
            verified.sourceBounds.y !== snapshot.sourceBounds.y ||
            verified.sourceBounds.w !== snapshot.sourceBounds.w ||
            verified.sourceBounds.h !== snapshot.sourceBounds.h
        ) {
            return this.geometryVerifyDetail("scope-source-bounds", -1, "unknown");
        }
        if (
            verified.targetBounds.x !== snapshot.targetBounds.x ||
            verified.targetBounds.y !== snapshot.targetBounds.y ||
            verified.targetBounds.w !== snapshot.targetBounds.w ||
            verified.targetBounds.h !== snapshot.targetBounds.h
        ) {
            return this.geometryVerifyDetail("scope-target-bounds", -1, "unknown");
        }
        if (verified.targetDesktopRef !== pending.targetDesktopRef) {
            return this.geometryVerifyDetail("scope-target-ref", -1, "unknown");
        }
        if (verified.targetExists !== true) {
            return this.geometryVerifyDetail("scope-target-exists", -1, "unknown");
        }
        const byId = new Map<string, { rect: WorkspaceSendRect; inSource: boolean; inTarget: boolean }>();
        for (const entry of verified.sourceWindows) {
            byId.set(entry.id, { rect: entry.rect, inSource: true, inTarget: false });
        }
        for (const entry of verified.targetWindows) {
            byId.set(entry.id, { rect: entry.rect, inSource: false, inTarget: true });
        }
        const planIndexOf = (windowId: string): number => {
            for (let index = 0; index < planned.geometry.length; index += 1) {
                if (planned.geometry[index]?.window === windowId) {
                    return index;
                }
            }
            return -1;
        };
        const seen = new Set<string>();
        for (let index = 0; index < planned.geometry.length; index += 1) {
            const entry = planned.geometry[index];
            if (entry === undefined) {
                continue;
            }
            if (seen.has(entry.window)) {
                return this.geometryVerifyDetail("geometry-duplicate", index, this.geometryRole(pending, entry));
            }
            seen.add(entry.window);
            const found = byId.get(entry.window);
            if (found === undefined) {
                return this.geometryVerifyDetail("geometry-missing", index, this.geometryRole(pending, entry));
            }
            if (
                found.rect.x !== entry.rect.x ||
                found.rect.y !== entry.rect.y ||
                found.rect.w !== entry.rect.w ||
                found.rect.h !== entry.rect.h
            ) {
                return this.geometryVerifyDetail("geometry-rect-mismatch", index, this.geometryRole(pending, entry), entry.rect, found.rect);
            }
        }
        if (seen.size !== byId.size) {
            return this.geometryVerifyDetail("observed-count-mismatch", -1, "unknown");
        }
        const mover = byId.get(pending.moverId);
        const moverIdx = planIndexOf(pending.moverId);
        if (mover === undefined) {
            return this.geometryVerifyDetail("mover-missing", moverIdx, "mover");
        }
        if (mover.inSource) {
            return this.geometryVerifyDetail("mover-in-source", moverIdx, "mover");
        }
        if (!mover.inTarget) {
            return this.geometryVerifyDetail("mover-not-in-target", moverIdx, "mover");
        }
        for (const entry of snapshot.sourceWindows) {
            if (entry.id === pending.moverId) {
                continue;
            }
            const found = byId.get(entry.id);
            if (found === undefined || !found.inSource || found.inTarget) {
                return this.geometryVerifyDetail("retained-source-membership", planIndexOf(entry.id), "source-retained");
            }
        }
        for (const entry of snapshot.targetWindows) {
            if (entry.id === pending.moverId) {
                continue;
            }
            const found = byId.get(entry.id);
            if (found === undefined || found.inSource || !found.inTarget) {
                return this.geometryVerifyDetail("retained-target-membership", planIndexOf(entry.id), "target-retained");
            }
        }
        return this.geometryVerifyDetail("ok", -1, "unknown");
    }
}
