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
// policy and commits the planned topology synchronously in the same call,
// returning both-domain geometry plus the native assignment. This module owns
// KWin observation of the focused output's source and target desktops, owner
// activation/pinning, a single request round trip, exact source+target
// re-validation, synchronous planned-geometry writes then the mover's
// Window.desktops membership write, and exactly one follow (target desktop
// switch then mover focus, no retry) on a fresh exact native membership proof:
// mover absent from source and present on target. The proof comes from an
// immediate post-write observation AND a one-shot mover desktopsChanged signal
// for delayed arrival. There is no ack/verify/cancel/abandon/status protocol,
// no per-window geometry echo, no settlement timer, and no blocksPlan: Plan is
// never blocked by a send flight.
//
// Source and target stay pinned from dispatch until arrival or a bounded
// arrival deadline; a separate unanswered-request deadline releases the flight
// and late replies are ignored by token. Every terminal path (arrival, failed
// native write, stale reply, rejected/diverged reply, missing callback,
// timeout, closed mover, disable with a live flight) clears the pin and calls
// exactly one entry-owned `onSettled` hook for a forced complete source AND
// target refresh through the single-flight Plan chain. Pre-flight refusals
// carry no hook and leave no flight.
//
// Activation first uses NameHasOwner's normal boolean reply. A present owner is
// resolved and pinned; only a confirmed absent name runs one
// StartServiceByName(service, 0) phase accepting 1 PrimaryOwner / 2
// AlreadyOwner, followed by one post-start GetNameOwner. Every planner call
// targets that pinned unique `:N.M` owner. Two one-shot timers, no retry, no
// polling. Same-UID authorization stays solely the Planner's existing single
// check.
//
// Refusal routes are exact bounded tokens: no-planner, owner-loss,
// stale-revision, cross-output, same-workspace, absent-focus, non-tiled-focus,
// desktop-cap (observed desktop count above the KWin cap of 25), and
// last-desktop (no distinct target desktop can exist). Pre-flight refusals
// (scope-invalid plus the requestSend validation tokens above) log one
// structured best-effort `plasma-auto-tiler:route-diag` line and return false
// with the adapter still enabled, so a later valid send can proceed.
//
// All logs carry fixed fields (component, stage, correlation, generation,
// revision, event, outcome) with no sensitive, native, or payload data.

import { DOMAIN_GAP_DEFAULT, DomainGaps, normalizeGap, OUTER_DOMAIN_GAP_DEFAULT, readDomainGaps } from "./domain-gap";
import { orderGeometryWrites } from "./geometry-order";

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
// Planner request byte cap (mirrors the Rust codec `PLAN_MAX_REQUEST_BYTES`).
// `.length` is an exact byte count here: every string reaching request JSON
// is a fixed literal or passes isOpaqueId/isGeneration/isCorrelationId
// (charsets [A-Za-z0-9_.-] / [a-z0-9-], all <= 0x7F), and JSON numbers,
// booleans, and escapes are ASCII-only. Non-ASCII can never reach a request
// payload: validation rejects it before any build.
export const WORKSPACE_SEND_MAX_REQUEST_BYTES = 1_048_576;
export const WORKSPACE_SEND_MAX_REPLY_BYTES = 64 * 1024;
export const WORKSPACE_SEND_TIMEOUT_MS = 5000;
export const WORKSPACE_SEND_MAX_CORRELATION_LEN = 128;
export const WORKSPACE_SEND_MAX_OWNER_LEN = 128;
export const WORKSPACE_SEND_MAX_GENERATION_LEN = 64;
export const WORKSPACE_SEND_MAX_REVISION = 1000000;
export const WORKSPACE_SEND_MAX_ID_LEN = 128;
// KWin's hard desktop cap: an observation reporting over 25 desktops is
// refused fail-closed with the desktop-cap token. Window sets are not
// count-gated; an oversize built request is refused by the request byte cap.
export const WORKSPACE_SEND_MAX_DESKTOPS = 25;
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
    // Complete-observation flags from the send observers (standalone and
    // production). Optional so legacy synthetic fixtures without flags keep
    // validating: absence normalizes to false, never drops an observed true.
    readonly floating?: boolean;
    readonly fitExcluded?: boolean;
    readonly fit_excluded?: boolean;
    readonly fullscreen?: boolean;
    readonly maximized?: boolean;
    readonly sticky?: boolean;
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
// scope, fingerprints, and complete-observation flags only. Targets are
// always resolved from a fresh synchronous observation while handling
// replies. Native fullscreen/maximized/sticky stay local snapshot semantics
// for the dispatch-frozen fence; only floating and fitExcluded ride the
// portable request wire (as `floating` / `fit_excluded`).
export interface WorkspaceSendSnapshotWindow {
    readonly id: string;
    readonly rect: WorkspaceSendRect;
    readonly floating: boolean;
    readonly fitExcluded: boolean;
    readonly fullscreen: boolean;
    readonly maximized: boolean;
    readonly sticky: boolean;
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
    // Single settlement edge for entry-owned coordination: invoked exactly
    // once on every terminal path that held a flight (arrival, failed native
    // write, stale/rejected reply, missing callback, deadline, closed mover,
    // disable with a live flight), carrying the exact terminal flight's
    // source/target domain keys. The entry runs one forced complete source
    // AND target refresh through the single-flight Plan chain; the adapter
    // never resets the Plan baseline itself and never claims a native commit.
    // Never invoked for pre-dispatch refusals, which hold no pin.
    readonly onSettled?: (settled: WorkspaceSendSettled) => void;
    readonly setGeometry: (target: object, rect: WorkspaceSendRect) => boolean;
    readonly readGeometry?: (target: object) => WorkspaceSendRect | null;
    readonly setDesktops: (target: object, refs: ReadonlyArray<object>) => boolean;
    readonly switchToTarget?: (desktopRef: object, diagnostic: WorkspaceFollowNativeDiagnostic) => boolean;
    readonly focusWindow?: (windowRef: object, diagnostic: WorkspaceFollowNativeDiagnostic) => boolean;
    // Narrow mover desktop-change subscription seam for delayed arrival.
    // Production entries bind this to the mover Window.desktopsChanged
    // public signal via the shared signal-capability helpers. One-shot: the
    // adapter detaches after the first signal and on every terminal path.
    // Absent only in legacy isolated core tests, which retain the immediate
    // post-write observation path.
    readonly subscribeMoverDesktops?: (moverRef: object, handler: () => void) => (() => void) | null;
}

// Exact terminal flight domains carried on the single settlement edge so the
// entry can force a complete source AND target refresh through the
// single-flight Plan chain. Primitive ids only, captured from the flight
// snapshot before the pin clears; empty strings only on the defensive
// no-flight path, which the entry treats as a generic resync.
export interface WorkspaceSendSettled {
    readonly sourceOutput: string;
    readonly sourceWorkspace: string;
    readonly targetOutput: string;
    readonly targetWorkspace: string;
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

// Exact lifecycle precondition vector for a same-output move-tiled plan. The
// `adapter-must-verify-postconditions` token is accepted for codec
// compatibility with the immediate-commit Rust reply; this adapter performs
// no native-verification claim and treats the vector as an opaque exact
// binding, never as proof of native state.
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
    // Follow is target-bound: the planned desired focus must name the moved
    // leaf in the operation target domain. Any other focus is a mismatched
    // reply and never follows.
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
    if (!Array.isArray(geometryRaw) || geometryRaw.length === 0) {
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
        // Complete-observation flags: absent normalizes to false downstream;
        // a present non-boolean never sanitizes, it fails closed.
        for (const flag of [
            candidate.floating,
            candidate.fitExcluded,
            candidate.fit_excluded,
            candidate.fullscreen,
            candidate.maximized,
            candidate.sticky,
        ]) {
            if (flag !== undefined && typeof flag !== "boolean") {
                return false;
            }
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

function snapshotWindowOf(entry: WorkspaceSendObservedWindow): WorkspaceSendSnapshotWindow {
    return {
        id: entry.id,
        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        floating: entry.floating === true,
        fitExcluded: entry.fitExcluded === true || entry.fit_excluded === true,
        fullscreen: entry.fullscreen === true,
        maximized: entry.maximized === true,
        sticky: entry.sticky === true,
    };
}

export function snapshotOf(observed: WorkspaceSendObserved): WorkspaceSendSnapshot {
    const sourceWindows = observed.sourceWindows.map(snapshotWindowOf);
    const targetWindows = observed.targetWindows.map(snapshotWindowOf);
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
        if (other === undefined || !snapshotWindowsEqual(other, entry)) {
            return false;
        }
    }
    const targetById = new Map<string, WorkspaceSendSnapshotWindow>();
    for (const entry of a.targetWindows) {
        targetById.set(entry.id, entry);
    }
    for (const entry of b.targetWindows) {
        const other = targetById.get(entry.id);
        if (other === undefined || !snapshotWindowsEqual(other, entry)) {
            return false;
        }
    }
    return true;
}

// Per-survivor equality: identical rect plus identical complete-observation
// flags. A survivor changing flags without rect/membership change still
// mismatches, on either domain, so the reply fence stales before any setter.
function snapshotWindowsEqual(a: WorkspaceSendSnapshotWindow, b: WorkspaceSendSnapshotWindow): boolean {
    return (
        a.rect.x === b.rect.x &&
        a.rect.y === b.rect.y &&
        a.rect.w === b.rect.w &&
        a.rect.h === b.rect.h &&
        a.floating === b.floating &&
        a.fitExcluded === b.fitExcluded &&
        a.fullscreen === b.fullscreen &&
        a.maximized === b.maximized &&
        a.sticky === b.sticky
    );
}

// Immutable scope fence for arrival and follow: the live source/target
// domains, bounds, and target existence still equal the dispatch snapshot.
// Membership and geometry are checked separately; wrapper identity is never
// compared because KWin may return a fresh wrapper per read.
function scopeMatchesSnapshot(observed: WorkspaceSendObserved, snapshot: WorkspaceSendSnapshot): boolean {
    return (
        observed.sourceOutput === snapshot.sourceOutput &&
        observed.sourceWorkspace === snapshot.sourceWorkspace &&
        observed.targetOutput === snapshot.targetOutput &&
        observed.targetWorkspace === snapshot.targetWorkspace &&
        observed.sourceBounds.x === snapshot.sourceBounds.x &&
        observed.sourceBounds.y === snapshot.sourceBounds.y &&
        observed.sourceBounds.w === snapshot.sourceBounds.w &&
        observed.sourceBounds.h === snapshot.sourceBounds.h &&
        observed.targetBounds.x === snapshot.targetBounds.x &&
        observed.targetBounds.y === snapshot.targetBounds.y &&
        observed.targetBounds.w === snapshot.targetBounds.w &&
        observed.targetBounds.h === snapshot.targetBounds.h &&
        observed.targetExists === true &&
        observed.targetDesktopRef !== null
    );
}

interface WorkspacePendingFlight {
    readonly correlation: string;
    readonly snapshot: WorkspaceSendSnapshot;
    readonly targetWorkspace: string;
    readonly moverId: string;
    readonly windowCount: number;
    readonly requestPayload: string;
    readonly targetDesktopRef: object | null;
    // Dispatch-frozen validated gap pair for this flight. The request payload
    // carries exactly these values even when a deliberate reload updates
    // subsequent requests.
    readonly innerGap: number;
    readonly outerGap: number;
    // Requested logical ordinal from the plan entry (0 permitted for the
    // trailing target, -1 when absent/invalid). Diagnostic only: never gates
    // request, commit, follow, or enablement.
    readonly requestedOrdinal: number;
    // Immutable dispatch-time mover membership, computed once at dispatch
    // from the dispatch snapshot and never rederived. Diagnostic only.
    readonly srcInSource: number;
    readonly srcInTarget: number;
    baseRevision: number;
    planned: WorkspacePlanned | null;
    // Arrival follow runs at most once per flight. It never advances any
    // planner phase: the Rust topology is already committed.
    followed: boolean;
    followOutcome: string;
}

export interface WorkspaceSendGaps {
    readonly innerGap?: unknown;
    readonly outerGap?: unknown;
}

export class WorkspaceSendAdapter {
    private enabled = false;
    private startupEnabled = false;
    private owner = "";
    private generation = "";
    // Validated gap configuration for subsequent requests: resolved at
    // construction, then re-resolved only through updateGaps on the
    // deliberate Options configChanged reload. Each dispatched flight
    // freezes its own pair at request time so a reload during an active
    // request never alters its payload.
    private innerGap: number;
    private outerGap: number;
    private inFlight = false;
    private token = 0;
    private activeToken = 0;
    // Separate bounded deadlines: the request deadline releases an
    // unanswered request; the arrival deadline bounds the source+target pin
    // and delayed-arrival follow. Distinct epochs so a stale timer can never
    // touch a later flight.
    private deadlineToken = 0;
    private requestDeadline = 0;
    private arrivalDeadline = 0;
    private requestTimer: (() => void) | null = null;
    private arrivalTimer: (() => void) | null = null;
    private pinnedOwner: string | null = null;
    private activationStep = 0;
    private pending: WorkspacePendingFlight | null = null;
    // One-shot delayed-arrival subscription. Armed after the native writes
    // when the immediate observation shows no arrival yet; detached on the
    // first signal and on every terminal path.
    private arrivalDetach: (() => void) | null = null;
    private seq = 0;
    private diagSeq = 0;
    // KWin signals may be delivered synchronously from a setter. Do not let
    // them follow or settle while the write stack is live; the immediate
    // post-write observation after the stack covers synchronous arrival.
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

    // Deliberate reload edge: adopt the already-validated configChanged pair
    // for subsequent requests only. Established normalization applies;
    // invalid input falls back via normalizeGap, never refuses. Never touches
    // an active flight: its pair stays frozen in pending.
    updateGaps(gaps?: WorkspaceSendGaps): void {
        try {
            if (gaps === undefined) {
                const resolved = readDomainGaps();
                this.innerGap = resolved.innerGap;
                this.outerGap = resolved.outerGap;
                return;
            }
            this.innerGap = normalizeGap(gaps.innerGap);
            this.outerGap = normalizeGap(gaps.outerGap);
        } catch (error) {
            void error;
        }
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
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
        return "arrival";
    }

    // Bounded source+target pin for native cleanup ordering: the exact
    // dispatch source/target workspace ids, present from dispatch until
    // arrival or the bounded arrival deadline clears them on every terminal
    // path. Empty before dispatch or after settlement, so retention is
    // strictly flight-lifetime. Primitive ids only, never refs or history.
    get pendingWorkspaces(): ReadonlyArray<string> {
        const pending = this.pending;
        if (!this.inFlight || pending === null) {
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
        this.diagSeq = 0;
        return true;
    }

    disable(): void {
        if (!this.enabled && !this.inFlight) {
            return;
        }
        // A live flight torn down here (explicit disable or entry stop) is a
        // terminal release: clear the pin and run the single settlement hook
        // so the entry refreshes both domains from native observation. Never
        // reports to the planner and never claims anything about Rust state.
        if (this.inFlight) {
            this.settleTerminal(this.activeToken, this.pending?.correlation ?? "", "disabled", "release");
        }
        this.enabled = false;
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
        const flightInnerGap = this.innerGap;
        const flightOuterGap = this.outerGap;
        const payload = this.buildRequestPayload(observed, correlation, flightInnerGap, flightOuterGap);
        if (payload === null) {
            this.refuse("payload-invalid", correlation);
            return false;
        }
        if (payload.length > WORKSPACE_SEND_MAX_REQUEST_BYTES) {
            this.refuse("request-over-cap", correlation);
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
            flightInnerGap,
            flightOuterGap,
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

    private buildRequestPayload(
        observed: WorkspaceSendObserved,
        correlation: string,
        innerGap: number,
        outerGap: number,
    ): string | null {
        // Portable wire fields only: `floating` and `fit_excluded` (the
        // observer-carried fit opt-out, already ORed over floating, sticky,
        // fullscreen, and maximized at observation). Native
        // fullscreen/maximized/sticky never ride the wire; they stay local
        // snapshot semantics for the dispatch-frozen fence.
        const wireFlags = (entry: WorkspaceSendObservedWindow): Record<string, boolean> => ({
            ...(entry.floating === true ? { floating: true } : {}),
            ...(entry.floating === true || entry.fitExcluded === true || entry.fit_excluded === true
                ? { fit_excluded: true }
                : {}),
        });
        const sourceWindows = observed.sourceWindows.map((entry) => ({
            window: entry.id,
            output: observed.sourceOutput,
            workspace: observed.sourceWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
            ...wireFlags(entry),
        }));
        const targetWindows = observed.targetWindows.map((entry) => ({
            window: entry.id,
            output: observed.targetOutput,
            workspace: observed.targetWorkspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
            ...wireFlags(entry),
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
                    gap: innerGap,
                    outer_gap: outerGap,
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
                    gap: innerGap,
                    outer_gap: outerGap,
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
        innerGap: number,
        outerGap: number,
    ): void {
        this.inFlight = true;
        this.detachArrival();
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
            innerGap,
            outerGap,
            srcInSource: flags.srcInSource,
            srcInTarget: flags.srcInTarget,
            baseRevision: 0,
            planned: null,
            followed: false,
            followOutcome: "not-reached",
        };
        this.diag("request", correlation, 0, "dispatch", "started");
        // True command-dispatch observation at the request boundary, using the
        // original dispatch observation. Best-effort only.
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
        // Arm both bounded deadlines from dispatch: the request deadline
        // releases an unanswered request, the arrival deadline bounds the
        // pin and delayed-arrival follow. Separate epochs; neither resets.
        this.deadlineToken += 1;
        this.requestDeadline = this.deadlineToken;
        const requestEpoch = this.requestDeadline;
        let requestCancel: (() => void) | null = null;
        try {
            requestCancel = this.env.scheduleOnce(WORKSPACE_SEND_TIMEOUT_MS, () =>
                this.onRequestTimeout(flight, requestEpoch),
            );
        } catch (error) {
            void error;
            requestCancel = null;
        }
        if (requestCancel === null) {
            this.inFlight = false;
            this.pending = null;
            this.activationStep = 0;
            this.requestDeadline = 0;
            this.refuse("timeout");
            return;
        }
        this.requestTimer = requestCancel;
        this.deadlineToken += 1;
        this.arrivalDeadline = this.deadlineToken;
        const arrivalEpoch = this.arrivalDeadline;
        let arrivalCancel: (() => void) | null = null;
        try {
            arrivalCancel = this.env.scheduleOnce(WORKSPACE_SEND_TIMEOUT_MS, () =>
                this.onArrivalTimeout(flight, arrivalEpoch),
            );
        } catch (error) {
            void error;
            arrivalCancel = null;
        }
        if (arrivalCancel === null) {
            this.clearRequestTimer();
            this.inFlight = false;
            this.pending = null;
            this.activationStep = 0;
            this.requestDeadline = 0;
            this.arrivalDeadline = 0;
            this.refuse("timeout");
            return;
        }
        this.arrivalTimer = arrivalCancel;
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
            this.settleTerminal(flight, correlation, "no-planner", "release");
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
                this.settleTerminal(flight, correlation, "no-planner", "release");
            }
            return;
        }
        if (reply !== false) {
            this.settleTerminal(flight, correlation, "no-planner", "release");
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
            this.settleTerminal(flight, correlation, "no-planner", "release");
        }
    }

    private onOwnerInitial(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 2) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.settleTerminal(flight, correlation, "no-planner", "release");
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
            this.settleTerminal(flight, correlation, "no-planner", "release");
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
            this.settleTerminal(flight, correlation, "no-planner", "release");
        }
    }

    private onOwnerAfterStart(reply: unknown, flight: number, correlation: string): void {
        if (!this.inFlight || flight !== this.activeToken || this.activationStep !== 4) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.settleTerminal(flight, correlation, "no-planner", "release");
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
            this.settleTerminal(flight, correlation, "no-planner", "release");
            return;
        }
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
            this.settleTerminal(flight, correlation, "owner-loss", "release");
        }
    }

    private onRequestReply(reply: unknown, flight: number, correlation: string): void {
        // A late reply after the request deadline released the flight is
        // ignored by token and never actuates. One bounded redacted line.
        if (!this.inFlight || flight !== this.activeToken) {
            this.logLateReply(reply);
            return;
        }
        const pending = this.pending;
        if (pending === null || pending.correlation !== correlation || !isUniqueOwner(this.pinnedOwner) || this.activationStep !== 5) {
            return;
        }
        // A duplicate reply after the plan was already bound must never
        // replay native writes.
        if (pending.planned !== null) {
            return;
        }
        this.clearRequestTimer();
        if (typeof reply !== "string" || reply.length > WORKSPACE_SEND_MAX_REPLY_BYTES) {
            this.settleTerminal(flight, correlation, "service-fault", "release");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.settleTerminal(flight, correlation, "service-fault", "release");
            return;
        }
        if (!isRecord(parsed)) {
            this.settleTerminal(flight, correlation, "service-fault", "release");
            return;
        }
        if (parsed["v"] !== WORKSPACE_SEND_CONTRACT_VERSION) {
            this.settleTerminal(flight, correlation, "service-fault", "release");
            return;
        }
        if (parsed["correlation_id"] !== correlation) {
            this.settleTerminal(flight, correlation, "correlation-mismatch", "release");
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "rejected" || outcome === "diverged") {
            this.settleTerminal(flight, correlation, sanitizeKind(parsed["kind"]), "release");
            return;
        }
        if (outcome !== "planned") {
            this.settleTerminal(flight, correlation, "service-fault", "release");
            return;
        }
        const planned = validatePlanned(parsed, correlation);
        if (planned === null) {
            this.settleTerminal(flight, correlation, "precondition-mismatch", "release");
            return;
        }
        if (!this.geometryCovers(planned, pending)) {
            this.settleTerminal(flight, correlation, "precondition-mismatch", "release");
            return;
        }
        if (!this.operationMatchesSnapshot(planned, pending)) {
            this.settleTerminal(flight, correlation, "precondition-mismatch", "release");
            return;
        }
        pending.baseRevision = planned.baseRevision;
        pending.planned = planned;
        this.diag("request", correlation, planned.baseRevision, "plan", "planned");
        this.actuate(flight, correlation);
    }

    // Complete-reply binding: the reply geometry must cover exactly the
    // observed tiled source+target window set (entries where floating
    // !== true). Floating exceptions stay observed but carry no planned
    // geometry. Fullscreen/maximized overlays stay tiled: fit_excluded
    // alone is NOT floating. Unknown, missing, duplicate, or floated
    // windows never reach native writes.
    private geometryCovers(planned: WorkspacePlanned, flightState: WorkspacePendingFlight): boolean {
        const wanted = new Set<string>();
        for (const entry of flightState.snapshot.sourceWindows) {
            if (entry.floating !== true) {
                wanted.add(entry.id);
            }
        }
        for (const entry of flightState.snapshot.targetWindows) {
            if (entry.floating !== true) {
                wanted.add(entry.id);
            }
        }
        if (planned.geometry.length !== wanted.size) {
            return false;
        }
        const seen = new Set<string>();
        for (const entry of planned.geometry) {
            if (!wanted.has(entry.window) || seen.has(entry.window)) {
                return false;
            }
            seen.add(entry.window);
        }
        return true;
    }

    // Operation-to-snapshot binding: the move-tiled operation must name the
    // flight mover plus the exact captured source/target domains. Any other
    // target/object is a mismatched reply and never actuates.
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

    // Identity fence held before every native setter and before switch/focus:
    // the flight token, correlation, and pinned owner/generation binding are
    // unchanged. Snapshot scope is fenced separately against a fresh
    // observation at each boundary.
    private fencesHold(flight: number, correlation: string): boolean {
        const pending = this.pending;
        return (
            this.inFlight &&
            flight === this.activeToken &&
            pending !== null &&
            pending.correlation === correlation &&
            this.activationStep === 5 &&
            isUniqueOwner(this.pinnedOwner)
        );
    }

    // Reply-boundary actuation: re-observe synchronously, exact-revalidate
    // the source+target scope against the flight snapshot, then apply the
    // planned geometry plus the mover's desktop membership. The arrival
    // follow runs once on a fresh exact membership proof: an immediate
    // post-write observation plus, for delayed arrival, a one-shot mover
    // desktopsChanged signal. Never waits for unrelated geometry and never
    // claims a native commit.
    private actuate(flight: number, correlation: string): void {
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null || !this.fencesHold(flight, correlation)) {
            this.settleTerminal(flight, correlation, "stale-scope", "release");
            return;
        }
        const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        if (fresh === null) {
            this.settleTerminal(flight, correlation, "stale-revision", "release");
            return;
        }
        if (!snapshotsEqual(snapshotOf(fresh), pending.snapshot)) {
            this.settleTerminal(flight, correlation, "stale-revision", "release");
            return;
        }
        // Dispatch-frozen gap fence before ANY native setter: a configChanged
        // reload must stale the reply even though bounds/membership still
        // match. Terminal stale with forced refresh via settleTerminal.
        if (!this.flightGapsHold(pending)) {
            this.settleTerminal(flight, correlation, "stale-revision", "release");
            return;
        }
        // Arm the one-shot arrival signal BEFORE native writes so a delayed
        // arrival signalling reentrantly between setters and the post-write
        // observation stays observable. Synchronous echo during the write
        // stack stays deferred via nativeWriteDepth and is covered by the
        // immediate post-write observation.
        this.armArrivalSignal(flight, correlation);
        this.nativeWriteDepth += 1;
        const geometryWritten = this.writeGeometries(flight, correlation, pending, planned);
        // Pre-write observation immediately before the mover membership
        // write. Best-effort only.
        this.emitFollowDiag(correlation, planned.baseRevision, "send-pre-mover", fresh, this.diagBasisOf(pending), -1, -1);
        const moverWritten = geometryWritten && this.writeMoverDesktops(flight, correlation, pending);
        this.nativeWriteDepth -= 1;
        if (!geometryWritten || !moverWritten) {
            if (!this.fencesHold(flight, correlation) || !this.scopeStillMatches(pending) || !this.flightGapsHold(pending)) {
                this.settleTerminal(flight, correlation, "stale-revision", "release");
                return;
            }
            this.settleTerminal(flight, correlation, "write-failed", "release");
            return;
        }
        this.diag("arrival", correlation, planned.baseRevision, "write", "applied");
        // Immediate post-write arrival check; delayed arrival waits on the
        // one-shot mover signal (already armed above) until the bounded
        // arrival deadline.
        if (this.checkArrival(flight, correlation)) {
            return;
        }
        if (this.arrivalDetach === null) {
            this.armArrivalSignal(flight, correlation);
        }
        this.diag("arrival", correlation, planned.baseRevision, "arrival", "waiting");
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

    // One-shot delayed-arrival trigger: the next mover desktopsChanged signal
    // re-observes and follows once on a fresh exact membership proof. The
    // armed arrival deadline still bounds the wait; the immediate post-write
    // observation covers synchronous arrival. Armed before native writes so
    // a signal between setters and the post-write observation is not missed.
    private armArrivalSignal(flight: number, correlation: string): void {
        const pending = this.pending;
        if (pending === null || pending.correlation !== correlation) {
            return;
        }
        if (this.arrivalDetach !== null) {
            return;
        }
        const subscribe = this.env.subscribeMoverDesktops;
        if (typeof subscribe !== "function") {
            return;
        }
        const current = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        if (current === null) {
            return;
        }
        const moverRef = this.resolveMoverRef(pending, current);
        if (moverRef === null) {
            return;
        }
        let detach: (() => void) | null = null;
        try {
            detach = subscribe(moverRef, () => this.onArrivalSignal(flight, correlation));
        } catch (error) {
            void error;
            detach = null;
        }
        if (detach === null || typeof detach !== "function") {
            return;
        }
        this.arrivalDetach = detach;
    }

    private detachArrival(): void {
        const detach = this.arrivalDetach;
        this.arrivalDetach = null;
        if (detach !== null) {
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
    }

    private onArrivalSignal(flight: number, correlation: string): void {
        // A signal arriving mid-write or mid-follow is covered by the
        // immediate post-write observation / in-progress follow instead.
        // Keep the one-shot armed so the delayed arrival stays observable;
        // do not consume it while the write/follow stack is live.
        if (this.nativeWriteDepth > 0 || this.nativeFollowDepth > 0) {
            return;
        }
        // One-shot: detach before any further progress so a duplicate signal
        // cannot produce a second follow.
        const detach = this.arrivalDetach;
        this.arrivalDetach = null;
        if (detach !== null) {
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
        this.checkArrival(flight, correlation);
    }

    // Fresh exact arrival proof: the mover is absent from the source and
    // present on the target with the dispatch scope unchanged. Returns true
    // when the flight reached a terminal path (arrival follow done, closed
    // mover, or stale scope); false when the mover simply has not arrived
    // yet and the flight keeps waiting for the signal or the deadline.
    // Never waits for unrelated geometry.
    private checkArrival(flight: number, correlation: string): boolean {
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null || !this.fencesHold(flight, correlation)) {
            return false;
        }
        const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        if (fresh === null) {
            return false;
        }
        if (!scopeMatchesSnapshot(fresh, pending.snapshot)) {
            this.settleTerminal(flight, correlation, "stale-revision", "release");
            return true;
        }
        let inSource = false;
        for (const entry of fresh.sourceWindows) {
            if (entry.id === pending.moverId) {
                inSource = true;
                break;
            }
        }
        let moverRef: object | null = null;
        for (const entry of fresh.targetWindows) {
            if (entry.id === pending.moverId) {
                moverRef = entry.ref;
                break;
            }
        }
        if (!inSource && moverRef !== null) {
            this.diag("arrival", correlation, planned.baseRevision, "arrival", "arrived");
            // Post-write observation: verified read shows the mover in target
            // while the basis keeps the frozen dispatch source. Best-effort.
            this.emitFollowDiag(correlation, planned.baseRevision, "send-post-mover", fresh, this.diagBasisOf(pending), -1, -1);
            this.followOnce(flight, correlation, fresh);
            this.settleTerminal(flight, correlation, "arrived", "arrival");
            return true;
        }
        if (!inSource && moverRef === null) {
            // The mover is in neither scope: closed or moved elsewhere
            // mid-flight. The entry refresh on settlement converges both
            // domains from native observation; never a phantom, no replay.
            this.settleTerminal(flight, correlation, "mover-closed", "release");
            return true;
        }
        return false;
    }

    // Follow a confirmed native mover transfer exactly once: switch to the
    // target desktop, then focus the mover. A fresh exact arrival proof is
    // required before the switch AND before focus; ambiguous or stale proof
    // refuses the follow without setters. A failed or ambiguous switch
    // never focuses; switch/focus failures are logged without retry or
    // setter replay. Token, owner, and scope fences are rechecked before
    // each setter.
    private followOnce(
        flight: number,
        correlation: string,
        arrival: WorkspaceSendObserved,
    ): void {
        void arrival;
        const pending = this.pending;
        const planned = pending?.planned ?? null;
        if (pending === null || planned === null || pending.followed || !this.fencesHold(flight, correlation)) {
            return;
        }
        const switchToTarget = this.env.switchToTarget;
        const focusWindow = this.env.focusWindow;
        if (typeof switchToTarget !== "function" || typeof focusWindow !== "function") {
            pending.followed = true;
            pending.followOutcome = "hooks-unavailable";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            return;
        }
        // Fresh arrival membership proof before the switch: the passed
        // arrival may be stale after the intervening setters.
        const preSwitch = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        if (preSwitch === null || !this.fencesHold(flight, correlation) || this.pending !== pending) {
            pending.followed = true;
            pending.followOutcome = "arrival-unconfirmed";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            return;
        }
        let preSwitchMoverRef: object | null = null;
        let preSwitchInSource = false;
        for (const entry of preSwitch.sourceWindows) {
            if (entry.id === pending.moverId) {
                preSwitchInSource = true;
                break;
            }
        }
        for (const entry of preSwitch.targetWindows) {
            if (entry.id === pending.moverId) {
                preSwitchMoverRef = entry.ref;
                break;
            }
        }
        const preSwitchDesktopRef = preSwitch.targetDesktopRef;
        if (
            preSwitchInSource ||
            preSwitchMoverRef === null ||
            preSwitchDesktopRef === null ||
            !scopeMatchesSnapshot(preSwitch, pending.snapshot)
        ) {
            pending.followed = true;
            pending.followOutcome = "arrival-unconfirmed";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            return;
        }
        // Flight-pinned diagnostic basis. The fences above stay the only
        // correctness checks; wrapper equality below is diagnostic only.
        // Source membership stays frozen from the immutable dispatch snapshot.
        const basis: WorkspaceFollowDiagBasis = this.diagBasisOf(pending);
        pending.followed = true;
        this.emitFollowDiag(correlation, planned.baseRevision, "follow-pre", preSwitch, basis, -1, -1);
        let switched = false;
        this.nativeFollowDepth += 1;
        try {
            switched = switchToTarget(preSwitchDesktopRef, {
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
        if (!this.fencesHold(flight, correlation) || this.pending !== pending) {
            this.nativeFollowDepth -= 1;
            return;
        }
        // Fresh arrival membership proof before focus: the mover may have
        // closed or moved elsewhere during the switch. Ambiguous or stale
        // proof refuses focus without a setter.
        const preFocus = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        if (preFocus === null || !this.fencesHold(flight, correlation) || this.pending !== pending) {
            pending.followOutcome = "arrival-unconfirmed";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            this.nativeFollowDepth -= 1;
            return;
        }
        let focusMoverRef: object | null = null;
        let focusInSource = false;
        for (const entry of preFocus.sourceWindows) {
            if (entry.id === pending.moverId) {
                focusInSource = true;
                break;
            }
        }
        for (const entry of preFocus.targetWindows) {
            if (entry.id === pending.moverId) {
                focusMoverRef = entry.ref;
                break;
            }
        }
        if (focusInSource || focusMoverRef === null || !scopeMatchesSnapshot(preFocus, pending.snapshot)) {
            pending.followOutcome = "arrival-unconfirmed";
            this.diag("follow", correlation, planned.baseRevision, "follow", pending.followOutcome);
            this.nativeFollowDepth -= 1;
            return;
        }
        let focused = false;
        try {
            focused = focusWindow(focusMoverRef, {
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
        pending.followOutcome = focused ? "state-confirmed" : "focus-unconfirmed";
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
    // Raw desktop ids, output identifiers, window native ids, object refs,
    // captions, app data, payload, and environment never enter logs. Wrapper
    // equality here is diagnostic only; existing follow gates stay unchanged.
    // Never throws or affects follow result, arrival, focus behavior,
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

    // Dispatch-frozen gap fence: the live configured pair must still equal
    // the flight-frozen primitives before any reply geometry or membership
    // write. Never throws.
    private flightGapsHold(pending: WorkspacePendingFlight): boolean {
        try {
            return pending.innerGap === this.innerGap && pending.outerGap === this.outerGap;
        } catch (error) {
            void error;
            return false;
        }
    }

    // Bounded scope fence for mid-write checks: a fresh observation still
    // carries the exact dispatch source+target scope. Never throws.
    private scopeStillMatches(pending: WorkspacePendingFlight): boolean {
        try {
            const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
            return (
                fresh !== null &&
                scopeMatchesSnapshot(fresh, pending.snapshot) &&
                this.flagsStillMatch(fresh, pending.snapshot)
            );
        } catch (error) {
            void error;
            return false;
        }
    }

    // Earlier setters may change rects; fence flags without comparing rects.
    private flagsStillMatch(current: WorkspaceSendObserved, snapshot: WorkspaceSendSnapshot): boolean {
        try {
            const freshById = new Map([...current.sourceWindows, ...current.targetWindows].map((entry) => [entry.id, entry]));
            return [...snapshot.sourceWindows, ...snapshot.targetWindows].every((entry) => {
                const fresh = freshById.get(entry.id);
                return fresh !== undefined &&
                    (fresh.fullscreen === true) === entry.fullscreen &&
                    (fresh.maximized === true) === entry.maximized &&
                    (fresh.floating === true) === entry.floating &&
                    (fresh.sticky === true) === entry.sticky &&
                    (fresh.fitExcluded === true || fresh.fit_excluded === true) === entry.fitExcluded;
            });
        } catch (error) {
            void error;
            return false;
        }
    }

    private writeGeometries(
        flight: number,
        correlation: string,
        pending: WorkspacePendingFlight,
        planned: WorkspacePlanned,
    ): boolean {
        // Stable ordering baseline from the dispatch snapshot; per-setter
        // targets and scope fences below always resolve from a fresh
        // observation.
        const baseline = new Map<string, WorkspaceSendRect>();
        for (const entry of pending.snapshot.sourceWindows) {
            baseline.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
        }
        for (const entry of pending.snapshot.targetWindows) {
            baseline.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
        }
        const overlays = new Set(
            [...pending.snapshot.sourceWindows, ...pending.snapshot.targetWindows]
                .filter((entry) => entry.fullscreen || entry.maximized)
                .map((entry) => entry.id),
        );
        const ordered = orderGeometryWrites(baseline, planned.geometry);
        for (let writeOrdinal = 0; writeOrdinal < ordered.length; writeOrdinal += 1) {
            // Retain the exact source+target scope and token before every
            // native setter: a window may resize, move, or close mid-write.
            if (!this.fencesHold(flight, correlation) || this.pending !== pending) {
                return false;
            }
            const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
            if (fresh === null || !scopeMatchesSnapshot(fresh, pending.snapshot) || !this.flightGapsHold(pending)) {
                return false;
            }
            if (!this.flagsStillMatch(fresh, pending.snapshot)) {
                return false;
            }
            const entry = ordered[writeOrdinal];
            if (entry === undefined) {
                return false;
            }
            // Retain an overlaid tile's allocation without writing its native frame.
            if (overlays.has(entry.window)) {
                continue;
            }
            const target = this.resolveWindowRef(fresh, entry.window);
            if (target === null) {
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

    private resolveWindowRef(current: WorkspaceSendObserved, id: string): object | null {
        for (const entry of current.sourceWindows) {
            if (entry.id === id) {
                return entry.ref;
            }
        }
        for (const entry of current.targetWindows) {
            if (entry.id === id) {
                return entry.ref;
            }
        }
        return null;
    }

    private writeMoverDesktops(
        flight: number,
        correlation: string,
        pending: WorkspacePendingFlight,
    ): boolean {
        // Fresh scope fence immediately before the mover membership setter:
        // never reuse the pre-geometry observation after geometry writes.
        if (!this.fencesHold(flight, correlation) || this.pending !== pending) {
            return false;
        }
        const fresh = this.freshObserved(pending.targetWorkspace, pending.snapshot.sourceWorkspace);
        if (fresh === null || !scopeMatchesSnapshot(fresh, pending.snapshot) || !this.flightGapsHold(pending)) {
            return false;
        }
        if (fresh.targetDesktopRef === null) {
            return false;
        }
        const mover = this.resolveWindowRef(fresh, pending.moverId);
        if (mover === null) {
            return false;
        }
        let written = false;
        try {
            written = this.env.setDesktops(mover, [fresh.targetDesktopRef]) === true;
        } catch (error) {
            void error;
            written = false;
        }
        return written;
    }

    // Single terminal exit for every flight path: release both deadline
    // timers, detach the arrival signal, clear the source+target pin, log one
    // bounded redacted release line, and invoke the entry-owned settlement
    // hook exactly once for a forced complete source AND target refresh.
    // Never reports to the planner, never replays setters, never claims a
    // native commit. A stale flight token never settles.
    private settleTerminal(flight: number, correlation: string, outcome: string, event: string): void {
        if (flight !== this.activeToken) {
            return;
        }
        const pending = this.pending;
        const revision = pending?.baseRevision ?? 0;
        const settledCorrelation = pending?.correlation ?? correlation;
        const snapshot = pending?.snapshot ?? null;
        this.clearRequestTimer();
        this.clearArrivalTimer();
        this.detachArrival();
        this.inFlight = false;
        this.pending = null;
        this.activationStep = 0;
        this.pinnedOwner = null;
        this.requestDeadline = 0;
        this.arrivalDeadline = 0;
        try {
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} route=send-to-workspace stage=release correlation=${settledCorrelation} generation=${this.generation} revision=${String(revision)} diag_seq=${String(this.nextDiagSeq())} event=${sanitizeKind(event)} outcome=${sanitizeKind(outcome)}`,
            );
        } catch (error) {
            void error;
        }
        try {
            this.env.onSettled?.({
                sourceOutput: snapshot?.sourceOutput ?? "",
                sourceWorkspace: snapshot?.sourceWorkspace ?? "",
                targetOutput: snapshot?.targetOutput ?? "",
                targetWorkspace: snapshot?.targetWorkspace ?? "",
            });
        } catch (error) {
            void error;
        }
    }

    // Unanswered-request deadline: the planner callback never arrived. The
    // flight releases with no native write; a late reply arriving afterwards
    // is ignored by token. The entry refresh on settlement converges both
    // domains from native observation.
    private onRequestTimeout(flight: number, deadline: number): void {
        if (!this.inFlight || flight !== this.activeToken || deadline !== this.requestDeadline) {
            return;
        }
        // A bound plan is already actuating synchronously past the request
        // boundary; the arrival deadline owns the flight from there.
        if (this.pending?.planned !== null) {
            return;
        }
        const correlation = this.pending?.correlation ?? "";
        this.settleTerminal(flight, correlation, "timeout", "release");
    }

    // Bounded arrival deadline: the pin and delayed-arrival wait expire with
    // no exact membership proof. No phantom is retained; the entry refresh
    // on settlement converges both domains from native observation.
    private onArrivalTimeout(flight: number, deadline: number): void {
        if (!this.inFlight || flight !== this.activeToken || deadline !== this.arrivalDeadline) {
            return;
        }
        const correlation = this.pending?.correlation ?? "";
        this.settleTerminal(flight, correlation, "arrival-timeout", "release");
    }

    private clearRequestTimer(): void {
        const cancel = this.requestTimer;
        this.requestTimer = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    private clearArrivalTimer(): void {
        const cancel = this.arrivalTimer;
        this.arrivalTimer = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    // Bounded redacted late-reply line: a reply arriving after the flight
    // released is ignored and never actuates. The correlation echoes only
    // when it passes the opaque-id shape; anything else stays empty.
    private logLateReply(reply: unknown): void {
        try {
            let correlation = "";
            if (typeof reply === "string" && reply.length <= WORKSPACE_SEND_MAX_REPLY_BYTES) {
                try {
                    const parsed: unknown = JSON.parse(reply);
                    if (isRecord(parsed) && isCorrelationId(parsed["correlation_id"])) {
                        correlation = parsed["correlation_id"] as string;
                    }
                } catch (error) {
                    void error;
                }
            }
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} route=send-to-workspace stage=request correlation=${correlation} generation=${this.generation} revision=0 diag_seq=${String(this.nextDiagSeq())} event=late-reply outcome=ignored`,
            );
        } catch (error) {
            void error;
        }
    }

    // Refusal during pre-flight (no pin, no hook): one structured route
    // diagnostic with an exact bounded token. Pre-flight refusals stay
    // enabled with no flight, timer, D-Bus, native, or follow so a
    // subsequent valid send can proceed.
    private refuse(outcome: string, correlation = ""): void {
        this.diag("request", correlation, 0, "refuse", outcome);
    }

    private diag(
        stage: string,
        correlation: string,
        revision: number,
        event: string,
        outcome: string,
    ): void {
        try {
            const followGate =
                event === "refuse"
                    ? ` follow=not-reached gate=pre-commit phase=request reason=${outcome}`
                    : event === "activate" && outcome === "no-planner"
                      ? " follow=not-reached gate=pre-commit phase=activation reason=no-planner"
                      : "";
            this.env.log(
                `${LOG_PREFIX} component=${WORKSPACE_SEND_COMPONENT} route=send-to-workspace stage=${stage} correlation=${correlation} generation=${this.generation} revision=${String(revision)} diag_seq=${String(this.nextDiagSeq())} event=${event} outcome=${outcome}${followGate}`,
            );
        } catch (error) {
            void error;
        }
    }

    private nextDiagSeq(): number {
        this.diagSeq += 1;
        return this.diagSeq;
    }
}
