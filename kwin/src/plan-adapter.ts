// Bounded DescribePlan adapter (single route).
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

// Session D-Bus activation transport (one-flight, bounded, no poll/retry).
// Mirrors the workspace-send activation design minimally: NameHasOwner's
// strict boolean reply distinguishes presence; a present name is resolved via
// GetNameOwner and pinned; only a strictly absent name runs one
// StartServiceByName(service, 0) accepting 1 PrimaryOwner / 2 AlreadyOwner,
// then one post-start GetNameOwner before any planner method. Every planner
// call targets the pinned unique `:N.M` owner. No Legacy path.
export const PLAN_DBUS_SERVICE = "org.freedesktop.DBus";
export const PLAN_DBUS_OBJECT = "/org/freedesktop/DBus";
export const PLAN_DBUS_INTERFACE = "org.freedesktop.DBus";
export const PLAN_HAS_OWNER_METHOD = "NameHasOwner";
export const PLAN_GET_OWNER_METHOD = "GetNameOwner";
export const PLAN_START_METHOD = "StartServiceByName";
export const PLAN_START_FLAGS = 0;
export const PLAN_START_PRIMARY = 1;
export const PLAN_START_ALREADY = 2;

export const PLAN_CONTRACT_VERSION = 1;
// Planner request byte cap (mirrors the Rust codec `PLAN_MAX_REQUEST_BYTES`).
// `.length` is an exact byte count here: every string reaching request JSON
// is a fixed literal or passes isOpaqueId/isGeneration/isCorrelationId
// (charsets [A-Za-z0-9_.-] / [a-z0-9-], all <= 0x7F), and JSON numbers,
// booleans, and escapes are ASCII-only. Non-ASCII can never reach a request
// payload: validation rejects it before any build.
export const PLAN_MAX_REQUEST_BYTES = 1_048_576;
export const PLAN_MAX_REPLY_BYTES = 64 * 1024;
export const PLAN_TIMEOUT_MS = 2000;
export const PLAN_DEBOUNCE_MS = 120;
export const MAX_RECONCILE_ATTEMPTS = 3;
export const PLAN_MAX_CORRELATION_LEN = 128;
export const PLAN_MAX_OWNER_LEN = 128;
export const PLAN_MAX_GENERATION_LEN = 64;
export const PLAN_MAX_ID_LEN = 128;
export const PLAN_MAX_SEQ = 1000000;

// KWin's public Script API exposes Window.output read-only and has no public
// output-transfer operation. A desktop-membership setter and target geometry
// do not prove an output transfer, so active R4 moves stay unavailable
// unless the entry supplies every R4 native capability (exact Output object
// resolution, exact VirtualDesktop resolution, sendClientToScreen transfer,
// mover desktop-membership write, output/membership/geometry reads, and the
// outputChanged/desktopsChanged/frameGeometryChanged fences). The request
// `cross_output_transfer` flag is true only when all of them are present.
export function crossOutputTransferSupported(env: PlanAdapterEnv): boolean {
    return (
        typeof env.resolveOutput === "function" &&
        typeof env.resolveDesktop === "function" &&
        typeof env.sendClientToScreen === "function" &&
        typeof env.setDesktops === "function" &&
        typeof env.readOutputName === "function" &&
        typeof env.readDesktopIds === "function" &&
        typeof env.readGeometry === "function" &&
        typeof env.subscribeMoverOutput === "function" &&
        typeof env.subscribeMoverDesktops === "function" &&
        typeof env.subscribeWindowGeometry === "function"
    );
}

const LOG_PREFIX = "plasma-auto-tiler:plan";

export type PlanDirection = "left" | "right" | "up" | "down";
export type PlanResizeMode = "inwards" | "outwards";
export type PlanSignal = "added" | "removed" | "activated" | "geometry" | "scope" | "fullscreen" | "maximize" | "desktops";
export type PlanOp = "admit" | "remove" | "move" | "focus" | "resize" | "reconcile" | "update-gaps" | "pointer-resize" | "toggle-float";
export type NativeStateWriteOutcome = "invoked" | "missing" | "threw";
export type MaximizeClearOutcome = NativeStateWriteOutcome;
export type KeepAboveWriteOutcome = NativeStateWriteOutcome | "refused";

export interface PlanRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface PlanWindowConstraints {
    readonly resizeable: boolean | null;
    readonly minSize: { readonly w: number; readonly h: number } | null;
    readonly maxSize: { readonly w: number; readonly h: number } | null;
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

// Production directional domain descriptor: bounded primitive per domain
// (output, workspace, work-area bounds, inner/outer gaps, horizontal
// reciprocal adjacency). At most two entries: source first, then the
// horizontally adjacent output's current logical workspace (which may differ
// in workspace id). Only `left`/`right` adjacency keys are admitted.
export interface PlanDomain {
    readonly output: string;
    readonly workspace: string;
    readonly bounds: PlanRect;
    readonly gap: number;
    readonly outerGap: number;
    readonly adjacent: Readonly<Partial<Record<"left" | "right", string>>>;
}

// Typed production directional observation outcome (active Left/Right
// route only). `ready` carries the validated two-domain observation;
// `no-target` means a confirmed no-adjacent/single-output condition and
// keeps local single-domain behavior; `invalid` covers ambiguous,
// unreadable, or malformed two-domain evidence and must refuse before any
// local mutation. Up/Down never consult this hook.
export type DirectionalObservationStatus = "ready" | "no-target" | "invalid";

export interface DirectionalObservation {
    readonly status: DirectionalObservationStatus;
    readonly observed: PlanObserved | null;
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
    // Production directional observation: source plus at most one
    // horizontally reciprocal adjacent domain. Absent for legacy
    // single-domain observations. Windows carry their exact output/workspace
    // across both domains; the fingerprint binds the full observation.
    readonly domains?: ReadonlyArray<PlanDomain>;
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
    // AR12 client size hints captured freshly from `readWindowConstraints`
    // at observation time (primitive only, advisory, never retained state).
    // Absent when the host reports no hint there. Hints never join the
    // fingerprint and never affect snapshot equality/membership: they only
    // ride the request wire as `min_size`/`max_size`.
    readonly minSize?: { readonly w: number; readonly h: number };
    readonly maxSize?: { readonly w: number; readonly h: number };
}

export interface PlanSnapshot {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly domainBounds: PlanRect;
    readonly domainGap: number;
    readonly domainOuterGap: number;
    readonly focusedId: string;
    // Retained directional domains (primitive only, no refs). Absent for
    // legacy single-domain snapshots.
    readonly domains?: ReadonlyArray<PlanDomain>;
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
    const domains =
        observed.domains === undefined
            ? undefined
            : Object.freeze(
                  observed.domains.map((entry) =>
                      Object.freeze({
                          output: entry.output,
                          workspace: entry.workspace,
                          bounds: { x: entry.bounds.x, y: entry.bounds.y, w: entry.bounds.w, h: entry.bounds.h },
                          gap: entry.gap,
                          outerGap: entry.outerGap,
                          adjacent: Object.freeze({ ...(entry.adjacent as Record<string, string>) }),
                      }),
                  ),
              );
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
        ...(domains === undefined ? {} : { domains }),
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

// Directional domains equality: same length with identical primitive
// entries in order (output, workspace, bounds, gaps, adjacency). Binds the
// stale-scope fence to the full source+target observation so a stale target
// substitution cannot pass as fresh.
function domainsEqual(
    a: ReadonlyArray<PlanDomain> | undefined,
    b: ReadonlyArray<PlanDomain> | undefined,
): boolean {
    if (a === undefined || b === undefined) {
        return a === undefined && b === undefined;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        const left = a[index] as PlanDomain;
        const right = b[index] as PlanDomain;
        if (
            left.output !== right.output ||
            left.workspace !== right.workspace ||
            left.bounds.x !== right.bounds.x ||
            left.bounds.y !== right.bounds.y ||
            left.bounds.w !== right.bounds.w ||
            left.bounds.h !== right.bounds.h ||
            left.gap !== right.gap ||
            left.outerGap !== right.outerGap
        ) {
            return false;
        }
        const leftKeys = Object.keys(left.adjacent).sort();
        const rightKeys = Object.keys(right.adjacent).sort();
        if (leftKeys.length !== rightKeys.length) {
            return false;
        }
        for (let keyIndex = 0; keyIndex < leftKeys.length; keyIndex += 1) {
            if (leftKeys[keyIndex] !== rightKeys[keyIndex]) {
                return false;
            }
            const key = leftKeys[keyIndex] as string;
            if (
                (left.adjacent as Record<string, string>)[key] !==
                (right.adjacent as Record<string, string>)[key]
            ) {
                return false;
            }
        }
    }
    return true;
}

function snapshotsEqual(a: PlanSnapshot, b: PlanSnapshot): boolean {
    if (
        a.domainOutput !== b.domainOutput ||
        a.domainWorkspace !== b.domainWorkspace ||
        a.domainGap !== b.domainGap ||
        a.domainOuterGap !== b.domainOuterGap ||
        a.focusedId !== b.focusedId ||
        a.fingerprint !== b.fingerprint ||
        !domainsEqual(a.domains, b.domains)
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
        a.windows.length !== b.windows.length ||
        !domainsEqual(a.domains, b.domains)
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

// Reply-boundary flag-exactness: like floatingSkewed, but tolerates a
// toggle-float flight's own target reaching its intended end state. The
// toggle choreography observes the target flipped before the reply lands
// (pinned by the sticky/float toggle rows) and must still apply; any other
// member flipping, or the target flipping away from the intended end state,
// fails closed as stale. Baseline-diff skew detection is untouched.
function unexpectedFloatingSkewed(flight: PendingFlight, fresh: PlanSnapshot): boolean {
    const target = flight.floatTarget;
    const freshById = new Map<string, PlanSnapshotWindow>();
    for (const entry of fresh.windows) {
        if (!freshById.has(entry.id)) {
            freshById.set(entry.id, entry);
        }
    }
    for (const entry of flight.snapshot.windows) {
        const current = freshById.get(entry.id);
        if (current === undefined) {
            continue;
        }
        const wasFloating = entry.floating === true || entry.sticky === true;
        const isFloating = current.floating === true || current.sticky === true;
        if (wasFloating === isFloating) {
            continue;
        }
        if (target !== null && entry.id === target.window && target.floating === isFloating) {
            continue;
        }
        return true;
    }
    return false;
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
    // Production directional observation for Left/Right focus/move: source
    // plus the horizontally reciprocal adjacent output's current desktop
    // (bounded max two domains) with multi-domain windows. Absent in
    // isolated core tests; Up/Down never use it. May return the typed
    // {@link DirectionalObservation} outcome or, for legacy mocks, a bare
    // {@link PlanObserved} (treated as ready) or null (treated as invalid).
    readonly observeDirectional?: (
        direction: PlanDirection,
    ) => DirectionalObservation | PlanObserved | null;
    readonly clearMaximize: (target: object) => MaximizeClearOutcome;
    readonly setMaximize?: (target: object, maximized: boolean) => NativeStateWriteOutcome;
    readonly setFullscreen?: (target: object, fullscreen: boolean) => NativeStateWriteOutcome;
    readonly setAllDesktops?: (target: object, allDesktops: boolean) => NativeStateWriteOutcome;
    readonly readKeepAbove?: (target: object) => boolean | null;
    readonly readKeepBelow?: (target: object) => boolean | null;
    readonly setKeepAbove?: (target: object, keepAbove: boolean) => KeepAboveWriteOutcome;
    readonly setKeepBelow?: (target: object, keepBelow: boolean) => KeepAboveWriteOutcome;
    readonly setGeometry: (target: object, rect: PlanRect) => boolean;
    readonly setFloating?: (id: string, floating: boolean) => void;
    readonly setActive: (target: object) => boolean;
    readonly active: () => object | null;
    // Production R4 cross-output transfer capabilities. All ten must be
    // present for `cross_output_transfer: true`; any absence keeps R4
    // unavailable and local R1-R3 behavior unchanged. The entry binds them
    // to public typed surfaces only: exact Output object resolution by name,
    // exact VirtualDesktop resolution by id, workspace.sendClientToScreen
    // with the exact target Output object, the mover desktops write with the
    // exact target VirtualDesktop refs, synchronous output/membership/
    // geometry reads for proof, and one-shot outputChanged (old value
    // re-read), desktopsChanged, and frameGeometryChanged fences.
    readonly resolveOutput?: (name: string) => object | null;
    readonly resolveDesktop?: (workspace: string) => object | null;
    readonly sendClientToScreen?: (mover: object, output: object) => boolean;
    readonly setDesktops?: (mover: object, desktops: ReadonlyArray<object>) => boolean;
    readonly readOutputName?: (ref: object) => string | null;
    readonly readDesktopIds?: (ref: object) => ReadonlyArray<string> | null;
    readonly readGeometry?: (ref: object) => PlanRect | null;
    // Trace-only native constraint read. It is optional so the planner route
    // remains usable on older script surfaces and isolated tests.
    readonly readWindowConstraints?: (ref: object) => PlanWindowConstraints | null;
    readonly subscribeMoverOutput?: (mover: object, handler: (old: unknown) => void) => (() => void) | null;
    readonly subscribeMoverDesktops?: (mover: object, handler: () => void) => (() => void) | null;
    readonly subscribeWindowGeometry?: (ref: object, handler: () => void) => (() => void) | null;
    readonly subscribe: (kind: PlanSignal, handler: (target?: object) => void) => () => void;
    readonly noteRemoved?: (id: string) => void;
    // Retired workspace-send coordination hook, ignored. Send flights never
    // block Plan: terminal send settlement arrives via `notifySendSettled`,
    // which forces a one-shot complete source AND target reconcile through
    // the existing single-flight chain. Retained as optional only so
    // obsolete harnesses still typecheck; production entries must not pass
    // it and the adapter never reads it.
    readonly isSendActive?: () => boolean;
    // Entry-owned native interaction guard. Ordinary retained reconciliation
    // must not compete with an active interactive edge resize.
    readonly isInteractiveResizeActive?: () => boolean;
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

// Wire-shaped window for the production directional fingerprint: exactly the
// fields carried on the request (id, output, workspace, rect, floating,
// fit-excluded).
export interface DirectionalFingerprintWindow {
    readonly window: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: PlanRect;
    readonly floating: boolean;
    readonly fitExcluded: boolean;
}

// Canonical production directional fingerprint (FNV-1a 32-bit) over the full
// two-domain evidence, byte-identical to Rust's `directional_fingerprint`:
// ordered domain primitives (output, workspace, raw bounds, gaps, left/right
// adjacency), the focused id, and every window sorted by id. Any alteration
// of target rect, bounds, or adjacency changes the value and fails Rust
// request validation. Legacy single-domain requests keep `planFingerprint`.
export function planDirectionalFingerprint(
    domains: ReadonlyArray<PlanDomain>,
    focusedId: string,
    windows: ReadonlyArray<DirectionalFingerprintWindow>,
): number {
    let hash = 2166136261;
    const feed = (text: string): void => {
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index) & 0xff;
            hash = Math.imul(hash, 16777619);
        }
    };
    const sep = (code: number): void => {
        hash ^= code;
        hash = Math.imul(hash, 16777619);
    };
    for (let index = 0; index < domains.length; index += 1) {
        const entry = domains[index] as PlanDomain;
        if (index > 0) {
            sep(0x1e);
        }
        feed(entry.output);
        sep(0x1f);
        feed(entry.workspace);
        sep(0x1f);
        feed(String(entry.bounds.x));
        sep(0x1f);
        feed(String(entry.bounds.y));
        sep(0x1f);
        feed(String(entry.bounds.w));
        sep(0x1f);
        feed(String(entry.bounds.h));
        sep(0x1f);
        feed(String(entry.gap));
        sep(0x1f);
        feed(String(entry.outerGap));
        sep(0x1f);
        feed("left");
        sep(0x1f);
        feed((entry.adjacent as Record<string, string>)["left"] ?? "");
        sep(0x1f);
        feed("right");
        sep(0x1f);
        feed((entry.adjacent as Record<string, string>)["right"] ?? "");
    }
    sep(0x1f);
    feed(focusedId);
    const ordered = [...windows].sort((a, b) => (a.window < b.window ? -1 : a.window > b.window ? 1 : 0));
    for (const entry of ordered) {
        sep(0x1f);
        feed(entry.window);
        sep(0x1f);
        feed(entry.output);
        sep(0x1f);
        feed(entry.workspace);
        sep(0x1f);
        feed(String(entry.rect.x));
        sep(0x1f);
        feed(String(entry.rect.y));
        sep(0x1f);
        feed(String(entry.rect.w));
        sep(0x1f);
        feed(String(entry.rect.h));
        sep(0x1f);
        feed(entry.floating ? "1" : "0");
        sep(0x1f);
        feed(entry.fitExcluded ? "1" : "0");
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

// Exact D-Bus unique-owner shape (`:N.M`) for the pinned planner endpoint.
function isUniqueOwner(value: unknown): value is string {
    return typeof value === "string" && /^:[0-9]+\.[0-9]+$/.test(value);
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

// Drag-N correlation for drop-intent follow-up: validated closed vocabulary
// only (drag-<digits>), never titles, ids, or payload bytes.
function isDragCorrelation(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= PLAN_MAX_CORRELATION_LEN && /^drag-[0-9]+$/.test(value);
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

// Exact Engine gap-mismatch messages for the correlated update-gaps retry.
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

// Exact Engine gap-mismatch messages for the correlated update-gaps retry.
// Rejected gap replies carry no wire `detail`, so only `message` binds the
// signal: matching is exact-string equality against these fixed Engine
// literals, never substring or kind-only.
const GAP_MISMATCH_MESSAGES: readonly string[] = Object.freeze([
    "domain gap does not match retained state",
    "domain outer gap does not match retained state",
]);

function isGapMismatchMessage(value: unknown): boolean {
    return typeof value === "string" && GAP_MISMATCH_MESSAGES.indexOf(value) >= 0;
}

interface PlanGeometryEntry {
    readonly window: string;
    readonly leaf: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: PlanRect;
    // AR12 reply diagnostics. Absent on the wire unless true; default false
    // here. `overconstrained` is honored on every op (never reasserted);
    // `clientClamped` is honored only on reconcile/update-gaps.
    readonly overconstrained: boolean;
    readonly clientClamped: boolean;
}

interface PlanFocusBody {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly leaf: string;
}

export interface PlanFocusOperation {
    readonly op: "focus";
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly fromLeaf: string;
    readonly toLeaf: string;
    readonly fromWindow: string;
    readonly toWindow: string;
    readonly direction: string;
    readonly route: ReadonlyArray<string>;
    readonly crossSourceOutput: string | null;
    readonly crossSourceWorkspace: string | null;
}

// Exact production cross-output move operation (R4 only): the mover, the
// captured source, the adjacent target with its current workspace, the
// commanded direction, the R4 rule, and the transfer capability. Absent for
// local R1/R2/R3 plans. The adapter fences every field before any
// membership/geometry/focus write; no looser alternate plan is accepted.
export interface PlanMoveOperation {
    readonly op: "move";
    readonly rule: string;
    readonly capability: string;
    readonly direction: string;
    readonly window: string;
    readonly leaf: string;
    readonly sourceOutput: string;
    readonly sourceWorkspace: string;
    readonly targetOutput: string;
    readonly targetWorkspace: string;
    readonly sourceRootChildIndex: number;
    readonly target: string;
}

interface PlannedReply {
    readonly correlationId: string;
    readonly baseRevision: number | null;
    readonly geometry: ReadonlyArray<PlanGeometryEntry>;
    readonly focus: PlanFocusBody | null;
    readonly floatGeometry: { readonly window: string; readonly rect: PlanRect } | null;
    // Exact cross-output operation/preconditions when the planner crossed
    // outputs (focus or R4 move). Absent for local plans. The adapter fences
    // them against the captured source before any actuation.
    readonly operation: PlanFocusOperation | PlanMoveOperation | null;
    readonly preconditions: ReadonlyArray<string> | null;
    // Raw wire operation/preconditions retained verbatim for the R4 verify
    // echo (Rust parses snake_case and compares typed equality).
    readonly rawOperation: unknown;
    readonly rawPreconditions: unknown;
}

function validateGeometryEntry(value: unknown): PlanGeometryEntry | null {
    if (!isRecord(value)) {
        return null;
    }
    // Required wire keys plus the optional AR12 diagnostics. Any other key
    // stays malformed (fail closed, mirroring the old exact-keys check).
    const allowed = new Set(["window", "leaf", "output", "workspace", "rect", "overconstrained", "client_clamped"]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            return null;
        }
    }
    for (const key of ["window", "leaf", "output", "workspace", "rect"]) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            return null;
        }
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
    const over = value["overconstrained"];
    if (over !== undefined && typeof over !== "boolean") {
        return null;
    }
    const clamped = value["client_clamped"];
    if (clamped !== undefined && typeof clamped !== "boolean") {
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
        overconstrained: over === true,
        clientClamped: clamped === true,
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

function parseBaseRevision(reply: unknown): number | null {
    if (!isRecord(reply)) {
        return null;
    }
    const value = reply["base_revision"];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > PLAN_MAX_SEQ) {
        return null;
    }
    return value;
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
    if (!Array.isArray(geometryRaw)) {
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
        if (floatGeometry === undefined) {
            return null;
        }
        const operation = validateOperation(reply["operation"]);
        if (operation === undefined) {
            return null;
        }
        const preconditions = validatePreconditions(reply["preconditions"]);
        if (preconditions === undefined) {
            return null;
        }
        // Cross focus operations must carry the exact adjacent-output
        // precondition; local focus operations must carry the same-domain
        // one. Move operations pair only with the move precondition set
        // (fenced by the active cross-focus path); any other pairing is
        // malformed.
        if (operation !== null && operation.op === "focus") {
            const hasAdjacent = preconditions !== null && preconditions.indexOf("focus-targets-adjacent-output") >= 0;
            const hasSame = preconditions !== null && preconditions.indexOf("focus-targets-same-domain") >= 0;
            const isCross = operation.crossSourceOutput !== null || operation.crossSourceWorkspace !== null;
            if (isCross !== hasAdjacent || (!isCross && !hasSame)) {
                return null;
            }
            if (hasAdjacent && hasSame) {
                return null;
            }
        } else if (operation !== null && operation.op === "move") {
            if (preconditions === null) {
                return null;
            }
            const allowed = new Set([
                "focused-leaf-occupied-by-focused-window",
                "source-root-membership-and-adjacent-same-workspace-output",
                "adapter-must-verify-postconditions",
            ]);
            if (preconditions.length !== 3) {
                return null;
            }
            for (const token of preconditions) {
                if (!allowed.has(token)) {
                    return null;
                }
            }
        } else if (preconditions !== null) {
            return null;
        }
        return { correlationId, baseRevision: parseBaseRevision(reply), geometry: Object.freeze(geometry), focus, floatGeometry, operation, preconditions, rawOperation: reply["operation"] ?? null, rawPreconditions: reply["preconditions"] ?? null };
    }
    const floatGeometry = validateFloatGeometry(reply["float_geometry"]);
    if (floatGeometry === undefined) {
        return null;
    }
    const operation = validateOperation(reply["operation"]);
    if (operation === undefined) {
        return null;
    }
    const preconditions = validatePreconditions(reply["preconditions"]);
    if (preconditions === undefined || operation !== null || preconditions !== null) {
        return null;
    }
    return { correlationId, baseRevision: parseBaseRevision(reply), geometry: Object.freeze(geometry), focus: null, floatGeometry, operation, preconditions, rawOperation: null, rawPreconditions: null };
}

// Operation envelope shared by focus and move replies: parsed by the `op`
// tag into the exact variant. Unknown tags and malformed variants are
// `undefined` (malformed reply); absent is `null`.
function validateOperation(value: unknown): PlanFocusOperation | PlanMoveOperation | null | undefined {
    if (value === undefined || value === null) {
        return null;
    }
    if (!isRecord(value)) {
        return undefined;
    }
    if (value["op"] === "focus") {
        return validateFocusOperation(value);
    }
    if (value["op"] === "move") {
        return validateMoveOperation(value);
    }
    return undefined;
}

function validateMoveOperation(value: unknown): PlanMoveOperation | null | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const want = ["op", "rule", "capability", "direction", "window", "leaf", "source_output", "source_workspace", "target_output", "target_workspace", "source_root_child_index", "target"];
    if (!hasExactKeys(value, want)) {
        return undefined;
    }
    if (
        !isOpaqueId(value["window"]) ||
        !isOpaqueId(value["leaf"]) ||
        !isOpaqueId(value["source_output"]) ||
        !isOpaqueId(value["source_workspace"]) ||
        !isOpaqueId(value["target_output"]) ||
        !isOpaqueId(value["target_workspace"])
    ) {
        return undefined;
    }
    const direction = value["direction"];
    if (direction !== "left" && direction !== "right" && direction !== "up" && direction !== "down") {
        return undefined;
    }
    const rule = value["rule"];
    if (typeof rule !== "string" || rule.length === 0 || rule.length > 32) {
        return undefined;
    }
    const capability = value["capability"];
    if (typeof capability !== "string" || capability.length === 0 || capability.length > 64) {
        return undefined;
    }
    const sourceRootChildIndex = value["source_root_child_index"];
    if (!isFiniteInt(sourceRootChildIndex) || (sourceRootChildIndex as number) < 0) {
        return undefined;
    }
    const target = value["target"];
    if (target !== "empty" && target !== "occupied") {
        return undefined;
    }
    return {
        op: "move",
        rule: rule as string,
        capability: capability as string,
        direction: direction as string,
        window: value["window"] as string,
        leaf: value["leaf"] as string,
        sourceOutput: value["source_output"] as string,
        sourceWorkspace: value["source_workspace"] as string,
        targetOutput: value["target_output"] as string,
        targetWorkspace: value["target_workspace"] as string,
        sourceRootChildIndex: sourceRootChildIndex as number,
        target: target as string,
    };
}

function validateFocusOperation(value: unknown): PlanFocusOperation | null | undefined {
    if (value === undefined || value === null) {
        return null;
    }
    if (!isRecord(value)) {
        return undefined;
    }
    const keys = Object.keys(value);
    const want = ["op", "domain_output", "domain_workspace", "from_leaf", "to_leaf", "from_window", "to_window", "direction", "route", "cross_source_output", "cross_source_workspace"];
    if (keys.length !== want.length) {
        return undefined;
    }
    for (const key of want) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            return undefined;
        }
    }
    if (value["op"] !== "focus") {
        return undefined;
    }
    if (
        !isOpaqueId(value["domain_output"]) ||
        !isOpaqueId(value["domain_workspace"]) ||
        !isOpaqueId(value["from_leaf"]) ||
        !isOpaqueId(value["to_leaf"]) ||
        !isOpaqueId(value["from_window"]) ||
        !isOpaqueId(value["to_window"])
    ) {
        return undefined;
    }
    const direction = value["direction"];
    if (direction !== "left" && direction !== "right" && direction !== "up" && direction !== "down") {
        return undefined;
    }
    const route = value["route"];
    if (!Array.isArray(route) || route.length === 0) {
        return undefined;
    }
    const routeOut: string[] = [];
    for (const entry of route) {
        if (!isOpaqueId(entry)) {
            return undefined;
        }
        routeOut.push(entry as string);
    }
    const crossOutput = value["cross_source_output"];
    const crossWorkspace = value["cross_source_workspace"];
    if (crossOutput !== null && !isOpaqueId(crossOutput)) {
        return undefined;
    }
    if (crossWorkspace !== null && !isOpaqueId(crossWorkspace)) {
        return undefined;
    }
    return {
        op: "focus",
        domainOutput: value["domain_output"] as string,
        domainWorkspace: value["domain_workspace"] as string,
        fromLeaf: value["from_leaf"] as string,
        toLeaf: value["to_leaf"] as string,
        fromWindow: value["from_window"] as string,
        toWindow: value["to_window"] as string,
        direction: direction as string,
        route: Object.freeze(routeOut),
        crossSourceOutput: (crossOutput as string | null) ?? null,
        crossSourceWorkspace: (crossWorkspace as string | null) ?? null,
    };
}

function validatePreconditions(value: unknown): ReadonlyArray<string> | null | undefined {
    if (value === undefined || value === null) {
        return null;
    }
    if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
        return undefined;
    }
    const allowed = new Set([
        "focused-leaf-occupied-by-focused-window",
        "target-leaf-occupied",
        "focus-targets-same-domain",
        "focus-targets-adjacent-output",
        "source-root-membership-and-adjacent-same-workspace-output",
        "adapter-must-verify-postconditions",
    ]);
    const out: string[] = [];
    for (const entry of value) {
        if (typeof entry !== "string" || !allowed.has(entry)) {
            return undefined;
        }
        out.push(entry);
    }
    return Object.freeze(out);
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
    if (windows.length === 0) {
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
    // Directional domains: at most two primitive entries, source first and
    // equal to the carried source domain, with distinct outputs and
    // reciprocal left/right adjacency when two are present.
    const domains = observed.domains;
    if (domains !== undefined) {
        if (!Array.isArray(domains) || domains.length === 0 || domains.length > 2) {
            return false;
        }
        const first = domains[0] as PlanDomain;
        if (
            first.output !== observed.domainOutput ||
            first.workspace !== observed.domainWorkspace ||
            first.bounds.x !== observed.domainBounds.x ||
            first.bounds.y !== observed.domainBounds.y ||
            first.bounds.w !== observed.domainBounds.w ||
            first.bounds.h !== observed.domainBounds.h ||
            first.gap !== observed.domainGap ||
            first.outerGap !== observed.domainOuterGap
        ) {
            return false;
        }
        const seenOutputs = new Set<string>();
        for (const entry of domains) {
            if (typeof entry !== "object" || entry === null) {
                return false;
            }
            const candidate = entry as PlanDomain;
            if (!isOpaqueId(candidate.output) || !isOpaqueId(candidate.workspace)) {
                return false;
            }
            if (!isTargetRect({ x: candidate.bounds.x, y: candidate.bounds.y, w: candidate.bounds.w, h: candidate.bounds.h })) {
                return false;
            }
            if (!isFiniteInt(candidate.gap) || candidate.gap < 0 || candidate.gap > 64) {
                return false;
            }
            if (!isFiniteInt(candidate.outerGap) || candidate.outerGap < 0 || candidate.outerGap > 64) {
                return false;
            }
            if (typeof candidate.adjacent !== "object" || candidate.adjacent === null || Array.isArray(candidate.adjacent)) {
                return false;
            }
            for (const key of Object.keys(candidate.adjacent)) {
                if (key !== "left" && key !== "right") {
                    return false;
                }
                const target = (candidate.adjacent as Record<string, unknown>)[key];
                if (!isOpaqueId(target)) {
                    return false;
                }
            }
            if (seenOutputs.has(candidate.output)) {
                return false;
            }
            seenOutputs.add(candidate.output);
        }
        if (domains.length === 2) {
            const firstEntry = domains[0] as PlanDomain;
            const secondEntry = domains[1] as PlanDomain;
            let reciprocal = false;
            for (const direction of ["left", "right"] as const) {
                const opposite = direction === "left" ? "right" : "left";
                if (
                    (firstEntry.adjacent as Record<string, string>)[direction] === secondEntry.output &&
                    (secondEntry.adjacent as Record<string, string>)[opposite] === firstEntry.output
                ) {
                    reciprocal = true;
                    break;
                }
            }
            if (!reciprocal) {
                return false;
            }
        }
    }
    const homedPairs = new Set<string>();
    if (domains !== undefined) {
        for (const entry of domains) {
            homedPairs.add(`${(entry as PlanDomain).output}\u0000${(entry as PlanDomain).workspace}`);
        }
    } else {
        homedPairs.add(`${observed.domainOutput}\u0000${observed.domainWorkspace}`);
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
        if (!homedPairs.has(`${candidate.output}\u0000${candidate.workspace}`)) {
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
            // Directional requests plan from the source focus: the focused
            // window must live in the source domain, never the target.
            if (
                domains !== undefined &&
                (candidate.output !== observed.domainOutput ||
                    candidate.workspace !== observed.domainWorkspace)
            ) {
                return false;
            }
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
    readonly plannerSession: number;
    readonly snapshot: PlanSnapshot;
    readonly removed: string | null;
    readonly windowCount: number;
    readonly pointerSource: string | null;
    // Drop-intent correlation: set only on pointer-resize flights dispatched
    // from a non-cancelled oracle drop (drag-N). Rejection or terminal
    // failure of such a flight feeds the coalesced per-domain restore
    // marker below, never a per-drag queue.
    readonly dragSource?: string | null;
    // Domain key of the restore marker this reconcile was dispatched for.
    // Never a drag correlation: satisfaction and failure terminals resolve
    // through the marker map, so overlapping drops share one dispatch.
    readonly restoreMarker?: string | null;
    readonly workAreaReprojection: boolean;
    readonly admissionMaximizeClears: ReadonlyArray<string>;
    readonly floatTarget: { readonly window: string; readonly floating: boolean } | null;
    readonly stickyTarget: { readonly window: string; readonly previousFloating: boolean } | null;
    // True for a hidden-domain (background) flight: geometry only, never
    // focus or interactive commands. Serialized through the same
    // single-flight and send-blocking as foreground.
    readonly background: boolean;
    // Directional command direction for Left/Right focus/move (else null).
    // Selects the directional re-observation at apply time so a stale target
    // substitution fails closed before any write.
    readonly direction: PlanDirection | null;
    // Pinned-owner transport payload retained across activation steps.
    readonly requestPayload: string;
    // Original request revision carried at dispatch (always 0 on the request
    // phase). Cancellation echoes exactly this value, never a base revision
    // learned from a stale probe.
    readonly requestRevision: number;
    // Original command for one pre-write replan.
    readonly body: Record<string, unknown>;
    // Prevents a second replan when the replacement flight is also stale.
    readonly replanned: boolean;
    // True when dispatched from confirmed-loss recovery: a terminal failure
    // stays bounded without a second identity probe, so a failed recovery
    // never loops.
    readonly isRecovery: boolean;
}

// Production R4 cross-output move flight (immediate commit, no wire
// ack/verify/cancel/status). Retained after the R4 `planned` reply across
// native transfer plus bounded delayed arrival. Exactly one flight
// serializes through the shared single-flight; while live every other
// PlanAdapter operation refuses busy and no replay ever occurs.
interface R4Flight {
    readonly flight: number;
    readonly session: number;
    readonly correlation: string;
    readonly baseRevision: number;
    readonly epoch: number;
    readonly op: PlanOp;
    readonly snapshot: PlanSnapshot;
    readonly planned: PlannedReply;
    readonly moverId: string;
    readonly moverRef: object;
    readonly targetOutput: string;
    readonly targetWorkspace: string;
    readonly targetOutputRef: object;
    readonly targetDesktopRef: object;
    readonly byRef: ReadonlyMap<string, object>;
    readonly direction: PlanDirection;
    followed: boolean;
    detaches: Array<() => void>;
    settled: boolean;
}

interface AutoIntent {
    readonly op: PlanOp;
    readonly snapshot: PlanSnapshot;
    readonly removed: string | null;
    readonly body: Record<string, unknown>;
    readonly pointerSource?: string | null;
    readonly dragSource?: string | null;
    // Domain key of the restore marker this reconcile converges. Set only
    // on marker reconciles built by maybeDispatchDragRestore; never queued
    // through superseding intents.
    readonly restoreMarker?: string | null;
    readonly workAreaReprojection?: boolean;
    readonly admissionMaximizeClears?: ReadonlyArray<string>;
    readonly floatTarget?: { readonly window: string; readonly floating: boolean } | null;
    readonly stickyTarget?: { readonly window: string; readonly previousFloating: boolean } | null;
    readonly background?: boolean;
    readonly direction?: PlanDirection | null;
    readonly replanned?: boolean;
}

interface PointerEcho {
    readonly correlation: string;
    readonly source: string;
    readonly scope: PlanSnapshot;
    readonly neighbours: ReadonlyArray<{ window: string; rect: PlanRect }>;
}

// Coalesced restore marker for rejected drops in one exact domain. `drags`
// carries every rejected drag-N correlation still needing its own terminal
// log; `dispatched` records that the marker's single reconcile attempt was
// used (sent or attempted), so no second dispatch ever follows.
interface DragRestoreMarker {
    readonly output: string;
    readonly workspace: string;
    readonly drags: string[];
    dispatched: boolean;
}

// Bound on drag correlations coalesced into one marker. Overflow fails closed
// with a truthful correlated `unavailable` terminal naming `plan=none`, never
// a silent drop and never a fabricated success.
const MAX_DRAG_RESTORE_DRAGS = 64;
// Bound on ops whose successful application satisfies a marker: exactly the
// ops that write/apply a domain's full retained/projected geometry.
// Focus-only and toggle-float plans never satisfy, however they settle.
const DRAG_RESTORE_SATISFYING_OPS: ReadonlySet<PlanOp> = new Set([
    "admit",
    "remove",
    "move",
    "resize",
    "reconcile",
    "update-gaps",
    "pointer-resize",
]);

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
    // Bounded correlation rotation: after PLAN_MAX_SEQ correlations the
    // sequence wraps with a rotation prefix (seqEpoch) so correlations are
    // never reused within a bounded length. Same Engine session/topology:
    // rotation never bumps plannerSession and never clears applied evidence.
    private seqEpoch = 0;
    // Per-id applied evidence (rect, output/workspace, floating/sticky/
    // fullscreen/maximized), written only on applied replies. Read-only hint
    // for overlays, first-admission maximize, and drag lookup; never authority
    // for Plan membership.
    private appliedById = new Map<string, { rect: PlanRect; output: string; workspace: string; floating: boolean; sticky: boolean; fullscreen: boolean; maximized: boolean }>();
    // Per-domain applied scope (bounds, gap, outerGap), keyed by domain
    // output/workspace. Written only on successful applied plan replies
    // alongside appliedById; never admission or membership authority.
    private appliedScopeByDomain = new Map<string, { bounds: PlanRect; gap: number; outerGap: number }>();
    // First-seen fullscreen hold: ids ever observed non-fullscreen versus ids
    // first seen fullscreen and still held. A first-seen fullscreen window
    // rides the wire as a synthetic floating exception (planner observation
    // only, never native float) so it takes no Rust tile slot while initially
    // fullscreen. First non-fullscreen observation releases to normal fresh
    // admission; later fullscreen retains its slot. Already tiled ids
    // (applied evidence) and ever-seen-normal ids never hold. Each entry
    // pins the exact native ref observed first: a reused id with a different
    // ref never inherits the old marker, and the exact native removal signal
    // evicts even marker-only ids with no applied slot.
    private seenNonFullscreen = new Map<string, object>();
    private heldInitialFullscreen = new Map<string, object>();
    private reconcileAttempts = 0;
    // One-shot forced complete reconciliation for send-settled domains,
    // keyed by domain output/workspace. A terminal send flight carries its
    // exact source+target keys via `notifySendSettled`; the next foreground
    // or hidden refresh then dispatches a complete reconcile for each
    // forced domain even when the equal-applied-evidence optimization would
    // otherwise stay quiet. Each key is consumed once when its reconcile
    // dispatches. Unreadable or omitted domains are never consumed and never
    // synthesized: absence stays unknown and the next complete observation
    // retries. No transaction, no Plan block, no queue.
    private sendForcedDomains = new Set<string>();
    // Per-domain background reconcile accounting, keyed by domain
    // output/workspace. Foreground counters above are never touched by
    // hidden-domain flights so background drift can never block foreground.
    private backgroundAttempts = new Map<string, number>();
    // Reentrancy guard for the finishFlight hidden-domain chain: a
    // synchronously failing background dispatch must not recurse.
    private chainingHidden = false;
    // Once-per-chain bound for hidden domains: every complete hidden domain
    // visited in one refresh/finishFlight chain is recorded here so unchanged
    // domains cannot self-chain endlessly. Cleared only at a new top-level
    // debounced refresh; the next independent signal revisits genuinely new
    // evidence.
    private hiddenVisited = new Set<string>();
    private repeatFocused: string | null = null;
    private repeatDirection: PlanDirection | null = null;
    private repeatMode: PlanResizeMode | null = null;
    private repeatNext = 0;
    private repeatFingerprint = "";
    private pointerEcho: PointerEcho | null = null;
    // Trace-only post-write evidence. One entry per written window avoids
    // turning repeated client or pointer updates into an unbounded trace.
    private constraintTracePending = new Map<string, { correlation: string; resourceClass: string; requested: PlanRect }>();
    private maximizeAdmissionEcho: object | null = null;
    private maximizeAdmissionAttempts = new Set<string>();
    private maximizeToggleEcho: { ref: object; id: string; resourceClass: string } | null = null;
    private stickyEcho: { ref: object; id: string; resourceClass: string; allDesktops: boolean; previousFloating: boolean } | null = null;
    private stickyPreviousFloating = new Map<string, boolean>();
    // Adopted sticky floats with unknown same-runtime origin: an eligible
    // normal window already native-sticky (onAllDesktops true with an empty
    // native desktop list) observed without a recorded origin is adopted as a
    // sticky float with prior-float semantics only. No tiled slot is guessed,
    // no history is persisted, and unstick never claims planner admission.
    private adoptedSticky = new Set<string>();
    // The native setters own mutual exclusivity. Retain only the prior pair so
    // a project float can restore an initial keep-below choice exactly.
    private keepAbovePrevious = new Map<string, { ref: object; above: boolean; below: boolean }>();
    private maximizeToggleAttempts = new Map<object, boolean>();
    private stickyAttempts = new Map<object, boolean>();
    // Owner-pinned Planner transport plus confirmed-loss recovery. The
    // in-memory Planner survives sleep: same-owner failures retain applied
    // evidence and never rebuild. Only actual absence/identity evidence
    // (strict NameHasOwner false or a changed unique owner, via normal
    // activation or one bounded post-terminal probe) triggers a fresh
    // session. No polling, retry, or Legacy path.
    private pinnedOwner: string | null = null;
    private activationStep = 0;
    private plannerSession = 0;
    private knownOwner: string | null = null;
    private nextIsRecovery = false;
    private probeToken = 0;
    private activeProbe = 0;
    private probeCancel: (() => void) | null = null;
    // Live production R4 flight (immediate commit, native plus bounded
    // delayed arrival). While non-null the shared single-flight stays held
    // and every other PlanAdapter operation refuses busy; completion or
    // terminal failure always clears it exactly once with no replay.
    private r4Flight: R4Flight | null = null;
    // Bounded reentrancy guard for the synchronous R4 native-write stack:
    // KWin signals delivered synchronously from a setter must not follow or
    // settle mid-stack; the immediate post-write observation covers sync
    // arrival. Delayed arrival stays observable through the armed one-shot
    // mover signals. Never a transaction-lifetime Plan block.
    private r4WriteDepth = 0;
    // Bounded arrival deadline for delayed R4 arrival. Armed alongside the
    // one-shot mover signals after native writes; cleared on every R4
    // terminal. The unanswered-request deadline stays the existing dispatch
    // `cancelTimer`; stale timers are fenced by flight/session.
    private r4ArrivalTimer: (() => void) | null = null;
    // Coalesced per-domain restore markers for rejected drops. Each rejected
    // drop (adapter-validation refusal, Planner rejection, terminal failure
    // of its pointer flight, or a superseded deferred pointer that never
    // dispatched) appends its validated drag-N correlation to the marker
    // scoped to the drop's exact output/workspace. Overlapping rejected
    // drops share one marker; every correlation gets its own terminal log
    // naming the satisfying or failing plan correlation. Drops with no
    // domain evidence at all fail closed immediately with an `unavailable`
    // terminal and never create a marker, so no unrelated plan can satisfy
    // them. Markers never ride the single deferred slot: while it is busy
    // the marker persists, and exactly one existing-route reconcile
    // dispatches per marker when free, unless an applied plan for the same
    // domain already satisfied it. A failed marker reconcile logs one
    // terminal per drag and never retries. Keyed by domain
    // output/workspace.
    private dragRestore = new Map<string, DragRestoreMarker>();

    constructor(private readonly env: PlanAdapterEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    // Global R4 pending gate: true while an R4 move flight holds the shared
    // single-flight across native transfer plus ack/verify. Entry and tests
    // use it alongside isInFlight to block interleaving work.
    get isR4InFlight(): boolean {
        return this.r4Flight !== null;
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
        this.r4Flight = null;
        this.deferredAuto = null;
        this.epoch = 0;
        this.appliedById.clear();
        this.appliedScopeByDomain.clear();
        this.seenNonFullscreen.clear();
        this.heldInitialFullscreen.clear();
        this.settleDragRestoreUnavailable();
        this.reconcileAttempts = 0;
        this.sendForcedDomains.clear();
        this.backgroundAttempts.clear();
        this.pointerEcho = null;
        this.constraintTracePending.clear();
        this.maximizeAdmissionEcho = null;
        this.maximizeAdmissionAttempts.clear();
        this.maximizeToggleEcho = null;
        this.stickyEcho = null;
        this.stickyPreviousFloating.clear();
        this.adoptedSticky.clear();
        this.keepAbovePrevious.clear();
        this.maximizeToggleAttempts.clear();
        this.stickyAttempts.clear();
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.plannerSession = 0;
        this.knownOwner = null;
        this.nextIsRecovery = false;
        this.activeProbe = 0;
        this.clearProbeTimer();
        this.r4WriteDepth = 0;
        this.clearRepeat();
        return true;
    }

    disable(): void {
        if (!this.enabled && this.detaches.length === 0) {
            return;
        }
        this.enabled = false;
        this.restoreAllKeepAbove();
        this.inFlight = false;
        this.pending = null;
        this.clearR4Flight();
        this.deferredAuto = null;
        this.appliedById.clear();
        this.appliedScopeByDomain.clear();
        this.seenNonFullscreen.clear();
        this.heldInitialFullscreen.clear();
        this.settleDragRestoreUnavailable();
        this.reconcileAttempts = 0;
        this.sendForcedDomains.clear();
        this.backgroundAttempts.clear();
        this.pointerEcho = null;
        this.constraintTracePending.clear();
        this.maximizeAdmissionEcho = null;
        this.maximizeAdmissionAttempts.clear();
        this.maximizeToggleEcho = null;
        this.stickyEcho = null;
        this.stickyPreviousFloating.clear();
        this.adoptedSticky.clear();
        this.keepAbovePrevious.clear();
        this.maximizeToggleAttempts.clear();
        this.stickyAttempts.clear();
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.knownOwner = null;
        this.nextIsRecovery = false;
        this.activeProbe = 0;
        this.clearProbeTimer();
        this.r4WriteDepth = 0;
        this.clearRepeat();
        this.clearTimer();
        this.clearR4ArrivalTimer();
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

    // Directional observation outcome for Left/Right focus/move. `ready`
    // carries a validated two-domain observation; `no-target` is a confirmed
    // no-adjacent/single-output condition that keeps local single-domain
    // behavior; `invalid` (ambiguous, unreadable, malformed) must refuse
    // before any local mutation. `legacy` covers Up/Down and hook-absent
    // isolated tests, which stay on the normal single-domain observation.
    private readDirectional(
        direction: PlanDirection,
    ): { kind: "ready"; observed: PlanObserved } | { kind: "no-target" } | { kind: "invalid" } | { kind: "legacy" } {
        if (direction !== "left" && direction !== "right") {
            return { kind: "legacy" };
        }
        const hook = this.env.observeDirectional;
        if (typeof hook !== "function") {
            return { kind: "legacy" };
        }
        let raw: DirectionalObservation | PlanObserved | null = null;
        try {
            raw = hook(direction);
        } catch (error) {
            void error;
            return { kind: "invalid" };
        }
        if (raw === null || raw === undefined) {
            return { kind: "invalid" };
        }
        if (typeof raw === "object" && "status" in raw) {
            const outcome = raw as DirectionalObservation;
            if (outcome.status === "ready") {
                return validateObserved(outcome.observed) ? { kind: "ready", observed: outcome.observed as PlanObserved } : { kind: "invalid" };
            }
            if (outcome.status === "no-target") {
                return { kind: "no-target" };
            }
            return { kind: "invalid" };
        }
        // Legacy mock shape: a bare observation is a ready candidate that
        // still must validate; anything else is invalid, never silent local.
        return validateObserved(raw as PlanObserved | null)
            ? { kind: "ready", observed: raw as PlanObserved }
            : { kind: "invalid" };
    }

    // Directional re-observation for a flight: the same commanded direction
    // re-resolves source plus the same adjacent target. Anything unreadable,
    // ambiguous, changed, or newly targetless fails closed (null) before any
    // write.
    private freshDirectionalForFlight(flightState: PendingFlight): PlanObserved | null {
        const direction = flightState.direction;
        if (direction !== "left" && direction !== "right") {
            return null;
        }
        const outcome = this.readDirectional(direction);
        return outcome.kind === "ready" ? outcome.observed : null;
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
        if (this.r4Flight !== null) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=focus`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=focus`);
            return;
        }
        const directional = this.readDirectional(direction);
        if (directional.kind === "invalid") {
            this.logToken(`${LOG_PREFIX}:focus-refused-ambiguous`);
            return;
        }
        const observed =
            directional.kind === "ready" ? directional.observed : this.freshObserved();
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
            direction,
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

    // Carried snapshot for dispatch and reply-boundary comparison: a
    // fullscreen or maximized member carries its per-id applied rectangle
    // (the last planned projection for that id on the same output/workspace)
    // in place of the compositor-owned fullscreen or maximized frame rect,
    // which can exceed the work area and would otherwise be rejected as
    // window-out-of-bounds. A member with no applied projection yet is
    // clamped into the domain bounds. The raw frame rect is never carried
    // for a fullscreen or maximized member. A known tiled member can
    // transiently report an out-of-bounds frame while KWin applies a state
    // change, so carry its applied projection rather than invalidating the
    // complete snapshot. Unknown non-overlay windows still fail closed.
    // Applied evidence is read-only here; only applied replies mutate it.
    // Initial-fullscreen hold is overlaid first (synthetic floating for
    // first-seen fullscreen only) so dispatch, quiet equality, reprojection,
    // and foreground/hidden paths agree from one snapshot shape.
    private withInitialFullscreenHold(observed: PlanObserved): PlanObserved {
        let changed = false;
        const windows = observed.windows.map((entry) => {
            if (!entry.fullscreen) {
                const seenRef = this.seenNonFullscreen.get(entry.id);
                if (seenRef === undefined || seenRef !== entry.ref) {
                    this.seenNonFullscreen.set(entry.id, entry.ref);
                }
                const heldRef = this.heldInitialFullscreen.get(entry.id);
                if (heldRef !== undefined) {
                    this.heldInitialFullscreen.delete(entry.id);
                    if (heldRef === entry.ref) {
                        this.logToken(`${LOG_PREFIX}:initial-fullscreen-released window=${entry.id}`);
                    }
                    changed = true;
                }
                return entry;
            }
            const seenRef = this.seenNonFullscreen.get(entry.id);
            if (seenRef !== undefined) {
                if (seenRef === entry.ref) {
                    return entry;
                }
                this.seenNonFullscreen.delete(entry.id);
            }
            const heldRef = this.heldInitialFullscreen.get(entry.id);
            if (heldRef !== undefined) {
                if (heldRef === entry.ref) {
                    if (entry.floating === true) {
                        return entry;
                    }
                    changed = true;
                    return { ...entry, floating: true };
                }
                this.heldInitialFullscreen.delete(entry.id);
            }
            if (this.appliedById.has(entry.id)) {
                return entry;
            }
            this.heldInitialFullscreen.set(entry.id, entry.ref);
            this.logToken(`${LOG_PREFIX}:initial-fullscreen-held window=${entry.id}`);
            changed = true;
            if (entry.floating === true) {
                return entry;
            }
            return { ...entry, floating: true };
        });
        if (!changed) {
            return observed;
        }
        return { ...observed, windows: Object.freeze(windows) };
    }

    private carriedSnapshot(observed: PlanObserved): PlanSnapshot {
        const held = this.withInitialFullscreenHold(observed);
        const snapshot = snapshotOf(held);
        const windows = snapshot.windows.map((entry) => {
            const evidence = this.appliedById.get(entry.id);
            const retainedRect =
                evidence !== undefined && evidence.output === entry.output && evidence.workspace === entry.workspace
                    ? evidence.rect
                    : undefined;
            const bounds = this.workAreaFor(snapshot, entry.output, entry.workspace) ?? snapshot.domainBounds;
            if (!entry.fullscreen && !entry.maximized && (retainedRect === undefined || rectContained(entry.rect, bounds))) {
                return entry;
            }
            const rect =
                retainedRect !== undefined
                    ? clampCarriedRect(retainedRect, bounds)
                    : clampCarriedRect(entry.rect, bounds);
            return { ...entry, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
        });
        return this.attachHintSizes({ ...snapshot, windows: Object.freeze(windows) }, observed);
    }

    // Per-domain applied scope: bounds, gap, outerGap keyed by
    // output/workspace. Written only on successful applied plan replies
    // alongside appliedById; never admission or membership authority.
    private appliedScopeFor(
        snapshot: Pick<PlanSnapshot, "domainOutput" | "domainWorkspace">,
    ): { bounds: PlanRect; gap: number; outerGap: number } | null {
        return this.appliedScopeByDomain.get(this.domainKey(snapshot)) ?? null;
    }

    // Same-domain window-set match from per-id applied evidence only: every
    // observed id carries same output/workspace evidence and no extra applied
    // id remains in the domain. Flags, rects, bounds, and gaps never count.
    private appliedWindowSetMatches(fresh: PlanSnapshot): boolean {
        const observedIds = new Set<string>();
        for (const entry of fresh.windows) {
            observedIds.add(entry.id);
            const evidence = this.appliedById.get(entry.id);
            if (
                evidence === undefined ||
                evidence.output !== entry.output ||
                evidence.workspace !== entry.workspace
            ) {
                return false;
            }
        }
        for (const [id, evidence] of this.appliedById) {
            if (
                evidence.output === fresh.domainOutput &&
                evidence.workspace === fresh.domainWorkspace &&
                !observedIds.has(id)
            ) {
                return false;
            }
        }
        return true;
    }

    // Whether any before-apply per-id evidence exists for a single domain:
    // an applied id homed to the domain, or an observed id carrying any
    // applied slot (including a sticky multi-homed slot last written by
    // another domain). Absent only before the first apply of the domain
    // (fresh worker or seeded retained baseline without applies).
    private hasAppliedEvidenceFor(snapshot: PlanSnapshot): boolean {
        for (const entry of snapshot.windows) {
            if (this.appliedById.has(entry.id)) {
                return true;
            }
        }
        for (const [, evidence] of this.appliedById) {
            if (evidence.output === snapshot.domainOutput && evidence.workspace === snapshot.domainWorkspace) {
                return true;
            }
        }
        return false;
    }

    // Tiled membership/flag difference versus before-apply per-id evidence:
    // an id-set change or a floating/sticky flip on a retained id, scoped
    // to a single domain. Overlays (fullscreen/maximized), focus,
    // fingerprint, rects, bounds, and gaps never count. Sticky windows are
    // multi-homed across domains sharing one per-id slot: matching sticky
    // flags forgive domain homing so consecutive domain applies do not
    // flap. Extra applied ids homed to the domain stay strict. True when
    // no evidence exists yet (fresh seeds converge like the retired admit).
    private appliedMembershipOrFlagsChanged(snapshot: PlanSnapshot): boolean {
        const observedIds = new Set<string>();
        for (const entry of snapshot.windows) {
            observedIds.add(entry.id);
            const evidence = this.appliedById.get(entry.id);
            if (evidence === undefined) {
                return true;
            }
            const floating = entry.floating === true;
            const sticky = entry.sticky === true;
            if (evidence.floating !== floating || evidence.sticky !== sticky) {
                return true;
            }
            const multiHomed = sticky && evidence.sticky === true;
            if (!multiHomed && (evidence.output !== entry.output || evidence.workspace !== entry.workspace)) {
                return true;
            }
        }
        if (!this.hasAppliedEvidenceFor(snapshot)) {
            return true;
        }
        for (const [id, evidence] of this.appliedById) {
            if (
                evidence.output === snapshot.domainOutput &&
                evidence.workspace === snapshot.domainWorkspace &&
                !observedIds.has(id)
            ) {
                return true;
            }
        }
        return false;
    }

    // Reprojection carries the prior planner allocation for every member. The
    // current client rectangles are drift inputs only, and are clamped solely
    // to keep the transport representation inside the new work area. Source is
    // per-id applied evidence for same-domain entries only; never baseline
    // authority.
    private reprojectionSnapshot(observed: PlanObserved): PlanSnapshot {
        const held = this.withInitialFullscreenHold(observed);
        const snapshot = snapshotOf(held);
        const windows = snapshot.windows.map((entry) => {
            const evidence = this.appliedById.get(entry.id);
            const carried =
                evidence !== undefined &&
                evidence.output === entry.output &&
                evidence.workspace === entry.workspace
                    ? evidence.rect
                    : entry.rect;
            const rect = clampCarriedRect(carried, snapshot.domainBounds);
            return { ...entry, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
        });
        return this.attachHintSizes({ ...snapshot, windows: Object.freeze(windows) }, observed);
    }

    // AR12: capture client size hints freshly from the live refs behind one
    // observation. Best-effort and fail-closed: a missing reader, a throw, or
    // an unreadable value leaves that member hintless (absent on the wire).
    // Values ride through verbatim; meaningfulness (positive, in-bound) is
    // judged in core, never here.
    private hintSizesFor(ref: object): { minSize?: { readonly w: number; readonly h: number }; maxSize?: { readonly w: number; readonly h: number } } {
        try {
            const reader = this.env.readWindowConstraints;
            if (typeof reader !== "function") {
                return {};
            }
            const constraints = reader(ref);
            if (constraints === null || typeof constraints !== "object") {
                return {};
            }
            const out: { minSize?: { readonly w: number; readonly h: number }; maxSize?: { readonly w: number; readonly h: number } } = {};
            const min = (constraints as PlanWindowConstraints).minSize;
            if (min !== null && min !== undefined && Number.isInteger(min.w) && Number.isInteger(min.h)) {
                out.minSize = { w: min.w, h: min.h };
            }
            const max = (constraints as PlanWindowConstraints).maxSize;
            if (max !== null && max !== undefined && Number.isInteger(max.w) && Number.isInteger(max.h)) {
                out.maxSize = { w: max.w, h: max.h };
            }
            return out;
        } catch (error) {
            void error;
            return {};
        }
    }

    // Attach freshly read hint sizes to every snapshot member backed by the
    // given observation (matched by id). Members without a live ref keep
    // their existing hints.
    private attachHintSizes(snapshot: PlanSnapshot, observed: PlanObserved): PlanSnapshot {
        if (typeof this.env.readWindowConstraints !== "function") {
            return snapshot;
        }
        const refById = new Map<string, object>();
        for (const entry of observed.windows) {
            if (!refById.has(entry.id)) {
                refById.set(entry.id, entry.ref);
            }
        }
        if (refById.size === 0) {
            return snapshot;
        }
        const windows = snapshot.windows.map((entry) => {
            const ref = refById.get(entry.id);
            if (ref === undefined) {
                return entry;
            }
            const hints = this.hintSizesFor(ref);
            if (hints.minSize === undefined && hints.maxSize === undefined) {
                return entry;
            }
            return {
                ...entry,
                ...(hints.minSize === undefined ? {} : { minSize: hints.minSize }),
                ...(hints.maxSize === undefined ? {} : { maxSize: hints.maxSize }),
            };
        });
        return { ...snapshot, windows };
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
        if (this.r4Flight !== null) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=move`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=move`);
            return;
        }
        const directional = this.readDirectional(direction);
        if (directional.kind === "invalid") {
            this.logToken(`${LOG_PREFIX}:move-refused-ambiguous`);
            return;
        }
        const observed =
            directional.kind === "ready" ? directional.observed : this.freshObserved();
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
        if (KWIN_TRACE_ENABLED && typeof this.env.readWindowConstraints === "function") {
            for (const entry of observed.windows) {
                this.traceConstraints(
                    "pre-plan",
                    "plan",
                    entry.id,
                    entry.output,
                    isOpaqueId(entry.resourceClass) ? entry.resourceClass : "unknown",
                    entry.ref,
                    this.workAreaFor(snapshot, entry.output, entry.workspace),
                    null,
                    entry.rect,
                );
            }
        }
        this.dispatch({
            op: "move",
            snapshot,
            removed: null,
            body: {
                op: "move",
                window: snapshot.focusedId,
                direction,
                // Rust preserves local R1/R2/R3 but stages R4 only when the
                // adapter transfers outputs. True solely when every R4
                // native capability is supplied.
                ...(snapshot.domains?.length === 2
                    ? { cross_output_transfer: crossOutputTransferSupported(this.env) }
                    : {}),
            },
            direction,
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
        if (this.r4Flight !== null) {
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
        if (this.r4Flight !== null) {
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
        const resourceClass = isOpaqueId(target.resourceClass) ? target.resourceClass : "unknown";
        if (target.sticky === true) {
            // Option A (2026-09-25): Meta+G on a sticky window always returns
            // to tile. Reuse the existing sticky-off path with a tiled origin
            // so the echo fence, keep-above restore, and tiling re-invoke
            // apply uniformly to prior-tiled, prior-float, and adopted
            // origins. Meta+Shift+G (requestSticky) keeps honoring the tracked
            // origin; no native all-desktops logic is duplicated here.
            // Fullscreen/maximized overlays refuse exactly like requestSticky,
            // before any adoption or native setter.
            if (target.fullscreen) {
                this.logToken(`${LOG_PREFIX}:sticky-refused-fullscreen window=${target.id} resource_class=${resourceClass}`);
                return;
            }
            if (target.maximized) {
                this.logToken(`${LOG_PREFIX}:sticky-refused-maximize window=${target.id} resource_class=${resourceClass}`);
                return;
            }
            if (this.stickyPreviousFloating.get(target.id) === undefined) {
                if (!this.adoptStickyUnknown(target, resourceClass)) {
                    this.logToken(`${LOG_PREFIX}:sticky-refused-untracked window=${target.id} resource_class=${resourceClass}`);
                    return;
                }
            }
            this.issueSticky(target, false, false);
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
        if (this.r4Flight !== null) {
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
        if (outcome !== "invoked") {
            // A missing/throwing native write never retries automatically and
            // never holds the one-shot attempt fence: clear it so a later
            // deliberate identical press can retry.
            this.maximizeToggleAttempts.delete(target.ref);
            this.logToken(`${LOG_PREFIX}:maximize-retry-armed window=${target.id} resource_class=${resourceClass} target=${wanted ? "maximized" : "restored"} cause=native-write-${outcome} recovery=retry-on-next-press`);
        }
        if (this.maximizeToggleEcho !== null) {
            this.maximizeToggleEcho = null;
            this.logToken(`${LOG_PREFIX}:maximize-toggle-echo-cleared-no-signal`);
        }
    }

    requestFullscreen(): void {
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:fullscreen-refused-disabled`);
            return;
        }
        if (this.r4Flight !== null) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-fullscreen`);
            return;
        }
        if (this.inFlight) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-fullscreen`);
            return;
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:fullscreen-refused-observe`);
            return;
        }
        const target = observed.windows.find((entry) => entry.id === observed.focusedId);
        if (target === undefined) {
            this.logToken(`${LOG_PREFIX}:fullscreen-refused-observe`);
            return;
        }
        const resourceClass = isOpaqueId(target.resourceClass) ? target.resourceClass : "unknown";
        // Project-owned toggle only: KWin keeps cover-and-restore. No
        // geometry, move, float, desktop, focus, or topology command is
        // issued; the existing fullScreenChanged observation drives planner
        // isolation on enter/exit without any echo fence here.
        const wanted = !target.fullscreen;
        this.logToken(`${LOG_PREFIX}:fullscreen-toggle window=${target.id} resource_class=${resourceClass} target=${wanted ? "fullscreen" : "restored"} outcome=issued`);
        let outcome: NativeStateWriteOutcome = "threw";
        try {
            outcome = this.env.setFullscreen === undefined ? "missing" : this.env.setFullscreen(target.ref, wanted);
        } catch (error) {
            void error;
        }
        this.logToken(`${LOG_PREFIX}:fullscreen-toggle window=${target.id} resource_class=${resourceClass} target=${wanted ? "fullscreen" : "restored"} outcome=${outcome}`);
    }

    requestSticky(): void {
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-disabled`);
            return;
        }
        if (this.r4Flight !== null) {
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
                if (!this.adoptStickyUnknown(target, resourceClass)) {
                    this.logToken(`${LOG_PREFIX}:sticky-refused-untracked window=${target.id} resource_class=${resourceClass}`);
                    return;
                }
                this.issueSticky(target, false, true);
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

    // Adopted sticky-float origin for externally sticky windows: an eligible
    // normal window already native-sticky with an empty native desktop list but
    // no same-runtime origin is adopted as a sticky float with prior-float
    // semantics only. No tiled slot is guessed, no history is persisted, and no
    // planner admission is claimed. Returns false when the native membership
    // cannot prove the empty-list sticky shape (fail closed, keep the existing
    // untracked refusal and never broaden unmanaged/non-normal windows).
    private adoptStickyUnknown(target: PlanObservedWindow, resourceClass: string): boolean {
        let ids: ReadonlyArray<string> | null = null;
        try {
            const reader = this.env.readDesktopIds;
            if (typeof reader !== "function") {
                return false;
            }
            try {
                ids = reader(target.ref);
            } catch (error) {
                void error;
                ids = null;
            }
            if (ids === null || ids.length !== 0) {
                return false;
            }
        } catch (error) {
            void error;
            return false;
        }
        this.stickyPreviousFloating.set(target.id, true);
        this.adoptedSticky.add(target.id);
        this.logToken(`${LOG_PREFIX}:sticky-adopted window=${target.id} resource_class=${resourceClass} origin=unknown-float`);
        return true;
    }

    // Bounded sticky focus retention: the exact toggled window stays
    // active across the native all-desktops write. Single synchronous
    // setActive only when the fresh observation still contains the toggled
    // id; stale ids never actuate and a failed write only logs. No timer,
    // retry, desktop switch, or later-focus fighting.
    private retainStickyFocus(target: PlanObservedWindow): boolean {
        const resourceClass = isOpaqueId(target.resourceClass) ? target.resourceClass : "unknown";
        let resolvedRef: object | undefined = target.ref;
        try {
            const fresh = this.freshObserved();
            if (fresh !== null) {
                let found: object | undefined;
                for (const entry of fresh.windows) {
                    if (entry.id === target.id) {
                        found = entry.ref;
                        break;
                    }
                }
                if (found === undefined) {
                    this.logToken(`${LOG_PREFIX}:sticky-focus-stale window=${target.id} resource_class=${resourceClass}`);
                    return false;
                }
                resolvedRef = found;
            }
        } catch (error) {
            void error;
        }
        if (resolvedRef === undefined) {
            this.logToken(`${LOG_PREFIX}:sticky-focus-stale window=${target.id} resource_class=${resourceClass}`);
            return false;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
            currentActive = null;
        }
        if (currentActive === resolvedRef) {
            this.logToken(`${LOG_PREFIX}:sticky-focus-retained window=${target.id} resource_class=${resourceClass}`);
            return true;
        }
        let focused = false;
        try {
            focused = this.env.setActive(resolvedRef) === true;
        } catch (error) {
            void error;
            focused = false;
        }
        if (!focused) {
            this.logToken(`${LOG_PREFIX}:sticky-focus-failed window=${target.id} resource_class=${resourceClass}`);
            return false;
        }
        this.logToken(`${LOG_PREFIX}:sticky-focus-retained window=${target.id} resource_class=${resourceClass}`);
        return true;
    }

    // Bounded float focus retention for toggle-float flights: the exact
    // toggled window stays active on entry and exit. Rust desired_focus is
    // tiled bookkeeping for survivors and must never natively activate a
    // sibling. Single synchronous setActive from the fresh observation only;
    // stale ids fail closed and failed writes fail the flight. No timer,
    // retry, desktop switch, MRU, or later-focus fighting.
    private retainFloatFocus(windowId: string, targetRef: object | undefined, resourceClass: string): boolean {
        if (targetRef === undefined) {
            this.logToken(`${LOG_PREFIX}:float-focus-stale window=${windowId} resource_class=${resourceClass}`);
            return false;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
            currentActive = null;
        }
        if (currentActive === targetRef) {
            this.logToken(`${LOG_PREFIX}:float-focus-retained window=${windowId} resource_class=${resourceClass}`);
            return true;
        }
        let focused = false;
        try {
            focused = this.env.setActive(targetRef) === true;
        } catch (error) {
            void error;
            focused = false;
        }
        if (!focused) {
            this.logToken(`${LOG_PREFIX}:float-focus-failed window=${windowId} resource_class=${resourceClass}`);
            return false;
        }
        this.logToken(`${LOG_PREFIX}:float-focus-retained window=${windowId} resource_class=${resourceClass}`);
        return true;
    }

    private issueSticky(target: PlanObservedWindow, allDesktops: boolean, previousFloating: boolean): void {
        const resourceClass = isOpaqueId(target.resourceClass) ? target.resourceClass : "unknown";
        if (this.stickyAttempts.get(target.ref) === allDesktops) {
            this.logToken(`${LOG_PREFIX}:sticky-refused-attempted window=${target.id} resource_class=${resourceClass}`);
            return;
        }
        if (allDesktops && !this.ensureKeepAbove(target.ref, target.id, resourceClass)) {
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
        if (outcome !== "invoked") {
            // A false/missing/throwing native assignment never retries,
            // replays, or fabricates success. Clear the one-shot attempt fence
            // so later explicit commands stay usable, and drop a stale
            // sticky-on claim (the window never became sticky) while keeping a
            // failed sticky-off origin for a later explicit retry.
            this.stickyAttempts.delete(target.ref);
            if (allDesktops) {
                this.stickyPreviousFloating.delete(target.id);
                this.adoptedSticky.delete(target.id);
            }
        } else {
            // A failed write owns no focus change: retain the toggled window
            // only when the native assignment actually landed.
            this.retainStickyFocus(target);
        }
        if (this.stickyEcho !== null) {
            this.stickyEcho = null;
            this.logToken(`${LOG_PREFIX}:sticky-echo-cleared-no-signal`);
        }
    }

    private ensureKeepAbove(target: object, id: string, resourceClass: string): boolean {
        let above: boolean | null = null;
        let below: boolean | null = null;
        try {
            above = this.env.readKeepAbove === undefined ? null : this.env.readKeepAbove(target);
            below = this.env.readKeepBelow === undefined ? null : this.env.readKeepBelow(target);
        } catch (error) {
            void error;
        }
        if (above === null || below === null) {
            this.logToken(`${LOG_PREFIX}:keep-above window=${id} resource_class=${resourceClass} target=above outcome=missing`);
            return false;
        }
        const prior = this.keepAbovePrevious.get(id);
        if (prior === undefined) {
            this.keepAbovePrevious.set(id, { ref: target, above, below });
        }
        if (above) {
            return true;
        }
        let outcome: KeepAboveWriteOutcome = "threw";
        try {
            outcome = this.env.setKeepAbove === undefined ? "missing" : this.env.setKeepAbove(target, true);
        } catch (error) {
            void error;
        }
        this.logToken(`${LOG_PREFIX}:keep-above window=${id} resource_class=${resourceClass} target=above outcome=${outcome}`);
        if (outcome !== "invoked") {
            if (prior === undefined) {
                this.keepAbovePrevious.delete(id);
            }
            return false;
        }
        return true;
    }

    private restoreKeepAbove(id: string, resourceClass: string): boolean {
        const prior = this.keepAbovePrevious.get(id);
        if (prior === undefined) {
            return true;
        }
        let above: boolean | null = null;
        let below: boolean | null = null;
        try {
            above = this.env.readKeepAbove === undefined ? null : this.env.readKeepAbove(prior.ref);
            below = this.env.readKeepBelow === undefined ? null : this.env.readKeepBelow(prior.ref);
        } catch (error) {
            void error;
        }
        if (above === null || below === null) {
            this.logToken(`${LOG_PREFIX}:keep-above window=${id} resource_class=${resourceClass} target=restore outcome=missing`);
            return false;
        }
        if (prior.above) {
            this.keepAbovePrevious.delete(id);
            return true;
        }
        if (prior.below) {
            if (below && !above) {
                this.keepAbovePrevious.delete(id);
                return true;
            }
            let outcome: KeepAboveWriteOutcome = "threw";
            try {
                outcome = this.env.setKeepBelow === undefined ? "missing" : this.env.setKeepBelow(prior.ref, true);
            } catch (error) {
                void error;
            }
            this.logToken(`${LOG_PREFIX}:keep-above window=${id} resource_class=${resourceClass} target=restore-below outcome=${outcome}`);
            if (outcome !== "invoked") {
                return false;
            }
            this.keepAbovePrevious.delete(id);
            return true;
        }
        if (!above) {
            this.keepAbovePrevious.delete(id);
            return true;
        }
        let outcome: KeepAboveWriteOutcome = "threw";
        try {
            outcome = this.env.setKeepAbove === undefined ? "missing" : this.env.setKeepAbove(prior.ref, false);
        } catch (error) {
            void error;
        }
        this.logToken(`${LOG_PREFIX}:keep-above window=${id} resource_class=${resourceClass} target=restore outcome=${outcome}`);
        if (outcome !== "invoked") {
            return false;
        }
        this.keepAbovePrevious.delete(id);
        return true;
    }

    private restoreAllKeepAbove(): void {
        for (const [id] of this.keepAbovePrevious) {
            this.restoreKeepAbove(id, "unknown");
        }
    }

    // Oracle route: one pointer-resize intent from the authoritative final
    // rect, single-axis or atomic corner (dual-axis). Strict decoding only;
    // fail-closed false when the window, direction(s), or boundary(ies)
    // cannot be safely bound. A corner carries both axes in exactly one
    // intent through the single pending slot (never two concurrent
    // requests); single-axis wire shape is unchanged. Defers through the
    // single pending slot when a flight is active, never bypasses it,
    // retries, or guesses.
    // Drop-intent callers pass their drag-N correlation as optional entry
    // metadata (6th arg). A drag-correlated refusal or terminal failure
    // feeds the coalesced per-domain restore marker, which converges once
    // through a single existing-route reconcile (or through any superseding
    // applied plan for the same domain). Calls without a drag correlation
    // behave exactly as before (no marker, no follow-up).
    requestPointerResize(windowId: unknown, direction: unknown, boundary: unknown, direction2?: unknown, boundary2?: unknown, dragCorrelation?: unknown): boolean {
        const drag = isDragCorrelation(dragCorrelation) ? (dragCorrelation as string) : null;
        const refuseDrag = (reason: string, output?: string, workspace?: string): false => {
            if (drag !== null) {
                this.noteDragRejected(drag, reason, typeof windowId === "string" ? windowId : null, output, workspace);
            }
            return false;
        };
        if (!this.enabled) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-disabled`);
            return refuseDrag("disabled");
        }
        if (!isOpaqueId(windowId)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-identity`);
            return refuseDrag("identity");
        }
        if (!isDirection(direction)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-direction`);
            return refuseDrag("direction");
        }
        if (!isFiniteInt(boundary) || (boundary as number) < -16384 || (boundary as number) > 16384) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-boundary`);
            return refuseDrag("boundary");
        }
        // Corner second axis is both-or-neither; a half-present pair, an
        // unparsable second direction, or a same-axis pair binds the exact
        // direction refusal, and an out-of-range second boundary binds the
        // exact boundary refusal. Single-axis calls never reach this block.
        const corner = direction2 !== undefined || boundary2 !== undefined;
        if (corner) {
            if (!isDirection(direction2)) {
                this.logToken(`${LOG_PREFIX}:pointer-refused-direction`);
                return refuseDrag("direction");
            }
            if (!isFiniteInt(boundary2) || (boundary2 as number) < -16384 || (boundary2 as number) > 16384) {
                this.logToken(`${LOG_PREFIX}:pointer-refused-boundary`);
                return refuseDrag("boundary");
            }
            const horizontal = (value: string): boolean => value === "left" || value === "right";
            if (horizontal(direction as string) === horizontal(direction2 as string)) {
                this.logToken(`${LOG_PREFIX}:pointer-refused-direction`);
                return refuseDrag("direction");
            }
        }
        if (this.r4Flight !== null) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=pointer-resize`);
            return refuseDrag("busy");
        }
        const observed = this.freshObserved();
        if (observed === null) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-observe`);
            return refuseDrag("observe");
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
            return refuseDrag("absent", observed.domainOutput, observed.domainWorkspace);
        }
        if (this.windowIsFullscreen(observed, windowId as string)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-fullscreen`);
            return refuseDrag("fullscreen", observed.domainOutput, observed.domainWorkspace);
        }
        if (this.windowIsMaximized(observed, windowId as string)) {
            this.logToken(`${LOG_PREFIX}:pointer-refused-maximize`);
            return refuseDrag("maximize", observed.domainOutput, observed.domainWorkspace);
        }
        const snapshot = this.carriedSnapshot(observed);
        this.noteObservation(snapshot.fingerprint);
        const intent: AutoIntent = {
            op: "pointer-resize",
            snapshot,
            removed: null,
            body: corner
                ? { op: "pointer-resize", window: windowId as string, direction, boundary, direction2, boundary2 }
                : { op: "pointer-resize", window: windowId as string, direction, boundary },
            pointerSource: windowId as string,
            ...(drag !== null ? { dragSource: drag } : {}),
        };
        // A final-geometry pointer route is selected ahead of the ordinary
        // finish resync. Do not let that resync restore the old split first.
        // A deferred drag pointer superseded here never dispatched: fold its
        // drop into the restore marker instead of losing it. The marker (not
        // the slot) owns convergence, so ordinary slot clearing below is
        // unchanged.
        this.clearDebounce();
        this.absorbDeferredDragIntent(this.deferredAuto, false);
        if (this.deferredAuto?.op === "reconcile" && this.deferredAuto.workAreaReprojection !== true) {
            this.deferredAuto = null;
        }
        this.discardInteractiveReconcile();
        if (this.inFlight) {
            this.deferredAuto = intent;
            return true;
        }
        this.dispatch(intent);
        const flight = this.pending;
        const ours =
            flight !== null &&
            flight.op === "pointer-resize" &&
            flight.pointerSource === (windowId as string) &&
            (drag === null ? flight.dragSource == null : this.dragSourceOf(flight) === drag);
        if (!ours) {
            // Dispatch never installed our pointer flight (R4 race,
            // interactive guard, or synchronous transport failure): the
            // dispatch failure paths already fed the marker when they ran
            // (deduped below), so just report refusal. A synchronous failure
            // that already dispatched the marker must not report accepted.
            // A deferred pointer would have returned true above, so this is
            // not the deferral path.
            if (drag !== null) {
                this.noteDragRejected(drag, "dispatch-failed", typeof windowId === "string" ? windowId : null, snapshot.domainOutput, snapshot.domainWorkspace);
            }
            return false;
        }
        return true;
    }

    // Drop-intent correlation reader: validated drag-N only, never titles,
    // ids, or payload bytes. A pointer flight carries dragSource (the drop
    // that dispatched it); marker reconciles carry a domain key instead.
    private dragSourceOf(flightState: PendingFlight): string | null {
        const drag = flightState.dragSource;
        return typeof drag === "string" && isDragCorrelation(drag) ? drag : null;
    }

    private dragRestoreKey(output: string, workspace: string): string {
        return `${output}\u0000${workspace}`;
    }

    // Resolve the domain scope for a rejected drop. Prefers the explicit
    // output/workspace (exact observation-time evidence), then the retained
    // domain holding the dragged window id (exact historical evidence, immune
    // to a foreground desktop switch between the drop and this refusal), then
    // a fresh observation only when it actually contains the dragged window.
    // An invalid (null) or unknown (unmatched) window never falls back to an
    // unrelated domain: that drop fails closed with an `unavailable` terminal
    // (bound by the caller), never an unscoped marker that any unrelated plan
    // could satisfy.
    private dragRestoreDomain(
        windowId: string | null,
        output?: string,
        workspace?: string,
    ): { output: string; workspace: string } | null {
        if (
            typeof output === "string" &&
            typeof workspace === "string" &&
            output.length > 0 &&
            workspace.length > 0
        ) {
            return { output, workspace };
        }
        if (windowId === null) {
            return null;
        }
        try {
            const evidence = this.appliedById.get(windowId);
            if (evidence !== undefined) {
                return { output: evidence.output, workspace: evidence.workspace };
            }
        } catch (error) {
            void error;
        }
        try {
            const observed = this.freshObserved();
            if (observed !== null && observed.windows.some((entry) => entry.id === windowId)) {
                return { output: observed.domainOutput, workspace: observed.domainWorkspace };
            }
        } catch (error) {
            void error;
        }
        return null;
    }

    // Record a rejected drop in its domain marker. Every rejected drag-N
    // gets exactly one `drag-rejected` line; overlapping drops share the
    // marker and each later gets its own settled terminal naming the same
    // plan correlation. When `dispatchNow` is true (no superseding intent
    // is being installed right after) a free slot dispatches the marker's
    // single reconcile immediately, otherwise the marker persists until the
    // finishFlight chain finds a free slot. Logging is best-effort and
    // never changes control flow.
    private noteDragRejected(
        drag: unknown,
        reason: string,
        windowId: string | null = null,
        output?: string,
        workspace?: string,
        dispatchNow = true,
    ): void {
        if (!isDragCorrelation(drag)) {
            return;
        }
        const id = drag as string;
        const kind = sanitizeKind(reason);
        try {
            const domain = this.dragRestoreDomain(windowId, output, workspace);
            if (domain === null) {
                // Fail closed with no marker at all: without domain evidence
                // no plan may ever claim this drop, so bind the terminal now
                // with an honest `plan=none` instead of a fabricated success.
                this.logToken(`${LOG_PREFIX}:drag-rejected correlation=${id} reason=${kind}`);
                this.logToken(`${LOG_PREFIX}:drag-reconcile-settled correlation=${id} outcome=unavailable plan=none`);
                return;
            }
            const key = this.dragRestoreKey(domain.output, domain.workspace);
            let marker = this.dragRestore.get(key);
            if (marker === undefined) {
                marker = {
                    output: domain.output,
                    workspace: domain.workspace,
                    drags: [],
                    dispatched: false,
                };
                this.dragRestore.set(key, marker);
            }
            const known = marker.drags.indexOf(id) >= 0;
            if (!known) {
                this.logToken(`${LOG_PREFIX}:drag-rejected correlation=${id} reason=${kind}`);
                if (marker.drags.length >= MAX_DRAG_RESTORE_DRAGS) {
                    this.logToken(`${LOG_PREFIX}:drag-reconcile-settled correlation=${id} outcome=unavailable plan=none`);
                    return;
                }
                marker.drags.push(id);
            }
            if (marker.dispatched) {
                if (!known) {
                    this.logToken(`${LOG_PREFIX}:drag-reconcile correlation=${id} dispatch=shared`);
                }
                return;
            }
            if (!dispatchNow) {
                return;
            }
            const outcome = this.maybeDispatchDragRestore();
            if (outcome === "deferred" && !known) {
                this.logToken(`${LOG_PREFIX}:drag-reconcile correlation=${id} dispatch=deferred`);
            } else if (outcome === "failed" && !known) {
                this.logToken(`${LOG_PREFIX}:drag-reconcile correlation=${id} dispatch=failed`);
            }
        } catch (error) {
            void error;
        }
    }

    // Tiled move-drop convergence: records the correlated drop in its domain
    // marker through the existing coalesced one-shot route (one dispatch, no
    // retry, per-drag terminal). Floating moves never reach here; cancelled
    // and null verdicts never reach here either (they converge through the
    // ordinary debounced resync without a marker and without inventing a
    // terminal).
    public noteMoveDropped(dragCorrelation: unknown, windowId: string | null = null, output?: string, workspace?: string): void {
        try {
            this.noteDragRejected(dragCorrelation, "move-dropped", windowId, output, workspace, true);
        } catch (error) {
            void error;
        }
    }

    // Fold a deferred intent being superseded or cleared into the marker
    // map: a deferred drag pointer never dispatched, so its drop joins the
    // marker instead of vanishing. A queued marker reconcile never exists
    // (markers dispatch straight through), so nothing else needs carrying.
    // When `dispatchNow` is false the caller installs a superseding intent
    // right after, which will satisfy or fail the marker on its own.
    private absorbDeferredDragIntent(intent: AutoIntent | null, dispatchNow: boolean): void {
        if (intent === null) {
            return;
        }
        try {
            if (
                intent.op === "pointer-resize" &&
                typeof intent.dragSource === "string" &&
                isDragCorrelation(intent.dragSource)
            ) {
                this.noteDragRejected(
                    intent.dragSource,
                    "superseded",
                    intent.pointerSource ?? null,
                    intent.snapshot.domainOutput,
                    intent.snapshot.domainWorkspace,
                    dispatchNow,
                );
            }
        } catch (error) {
            void error;
        }
    }

    // Dispatch the single reconcile for the oldest undispatched marker whose
    // domain is currently observed, through the existing dispatch route.
    // Returns the disposition for per-drag logging by the caller. Exactly one
    // dispatch per marker: the flag is set before dispatching, so a
    // never-sent attempt still consumes it (logged `dispatch=failed`, kept
    // pending for a later applied plan or recovery, never retried in a
    // loop). A marker whose domain is not currently observed persists
    // untouched until its domain is visible again; it never blocks an
    // eligible later marker for the observed domain.
    private maybeDispatchDragRestore(): "dispatched" | "deferred" | "failed" | "none" {
        try {
            if (!this.enabled) {
                return "none";
            }
            let anyPending = false;
            for (const entry of this.dragRestore.values()) {
                if (!entry.dispatched) {
                    anyPending = true;
                    break;
                }
            }
            if (!anyPending) {
                return "none";
            }
            if (
                this.inFlight ||
                this.r4Flight !== null ||
                this.interactiveResizeActive() ||
                this.deferredAuto !== null
            ) {
                return "deferred";
            }
            const observed = this.freshObserved();
            if (observed === null) {
                return "failed";
            }
            let key: string | null = null;
            let marker: DragRestoreMarker | undefined = undefined;
            for (const entry of this.dragRestore.entries()) {
                if (entry[1].dispatched) {
                    continue;
                }
                if (observed.domainOutput !== entry[1].output || observed.domainWorkspace !== entry[1].workspace) {
                    // The marked domain is not currently observed: persist
                    // untouched until its domain is visible again, never
                    // satisfy or dispatch against an unrelated domain.
                    continue;
                }
                key = entry[0];
                marker = entry[1];
                break;
            }
            if (key === null || marker === undefined) {
                return "deferred";
            }
            const snapshot = this.carriedSnapshot(observed);
            try {
                this.noteObservation(snapshot.fingerprint);
            } catch (error) {
                void error;
            }
            const intent: AutoIntent = {
                op: "reconcile",
                snapshot,
                removed: null,
                body: { op: "reconcile" },
                restoreMarker: key,
            };
            marker.dispatched = true;
            this.dispatch(intent);
            if (this.inFlight) {
                for (const drag of marker.drags) {
                    try {
                        this.logToken(`${LOG_PREFIX}:drag-reconcile correlation=${drag} dispatch=dispatched`);
                    } catch (error) {
                        void error;
                    }
                }
                return "dispatched";
            }
            // Never sent: the dispatch failure paths bind their own exact
            // marker terminal (with the allocated plan correlation, or an
            // honest `plan=none` when none was allocated). Bind it here only
            // as a last-resort guard so no path strands the marker.
            if (this.dragRestore.get(key) !== undefined) {
                this.failMarkerDispatch(intent, "dispatch-failed", null);
            }
            return "failed";
        } catch (error) {
            void error;
            return "failed";
        }
    }

    // Satisfy markers through actual application only: the first subsequent
    // plan in the satisfying op set whose applied geometry covers ALL tiled
    // members of the flight domain clears that domain's marker, logging one
    // terminal per drag naming the satisfying plan correlation. Coverage is
    // the full wanted set (mirroring geometryCovers: non-floating members
    // homed to the flight domain, minus removals), so a partial geometry
    // never satisfies. Members skipped at write time (fullscreen, maximized,
    // or unrelated floating) are excluded from the restored count and never
    // produce an `applied` restoring claim: the marker's own reconcile then
    // settles a truthful `partial` terminal naming its plan with
    // covered=R/W and no retry, while another plan's partial application
    // leaves the marker pending to dispatch once the slot is free.
    // Focus-only, toggle-float, and unrelated-domain plans never satisfy.
    // Call only on the applied path, never on dispatch or reply.
    private satisfyDragRestore(flightState: PendingFlight, planned: PlannedReply, current: PlanObserved): void {
        try {
            if (!DRAG_RESTORE_SATISFYING_OPS.has(flightState.op)) {
                return;
            }
            const domainOutput = flightState.snapshot.domainOutput;
            const domainWorkspace = flightState.snapshot.domainWorkspace;
            const homed = planned.geometry.every(
                (entry) =>
                    entry.output === domainOutput &&
                    entry.workspace === domainWorkspace,
            );
            if (!homed) {
                return;
            }
            const key = this.dragRestoreKey(domainOutput, domainWorkspace);
            const marker = this.dragRestore.get(key);
            if (marker === undefined) {
                return;
            }
            const wanted: string[] = [];
            for (const entry of flightState.snapshot.windows) {
                if (entry.output !== domainOutput || entry.workspace !== domainWorkspace) {
                    continue;
                }
                if (flightState.removed !== null && entry.id === flightState.removed) {
                    continue;
                }
                if (
                    entry.floating === true &&
                    !(flightState.floatTarget !== null && flightState.floatTarget.window === entry.id && flightState.floatTarget.floating === false)
                ) {
                    continue;
                }
                wanted.push(entry.id);
            }
            const plannedIds = new Set<string>();
            for (const entry of planned.geometry) {
                plannedIds.add(entry.window);
            }
            const skipped = new Set<string>();
            for (const entry of current.windows) {
                if (entry.output !== domainOutput || entry.workspace !== domainWorkspace) {
                    continue;
                }
                if (entry.fullscreen) {
                    skipped.add(entry.id);
                } else if (entry.maximized) {
                    skipped.add(entry.id);
                } else if (entry.floating === true && flightState.floatTarget?.window !== entry.id) {
                    skipped.add(entry.id);
                }
            }
            let covered = 0;
            for (const id of wanted) {
                if (plannedIds.has(id) && !skipped.has(id)) {
                    covered += 1;
                }
            }
            if (covered === wanted.length) {
                this.dragRestore.delete(key);
                for (const drag of marker.drags) {
                    try {
                        this.logToken(
                            `${LOG_PREFIX}:drag-reconcile-settled correlation=${drag} outcome=applied plan=${flightState.correlation} covered=${covered}/${wanted.length}`,
                        );
                    } catch (error) {
                        void error;
                    }
                }
                return;
            }
            if (flightState.restoreMarker === key) {
                // The marker's own reconcile could not restore every tiled
                // member: bind the truthful partial terminal naming this plan
                // with the covered count, then clear with no retry.
                this.dragRestore.delete(key);
                for (const drag of marker.drags) {
                    try {
                        this.logToken(
                            `${LOG_PREFIX}:drag-reconcile-settled correlation=${drag} outcome=partial plan=${flightState.correlation} covered=${covered}/${wanted.length}`,
                        );
                    } catch (error) {
                        void error;
                    }
                }
                return;
            }
            // Another plan's partial application never satisfies: the marker
            // stays pending (re-armed, never consumed) to dispatch once the
            // slot is free.
            marker.dispatched = false;
            for (const drag of marker.drags) {
                try {
                    this.logToken(
                        `${LOG_PREFIX}:drag-reconcile correlation=${drag} dispatch=pending covered=${covered}/${wanted.length}`,
                    );
                } catch (error) {
                    void error;
                }
            }
        } catch (error) {
            void error;
        }
    }

    // Terminal for a marker reconcile that never became a flight (payload
    // build/oversize failure, timer/dispatch transport failure): one exact
    // terminal per drag naming the allocated plan correlation, or an honest
    // `plan=none` when none was allocated. The marker clears with no retry
    // and no silent loss; ordinary intents are untouched (no restore key).
    private failMarkerDispatch(intent: AutoIntent, outcome: string, plan: string | null): void {
        try {
            const key = intent.restoreMarker;
            if (typeof key !== "string") {
                return;
            }
            const marker = this.dragRestore.get(key);
            if (marker === undefined) {
                return;
            }
            this.dragRestore.delete(key);
            const cause = sanitizeKind(outcome);
            const planToken = typeof plan === "string" && isCorrelationId(plan) ? plan : "none";
            for (const drag of marker.drags) {
                try {
                    this.logToken(
                        `${LOG_PREFIX}:drag-reconcile-settled correlation=${drag} outcome=${cause} plan=${planToken}`,
                    );
                } catch (error) {
                    void error;
                }
            }
        } catch (error) {
            void error;
        }
    }

    // Teardown for enable/disable lifecycle resets: every pending marker gets
    // one correlated `unavailable` terminal per drag before clearing, so no
    // drop is silently lost across the reset. Best-effort logging only, never
    // changes control flow.
    private settleDragRestoreUnavailable(): void {
        try {
            for (const marker of this.dragRestore.values()) {
                for (const drag of marker.drags) {
                    try {
                        this.logToken(
                            `${LOG_PREFIX}:drag-reconcile-settled correlation=${drag} outcome=unavailable plan=none`,
                        );
                    } catch (error) {
                        void error;
                    }
                }
            }
        } catch (error) {
            void error;
        }
        this.dragRestore.clear();
    }

    // Terminal for a dispatched marker reconcile that itself failed: one
    // correlated terminal per drag naming the failed plan correlation, then
    // the marker clears with no retry. Ordinary flight failures leave
    // pending markers untouched for the finishFlight chain.
    private failDragRestore(flightState: PendingFlight, outcome: string): void {
        try {
            const key = flightState.restoreMarker;
            if (typeof key !== "string") {
                return;
            }
            const marker = this.dragRestore.get(key);
            if (marker === undefined) {
                return;
            }
            this.dragRestore.delete(key);
            const cause = sanitizeKind(outcome);
            for (const drag of marker.drags) {
                try {
                    this.logToken(
                        `${LOG_PREFIX}:drag-reconcile-settled correlation=${drag} outcome=${cause} plan=${flightState.correlation}`,
                    );
                } catch (error) {
                    void error;
                }
            }
        } catch (error) {
            void error;
        }
    }

    requestResync(): void {
        this.onSignal();
    }

    // Terminal send-settlement edge (entry-owned): force one complete
    // source AND target reconcile through the existing single-flight
    // foreground+hidden chain, bypassing the equal-applied-evidence quiet
    // path once per involved domain. Invalid keys are ignored (a generic
    // resync still runs); unreadable domains stay forced until the next
    // complete observation. Never synthesizes empty evidence and never
    // blocks normal signals or intents.
    notifySendSettled(settled: {
        readonly sourceOutput: string;
        readonly sourceWorkspace: string;
        readonly targetOutput: string;
        readonly targetWorkspace: string;
    }): void {
        if (!this.enabled) {
            return;
        }
        try {
            if (isOpaqueId(settled.sourceOutput) && isOpaqueId(settled.sourceWorkspace)) {
                this.sendForcedDomains.add(this.domainKey({
                    domainOutput: settled.sourceOutput,
                    domainWorkspace: settled.sourceWorkspace,
                }));
            }
            if (isOpaqueId(settled.targetOutput) && isOpaqueId(settled.targetWorkspace)) {
                this.sendForcedDomains.add(this.domainKey({
                    domainOutput: settled.targetOutput,
                    domainWorkspace: settled.targetWorkspace,
                }));
            }
        } catch (error) {
            void error;
        }
        this.requestResync();
    }

    // Peek without consuming: true when a send settlement forced this
    // domain's next complete refresh to reconcile even on equal applied
    // evidence. Consumed only when its reconcile actually dispatches, so
    // unreadable domains and suppressed (interactive/in-flight) rounds keep
    // the force for the next complete observation.
    private hasSendForced(key: string): boolean {
        try {
            return this.sendForcedDomains.has(key);
        } catch (error) {
            void error;
            return false;
        }
    }

    private consumeSendForced(key: string): void {
        try {
            this.sendForcedDomains.delete(key);
        } catch (error) {
            void error;
        }
    }

    // Lean R4 terminal helper: an R4-shape pending flight (move, Left/Right,
    // two-domain snapshot) forces one complete source AND target reconcile
    // through the existing `notifySendSettled` chain, including equal
    // evidence. No-op for ordinary flights. Called on every R4 terminal
    // (stale/rejected/timeout before staging plus lean arrival terminals)
    // so both domains converge from native observation with no phantom.
    private forceR4SettleFromPending(flightState: PendingFlight | null): void {
        if (flightState === null) {
            return;
        }
        if (flightState.op !== "move" || flightState.background === true) {
            return;
        }
        if (flightState.direction !== "left" && flightState.direction !== "right") {
            return;
        }
        const domains = flightState.snapshot.domains;
        if (domains === undefined || domains.length !== 2) {
            return;
        }
        const source = domains[0] as PlanDomain;
        const target = domains[1] as PlanDomain;
        try {
            this.notifySendSettled({
                sourceOutput: source.output,
                sourceWorkspace: source.workspace,
                targetOutput: target.output,
                targetWorkspace: target.workspace,
            });
        } catch (error) {
            void error;
        }
    }

    setInteractiveResizeActive(active: boolean): void {
        if (active) {
            this.clearDebounce();
            this.absorbDeferredDragIntent(this.deferredAuto, true);
            if (this.deferredAuto?.op === "reconcile" && this.deferredAuto.workAreaReprojection !== true) {
                this.deferredAuto = null;
            }
            this.discardInteractiveReconcile();
            return;
        }
        // Reuse the normal debounced observation path. This reasserts only the
        // retained allocation and never derives a split from native geometry.
        this.requestResync();
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
    }

    // Accept only exact client-held rectangles after bounded reassertions.
    private acceptClientDrift(snapshot: PlanSnapshot, hidden = false): void {
        let accepted = 0;
        for (const entry of snapshot.windows) {
            if (entry.fullscreen || entry.maximized) {
                continue;
            }
            const evidence = this.appliedById.get(entry.id);
            if (
                evidence === undefined ||
                evidence.output !== entry.output ||
                evidence.workspace !== entry.workspace ||
                evidence.floating !== (entry.floating === true) ||
                evidence.sticky !== (entry.sticky === true)
            ) {
                continue;
            }
            if (hidden && entry.sticky === true) {
                continue;
            }
            if (
                evidence.rect.x === entry.rect.x &&
                evidence.rect.y === entry.rect.y &&
                evidence.rect.w === entry.rect.w &&
                evidence.rect.h === entry.rect.h
            ) {
                continue;
            }
            this.appliedById.set(entry.id, { ...evidence, rect: { ...entry.rect } });
            accepted += 1;
        }
        if (hidden) {
            this.backgroundAttempts.delete(this.domainKey(snapshot));
        } else {
            this.reconcileAttempts = 0;
        }
        this.logToken(`${LOG_PREFIX}:reconcile-accepted windows=${String(accepted)} cause=stable-drift recovery=accept-client-rect`);
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

    private interactiveResizeActive(): boolean {
        try {
            return this.env.isInteractiveResizeActive?.() === true;
        } catch (error) {
            void error;
            return true;
        }
    }

    private discardInteractiveReconcile(): void {
        const flight = this.pending;
        if (
            flight === null ||
            flight.background === true ||
            flight.op !== "reconcile" ||
            flight.workAreaReprojection
        ) {
            return;
        }
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.diag(flight.op, flight.correlation, flight.windowCount, "interactive-resize-suppressed");
        // A suppressed marker reconcile is a cancellation, never a failure:
        // re-arm the same marker pending (not dispatched) so the next
        // same-domain applied plan can satisfy it, a rejected drop can
        // trigger its single follow-up, or a free slot can dispatch it for a
        // different domain. Genuine failed reconciles still terminate through
        // failDragRestore with no retry.
        try {
            const key = flight.restoreMarker;
            if (typeof key === "string") {
                const marker = this.dragRestore.get(key);
                if (marker !== undefined) {
                    marker.dispatched = false;
                    for (const drag of marker.drags) {
                        try {
                            this.logToken(`${LOG_PREFIX}:drag-reconcile correlation=${drag} dispatch=cancelled`);
                        } catch (error) {
                            void error;
                        }
                    }
                }
            }
        } catch (error) {
            void error;
        }
    }

    private onSignal(kind?: PlanSignal, target?: object): void {
        if (!this.enabled) {
            return;
        }
        // Evict only the removed native object, never inferred absence.
        // Exact-object eviction covers marker-only ids with no applied slot,
        // so truly removed windows never leave session-local residue. No
        // native reads, no id logging, no per-domain inference: relocation
        // survivors carry a different live ref and keep their markers.
        if (kind === "removed" && typeof target === "object" && target !== null) {
            this.stickyAttempts.delete(target);
            for (const [id, ref] of [...this.heldInitialFullscreen]) {
                if (ref === target) {
                    this.heldInitialFullscreen.delete(id);
                }
            }
            for (const [id, ref] of [...this.seenNonFullscreen]) {
                if (ref === target) {
                    this.seenNonFullscreen.delete(id);
                }
            }
        }
        // Bounded native-write exclusion only: signals delivered
        // synchronously from our own R4 setters must not advance epoch or
        // queue auto intents mid-stack; the immediate post-write observation
        // covers sync arrival. Delayed arrival stays observable through the
        // armed one-shot mover signals. No transaction-lifetime Plan block.
        if (this.r4WriteDepth > 0) {
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
                    const wasAdopted = this.adoptedSticky.delete(echo.id);
                    this.stickyPreviousFloating.delete(echo.id);
                    if (wasAdopted) {
                        // Adopted unknown origin stays a normal float on the
                        // then-current desktop: native assignment already
                        // homed it, so only mark canonical float tracking
                        // with no geometry, workspace, or planner admission.
                        try {
                            this.env.setFloating?.(echo.id, true);
                        } catch (error) {
                            void error;
                        }
                    }
                    if (!echo.previousFloating) {
                        if (!this.restoreKeepAbove(echo.id, echo.resourceClass)) {
                            return;
                        }
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
        if (!this.chainingHidden) {
            this.hiddenVisited.clear();
        }
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
            this.refreshHiddenNow();
            // Idle marker pump: when the foreground decided no ordinary
            // flight was needed and no hidden step took the slot, a pending
            // drop marker still owns convergence. This covers guard releases
            // (settle/timeout/removal resync) that land on an already-equal
            // snapshot: without a flight the finishFlight chain never runs,
            // so the marker would strand. Same single-slot guards as the
            // finishFlight pump; a dispatched ordinary or hidden flight
            // above already returned before reaching here.
            if (!this.enabled || this.inFlight || this.deferredAuto !== null) {
                return;
            }
            if (this.activeProbe !== 0) {
                return;
            }
            this.maybeDispatchDragRestore();
        } finally {
            this.chainingHidden = false;
        }
    }

    // Foreground automatic reconcile: one complete-observation reconcile per
    // debounced foreground signal. Membership converges in the Engine; KWin
    // never derives admit/remove, floating-skew, or gap/bounds choices here.
    // A correlated exact-message gap refusal triggers the existing single
    // update-gaps retry on the reply path. The carried snapshot preserves
    // per-id applied rectangles for fullscreen/transient out-of-bounds.
    // Only reassertion counters reset here; applied evidence mutates solely on
    // applied replies plus per-window client acceptance. Fresh/changed
    // membership or flags always dispatch and never accept.
    private refreshForegroundNow(): void {
        if (!this.enabled) {
            return;
        }
        let fresh = this.freshObserved();
        if (fresh === null) {
            return;
        }
        const prepared = this.clearMaximizeAtAdmission(fresh, null);
        if (prepared === null) {
            return;
        }
        fresh = prepared.observed;
        const freshSnapshot = this.carriedSnapshot(fresh);
        const epochBeforeQuiet = this.epoch;
        this.epoch += 1;
        this.noteObservation(freshSnapshot.fingerprint);
        // Quiet equal no-op from applied evidence only (never baseline
        // authority): skip dispatch when every observed id matches applied
        // output/workspace, floating/sticky flags and carried rect, with no
        // extra applied ids in this domain, and bounds/gaps match the
        // per-domain applied scope. Fresh/not-yet-applied, membership
        // or flag change, gap/bounds change, client drift, and pending drag
        // markers all fall through to dispatch below. Overlays stay quiet
        // through carried rects. No baseline writes here.
        let pureDrift = true;
        let converged = true;
        const observedIds = new Set<string>();
        for (const entry of freshSnapshot.windows) {
            observedIds.add(entry.id);
            const evidence = this.appliedById.get(entry.id);
            if (
                evidence === undefined ||
                evidence.output !== entry.output ||
                evidence.workspace !== entry.workspace ||
                evidence.floating !== (entry.floating === true) ||
                evidence.sticky !== (entry.sticky === true)
            ) {
                pureDrift = false;
                converged = false;
                break;
            }
            if (
                evidence.rect.x !== entry.rect.x ||
                evidence.rect.y !== entry.rect.y ||
                evidence.rect.w !== entry.rect.w ||
                evidence.rect.h !== entry.rect.h
            ) {
                converged = false;
            }
        }
        if (pureDrift) {
            for (const [id, evidence] of this.appliedById) {
                if (
                    evidence.output === freshSnapshot.domainOutput &&
                    evidence.workspace === freshSnapshot.domainWorkspace &&
                    !observedIds.has(id)
                ) {
                    pureDrift = false;
                    converged = false;
                    break;
                }
            }
        }
        const appliedScope = this.appliedScopeFor(freshSnapshot);
        const scopeEqual =
            appliedScope !== null &&
            appliedScope.bounds.x === freshSnapshot.domainBounds.x &&
            appliedScope.bounds.y === freshSnapshot.domainBounds.y &&
            appliedScope.bounds.w === freshSnapshot.domainBounds.w &&
            appliedScope.bounds.h === freshSnapshot.domainBounds.h &&
            appliedScope.gap === freshSnapshot.domainGap &&
            appliedScope.outerGap === freshSnapshot.domainOuterGap;
        // Raw retained tiled out-of-bounds drift: the carried snapshot clamps
        // it back to the applied rect, so carried equality alone would go
        // quiet. Bypass equal/acceptance and reconcile; the reply path never writes
        // a fullscreen member.
        let rawRetainedOutOfBounds = false;
        for (const entry of fresh.windows) {
            if (entry.fullscreen || entry.maximized) {
                continue;
            }
            const evidence = this.appliedById.get(entry.id);
            if (
                evidence !== undefined &&
                evidence.output === entry.output &&
                evidence.workspace === entry.workspace &&
                !rectContained(entry.rect, freshSnapshot.domainBounds)
            ) {
                rawRetainedOutOfBounds = true;
                break;
            }
        }
        if (rawRetainedOutOfBounds) {
            converged = false;
        }
        // Work-area scope transition: same applied window set with changed
        // bounds and equal applied gaps. Dispatches applied reprojection even
        // while interactive, even in-flight deferred, with counter reset.
        if (
            appliedScope !== null &&
            appliedScope.gap === freshSnapshot.domainGap &&
            appliedScope.outerGap === freshSnapshot.domainOuterGap &&
            (appliedScope.bounds.x !== freshSnapshot.domainBounds.x ||
                appliedScope.bounds.y !== freshSnapshot.domainBounds.y ||
                appliedScope.bounds.w !== freshSnapshot.domainBounds.w ||
                appliedScope.bounds.h !== freshSnapshot.domainBounds.h) &&
            this.appliedWindowSetMatches(freshSnapshot)
        ) {
            const oldBounds = appliedScope.bounds;
            const newBounds = freshSnapshot.domainBounds;
            this.logToken(
                `${LOG_PREFIX}:scope-transition old=${String(oldBounds.x)},${String(oldBounds.y)},${String(oldBounds.w)},${String(oldBounds.h)} new=${String(newBounds.x)},${String(newBounds.y)},${String(newBounds.w)},${String(newBounds.h)}`,
            );
            this.logToken(`${LOG_PREFIX}:work-area-reprojection selected=retained`);
            this.pointerEcho = null;
            this.resetReconcileState();
            this.consumeSendForced(this.domainKey(freshSnapshot));
            this.absorbDeferredDragIntent(this.deferredAuto, false);
            this.deferredAuto = {
                op: "reconcile",
                snapshot: this.reprojectionSnapshot(fresh),
                removed: null,
                body: { op: "reconcile" },
                workAreaReprojection: true,
                admissionMaximizeClears: prepared.cleared,
            };
            if (this.inFlight) {
                return;
            }
            const nextReprojection = this.deferredAuto;
            this.deferredAuto = null;
            if (nextReprojection !== null) {
                this.dispatch(nextReprojection);
            }
            return;
        }
        const restoreKey = this.domainKey(freshSnapshot);
        // One-shot send-settlement force: a forced domain reconciles even
        // when the equal-applied-evidence optimization would stay quiet.
        // The force is consumed only when its reconcile dispatches below,
        // so unreadable or suppressed rounds keep it for the next complete
        // observation.
        const sendForced = this.hasSendForced(restoreKey);
        const restoreMarker = this.dragRestore.get(restoreKey);
        const hasPendingMarker =
            restoreMarker !== undefined && !restoreMarker.dispatched && restoreMarker.drags.length > 0;
        if (pureDrift && converged && scopeEqual && !hasPendingMarker && freshSnapshot.windows.length > 0 && !rawRetainedOutOfBounds && !sendForced) {
            // Quiet equality cannot invalidate an in-flight reply.
            this.epoch = epochBeforeQuiet;
            if (this.pointerEcho !== null) {
                this.logToken(`${LOG_PREFIX}:echo-fence-cleared-equality`);
            }
            this.pointerEcho = null;
            this.reconcileAttempts = 0;
            this.absorbDeferredDragIntent(this.deferredAuto, true);
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
        // Pointer echo consume: a matching neighbour echo means the planned
        // geometry already landed, so consume the one-shot fence with no
        // second write and no baseline mutation. A mismatch falls through to
        // one ordinary reconcile below. A send-forced domain skips the fence
        // so its forced reconcile below still dispatches.
        const echo = this.pointerEcho;
        if (echo !== null && !sendForced) {
            this.pointerEcho = null;
            if (this.echoMatches(freshSnapshot, echo)) {
                this.logToken(`${LOG_PREFIX}:echo-fence-consumed`);
                this.reconcileAttempts = 0;
                this.absorbDeferredDragIntent(this.deferredAuto, true);
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
        if (this.interactiveResizeActive()) {
            // A deferred drag pointer waits out the live gesture inside its
            // marker; ordinary queued reconciles keep the established clear.
            this.absorbDeferredDragIntent(this.deferredAuto, true);
            if (this.deferredAuto?.op === "reconcile" && this.deferredAuto.workAreaReprojection !== true) {
                this.deferredAuto = null;
            }
            return;
        }
        // Bounded per-window acceptance from per-id applied evidence only
        // (never baseline authority): pure geometry drift accepts the exact
        // client-held rectangle per window after three failed reassertions,
        // but only when every observed member is already applied on this
        // domain with unchanged floating/sticky flags and equal transitional
        // scope. Any fresh newcomer, departure, flag change, or gap/bounds
        // change resets the counter and always dispatches. Raw retained
        // out-of-bounds drift bypasses acceptance like a scope change: it
        // always converges. A send-forced domain likewise bypasses acceptance
        // and always converges. Other drift in the same domain keeps ordinary
        // reconciliation: acceptance only quiets the currently stable rects,
        // and any later change dispatches normally.
        if (!pureDrift || converged || rawRetainedOutOfBounds || sendForced) {
            this.reconcileAttempts = 0;
        } else if (this.reconcileAttempts >= MAX_RECONCILE_ATTEMPTS && scopeEqual) {
            this.acceptClientDrift(freshSnapshot);
            this.absorbDeferredDragIntent(this.deferredAuto, true);
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
        // Ordinary converge: a deferred drag pointer superseded here joins
        // its domain marker (the fresh reconcile below satisfies it on
        // apply); the slot itself carries no drag binding.
        this.absorbDeferredDragIntent(this.deferredAuto, false);
        if (sendForced) {
            this.consumeSendForced(restoreKey);
        }
        this.deferredAuto = {
            op: "reconcile",
            snapshot: freshSnapshot,
            removed: null,
            body: { op: "reconcile" },
            admissionMaximizeClears: prepared.cleared,
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

    private refreshHiddenNow(): void {
        if (!this.enabled || this.inFlight || this.deferredAuto !== null) {
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
        // Every validated hidden domain is considered: explicit empty-source
        // cleanup for an already-retained domain converges through reconcile,
        // and new domains converge without a domain-count gate. Retained
        // domains converge below. Each complete domain is visited at most
        // once per chain (marked even when no intent is sent); absence stays
        // unknown and never synthesizes empty evidence.
        const nonEmpty = valid.filter((entry) => entry.windows.length > 0);
        const emptyExplicit = valid.filter((entry) => entry.windows.length === 0);
        for (const observed of nonEmpty) {
            const key = this.domainKey(observed);
            if (this.hiddenVisited.has(key)) {
                continue;
            }
            this.hiddenVisited.add(key);
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
        // an empty snapshot. Per-domain baselines are retired
        // only via applied reconcile convergence; attempts use the per-domain
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
            if (this.hiddenVisited.has(key)) {
                continue;
            }
            this.hiddenVisited.add(key);
            // Explicit complete empty with retained applied members converges
            // through one reconcile (Engine retires the slot after its
            // fences), even when several members vanished together. Domains
            // without applied evidence/scope stay quiet inside hiddenIntentFor.
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
    // reconcile derivation, minus focus advancement, echo fences,
    // and interactive commands. Every complete observation (fresh, retained
    // membership/departure, exception-only, explicit empty) converges through
    // reconcile; the Engine adopts newcomers/departures/exceptions and
    // retires explicit-empty domains. KWin never selects admit/remove here.
    // Membership/flags/rects use per-id applied evidence only (never baseline
    // authority); the per-domain applied scope below supplies applied
    // bounds/gaps scope. Quiet equal reads write no baseline. Never dispatches
    // for hidden domains (no focus writes).
    private hiddenIntentFor(observed: PlanObserved): AutoIntent | null {
        const prepared = this.clearMaximizeAtAdmission(observed, null, () =>
            this.freshHiddenFor(observed),
        );
        if (prepared === null) {
            return null;
        }
        const freshSnapshot = this.carriedSnapshot(prepared.observed);
        const appliedScope = this.appliedScopeFor(freshSnapshot);
        const observedIds = new Set<string>();
        for (const entry of freshSnapshot.windows) {
            observedIds.add(entry.id);
        }
        // Explicit empty dispatches only with actual applied evidence/scope
        // for that domain; absence is unknown and never synthesizes empty.
        if (freshSnapshot.windows.length === 0) {
            if (appliedScope === null && !this.hasAppliedEvidenceFor(freshSnapshot)) {
                return null;
            }
        }
        // Observation-driven equal/flag/rect via applied evidence only: every
        // observed id must match applied output/workspace and floating/sticky
        // flags (pureDrift), with identical carried rects (converged). Extra
        // applied ids in this domain break both. Overlays stay quiet through
        // carried rects. Exception-only newcomers/changes fall out as
        // non-pure-drift below and always converge, never accept.
        let pureDrift = true;
        let converged = true;
        for (const entry of freshSnapshot.windows) {
            const evidence = this.appliedById.get(entry.id);
            const floating = entry.floating === true;
            const sticky = entry.sticky === true;
            if (evidence === undefined || evidence.floating !== floating || evidence.sticky !== sticky) {
                pureDrift = false;
                converged = false;
                break;
            }
            // Sticky windows are multi-homed across domains sharing one
            // per-id evidence slot: every domain's apply rewrites the slot's
            // output/workspace/rect, so a strict domain/rect comparison would
            // flap and ping-pong dispatches between domains, starving fresh
            // domains of the single-flight slot. Matching sticky flags prove
            // the same multi-homed window; its geometry is natively owned per
            // domain and never actuated, so domain and rect are forgiven here.
            // Flag transitions still mismatch above and always converge.
            const multiHomed = sticky && evidence.sticky === true;
            if (!multiHomed && (evidence.output !== entry.output || evidence.workspace !== entry.workspace)) {
                pureDrift = false;
                converged = false;
                break;
            }
            if (
                !multiHomed &&
                (evidence.rect.x !== entry.rect.x ||
                    evidence.rect.y !== entry.rect.y ||
                    evidence.rect.w !== entry.rect.w ||
                    evidence.rect.h !== entry.rect.h)
            ) {
                converged = false;
            }
        }
        if (pureDrift) {
            for (const [id, evidence] of this.appliedById) {
                if (
                    evidence.output === freshSnapshot.domainOutput &&
                    evidence.workspace === freshSnapshot.domainWorkspace &&
                    !observedIds.has(id)
                ) {
                    pureDrift = false;
                    converged = false;
                    break;
                }
            }
        }
        // Raw retained out-of-bounds drift: the carried snapshot clamps it
        // back to the applied rect, so carried equality alone would go quiet.
        // Bypass equal/acceptance and reconcile; the reply path never writes a
        // fullscreen member.
        let rawRetainedOutOfBounds = false;
        for (const entry of prepared.observed.windows) {
            if (entry.fullscreen || entry.maximized) {
                continue;
            }
            const evidence = this.appliedById.get(entry.id);
            if (
                evidence !== undefined &&
                evidence.output === entry.output &&
                evidence.workspace === entry.workspace &&
                !rectContained(entry.rect, freshSnapshot.domainBounds)
            ) {
                rawRetainedOutOfBounds = true;
                break;
            }
        }
        if (rawRetainedOutOfBounds) {
            converged = false;
        }
        const scopeEqual =
            appliedScope !== null &&
            appliedScope.bounds.x === freshSnapshot.domainBounds.x &&
            appliedScope.bounds.y === freshSnapshot.domainBounds.y &&
            appliedScope.bounds.w === freshSnapshot.domainBounds.w &&
            appliedScope.bounds.h === freshSnapshot.domainBounds.h &&
            appliedScope.gap === freshSnapshot.domainGap &&
            appliedScope.outerGap === freshSnapshot.domainOuterGap;
        // Proven-departure cleanup only: an applied id in this domain omitted
        // from the complete observation retires its sticky/keep-above state
        // and emits noteRemoved. Covers single, simultaneous, and explicit
        // empty departures in one place. Global initial-fullscreen markers
        // (heldInitialFullscreen/seenNonFullscreen) are retained here: this
        // per-domain view cannot prove the id is gone everywhere, and a
        // cross-domain relocation survivor must keep its markers. True-gone
        // cleanup is via the explicit-removed path, the exact native removal
        // signal (which evicts even marker-only ids), and full resets.
        for (const [id, evidence] of [...this.appliedById]) {
            if (
                evidence.output === freshSnapshot.domainOutput &&
                evidence.workspace === freshSnapshot.domainWorkspace &&
                !observedIds.has(id)
            ) {
                this.maximizeAdmissionAttempts.delete(id);
                this.keepAbovePrevious.delete(id);
                this.stickyPreviousFloating.delete(id);
                this.adoptedSticky.delete(id);
                try {
                    this.env.noteRemoved?.(id);
                } catch (error) {
                    void error;
                }
            }
        }
        // One-shot send-settlement force: a forced domain reconciles even
        // when the equal-applied-evidence optimization would stay quiet.
        // Consumed only when an intent below dispatches, so unreadable
        // domains and empty domains without applied evidence keep the force
        // for the next complete observation. Never synthesizes empty
        // evidence: absence stays unknown.
        const hiddenKey = this.domainKey(freshSnapshot);
        const hiddenForced = this.hasSendForced(hiddenKey);
        // Explicit empty with retained applied members retires through one
        // reconcile (Engine retires the slot after its fences), even when
        // several members vanished together. Membership/exception-only
        // changed never accepts: any id-set or floating/sticky flag difference
        // versus applied evidence converges through one reconcile carrying
        // the complete observation.
        if (freshSnapshot.windows.length === 0 || !pureDrift) {
            this.consumeSendForced(hiddenKey);
            return {
                op: "reconcile",
                snapshot: freshSnapshot,
                removed: null,
                body: { op: "reconcile" },
                admissionMaximizeClears: prepared.cleared,
                background: true,
            };
        }
        // Quiet unchanged hidden domains: fully converged with equal applied
        // scope. Writes no baseline; clears drift accounting so the
        // once-per-chain bound cannot self-chain.
        if (converged && scopeEqual && !rawRetainedOutOfBounds && !hiddenForced) {
            this.clearBackgroundReconcile(freshSnapshot);
            return null;
        }
        // Work-area scope transition: same applied window set (pureDrift holds
        // here) with changed bounds and equal applied gaps. Dispatches applied
        // reprojection with acceptance bypass.
        if (
            appliedScope !== null &&
            appliedScope.gap === freshSnapshot.domainGap &&
            appliedScope.outerGap === freshSnapshot.domainOuterGap &&
            (appliedScope.bounds.x !== freshSnapshot.domainBounds.x ||
                appliedScope.bounds.y !== freshSnapshot.domainBounds.y ||
                appliedScope.bounds.w !== freshSnapshot.domainBounds.w ||
                appliedScope.bounds.h !== freshSnapshot.domainBounds.h)
        ) {
            const oldBounds = appliedScope.bounds;
            const newBounds = freshSnapshot.domainBounds;
            this.logToken(
                `${LOG_PREFIX}:scope-transition old=${String(oldBounds.x)},${String(oldBounds.y)},${String(oldBounds.w)},${String(oldBounds.h)} new=${String(newBounds.x)},${String(newBounds.y)},${String(newBounds.w)},${String(newBounds.h)}`,
            );
            this.logToken(`${LOG_PREFIX}:work-area-reprojection selected=retained`);
            this.clearBackgroundReconcile(freshSnapshot);
            this.consumeSendForced(hiddenKey);
            return {
                op: "reconcile",
                snapshot: this.reprojectionSnapshot(prepared.observed),
                removed: null,
                body: { op: "reconcile" },
                workAreaReprojection: true,
                background: true,
            };
        }
        // Deliberate gap reload: same applied window set with a changed inner
        // and/or outer gap, converged without touching focus.
        if (
            appliedScope !== null &&
            (appliedScope.gap !== freshSnapshot.domainGap ||
                appliedScope.outerGap !== freshSnapshot.domainOuterGap)
        ) {
            this.logToken(`${LOG_PREFIX}:gap-reprojection selected=retained`);
            this.consumeSendForced(hiddenKey);
            return {
                op: "update-gaps",
                snapshot: freshSnapshot,
                removed: null,
                body: { op: "update-gaps" },
                background: true,
            };
        }
        // Bounded per-window acceptance applies only to pure geometry drift
        // below: membership/flag changes already returned above and never
        // accept. A send-forced domain bypasses acceptance and always
        // converges.
        if (!hiddenForced && (this.backgroundAttempts.get(this.domainKey(observed)) ?? 0) >= MAX_RECONCILE_ATTEMPTS) {
            this.acceptClientDrift(freshSnapshot, true);
            return null;
        }
        if (hiddenForced) {
            this.clearBackgroundReconcile(freshSnapshot);
            this.consumeSendForced(hiddenKey);
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
    }

    private clearBackgroundReconcile(snapshot: Pick<PlanSnapshot, "domainOutput" | "domainWorkspace">): void {
        const key = this.domainKey(snapshot);
        this.backgroundAttempts.delete(key);
    }

    private clearMaximizeAtAdmission(
        observed: PlanObserved,
        previous: PlanSnapshot | null,
        refetch: () => PlanObserved | null = () => this.freshObserved(),
    ): { observed: PlanObserved; cleared: ReadonlyArray<string> } | null {
        void previous;
        const known = this.appliedById;
        const attempted: Array<{ id: string; ref: object; resourceClass: string }> = [];
        for (const entry of observed.windows) {
            // Admission clear runs before the initial-fullscreen hold release
            // in carriedSnapshot, so a held id exiting fullscreen is still
            // marked here. Held ids bypass the known-id skip: their applied
            // slot (if any) is exception evidence, never a tile, while
            // already-tiled ids never enter the held set. Fullscreen never
            // clears; one-shot via maximizeAdmissionAttempts with no retry.
            if (entry.fullscreen || !entry.maximized || this.maximizeAdmissionAttempts.has(entry.id)) {
                continue;
            }
            if (known.has(entry.id) && this.heldInitialFullscreen.get(entry.id) !== entry.ref) {
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
    }

    // Bounded reassertion accounting for the automatic foreground route: only
    // same-membership pure-drift reconciles advance the three-strike count
    // toward per-window acceptance. A reconcile carrying tiled membership
    // or floating/sticky flag changes (the retired admit/remove shape,
    // including fresh seeds with no applied evidence yet) never advances it;
    // work-area reprojections keep their existing early return through the
    // delegate below. Reads before-apply per-id evidence only, never baseline
    // authority.
    private noteAutoReconcileTerminal(flightState: PendingFlight): void {
        if (
            flightState.op === "reconcile" &&
            flightState.background !== true &&
            flightState.workAreaReprojection !== true
        ) {
            if (this.appliedMembershipOrFlagsChanged(flightState.snapshot)) {
                return;
            }
        }
        this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
    }

    private dispatch(intent: AutoIntent): void {
        if (!this.enabled || this.inFlight) {
            return;
        }
        // A new lifecycle command supersedes an unanswered terminal probe. Its
        // callback must not make a later recovery decision for an older flight.
        this.activeProbe = 0;
        this.clearProbeTimer();
        if (
            intent.op === "reconcile" &&
            intent.background !== true &&
            intent.workAreaReprojection !== true &&
            this.interactiveResizeActive()
        ) {
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
            const nextEpoch = this.seqEpoch + 1;
            if (!Number.isSafeInteger(nextEpoch)) {
                return;
            }
            const candidate = `${this.generation}-p${String(nextEpoch)}r0`;
            if (!isCorrelationId(candidate)) {
                return;
            }
            this.seqEpoch = nextEpoch;
            this.seq = 0;
            this.logToken(`${LOG_PREFIX}:sequence-rotated correlation=${candidate} cause=sequence-exhausted recovery=rotated`);
        }
        const correlation =
            this.seqEpoch === 0
                ? `${this.generation}-p${String(this.seq)}`
                : `${this.generation}-p${String(this.seqEpoch)}r${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            return;
        }
        const snapshot = intent.snapshot;
        const sortedIds = snapshot.windows.map((entry) => entry.id).sort();
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
            // AR12 client size hints captured freshly at observation time.
            // Absent when the host reports no hint there.
            ...(entry.minSize === undefined ? {} : { min_size: { w: entry.minSize.w, h: entry.minSize.h } }),
            ...(entry.maxSize === undefined ? {} : { max_size: { w: entry.maxSize.w, h: entry.maxSize.h } }),
        }));
        // Directional domains payload: only focus/move may carry it, and
        // only when the snapshot holds two validated domains. The source
        // `domain` stays for compatibility; `domains` binds the full
        // source+target observation so stale targets fail closed.
        const directionalDomains =
            (intent.op === "focus" || intent.op === "move") &&
            snapshot.domains !== undefined &&
            snapshot.domains.length === 2
                ? snapshot.domains.map((entry) => ({
                      output: entry.output,
                      workspace: entry.workspace,
                      bounds: { x: entry.bounds.x, y: entry.bounds.y, w: entry.bounds.w, h: entry.bounds.h },
                      gap: entry.gap,
                      outer_gap: entry.outerGap,
                      adjacent: { ...(entry.adjacent as Record<string, string>) },
                  }))
                : undefined;
        // Directional requests bind the full two-domain evidence in the
        // fingerprint (Rust re-derives and validates it); legacy requests
        // keep the historical plan fingerprint scheme unchanged.
        const fingerprint =
            directionalDomains === undefined
                ? planFingerprint(
                      snapshot.domainOutput,
                      snapshot.domainWorkspace,
                      snapshot.focusedId,
                      sortedIds,
                  )
                : planDirectionalFingerprint(
                      snapshot.domains as ReadonlyArray<PlanDomain>,
                      snapshot.focusedId,
                      windows.map((entry) => ({
                          window: entry.window as string,
                          output: entry.output as string,
                          workspace: entry.workspace as string,
                          rect: entry.rect as PlanRect,
                          floating: (entry as Record<string, unknown>)["floating"] === true,
                          fitExcluded: (entry as Record<string, unknown>)["fit_excluded"] === true,
                      })),
                  );
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
                ...(directionalDomains === undefined ? {} : { domains: directionalDomains }),
                focused_window: snapshot.focusedId,
                windows,
                command: intent.body,
            });
        } catch (error) {
            void error;
            // Unbuildable payload: no plan correlation was created, so bind
            // the exact marker failure now with an honest `plan=none`, plus
            // one correlated refusal line so the drop is never silent.
            this.logToken(`${LOG_PREFIX}:request-refused correlation=${correlation} reason=request-invalid`);
            this.failMarkerDispatch(intent, "dispatch-failed", null);
            return;
        }
        if (payload.length > PLAN_MAX_REQUEST_BYTES) {
            // Oversize payload: no flight was created, so bind the exact
            // marker failure now with an honest `plan=none`, plus one
            // correlated refusal line so the drop is never silent. The
            // allocated correlation never left the adapter and names nothing.
            this.logToken(`${LOG_PREFIX}:request-refused correlation=${correlation} reason=request-over-cap`);
            this.failMarkerDispatch(intent, "dispatch-failed", null);
            return;
        }
        const isRecovery = this.nextIsRecovery;
        this.nextIsRecovery = false;
        this.inFlight = true;
        this.pending = {
            correlation,
            op: intent.op,
            epoch: this.epoch,
            plannerSession: this.plannerSession,
            snapshot,
            removed: intent.removed,
            windowCount: sortedIds.length,
            pointerSource: intent.pointerSource ?? null,
            dragSource: intent.dragSource ?? null,
            restoreMarker: intent.restoreMarker ?? null,
            workAreaReprojection: intent.workAreaReprojection === true,
            admissionMaximizeClears: intent.admissionMaximizeClears ?? Object.freeze([]),
            floatTarget: intent.floatTarget ?? null,
            stickyTarget: intent.stickyTarget ?? null,
            background: intent.background === true,
            direction:
                intent.direction === "left" ||
                intent.direction === "right" ||
                intent.direction === "up" ||
                intent.direction === "down"
                    ? intent.direction
                    : null,
            requestPayload: payload,
            requestRevision: 0,
            isRecovery,
            body: intent.body,
            replanned: intent.replanned === true,
        };
        this.r4WriteDepth = 0;
        this.lifecycleDiag(this.pending as PendingFlight, "request", "dispatch", "started", "-");
        this.callbackSeen = false;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        const session = this.plannerSession;
        this.pinnedOwner = null;
        this.activationStep = 1;
        try {
            const cancel = this.env.scheduleOnce(PLAN_TIMEOUT_MS, () => this.onTimeout(flight, session));
            this.cancelTimer = cancel;
        } catch (error) {
            void error;
            this.inFlight = false;
            this.pending = null;
            this.activationStep = 0;
            this.diag(intent.op, correlation, sortedIds.length, "timer-failed");
            if (intent.background === true) {
                this.noteBackgroundTerminal(intent.snapshot);
            } else {
                this.noteReconcileTerminal(intent.op, intent.workAreaReprojection === true);
            }
            // A never-sent pointer joins its marker (persisting for a later
            // free moment); a never-sent marker attempt binds its exact
            // failure naming the allocated plan correlation.
            if (typeof intent.dragSource === "string" && isDragCorrelation(intent.dragSource)) {
                this.noteDragRejected(intent.dragSource, "timer-failed", intent.pointerSource ?? null, intent.snapshot.domainOutput, intent.snapshot.domainWorkspace);
            }
            this.failMarkerDispatch(intent, "timer-failed", correlation);
            this.finishFlight();
            return;
        }
        // Phase 1: strict NameHasOwner presence. KWin does not deliver
        // GetNameOwner's absent-name error to callbacks, so presence must be
        // distinguished first. Strict boolean only; anything else is terminal
        // no-planner with no recovery and no retry.
        try {
            const presenceFlight = this.pending;
            if (presenceFlight !== null) {
                this.activateDiag(presenceFlight, "presence", "presence-requested");
            }
            this.env.callDbus(
                PLAN_DBUS_SERVICE,
                PLAN_DBUS_OBJECT,
                PLAN_DBUS_INTERFACE,
                PLAN_HAS_OWNER_METHOD,
                PLAN_SERVICE,
                (reply) => this.onNamePresence(reply, flight, session),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            const lostPresence = this.pending;
            if (lostPresence !== null) {
                this.activateDiag(lostPresence, "presence", "presence-throw");
            }
            this.inFlight = false;
            this.pending = null;
            this.activationStep = 0;
            this.diag(intent.op, correlation, sortedIds.length, "dbus-failed");
            if (intent.background === true) {
                this.noteBackgroundTerminal(intent.snapshot);
            } else {
                this.noteReconcileTerminal(intent.op, intent.workAreaReprojection === true);
            }
            // A never-sent pointer joins its marker (persisting for a later
            // free moment); a never-sent marker attempt binds its exact
            // failure naming the allocated plan correlation.
            if (typeof intent.dragSource === "string" && isDragCorrelation(intent.dragSource)) {
                this.noteDragRejected(intent.dragSource, "dbus-failed", intent.pointerSource ?? null, intent.snapshot.domainOutput, intent.snapshot.domainWorkspace);
            }
            this.failMarkerDispatch(intent, "dbus-failed", correlation);
            this.finishFlight();
        }
    }

    private onNamePresence(reply: unknown, flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession || this.activationStep !== 1) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null || flightState.plannerSession !== session) {
            return;
        }
        if (reply === true) {
            this.activateDiag(flightState, "presence", "present");
            this.activationStep = 2;
            try {
                this.activateDiag(flightState, "resolve", "resolve-requested");
                this.env.callDbus(
                    PLAN_DBUS_SERVICE,
                    PLAN_DBUS_OBJECT,
                    PLAN_DBUS_INTERFACE,
                    PLAN_GET_OWNER_METHOD,
                    PLAN_SERVICE,
                    (ownerReply) => this.onOwnerInitial(ownerReply, flight, session),
                );
            } catch (error) {
                void error;
                this.activateDiag(flightState, "resolve", "resolve-throw");
                this.failActivation(flightState, "no-planner");
            }
            return;
        }
        if (reply !== false) {
            this.activateDiag(flightState, "presence", "presence-malformed");
            this.failActivation(flightState, "no-planner");
            return;
        }
        // Strictly absent name. With a previously pinned owner this is
        // confirmed absence: the old flight is terminal and a fresh session
        // recovery replaces it; the old command is never replayed. Without a
        // prior owner this is initial activation: proceed to one bounded start.
        if (this.knownOwner !== null) {
            const lost = flightState;
            this.activateDiag(lost, "presence", "name-loss");
            this.clearTimer();
            this.inFlight = false;
            this.pending = null;
            this.pinnedOwner = null;
            this.activationStep = 0;
            this.diag(lost.op, lost.correlation, lost.windowCount, "owner-absent");
            this.noteTerminalFor(lost);
            this.triggerRecovery("absent");
            return;
        }
        this.activateDiag(flightState, "presence", "absent");
        this.activationStep = 3;
        try {
            this.activateDiag(flightState, "start", "start-requested");
            this.env.callDbus(
                PLAN_DBUS_SERVICE,
                PLAN_DBUS_OBJECT,
                PLAN_DBUS_INTERFACE,
                PLAN_START_METHOD,
                PLAN_SERVICE,
                (startReply) => this.onStartResult(startReply, flight, session),
            );
        } catch (error) {
            void error;
            this.activateDiag(flightState, "start", "start-throw");
            this.failActivation(flightState, "no-planner");
        }
    }

    private onOwnerInitial(reply: unknown, flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession || this.activationStep !== 2) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null || flightState.plannerSession !== session) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.activateDiag(flightState, "resolve", "owner-malformed");
            this.failActivation(flightState, "no-planner");
            return;
        }
        // A changed unique owner after a previously pinned Planner is
        // confirmed identity evidence: terminal old flight plus fresh-session
        // recovery, never replaying the old command.
        if (this.knownOwner !== null && reply !== this.knownOwner) {
            const lost = flightState;
            this.activateDiag(lost, "resolve", "owner-changed");
            this.clearTimer();
            this.inFlight = false;
            this.pending = null;
            this.pinnedOwner = null;
            this.activationStep = 0;
            this.diag(lost.op, lost.correlation, lost.windowCount, "owner-changed");
            this.noteTerminalFor(lost);
            this.triggerRecovery("changed");
            return;
        }
        this.pinnedOwner = reply;
        this.knownOwner = reply;
        this.activateDiag(flightState, "resolve", "owner-pinned");
        this.activationStep = 5;
        this.sendPlannerRequest(flight, session);
    }

    private onStartResult(reply: unknown, flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession || this.activationStep !== 3) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null || flightState.plannerSession !== session) {
            return;
        }
        if (reply !== PLAN_START_PRIMARY && reply !== PLAN_START_ALREADY) {
            this.activateDiag(
                flightState,
                "start-result",
                typeof reply === "number" ? "start-refused" : "start-malformed",
            );
            this.failActivation(flightState, "no-planner");
            return;
        }
        this.activateDiag(
            flightState,
            "start-result",
            reply === PLAN_START_PRIMARY ? "start-primary" : "start-already",
        );
        this.activationStep = 4;
        try {
            this.activateDiag(flightState, "resolve", "resolve-requested");
            this.env.callDbus(
                PLAN_DBUS_SERVICE,
                PLAN_DBUS_OBJECT,
                PLAN_DBUS_INTERFACE,
                PLAN_GET_OWNER_METHOD,
                PLAN_SERVICE,
                (ownerReply) => this.onOwnerAfterStart(ownerReply, flight, session),
            );
        } catch (error) {
            void error;
            this.activateDiag(flightState, "resolve", "resolve-throw");
            this.failActivation(flightState, "no-planner");
        }
    }

    private onOwnerAfterStart(reply: unknown, flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession || this.activationStep !== 4) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null || flightState.plannerSession !== session) {
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.activateDiag(flightState, "resolve", "owner-malformed");
            this.failActivation(flightState, "no-planner");
            return;
        }
        this.pinnedOwner = reply;
        if (this.knownOwner === null) {
            this.knownOwner = reply;
        }
        this.activateDiag(flightState, "resolve", "owner-pinned");
        this.activationStep = 5;
        this.sendPlannerRequest(flight, session);
    }

    private sendPlannerRequest(flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession || this.activationStep !== 5) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null || flightState.plannerSession !== session || !isUniqueOwner(this.pinnedOwner)) {
            return;
        }
        this.callbackSeen = false;
        try {
            const target = this.pinnedOwner as string;
            this.activateDiag(flightState, "send", "send-requested");
            this.env.callDbus(
                target,
                PLAN_OBJECT,
                PLAN_INTERFACE,
                PLAN_METHOD,
                flightState.requestPayload,
                (reply) => this.onRequestReply(reply, flight, session),
            );
            this.activateDiag(flightState, "send", "request-sent");
        } catch (error) {
            void error;
            this.activateDiag(flightState, "send", "send-throw");
            this.failFlight(flightState, "owner-loss");
        }
    }

    private failActivation(flightState: PendingFlight, outcome: string): void {
        if (flightState.plannerSession !== this.plannerSession) {
            return;
        }
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.diag(flightState.op, flightState.correlation, flightState.windowCount, outcome);
        this.noteTerminalFor(flightState);
        // Activation never sent the command: a pointer joins its marker
        // (persisting for a later free moment, with exactly one reconcile
        // attempt overall); a marker attempt binds its exact failure naming
        // the allocated plan correlation.
        const dragPointer = this.dragSourceOf(flightState);
        if (dragPointer !== null) {
            this.noteDragRejected(
                dragPointer,
                outcome,
                flightState.pointerSource,
                flightState.snapshot.domainOutput,
                flightState.snapshot.domainWorkspace,
            );
        } else {
            this.failDragRestore(flightState, outcome);
        }
        this.finishFlight();
    }

    private noteTerminalFor(flightState: PendingFlight): void {
        if (flightState.background === true) {
            this.noteBackgroundTerminal(flightState.snapshot);
        } else {
            this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
        }
    }

    private maybeProbeAfterTerminal(lost: PendingFlight): void {
        if (!this.enabled) {
            return;
        }
        if (lost.isRecovery) {
            return;
        }
        if (lost.plannerSession !== this.plannerSession) {
            return;
        }
        if (this.inFlight) {
            return;
        }
        if (this.knownOwner === null) {
            return;
        }
        // One bounded identity probe only when the flight is otherwise
        // terminal. Timeout, malformed, service fault, missing callback, and
        // correlation mismatch alone never recover; only a probe result
        // proving absence (strict false) or a changed unique owner triggers
        // recovery. One bounded deadline covers both probe callbacks: silence
        // clears only the probe and resumes the pump without recovery or
        // topology reset. No retry, polling, or systemd behavior.
        this.clearProbeTimer();
        this.probeToken += 1;
        const probe = this.probeToken;
        this.activeProbe = probe;
        const session = this.plannerSession;
        const expectedOwner = this.knownOwner;
        const correlation = lost.correlation;
        try {
            this.probeCancel = this.env.scheduleOnce(PLAN_TIMEOUT_MS, () => this.onProbeTimeout(probe, session, correlation));
        } catch (error) {
            void error;
            this.probeCancel = null;
            this.activeProbe = 0;
            return;
        }
        try {
            this.env.callDbus(
                PLAN_DBUS_SERVICE,
                PLAN_DBUS_OBJECT,
                PLAN_DBUS_INTERFACE,
                PLAN_HAS_OWNER_METHOD,
                PLAN_SERVICE,
                (reply) => this.onProbePresence(reply, probe, session, expectedOwner),
            );
        } catch (error) {
            void error;
            this.clearProbeTimer();
            this.activeProbe = 0;
        }
    }

    private onProbeTimeout(probe: number, session: number, correlation: string): void {
        if (probe !== this.activeProbe || session !== this.plannerSession) {
            return;
        }
        if (this.inFlight) {
            this.clearProbeTimer();
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        // Silence is not confirmed loss: retain Planner/Engine topology and
        // resume deferred/hidden/marker pumping. Late callbacks stay fenced
        // by the cleared probe token below.
        this.clearProbeTimer();
        this.activeProbe = 0;
        this.logToken(`${LOG_PREFIX}:probe-timeout correlation=${correlation} cause=probe-silence outcome=pump-resumed`);
        this.finishFlight();
    }

    private onProbePresence(reply: unknown, probe: number, session: number, expectedOwner: string | null): void {
        if (probe !== this.activeProbe || session !== this.plannerSession) {
            return;
        }
        if (this.inFlight) {
            this.clearProbeTimer();
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (reply === false) {
            this.triggerRecovery("absent");
            return;
        }
        if (reply !== true) {
            this.clearProbeTimer();
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        try {
            this.env.callDbus(
                PLAN_DBUS_SERVICE,
                PLAN_DBUS_OBJECT,
                PLAN_DBUS_INTERFACE,
                PLAN_GET_OWNER_METHOD,
                PLAN_SERVICE,
                (ownerReply) => this.onProbeOwner(ownerReply, probe, session, expectedOwner),
            );
        } catch (error) {
            void error;
            this.clearProbeTimer();
            this.activeProbe = 0;
            this.finishFlight();
        }
    }

    private onProbeOwner(reply: unknown, probe: number, session: number, expectedOwner: string | null): void {
        if (probe !== this.activeProbe || session !== this.plannerSession) {
            return;
        }
        if (this.inFlight) {
            this.clearProbeTimer();
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.clearProbeTimer();
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (expectedOwner === null) {
            this.clearProbeTimer();
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (reply !== expectedOwner) {
            this.triggerRecovery("changed");
            return;
        }
        this.clearProbeTimer();
        this.activeProbe = 0;
        this.finishFlight();
    }

    private triggerRecovery(reason: string): void {
        if (!this.enabled || this.inFlight) {
            return;
        }
        // Old flight is already terminal here; late old-generation callbacks
        // are fenced by the session bump below. Clear KWin lifecycle
        // evidence so CURRENT eligible windows form a fresh session through
        // the existing fresh-observation route (Rust near-strip fitting with normal
        // tiling when no fit applies). Never replay the old command. While a workspace send is
        // active, uncertain (plan-blocked), or otherwise blocking Plan, this
        // edge stays unavailable. A failed fresh activation stays
        // bounded/terminal without loops via the isRecovery fence.
        this.plannerSession += 1;
        this.epoch += 1;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.pending = null;
        this.knownOwner = null;
        this.activeProbe = 0;
        this.clearProbeTimer();
        this.appliedById.clear();
        this.appliedScopeByDomain.clear();
        this.seenNonFullscreen.clear();
        this.heldInitialFullscreen.clear();
        this.reconcileAttempts = 0;
        this.backgroundAttempts.clear();
        this.pointerEcho = null;
        this.absorbDeferredDragIntent(this.deferredAuto, false);
        this.deferredAuto = null;
        this.logToken(`${LOG_PREFIX}:recovery reason=${reason} outcome=confirmed-loss`);
        // Recovery tears down every flight without terminals: a dispatched
        // marker attempt never settled, so every marker gets one fresh
        // attempt afterwards instead of sticking consumed. Drags themselves
        // are preserved, never silently discarded.
        for (const marker of this.dragRestore.values()) {
            marker.dispatched = false;
        }
        this.nextIsRecovery = true;
        try {
            this.refreshNow();
        } catch (error) {
            void error;
            this.nextIsRecovery = false;
        }
        if (!this.inFlight) {
            this.nextIsRecovery = false;
            this.logToken(`${LOG_PREFIX}:recovery reason=${reason} outcome=no-fresh-observation`);
        }
    }

    private onTimeout(flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession) {
            return;
        }
        // A late arrival-timer fire while a lean R4 arrival wait holds the
        // flight belongs to the arrival deadline, not the request deadline.
        if (this.r4Flight !== null) {
            this.onR4ArrivalTimeout(flight, session);
            return;
        }
        const lost = this.pending;
        if (lost !== null && this.activationStep >= 1 && this.activationStep <= 4) {
            const phase =
                this.activationStep === 1
                    ? "presence"
                    : this.activationStep === 2
                      ? "resolve"
                      : this.activationStep === 3
                        ? "start"
                        : "start-resolve";
            this.activateDiag(lost, "timeout", "timeout", phase);
        }
        // Unanswered-request deadline: no planner reply arrived. There is no
        // ack/verify/cancel/status protocol and no retry; a late reply is
        // ignored by flight/session fencing. R4-shape flights force both
        // domains through the existing settlement chain below.
        // Ordinary reply-wait timeout only: the Planner send completed
        // (activationStep 5) and the reply never arrived. Activation-phase
        // timeouts (steps 1-4, 0) stay exclusively with the existing activate
        // diagnostics above and never emit an ordinary terminal.
        if (lost !== null && this.activationStep === 5) {
            this.ordinaryTerminal(lost, null, "timeout", "reply");
        }
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        if (lost !== null) {
            this.diag(lost.op, lost.correlation, lost.windowCount, "timeout");
            if (lost.background === true) {
                this.noteBackgroundTerminal(lost.snapshot);
            } else {
                this.noteReconcileTerminal(lost.op, lost.workAreaReprojection);
            }
            // A timed-out pointer feeds its marker; a timed-out marker
            // reconcile gets one terminal per drag naming this plan.
            const dragPointer = this.dragSourceOf(lost);
            if (dragPointer !== null) {
                this.noteDragRejected(dragPointer, "timeout", lost.pointerSource, lost.snapshot.domainOutput, lost.snapshot.domainWorkspace);
            } else {
                this.failDragRestore(lost, "timeout");
            }
            this.maybeProbeAfterTerminal(lost);
            this.forceR4SettleFromPending(lost);
            this.finishFlight();
            return;
        }
        this.finishFlight();
    }

    private onRequestReply(reply: unknown, flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession || this.callbackSeen) {
            return;
        }
        // A live lean R4 arrival wait owns the single-flight. A duplicate
        // `planned` must never restart native transfer or reset timers.
        if (this.r4Flight !== null) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null || flightState.plannerSession !== session || this.activationStep !== 5) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        this.lifecycleDiag(flightState, "reply", "reply", "received", "-");
        if (typeof reply !== "string" || reply.length > PLAN_MAX_REPLY_BYTES) {
            this.lifecycleDiag(flightState, "reply", "validate", "malformed", "service-fault");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            this.failFlight(flightState, "service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.lifecycleDiag(flightState, "reply", "validate", "malformed", "service-fault");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            this.failFlight(flightState, "service-fault");
            return;
        }
        if (!isRecord(parsed)) {
            this.lifecycleDiag(flightState, "reply", "validate", "malformed", "service-fault");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            this.failFlight(flightState, "service-fault");
            return;
        }
        if (parsed["v"] !== PLAN_CONTRACT_VERSION) {
            this.lifecycleDiag(flightState, "reply", "validate", "malformed", "service-fault");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            this.failFlight(flightState, "service-fault");
            return;
        }
        if (parsed["correlation_id"] !== flightState.correlation) {
            this.lifecycleDiag(flightState, "reply", "validate", "stale", "correlation-mismatch");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            this.failFlight(flightState, "correlation-mismatch");
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "diverged") {
            const kind = sanitizeKind(parsed["kind"]);
            this.lifecycleDiag(flightState, "reply", "validate", "rejected", kind);
            this.ordinaryTerminal(flightState, null, "rejected", "validate");
            this.failFlight(flightState, sanitizeKind(parsed["kind"]));
            return;
        }
        if (outcome === "rejected") {
            const kind = sanitizeKind(parsed["kind"]);
            const detail = sanitizeDetail(parsed["detail"]);
            this.lifecycleDiag(flightState, "reply", "validate", "rejected", kind);
            this.ordinaryTerminal(flightState, null, "rejected", "validate");
            if (isUniqueOwner(this.pinnedOwner) && this.knownOwner === null) {
                this.knownOwner = this.pinnedOwner;
            }
            this.inFlight = false;
            this.pending = null;
            this.pinnedOwner = null;
            this.activationStep = 0;
            this.diag(flightState.op, flightState.correlation, flightState.windowCount, "rejected");
            this.rejectKind(kind, detail, flightState.snapshot);
            // Core partial-observation diagnostics: log the retained vs
            // observed membership skew (counts only, no gate change) so a
            // floating/exception drift is attributable without guessing.
            if (kind === "partial-observation") {
                this.logCoverSkew(flightState, null, "partial-observation");
            }
            if (flightState.background === true) {
                this.noteBackgroundTerminal(flightState.snapshot);
            } else {
                this.noteAutoReconcileTerminal(flightState);
            }
            // A Planner-rejected drag pointer feeds its domain marker for one
            // bounded converge; a rejected marker reconcile itself only logs
            // its correlated terminal naming this plan (no retry/loop).
            const dragPointer = this.dragSourceOf(flightState);
            if (dragPointer !== null) {
                this.noteDragRejected(dragPointer, kind, flightState.pointerSource, flightState.snapshot.domainOutput, flightState.snapshot.domainWorkspace);
            } else {
                this.failDragRestore(flightState, "rejected");
            }
            // R4-shape rejections force both domains even on equal evidence.
            this.forceR4SettleFromPending(flightState);
            // Correlated gap-mismatch retry: an automatic reconcile refused
            // solely for inner/outer gaps re-observes the same domain fresh
            // (foreground observation, or same hidden-domain observation for
            // background flights) and dispatches at most one update-gaps
            // through the ordinary single-flight below. Never from update-gaps,
            // diverged, owner/stale/uncertain/malformed, cross-domain
            // evidence, marker/pointer flights, or a superseded slot: an
            // update-gaps rejection never retries, and a queued intent wins
            // so its own flight governs the next attempt.
            if (
                kind === "domain-mismatch" &&
                isGapMismatchMessage(parsed["message"]) &&
                flightState.op === "reconcile" &&
                flightState.workAreaReprojection !== true &&
                (flightState.restoreMarker ?? null) === null &&
                this.dragSourceOf(flightState) === null &&
                this.deferredAuto === null
            ) {
                const isHiddenRetry = flightState.background === true;
                const retryObserved = isHiddenRetry
                    ? this.freshHiddenFor(flightState.snapshot)
                    : this.freshObserved();
                if (retryObserved !== null) {
                    const retrySnapshot = this.carriedSnapshot(retryObserved);
                    if (this.domainKey(snapshotOf(retryObserved)) === this.domainKey(flightState.snapshot)) {
                        this.logToken(
                            `${LOG_PREFIX}:gap-reprojection selected=retry inner=${String(flightState.snapshot.domainGap)}->${String(retrySnapshot.domainGap)} outer=${String(flightState.snapshot.domainOuterGap)}->${String(retrySnapshot.domainOuterGap)}`,
                        );
                        this.pointerEcho = null;
                        this.deferredAuto = {
                            op: "update-gaps",
                            snapshot: retrySnapshot,
                            removed: null,
                            body: { op: "update-gaps" },
                            admissionMaximizeClears: flightState.admissionMaximizeClears,
                            ...(isHiddenRetry ? { background: true as const } : {}),
                        };
                    }
                }
            }
            this.finishFlight();
            return;
        }
        if (outcome !== "planned") {
            this.lifecycleDiag(flightState, "reply", "validate", "malformed", "service-fault");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            this.failFlight(flightState, "service-fault");
            return;
        }
        // Fence stale replies: a newer observation arrived after dispatch.
        if (flightState.epoch !== this.epoch) {
            this.lifecycleDiag(flightState, "reply", "validate", "stale", "stale-dropped");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            if (isUniqueOwner(this.pinnedOwner) && this.knownOwner === null) {
                this.knownOwner = this.pinnedOwner;
            }
            this.inFlight = false;
            this.pending = null;
            this.pinnedOwner = null;
            this.activationStep = 0;
            this.diag(flightState.op, flightState.correlation, flightState.windowCount, "stale-dropped");
            if (flightState.background === true) {
                this.noteBackgroundTerminal(flightState.snapshot);
            } else {
                this.noteAutoReconcileTerminal(flightState);
            }
            // A stale drag pointer feeds its marker; a stale marker
            // reconcile gets one terminal per drag naming this plan.
            const dragPointer = this.dragSourceOf(flightState);
            if (dragPointer !== null) {
                this.noteDragRejected(dragPointer, "stale-dropped", flightState.pointerSource, flightState.snapshot.domainOutput, flightState.snapshot.domainWorkspace);
            } else {
                this.failDragRestore(flightState, "stale-dropped");
            }
            // R4-shape stale replies force both domains even on equal evidence.
            this.forceR4SettleFromPending(flightState);
            this.finishFlight();
            return;
        }
        const planned = validatePlanned(parsed, flightState.correlation);
        if (planned === null) {
            this.lifecycleDiag(flightState, "reply", "validate", "malformed", "precondition-mismatch");
            this.ordinaryTerminal(flightState, null, "uncertain", "validate");
            this.logCoverSkew(flightState, null, "malformed");
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        if (!this.geometryCovers(planned, flightState)) {
            this.lifecycleDiag(flightState, "reply", "validate", "malformed", "precondition-mismatch", this.ordinaryRevision(planned, flightState));
            this.ordinaryTerminal(flightState, planned, "uncertain", "validate");
            this.logCoverSkew(flightState, planned, "cover-mismatch");
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        this.lifecycleDiag(flightState, "reply", "validate", "validated", "-", this.ordinaryRevision(planned, flightState));
        this.applyPlanned(planned, flightState);
    }

    // Known floating source derived from adapter observation (entry.ts:
    // floating = float-membership set OR onAllDesktops; sticky implies
    // onAllDesktops). Never a Rust derivation.
    private floatSourceOf(entry: { readonly floating: boolean; readonly sticky?: boolean }): string {
        if (entry.floating !== true) {
            return "none";
        }
        return entry.sticky === true ? "all-desktops" : "float-set";
    }

    private skewFlag(value: boolean | undefined): string {
        return value === undefined ? "unknown" : value ? "true" : "false";
    }

    // Membership-skew diagnostics (logging only, never a gate): one summary
    // line plus one bounded record per mismatched member using the existing
    // opaque window id convention, each with its observed
    // floating/sticky/fullscreen/maximized flags and known floating source.
    // Retained tiled membership comes from before-apply per-id applied
    // evidence on the same domain (never baseline authority, never core
    // state). For core partial-observation (no planned geometry) members
    // compare only against actual applied evidence; without it the log
    // reports retained=unknown and claims no precise cause. Counts only
    // otherwise; no rects, no raw native ids. Member records are bounded
    // by the built request byte cap.
    private logCoverSkew(flightState: PendingFlight, planned: PlannedReply | null, reason: string): void {
        try {
            interface SkewFlags {
                readonly floating: boolean | undefined;
                readonly sticky: boolean | undefined;
                readonly fullscreen: boolean | undefined;
                readonly maximized: boolean | undefined;
                readonly src: string;
            }
            const snapById = new Map<string, SkewFlags>();
            const wanted = new Set<string>();
            let floating = 0;
            let sticky = 0;
            let fullscreen = 0;
            let maximized = 0;
            for (const entry of flightState.snapshot.windows) {
                snapById.set(entry.id, {
                    floating: entry.floating,
                    sticky: entry.sticky,
                    fullscreen: entry.fullscreen,
                    maximized: entry.maximized,
                    src: this.floatSourceOf(entry),
                });
                if (entry.floating === true) {
                    floating += 1;
                }
                if (entry.sticky === true) {
                    sticky += 1;
                }
                if (entry.fullscreen) {
                    fullscreen += 1;
                }
                if (entry.maximized) {
                    maximized += 1;
                }
                if (entry.floating !== true || (flightState.floatTarget?.window === entry.id && flightState.floatTarget.floating === false)) {
                    wanted.add(entry.id);
                }
            }
            if (flightState.removed !== null) {
                wanted.delete(flightState.removed);
            }
            // Before-apply per-id evidence (never core state, never baseline
            // authority): retained tiled members homed to the flight domain,
            // plus sticky multi-homed members observed here with matching
            // sticky flags even when the shared slot was last written by
            // another domain.
            const hasApplied = this.hasAppliedEvidenceFor(flightState.snapshot);
            const retainedTiled = new Map<string, SkewFlags>();
            if (hasApplied) {
                for (const [id, evidence] of this.appliedById) {
                    if (
                        evidence.output === flightState.snapshot.domainOutput &&
                        evidence.workspace === flightState.snapshot.domainWorkspace &&
                        evidence.floating !== true
                    ) {
                        retainedTiled.set(id, {
                            floating: evidence.floating,
                            sticky: evidence.sticky,
                            fullscreen: evidence.fullscreen,
                            maximized: evidence.maximized,
                            src: this.floatSourceOf({ floating: evidence.floating, sticky: evidence.sticky }),
                        });
                    }
                }
                for (const entry of flightState.snapshot.windows) {
                    if (retainedTiled.has(entry.id) || entry.floating === true) {
                        continue;
                    }
                    const evidence = this.appliedById.get(entry.id);
                    if (
                        evidence !== undefined &&
                        evidence.floating === false &&
                        entry.sticky === true &&
                        evidence.sticky === true
                    ) {
                        retainedTiled.set(entry.id, {
                            floating: evidence.floating,
                            sticky: evidence.sticky,
                            fullscreen: evidence.fullscreen,
                            maximized: evidence.maximized,
                            src: this.floatSourceOf({ floating: evidence.floating, sticky: evidence.sticky }),
                        });
                    }
                }
            }
            // Missing/extra member ids with per-member flags. Cover-mismatch
            // compares wanted against the planned geometry with observed
            // (dispatch-snapshot) flags; without planned geometry the
            // comparison falls back to retained evidence when available.
            const missing: string[] = [];
            const extra: string[] = [];
            const flagOf = new Map<string, SkewFlags>();
            const unknownFlags: SkewFlags = {
                floating: undefined,
                sticky: undefined,
                fullscreen: undefined,
                maximized: undefined,
                src: "unknown",
            };
            let plannedText = "unknown";
            if (planned !== null) {
                const plannedIds = new Set<string>();
                for (const entry of planned.geometry) {
                    plannedIds.add(entry.window);
                }
                for (const id of wanted) {
                    if (!plannedIds.has(id)) {
                        missing.push(id);
                    }
                }
                for (const id of plannedIds) {
                    if (!wanted.has(id)) {
                        extra.push(id);
                    }
                }
                plannedText = String(planned.geometry.length);
                for (const id of missing) {
                    const flags = snapById.get(id);
                    if (flags !== undefined) {
                        flagOf.set(id, flags);
                    }
                }
                for (const id of extra) {
                    flagOf.set(id, snapById.get(id) ?? unknownFlags);
                }
            } else if (hasApplied) {
                for (const id of wanted) {
                    if (!retainedTiled.has(id)) {
                        missing.push(id);
                    }
                }
                for (const id of retainedTiled.keys()) {
                    if (!wanted.has(id)) {
                        extra.push(id);
                    }
                }
                for (const id of missing) {
                    const flags = snapById.get(id);
                    if (flags !== undefined) {
                        flagOf.set(id, flags);
                    }
                }
                for (const id of extra) {
                    const flags = retainedTiled.get(id);
                    if (flags !== undefined) {
                        flagOf.set(id, flags);
                    }
                }
            }
            missing.sort();
            extra.sort();
            const retainedIds = [...retainedTiled.keys()].sort();
            const hasReference = planned !== null || hasApplied;
            this.logToken(
                `${LOG_PREFIX}:membership-skew correlation=${flightState.correlation} op=${flightState.op} reason=${sanitizeKind(reason)} wanted=${String(wanted.size)} planned=${plannedText} missing=${hasReference ? String(missing.length) : "unknown"} extra=${hasReference ? String(extra.length) : "unknown"} floating=${String(floating)} sticky=${String(sticky)} fullscreen=${String(fullscreen)} maximized=${String(maximized)} retained=${hasApplied ? "known" : "unknown"} retained-wanted=${hasApplied ? String(retainedTiled.size) : "-"} retained-ids=${!hasApplied || retainedIds.length === 0 ? "-" : retainedIds.join(",")}`,
            );
            for (const id of missing) {
                const flags = flagOf.get(id);
                if (flags === undefined) {
                    continue;
                }
                this.logToken(
                    `${LOG_PREFIX}:membership-skew-member correlation=${flightState.correlation} window=${id} side=missing floating=${this.skewFlag(flags.floating)} sticky=${this.skewFlag(flags.sticky)} fullscreen=${this.skewFlag(flags.fullscreen)} maximized=${this.skewFlag(flags.maximized)} float-src=${flags.src}`,
                );
            }
            for (const id of extra) {
                const flags = flagOf.get(id);
                if (flags === undefined) {
                    continue;
                }
                this.logToken(
                    `${LOG_PREFIX}:membership-skew-member correlation=${flightState.correlation} window=${id} side=extra floating=${this.skewFlag(flags.floating)} sticky=${this.skewFlag(flags.sticky)} fullscreen=${this.skewFlag(flags.fullscreen)} maximized=${this.skewFlag(flags.maximized)} float-src=${flags.src}`,
                );
            }
        } catch (error) {
            void error;
        }
    }

    // Complete-reply binding: the reply geometry must cover exactly the
    // request window set (admit/move/focus/resize) or exactly the survivors
    // (remove). Unknown or partial windows never reach native writes. The
    // wanted set is derived from the primitive dispatch snapshot only.
    // Directional focus/move may alternatively carry a source-only local
    // plan on a two-domain snapshot: then the geometry must cover exactly
    // the source-domain wanted subset (the target is untouched).
    private geometryCovers(planned: PlannedReply, flightState: PendingFlight): boolean {
        const wanted = new Set<string>();
        const wantedById = new Map<string, PlanSnapshotWindow>();
        for (const entry of flightState.snapshot.windows) {
            if (entry.floating !== true || (flightState.floatTarget?.window === entry.id && flightState.floatTarget.floating === false)) {
                wanted.add(entry.id);
                wantedById.set(entry.id, entry);
            }
        }
        if (flightState.removed !== null) {
            wanted.delete(flightState.removed);
            wantedById.delete(flightState.removed);
        }
        if (flightState.op === "toggle-float") {
            const target = flightState.floatTarget;
            if (target === null || (target.floating && (planned.floatGeometry === null || planned.floatGeometry.window !== target.window)) || (!target.floating && planned.floatGeometry !== null)) {
                return false;
            }
        }
        // Every planned entry must be wanted. Directional two-domain flights
        // additionally require homing to one of the snapshot domains so a
        // stale target substitution cannot pass; legacy single-domain flows
        // keep the historical id-only binding unchanged.
        const directionalHoming = flightState.snapshot.domains;
        let homedPairs: Set<string> | null = null;
        if (directionalHoming !== undefined) {
            homedPairs = new Set<string>();
            for (const entry of directionalHoming) {
                homedPairs.add(`${entry.output}\u0000${entry.workspace}`);
            }
        }
        for (const entry of planned.geometry) {
            if (!wanted.has(entry.window)) {
                return false;
            }
            if (homedPairs !== null && !homedPairs.has(`${entry.output}\u0000${entry.workspace}`)) {
                return false;
            }
        }
        if (planned.geometry.length === wanted.size) {
            return true;
        }
        // Directional local plan on a two-domain snapshot: exactly the
        // source-domain wanted subset, all homed to the source domain.
        const domains = flightState.snapshot.domains;
        if (
            (flightState.op === "focus" || flightState.op === "move") &&
            domains !== undefined &&
            domains.length === 2
        ) {
            const sourceOutput = flightState.snapshot.domainOutput;
            const sourceWorkspace = flightState.snapshot.domainWorkspace;
            let sourceWanted = 0;
            for (const entry of wantedById.values()) {
                if (entry.output === sourceOutput && entry.workspace === sourceWorkspace) {
                    sourceWanted += 1;
                }
            }
            if (planned.geometry.length !== sourceWanted || sourceWanted === 0) {
                return false;
            }
            for (const entry of planned.geometry) {
                if (entry.output !== sourceOutput || entry.workspace !== sourceWorkspace) {
                    return false;
                }
            }
            // A local plan must not carry a cross focus operation.
            if (planned.operation !== null) {
                return false;
            }
            // A local plan's focus (when present) must stay in the source.
            if (
                planned.focus !== null &&
                (planned.focus.domainOutput !== sourceOutput ||
                    planned.focus.domainWorkspace !== sourceWorkspace)
            ) {
                return false;
            }
            return true;
        }
        return false;
    }

    // Called only before flight setters. Keep scope/owner fences; a second
    // stale reply follows the ordinary terminal and convergence path.
    private maybeReplanStalePrewrite(flightState: PendingFlight, freshSnapshot: PlanSnapshot): boolean {
        if (flightState.replanned) {
            return false;
        }
        if (!this.enabled || this.r4Flight !== null) {
            return false;
        }
        if (!this.inFlight || this.pending !== flightState || flightState.plannerSession !== this.plannerSession) {
            return false;
        }
        if (!isUniqueOwner(this.pinnedOwner) || !isGeneration(this.generation)) {
            return false;
        }
        if (
            !sameScope(freshSnapshot, flightState.snapshot) ||
            !domainsEqual(freshSnapshot.domains, flightState.snapshot.domains)
        ) {
            return false;
        }
        const oldCorrelation = flightState.correlation;
        const op = flightState.op;
        this.diag(op, oldCorrelation, flightState.windowCount, "stale-scope");
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.dispatch({
            op: flightState.op,
            snapshot: freshSnapshot,
            removed: flightState.removed,
            body: flightState.body,
            pointerSource: flightState.pointerSource,
            dragSource: flightState.dragSource ?? null,
            restoreMarker: flightState.restoreMarker ?? null,
            workAreaReprojection: flightState.workAreaReprojection,
            admissionMaximizeClears: flightState.admissionMaximizeClears,
            floatTarget: flightState.floatTarget,
            stickyTarget: flightState.stickyTarget,
            background: flightState.background,
            direction: flightState.direction,
            replanned: true,
        });
        const next = this.pending as PendingFlight | null;
        if (next !== null && next.replanned === true && next.correlation !== oldCorrelation) {
            this.logToken(
                `${LOG_PREFIX}:stale-replan correlation=${oldCorrelation} op=${op} cause=stale-scope recovery=replan-once next=${next.correlation}`,
            );
        } else {
            this.logToken(
                `${LOG_PREFIX}:stale-replan correlation=${oldCorrelation} op=${op} cause=stale-scope recovery=dispatch-refused`,
            );
        }
        this.finishFlight();
        return true;
    }

    // Reply-boundary revalidation: never touch a possibly-destroyed Window
    // observed before dispatch. Re-observe synchronously, compare the captured
    // primitive snapshot, and resolve all geometry/focus targets only from the
    // fresh observation.
    private applyPlanned(planned: PlannedReply, flightState: PendingFlight): void {
        if (
            flightState.op === "reconcile" &&
            flightState.background !== true &&
            flightState.workAreaReprojection !== true &&
            this.interactiveResizeActive()
        ) {
            this.ordinaryTerminal(flightState, planned, "uncertain", "validate");
            this.discardInteractiveReconcile();
            this.finishFlight();
            return;
        }
        // Directional focus/move flights re-observe directionally (source
        // plus the same adjacent target) so cross targets resolve from fresh
        // evidence and stale substitutions fail closed before any write.
        // Reply-boundary re-observation resolves targets from the flight's own
        // domain only, so hidden-domain geometry is never applied to
        // foreground refs and vice versa.
        const directionalFlight =
            flightState.background !== true &&
            (flightState.op === "focus" || flightState.op === "move") &&
            flightState.snapshot.domains !== undefined &&
            flightState.snapshot.domains.length === 2 &&
            flightState.direction !== null;
        const fresh = directionalFlight
            ? this.freshDirectionalForFlight(flightState)
            : flightState.background === true
              ? this.freshHiddenFor(flightState.snapshot)
              : this.freshObserved();
        if (fresh === null) {
            this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
            this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
            this.failFlight(flightState, "stale-scope");
            return;
        }
        if (flightState.workAreaReprojection) {
            const freshSnapshot = this.carriedSnapshot(fresh);
            // Reply-boundary revalidation is flag-exact: a floating/sticky
            // flip mid-flight must fail closed even when the blind structural
            // comparators still match. Baseline-diff skew detection runs
            // pre-dispatch and is unaffected.
            if (
                !sameReprojectionScope(freshSnapshot, flightState.snapshot) ||
                unexpectedFloatingSkewed(flightState, freshSnapshot)
            ) {
                this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
                this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
                if (this.maybeReplanStalePrewrite(flightState, freshSnapshot)) {
                    return;
                }
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.lifecycleDiag(flightState, "observe", "observe", "matched", "-", this.ordinaryRevision(planned, flightState));
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        if (flightState.op === "pointer-resize") {
            const source = flightState.pointerSource;
            if (source === null) {
                this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
                this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
                this.failFlight(flightState, "stale-scope");
                return;
            }
            const freshSnapshot = this.carriedSnapshot(fresh);
            if (
                !rectsEqualExceptSource(freshSnapshot, flightState.snapshot, source) ||
                unexpectedFloatingSkewed(flightState, freshSnapshot)
            ) {
                this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
                this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
                if (this.maybeReplanStalePrewrite(flightState, freshSnapshot)) {
                    return;
                }
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.lifecycleDiag(flightState, "observe", "observe", "matched", "-", this.ordinaryRevision(planned, flightState));
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        if (flightState.op === "toggle-float") {
            const freshSnapshot = this.carriedSnapshot(fresh);
            // The native flip lands at write time, so any pre-apply skew is
            // external and must fail closed.
            if (
                !snapshotsEqual(freshSnapshot, flightState.snapshot) ||
                unexpectedFloatingSkewed(flightState, freshSnapshot)
            ) {
                this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
                this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
                if (this.maybeReplanStalePrewrite(flightState, freshSnapshot)) {
                    return;
                }
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.lifecycleDiag(flightState, "observe", "observe", "matched", "-", this.ordinaryRevision(planned, flightState));
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        if (flightState.removed === null) {
            const freshSnapshot = this.carriedSnapshot(fresh);
            // Admission-time maximize tolerance rides the clears list, not
            // the op: foreground auto reconciles carry the same
            // admissionMaximizeClears as the retired admit, so a cleared
            // window that re-maximizes before the reply still applies.
            const maximizeClears = flightState.admissionMaximizeClears;
            if (
                (!snapshotsEqual(freshSnapshot, flightState.snapshot) &&
                    !(
                        maximizeClears.length > 0 &&
                        snapshotsEqualAllowingAdmissionMaximize(
                            freshSnapshot,
                            flightState.snapshot,
                            maximizeClears,
                        )
                    )) ||
                unexpectedFloatingSkewed(flightState, freshSnapshot)
            ) {
                this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
                this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
                if (this.maybeReplanStalePrewrite(flightState, freshSnapshot)) {
                    return;
                }
                this.failFlight(flightState, "stale-scope");
                return;
            }
            this.lifecycleDiag(flightState, "observe", "observe", "matched", "-", this.ordinaryRevision(planned, flightState));
            this.writeGeometries(planned, flightState, fresh);
            return;
        }
        const freshSnapshot = this.carriedSnapshot(fresh);
        // Complete-observation convergence: the remove flight already carries
        // the current complete post-removal snapshot, so the reply boundary
        // revalidates exact post-membership equality. The reply geometry must
        // cover exactly the survivors via geometryCovers. A survivor
        // floating/sticky flip mid-flight fails closed the same way.
        if (
            !snapshotsEqual(freshSnapshot, flightState.snapshot) ||
            unexpectedFloatingSkewed(flightState, freshSnapshot)
        ) {
            this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
            this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
            if (this.maybeReplanStalePrewrite(flightState, freshSnapshot)) {
                return;
            }
            this.failFlight(flightState, "stale-scope");
            return;
        }
        this.lifecycleDiag(flightState, "observe", "observe", "matched", "-", this.ordinaryRevision(planned, flightState));
        this.writeGeometries(planned, flightState, fresh);
    }

    // Cross-output focus gate: exact operation fields, preconditions, and
    // target/source binding. Returns true only when every fence passes; any
    // mismatch is a precondition failure handled by the caller.
    private isCrossFocus(planned: PlannedReply, flightState: PendingFlight): boolean {
        if (flightState.op !== "focus" || flightState.background === true) {
            return false;
        }
        const domains = flightState.snapshot.domains;
        if (domains === undefined || domains.length !== 2) {
            return false;
        }
        const operation = planned.operation;
        const focus = planned.focus;
        if (operation === null || operation.op !== "focus" || focus === null || planned.preconditions === null) {
            return false;
        }
        const source = domains[0] as PlanDomain;
        const target = domains[1] as PlanDomain;
        if (
            operation.crossSourceOutput !== source.output ||
            operation.crossSourceWorkspace !== source.workspace ||
            operation.domainOutput !== target.output ||
            operation.domainWorkspace !== target.workspace ||
            focus.domainOutput !== target.output ||
            focus.domainWorkspace !== target.workspace
        ) {
            return false;
        }
        if (operation.fromWindow !== flightState.snapshot.focusedId) {
            return false;
        }
        if (flightState.direction === null || operation.direction !== flightState.direction) {
            return false;
        }
        if (operation.direction !== "left" && operation.direction !== "right") {
            return false;
        }
        if (operation.toLeaf !== focus.leaf || operation.toWindow.length === 0) {
            return false;
        }
        if (operation.route.length !== 1 || operation.route[0] !== operation.toLeaf) {
            return false;
        }
        const expected = [
            "focused-leaf-occupied-by-focused-window",
            "target-leaf-occupied",
            "focus-targets-adjacent-output",
            "adapter-must-verify-postconditions",
        ];
        const actual = planned.preconditions;
        if (actual.length !== expected.length) {
            return false;
        }
        for (let index = 0; index < expected.length; index += 1) {
            if (actual[index] !== expected[index]) {
                return false;
            }
        }
        // The focus leaf must resolve through the planned geometry to the
        // operation's target window.
        for (const entry of planned.geometry) {
            if (entry.leaf === focus.leaf && entry.window !== operation.toWindow) {
                return false;
            }
        }
        return true;
    }

    // Cross-output focus actuation: exactly one `setActive` on the resolved
    // target window, no geometry/layout/window membership writes. Every fence
    // refuses before the actuation; the existing acknowledgement/verification
    // already committed in Rust, and the adapter's epoch/scope fences hold.
    private applyCrossFocus(
        planned: PlannedReply,
        flightState: PendingFlight,
        current: PlanObserved,
    ): void {
        const operation = planned.operation;
        const focus = planned.focus;
        if (operation === null || operation.op !== "focus" || focus === null) {
            this.ordinaryTerminal(flightState, planned, "uncertain", "apply");
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        const domains = flightState.snapshot.domains;
        if (domains === undefined || domains.length !== 2) {
            this.ordinaryTerminal(flightState, planned, "uncertain", "apply");
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        const target = domains[1] as PlanDomain;
        // Resolve the target from the fresh cross-domain observation only.
        let targetRef: object | undefined;
        let targetEntry: PlanObservedWindow | undefined;
        for (const entry of current.windows) {
            if (
                entry.id === operation.toWindow &&
                entry.output === target.output &&
                entry.workspace === target.workspace
            ) {
                targetRef = entry.ref;
                targetEntry = entry;
                break;
            }
        }
        if (targetRef === undefined || targetEntry === undefined) {
            this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
            this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
            this.failFlight(flightState, "stale-scope");
            return;
        }
        // Exceptional targets never actuate: refuse before any write.
        if (
            targetEntry.fullscreen ||
            targetEntry.maximized ||
            targetEntry.floating === true ||
            targetEntry.sticky === true
        ) {
            this.ordinaryTerminal(flightState, planned, "uncertain", "apply");
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        // The planned focus leaf must match a geometry entry for the target
        // window (no layout change, target is the remembered leaf).
        let leafMatches = false;
        for (const entry of planned.geometry) {
            if (entry.window === operation.toWindow && entry.leaf === focus.leaf) {
                leafMatches = true;
                break;
            }
        }
        if (!leafMatches) {
            this.ordinaryTerminal(flightState, planned, "uncertain", "apply");
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
            currentActive = null;
        }
        if (currentActive !== targetRef) {
            let focused = false;
            try {
                focused = this.env.setActive(targetRef) === true;
            } catch (error) {
                void error;
                focused = false;
            }
            if (!focused) {
                this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                this.failFlight(flightState, "write-failed");
                return;
            }
        }
        if (isUniqueOwner(this.pinnedOwner)) {
            this.knownOwner = this.pinnedOwner;
        }
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.ordinaryTerminal(flightState, planned, "applied", "apply");
        this.diag(flightState.op, flightState.correlation, flightState.windowCount, "planned-applied");
        this.finishFlight();
    }

    // Exact production R4 cross-output move gate: the mover, the captured
    // source, the adjacent target with its current workspace, the commanded
    // direction, the R4 rule, and the transfer capability. Returns true only
    // when every fence passes; local R1/R2/R3 plans never satisfy it.
    private isCrossMove(planned: PlannedReply, flightState: PendingFlight): boolean {
        if (flightState.op !== "move" || flightState.background === true) {
            return false;
        }
        const domains = flightState.snapshot.domains;
        if (domains === undefined || domains.length !== 2) {
            return false;
        }
        const operation = planned.operation;
        if (operation === null || operation.op !== "move") {
            return false;
        }
        const move = operation as PlanMoveOperation;
        if (move.rule !== "R4" || move.capability !== "CrossOutputTransfer") {
            return false;
        }
        if (move.direction !== "left" && move.direction !== "right") {
            return false;
        }
        if (flightState.direction === null || move.direction !== flightState.direction) {
            return false;
        }
        const source = domains[0] as PlanDomain;
        const target = domains[1] as PlanDomain;
        if (
            move.sourceOutput !== source.output ||
            move.sourceWorkspace !== source.workspace ||
            move.targetOutput !== target.output ||
            move.targetWorkspace !== target.workspace
        ) {
            return false;
        }
        if (move.window !== flightState.snapshot.focusedId) {
            return false;
        }
        if (planned.preconditions === null || planned.preconditions.length !== 3) {
            return false;
        }
        const expected = [
            "focused-leaf-occupied-by-focused-window",
            "source-root-membership-and-adjacent-same-workspace-output",
            "adapter-must-verify-postconditions",
        ];
        for (let index = 0; index < expected.length; index += 1) {
            if (planned.preconditions[index] !== expected[index]) {
                return false;
            }
        }
        if (planned.baseRevision === null) {
            return false;
        }
        // Every desired entry must home to the source/target pair and the
        // mover must be desired on the target.
        let moverDesired = false;
        for (const entry of planned.geometry) {
            const onSource = entry.output === source.output && entry.workspace === source.workspace;
            const onTarget = entry.output === target.output && entry.workspace === target.workspace;
            if (!onSource && !onTarget) {
                return false;
            }
            if (entry.window === move.window && onTarget) {
                moverDesired = true;
            }
        }
        if (!moverDesired) {
            return false;
        }
        // The desired focus must follow the mover onto the target.
        if (
            planned.focus === null ||
            planned.focus.domainOutput !== target.output ||
            planned.focus.domainWorkspace !== target.workspace
        ) {
            return false;
        }
        return true;
    }

    // R4 immediate commit, no wire ack/verify/cancel/status. Called once per
    // R4 `planned` reply with the shared single-flight held: the dispatch
    // timer is already cleared. Order is fixed: sendClientToScreen with the
    // exact target Output object, mover desktops write with the exact target
    // VirtualDesktop refs, then planned geometries in canonical order
    // (overconstrained members skipped). Fences pinned owner, correlation,
    // flight/session token, and exact source/target scope before any native
    // write and before every setter; a stale snapshot discards before writes.
    // Structural scope rechecks tolerate the intended mover relocation
    // (source, half, or target placement) while rejecting unrelated stale
    // changes. After writes, one immediate fresh exact mover-on-target proof
    // follows once (a single setActive); delayed arrival waits on one-shot
    // output/desktops signals until a bounded arrival deadline. Every
    // terminal forces complete source AND target reconciliation through
    // `notifySendSettled`, including equal evidence. No geometry echo, no
    // settlement protocol, no queue, no replay. Logs are correlated and
    // redacted (no payloads or native ids).
    private beginR4Transfer(
        planned: PlannedReply,
        flightState: PendingFlight,
        current: PlanObserved,
    ): void {
        const operation = planned.operation as PlanMoveOperation;
        const domains = flightState.snapshot.domains as ReadonlyArray<PlanDomain>;
        const target = domains[1] as PlanDomain;
        const source = domains[0] as PlanDomain;
        const correlation = flightState.correlation;
        const windowCount = flightState.windowCount;
        if (!crossOutputTransferSupported(this.env)) {
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        if (planned.baseRevision === null) {
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        if (!isUniqueOwner(this.pinnedOwner)) {
            this.failFlight(flightState, "owner-loss");
            return;
        }
        if (flightState.correlation !== planned.correlationId) {
            this.failFlight(flightState, "correlation-mismatch");
            return;
        }
        if (!this.inFlight || this.pending !== flightState || flightState.plannerSession !== this.plannerSession) {
            this.failFlight(flightState, "stale-scope");
            return;
        }
        const baseRevision = planned.baseRevision;
        const byRef = new Map<string, object>();
        for (const entry of current.windows) {
            byRef.set(entry.id, entry.ref);
        }
        let moverEntry: PlanObservedWindow | undefined;
        for (const entry of current.windows) {
            if (entry.id === operation.window) {
                moverEntry = entry;
                break;
            }
        }
        if (
            moverEntry === undefined ||
            moverEntry.output !== operation.sourceOutput ||
            moverEntry.workspace !== operation.sourceWorkspace ||
            moverEntry.output !== source.output ||
            moverEntry.workspace !== source.workspace ||
            moverEntry.fullscreen ||
            moverEntry.maximized ||
            moverEntry.floating === true ||
            moverEntry.sticky === true
        ) {
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        const moverRef = moverEntry.ref;
        let targetOutputRef: object | null = null;
        let targetDesktopRef: object | null = null;
        try {
            targetOutputRef = this.env.resolveOutput?.(target.output) ?? null;
        } catch (error) {
            void error;
            targetOutputRef = null;
        }
        try {
            targetDesktopRef = this.env.resolveDesktop?.(target.workspace) ?? null;
        } catch (error) {
            void error;
            targetDesktopRef = null;
        }
        if (targetOutputRef === null || targetDesktopRef === null) {
            this.failFlight(flightState, "stale-scope");
            return;
        }
        const flight = this.activeToken;
        const session = this.plannerSession;
        const r4: R4Flight = {
            flight,
            session,
            correlation,
            baseRevision,
            epoch: this.epoch,
            op: flightState.op,
            snapshot: flightState.snapshot,
            planned,
            moverId: operation.window,
            moverRef,
            targetOutput: target.output,
            targetWorkspace: target.workspace,
            targetOutputRef,
            targetDesktopRef,
            byRef,
            direction: flightState.direction as PlanDirection,
            followed: false,
            detaches: [],
            settled: false,
        };
        this.r4Flight = r4;
        this.diag(flightState.op, correlation, windowCount, "r4-transfer-started");
        if (!this.armR4ArrivalSignals(r4, flight, session)) {
            this.r4SettleTerminal(r4, "write-failed");
            return;
        }
        try {
            const cancel = this.env.scheduleOnce(PLAN_TIMEOUT_MS, () => this.onR4ArrivalTimeout(flight, session));
            this.r4ArrivalTimer = cancel;
        } catch (error) {
            void error;
            this.r4SettleTerminal(r4, "timer-failed");
            return;
        }
        this.r4WriteDepth += 1;
        try {
            if (!this.r4FlightFencesHold(flightState, flight, session, r4)) {
                const fenced = !isUniqueOwner(this.pinnedOwner) || !isGeneration(this.generation) ? "owner-loss" : "stale-scope";
                this.r4SettleTerminal(r4, fenced);
                return;
            }
            if (!this.r4FreshScopeAllowsMover(flightState, operation.window, source, target, false)) {
                this.r4SettleTerminal(r4, "stale-scope");
                return;
            }
            let transferred = false;
            try {
                transferred = this.env.sendClientToScreen?.(moverRef, targetOutputRef) === true;
            } catch (error) {
                void error;
                transferred = false;
            }
            if (!transferred) {
                this.r4SettleTerminal(r4, "write-failed");
                return;
            }
            if (!this.r4FlightFencesHold(flightState, flight, session, r4)) {
                const fenced = !isUniqueOwner(this.pinnedOwner) || !isGeneration(this.generation) ? "owner-loss" : "stale-scope";
                this.r4SettleTerminal(r4, fenced);
                return;
            }
            if (!this.r4FreshScopeAllowsMover(flightState, operation.window, source, target, false)) {
                this.r4SettleTerminal(r4, "stale-scope");
                return;
            }
            let membershipWritten = false;
            try {
                membershipWritten = this.env.setDesktops?.(moverRef, [targetDesktopRef]) === true;
            } catch (error) {
                void error;
                membershipWritten = false;
            }
            if (!membershipWritten) {
                this.r4SettleTerminal(r4, "write-failed");
                return;
            }
            const oldById = new Map<string, PlanRect>();
            for (const entry of current.windows) {
                oldById.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
            }
            const ordered = orderGeometryWrites(oldById, planned.geometry.filter((entry) => !entry.overconstrained));
            for (const entry of ordered) {
                if (!this.r4FlightFencesHold(flightState, flight, session, r4)) {
                    const fenced = !isUniqueOwner(this.pinnedOwner) || !isGeneration(this.generation) ? "owner-loss" : "stale-scope";
                    this.r4SettleTerminal(r4, fenced);
                    return;
                }
                if (!this.r4FreshScopeAllowsMover(flightState, operation.window, source, target, false)) {
                    this.r4SettleTerminal(r4, "stale-scope");
                    return;
                }
                const ref = byRef.get(entry.window);
                if (ref === undefined) {
                    this.r4SettleTerminal(r4, "write-failed");
                    return;
                }
                let written = false;
                try {
                    written = this.env.setGeometry(ref, entry.rect) === true;
                } catch (error) {
                    void error;
                    written = false;
                }
                const resourceClass = this.r4ResourceClass(current, entry.window);
                if (!written) {
                    this.writeDiag(entry.window, resourceClass, "write-failed", entry.rect);
                    this.r4SettleTerminal(r4, "write-failed");
                    return;
                }
                this.writeDiag(entry.window, resourceClass, "written", entry.rect);
            }
            for (const entry of planned.geometry) {
                if (entry.overconstrained) {
                    const resourceClass = this.r4ResourceClass(current, entry.window);
                    this.writeDiag(entry.window, resourceClass, "skip-overconstrained", entry.rect);
                }
            }
            if (planned.geometry.some((entry) => entry.overconstrained)) {
                this.logToken(`${LOG_PREFIX}:overconstrained-skipped correlation=${correlation} op=${flightState.op}`);
            }
        } finally {
            this.r4WriteDepth = Math.max(0, this.r4WriteDepth - 1);
        }
        this.diag(flightState.op, correlation, windowCount, "r4-native-written");
        if (this.checkR4Arrived(r4)) {
            this.followR4Once(r4);
            if (this.r4Current() === r4 && !r4.settled) {
                this.diag(flightState.op, correlation, windowCount, "r4-arrival-waiting");
            }
            return;
        }
        const placement = this.r4PlacementDetail(r4);
        if (placement === "wrong-target" || placement === "unreadable") {
            this.r4SettleTerminal(r4, placement === "wrong-target" ? "wrong-output" : "stale-scope");
            return;
        }
        this.diag(flightState.op, correlation, windowCount, "r4-arrival-waiting");
    }

    private writeGeometries(
        planned: PlannedReply,
        flightState: PendingFlight,
        current: PlanObserved,
    ): void {
        // Production cross-output routes: fenced before any native write.
        if (flightState.op === "focus" && this.isCrossFocus(planned, flightState)) {
            this.lifecycleDiag(flightState, "apply", "apply", "started", "-", this.ordinaryRevision(planned, flightState));
            this.applyCrossFocus(planned, flightState, current);
            return;
        }
        // Production R4 cross-output move: immediate commit on the `planned`
        // reply. Native transfer, membership, and geometry complete it
        // synchronously; the shared single-flight stays held throughout with
        // no replay. Ordinary lifecycle stays silent here: R4 owns its
        // transfer diagnostics.
        if (flightState.op === "move" && this.isCrossMove(planned, flightState)) {
            this.beginR4Transfer(planned, flightState, current);
            return;
        }
        this.lifecycleDiag(flightState, "apply", "apply", "started", "-", this.ordinaryRevision(planned, flightState));
        // A cross operation on a same-domain plan, or a cross-domain plan
        // without its exact operation, never actuates: fail closed before
        // any write. No looser alternate plan is accepted for either op:
        // on a two-domain flight a local plan keeps focus in the source
        // with no operation, and only isCrossFocus may target the adjacent
        // domain.
        if (flightState.op === "focus" || flightState.op === "move") {
            const domains = flightState.snapshot.domains;
            if (domains !== undefined && domains.length === 2) {
                const source = domains[0] as PlanDomain;
                const focusOnSource =
                    planned.focus !== null &&
                    planned.focus.domainOutput === source.output &&
                    planned.focus.domainWorkspace === source.workspace;
                if (!(focusOnSource && planned.operation === null)) {
                    this.ordinaryTerminal(flightState, planned, "uncertain", "apply");
                    this.failFlight(flightState, "precondition-mismatch");
                    return;
                }
            } else if (planned.operation !== null) {
                this.ordinaryTerminal(flightState, planned, "uncertain", "apply");
                this.failFlight(flightState, "precondition-mismatch");
                return;
            }
        }
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
        // AR12: planner-directed skips. Overconstrained members are never
        // reasserted on any op; client-clamped members are honored only on
        // reconcile/update-gaps (the only paths that set the flag). Honored
        // members leave the observed rectangle alone and keep the retained
        // desired rectangle as authoritative truth. Park accounting for a
        // fully explained reconcile apply resets below; a mixed apply that
        // also reasserts genuine drift keeps the bounded increment.
        const overconstrainedById = new Set<string>();
        const clampedById = new Set<string>();
        for (const entry of planned.geometry) {
            if (entry.overconstrained) {
                overconstrainedById.add(entry.window);
            } else if (entry.clientClamped) {
                clampedById.add(entry.window);
            }
        }
        const honorClamp = flightState.op === "reconcile" || flightState.op === "update-gaps";
        let honoredAr12Skips = 0;
        for (const entry of planned.geometry) {
            if (overconstrainedById.has(entry.window)) {
                honoredAr12Skips += 1;
            } else if (honorClamp && clampedById.has(entry.window)) {
                honoredAr12Skips += 1;
            }
        }
        const writable = planned.geometry.filter(
            (entry) => !overconstrainedById.has(entry.window) && !(honorClamp && clampedById.has(entry.window)),
        );
        const ordered = orderGeometryWrites(oldById, writable);
        const orderedById = new Set<string>();
        for (const entry of ordered) {
            orderedById.add(entry.window);
        }
        // Genuine reasserts pending on this apply: ordered members that are
        // not overlay-skipped. A mixed reconcile (one accepted clamp plus
        // one genuine drift) still performs a genuine write, so it must
        // still advance bounded reassertion attempts below; only a fully explained
        // apply (every drift covered by an honored AR12 skip) converges.
        let pendingWrites = 0;
        for (const entry of ordered) {
            if (
                fullscreenById.has(entry.window) ||
                maximizedById.has(entry.window) ||
                (floatingById.has(entry.window) && flightState.floatTarget?.window !== entry.window)
            ) {
                continue;
            }
            pendingWrites += 1;
        }
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
            // precedence over equality. AR12 planner-directed skips
            // (overconstrained, honored client clamp) take precedence over
            // equality and carry their own default-visible correlated line.
            for (const entry of planned.geometry) {
                if (fullscreenById.has(entry.window)) {
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "skip-fullscreen", entry.rect);
                } else if (maximizedById.has(entry.window)) {
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "skip-maximized", entry.rect);
                } else if (floatingById.has(entry.window) && flightState.floatTarget?.window !== entry.window) {
                    this.writeDiag(entry.window, resourceClassById.get(entry.window) ?? "unknown", "skip-floating", entry.rect);
                } else if (overconstrainedById.has(entry.window)) {
                    const resourceClass = resourceClassById.get(entry.window) ?? "unknown";
                    this.writeDiag(entry.window, resourceClass, "skip-overconstrained", entry.rect);
                    this.logToken(`${LOG_PREFIX}:overconstrained-skipped correlation=${flightState.correlation} window=${entry.window} resource_class=${resourceClass} op=${flightState.op}`);
                } else if (honorClamp && clampedById.has(entry.window)) {
                    const resourceClass = resourceClassById.get(entry.window) ?? "unknown";
                    this.writeDiag(entry.window, resourceClass, "skip-clamped", entry.rect);
                    this.logToken(`${LOG_PREFIX}:clamp-accepted correlation=${flightState.correlation} window=${entry.window} resource_class=${resourceClass} op=${flightState.op}`);
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
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "precondition-mismatch", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "precondition-mismatch");
                    return;
                }
                const resourceClass = resourceClassById.get(entry.window) ?? "unknown";
                const traceNativeConstraints =
                    flightState.op !== "pointer-resize" &&
                    KWIN_TRACE_ENABLED &&
                    typeof this.env.readWindowConstraints === "function";
                if (traceNativeConstraints) {
                    this.traceConstraints(
                        flightState.correlation,
                        "plan",
                        entry.window,
                        entry.output,
                        resourceClass,
                        target,
                        this.workAreaFor(flightState.snapshot, entry.output, entry.workspace),
                        entry.rect,
                        oldById.get(entry.window) ?? null,
                    );
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
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                this.writeDiag(entry.window, resourceClass, "written", entry.rect);
                if (traceNativeConstraints) {
                    this.constraintTracePending.set(entry.window, {
                        correlation: flightState.correlation,
                        resourceClass,
                        requested: entry.rect,
                    });
                    this.traceConstraints(
                        flightState.correlation,
                        "write",
                        entry.window,
                        entry.output,
                        resourceClass,
                        target,
                        this.workAreaFor(flightState.snapshot, entry.output, entry.workspace),
                        entry.rect,
                        null,
                    );
                }
            }
            const transition = flightState.floatTarget;
            if (transition !== null && transition.floating) {
                const floatGeometry = planned.floatGeometry;
                const target = byRef.get(transition.window);
                if (floatGeometry === null || target === undefined) {
                    this.writeDiag(transition.window, resourceClassById.get(transition.window) ?? "unknown", "float-write-failed", floatGeometry?.rect ?? { x: 0, y: 0, w: 1, h: 1 });
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                if (!this.ensureKeepAbove(target, transition.window, resourceClassById.get(transition.window) ?? "unknown")) {
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                let written = false;
                try {
                    written = this.env.setGeometry(target, floatGeometry.rect) === true;
                } catch (error) {
                    void error;
                    written = false;
                }
                if (!written) {
                    this.restoreKeepAbove(transition.window, resourceClassById.get(transition.window) ?? "unknown");
                    this.writeDiag(transition.window, resourceClassById.get(transition.window) ?? "unknown", "float-write-failed", floatGeometry.rect);
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                this.writeDiag(transition.window, resourceClassById.get(transition.window) ?? "unknown", "float-written", floatGeometry.rect);
                try {
                    this.env.setFloating?.(transition.window, true);
                } catch (error) {
                    void error;
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
            } else if (transition !== null) {
                if (!this.restoreKeepAbove(transition.window, resourceClassById.get(transition.window) ?? "unknown")) {
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                try {
                    this.env.setFloating?.(transition.window, false);
                } catch (error) {
                    void error;
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
            }
            const sticky = flightState.stickyTarget;
            if (sticky !== null) {
                const target = current.windows.find((entry) => entry.id === sticky.window);
                if (target === undefined) {
                    this.ordinaryTerminal(flightState, planned, "uncertain", "apply");
                    this.failFlight(flightState, "precondition-mismatch");
                    return;
                }
                this.issueSticky(target, true, sticky.previousFloating);
            }
            // Toggle-float flights never actuate Rust desired_focus: it is
            // tiled survivor bookkeeping and would activate a sibling. Retain
            // the exact toggled window instead, from the fresh observation
            // only. Stale ids fail closed; a failed native write fails the
            // flight. No timer, retry, desktop switch, or later focus write.
            const floatTransition = flightState.floatTarget;
            if (floatTransition !== null) {
                const floatRef = byRef.get(floatTransition.window);
                if (floatRef === undefined) {
                    this.logToken(`${LOG_PREFIX}:float-focus-stale window=${floatTransition.window} resource_class=${resourceClassById.get(floatTransition.window) ?? "unknown"}`);
                    this.lifecycleDiag(flightState, "observe", "observe", "mismatched", "stale-scope", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "observe");
                    this.failFlight(flightState, "stale-scope");
                    return;
                }
                if (!this.retainFloatFocus(floatTransition.window, floatRef, resourceClassById.get(floatTransition.window) ?? "unknown")) {
                    this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                    this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                    this.failFlight(flightState, "write-failed");
                    return;
                }
            }
        }
        const focus = planned.focus;
        // Hidden-domain flights never route focus: the anchor focusedId is a
        // structural placeholder, and applying it would steal native focus and
        // switch desktop visibility. Toggle-float flights retain the exact
        // toggled window above and never actuate survivor bookkeeping focus.
        if (focus !== null && flightState.background !== true && flightState.op !== "toggle-float") {
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
                            this.lifecycleDiag(flightState, "apply", "setters", "write-failed", "write-failed", this.ordinaryRevision(planned, flightState));
                            this.ordinaryTerminal(flightState, planned, "uncertain", "setters");
                            this.failFlight(flightState, "write-failed");
                            return;
                        }
                    }
                }
            }
        }
        // Whether a foreground auto reconcile changed tiled membership or
        // floating/sticky flags versus before-apply per-id evidence
        // (computed inside the geometry branch below, consumed by the
        // highlight edge after it).
        let autoMembershipChanged = false;
        // Before-write per-id evidence presence for the flight domain, read
        // before appliedById advances below. Fresh seeds with no evidence
        // yet converge like the retired admit/remove.
        let hasAppliedBefore = false;
        if (flightState.op !== "focus") {
            const base = this.carriedSnapshot(current);
            // A local reply to a directional two-domain request only owns the
            // source domain. Retaining the untouched target here would later
            // synthesize its removal under the source bounds.
            const localDirectional =
                flightState.op === "move" &&
                flightState.snapshot.domains !== undefined &&
                flightState.snapshot.domains.length === 2 &&
                planned.operation === null;
            const { domains: _domains, ...sourceBase } = base;
            const retainedBase = localDirectional
                ? {
                      ...sourceBase,
                      windows: Object.freeze(
                          base.windows.filter(
                              (entry) =>
                                  entry.output === flightState.snapshot.domainOutput &&
                                  entry.workspace === flightState.snapshot.domainWorkspace,
                          ),
                      ),
                  }
                : base;
            const rectById = new Map<string, PlanRect>();
            for (const entry of planned.geometry) {
                rectById.set(entry.window, entry.rect);
            }
            // Auto-reconcile membership edge, read before applied evidence
            // advances below: a reconcile that changed tiled membership or
            // floating/sticky flags versus before-apply per-id evidence on
            // the same domain (including fresh seeds with no evidence yet)
            // converges like the retired admit/remove. Foreground uses it
            // for the highlight refresh and counter reset below; background
            // uses it to keep membership convergence out of the bounded
            // drift count. Equal reflows stay quiet and keep existing
            // accounting. Never baseline authority.
            hasAppliedBefore = this.hasAppliedEvidenceFor(flightState.snapshot);
            if (flightState.op === "reconcile" && this.appliedMembershipOrFlagsChanged(flightState.snapshot)) {
                autoMembershipChanged = true;
            }
            const windows = retainedBase.windows.map((entry) => {
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
            // A committed remove that empties the domain retires its applied
            // evidence and all background accounting at the same applied
            // boundary so the slot is released. Zero-window scope is never
            // retained.
            if (flightState.op === "remove" && windows.length === 0) {
                const emptyKey = this.domainKey(base);
                this.appliedScopeByDomain.delete(emptyKey);
                // Global initial-fullscreen markers retained: a per-domain
                // remove-empty cannot prove cross-domain absence; relocation
                // survivors keep markers. Explicit-removed below, the exact
                // native removal signal, and full resets remain true-gone
                // cleanup.
                for (const [id, evidence] of [...this.appliedById]) {
                    if (evidence.output === base.domainOutput && evidence.workspace === base.domainWorkspace) {
                        this.appliedById.delete(id);
                    }
                }
                if (flightState.background === true) {
                    this.clearBackgroundReconcile(base);
                }
                if (flightState.removed !== null) {
                    this.maximizeAdmissionAttempts.delete(flightState.removed);
                    this.keepAbovePrevious.delete(flightState.removed);
                    this.stickyPreviousFloating.delete(flightState.removed);
                    this.adoptedSticky.delete(flightState.removed);
                    this.heldInitialFullscreen.delete(flightState.removed);
                    this.seenNonFullscreen.delete(flightState.removed);
                    try {
                        this.env.noteRemoved?.(flightState.removed);
                    } catch (error) {
                        void error;
                    }
                }
            } else {
                const scopeKey = this.domainKey(retainedBase);
                if (windows.length === 0) {
                    this.appliedScopeByDomain.delete(scopeKey);
                } else {
                    this.appliedScopeByDomain.set(scopeKey, {
                        bounds: {
                            x: retainedBase.domainBounds.x,
                            y: retainedBase.domainBounds.y,
                            w: retainedBase.domainBounds.w,
                            h: retainedBase.domainBounds.h,
                        },
                        gap: retainedBase.domainGap,
                        outerGap: retainedBase.domainOuterGap,
                    });
                }
                const live = new Set<string>();
                for (const entry of windows) {
                    live.add(entry.id);
                    const source = retainedBase.windows.find((candidate) => candidate.id === entry.id);
                    this.appliedById.set(entry.id, {
                        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
                        output: entry.output,
                        workspace: entry.workspace,
                        floating: entry.floating === true,
                        sticky: source?.sticky === true,
                        fullscreen: entry.fullscreen,
                        maximized: entry.maximized,
                    });
                }
                for (const [id, evidence] of [...this.appliedById]) {
                    if (
                        evidence.output === retainedBase.domainOutput &&
                        evidence.workspace === retainedBase.domainWorkspace &&
                        !live.has(id)
                    ) {
                        // Per-domain prune retires applied evidence only;
                        // global markers retained for possible cross-domain
                        // survivors (see above).
                        this.appliedById.delete(id);
                    }
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
                    if (flightState.workAreaReprojection === true) {
                        this.clearBackgroundReconcile(flightState.snapshot);
                    } else if (autoMembershipChanged) {
                        // A membership/flag-changing hidden reconcile applies
                        // like the retired admit/remove: converge, never count.
                        this.clearBackgroundReconcile(flightState.snapshot);
                    } else if (honoredAr12Skips > 0 && pendingWrites === 0) {
                        // Fully explained drift converges: every difference
                        // was covered by a honored client-clamped or
                        // overconstrained skip, so no genuine reassert ran
                        // and background acceptance must not advance.
                        this.clearBackgroundReconcile(flightState.snapshot);
                    } else {
                        this.noteBackgroundTerminal(flightState.snapshot);
                    }
                } else if (honoredAr12Skips > 0 && pendingWrites === 0) {
                    // Fully explained drift converges: every difference was
                    // covered by an honored client-clamped or overconstrained
                    // skip, so no genuine reassert ran and acceptance must not
                    // advance. A mixed apply that also wrote genuine drift
                    // keeps the existing bounded increment below.
                    this.reconcileAttempts = 0;
                } else if (!hasAppliedBefore || autoMembershipChanged) {
                    // A membership/flag-changing auto reconcile applies like
                    // the retired admit/remove: converge, never accept.
                    this.reconcileAttempts = 0;
                } else {
                    this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
                }
            } else if (flightState.background === true) {
                this.clearBackgroundReconcile(flightState.snapshot);
            } else {
                this.reconcileAttempts = 0;
            }
        } else {
            this.reconcileAttempts = 0;
        }
        if (isUniqueOwner(this.pinnedOwner)) {
            this.knownOwner = this.pinnedOwner;
        }
        if (flightState.op !== "focus") {
            const skips = new Set<string>();
            for (const entry of planned.geometry) {
                if (fullscreenById.has(entry.window)) {
                    skips.add("skipped-fullscreen");
                } else if (maximizedById.has(entry.window)) {
                    skips.add("skipped-maximized");
                } else if (floatingById.has(entry.window) && flightState.floatTarget?.window !== entry.window) {
                    skips.add("skipped-floating");
                } else if (overconstrainedById.has(entry.window)) {
                    skips.add("skipped-overconstrained");
                } else if (honorClamp && clampedById.has(entry.window)) {
                    skips.add("skipped-clamped");
                } else if (!orderedById.has(entry.window)) {
                    skips.add("skipped-equal");
                }
            }
            this.lifecycleDiag(flightState, "apply", "setters", "applied", this.skipSummary(skips), this.ordinaryRevision(planned, flightState));
            this.ordinaryTerminal(flightState, planned, "applied", "setters");
        } else {
            this.ordinaryTerminal(flightState, planned, "applied", "apply");
        }
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.diag(flightState.op, flightState.correlation, flightState.windowCount, "planned-applied");
        // Marker satisfaction through actual application only: the first
        // subsequent plan that applies this domain's full geometry clears
        // the marker with one terminal per drag naming this plan.
        this.satisfyDragRestore(flightState, planned, current);
        // Exactly one observational active-group refresh after an actual
        // successful geometry-plan boundary, even when focus is unchanged.
        // Geometry writes emit no highlight signal, so without this edge the
        // entry-owned highlight would stay stale. Admit/move/remove/resize
        // qualify, plus a foreground auto reconcile that changed tiled
        // membership or floating/sticky flags; focus, equal-reflow
        // reconcile, pointer-resize, and toggle-float never refresh here
        // (focus already re-queries via its signal). Stale, rejected, error,
        // and unfinished boundaries return through failFlight or earlier
        // exits and never reach this edge. The callback is best-effort and
        // non-blocking: it must not delay the deferred foreground command
        // below.
        if (
            flightState.background !== true &&
            (flightState.op === "admit" ||
                flightState.op === "move" ||
                flightState.op === "remove" ||
                flightState.op === "resize" ||
                (flightState.op === "reconcile" && autoMembershipChanged))
        ) {
            try {
                this.env.onPlannedApplied?.(flightState.op);
            } catch (error) {
                void error;
            }
        }
        this.finishFlight();
    }

    // Lean R4 helpers: one-shot arrival signals, fresh exact mover proof,
    // single follow, and forced source+target settlement. No geometry echo,
    // no ack/verify/cancel/status wire protocol, no settlement timers beyond
    // the bounded arrival deadline.
    private r4ResourceClass(current: PlanObserved, windowId: string): string {
        for (const entry of current.windows) {
            if (entry.id === windowId) {
                return isOpaqueId(entry.resourceClass) ? entry.resourceClass : "unknown";
            }
        }
        return "unknown";
    }

    private r4Current(): R4Flight | null {
        const r4 = this.r4Flight;
        if (r4 === null || r4.settled || !this.inFlight || r4.flight !== this.activeToken || r4.session !== this.plannerSession) {
            return null;
        }
        return r4;
    }

    // Per-setter flight fences: pinned owner/generation plus flight/session/
    // epoch/correlation identity. Called before every native setter because a
    // synchronous setter effect or an intervening signal may have released or
    // superseded the flight mid-stack.
    private r4FlightFencesHold(flightState: PendingFlight, flight: number, session: number, r4: R4Flight): boolean {
        if (!isUniqueOwner(this.pinnedOwner)) {
            return false;
        }
        if (!isGeneration(this.generation)) {
            return false;
        }
        if (!this.inFlight || this.pending !== flightState) {
            return false;
        }
        if (flight !== this.activeToken || session !== this.plannerSession) {
            return false;
        }
        if (flightState.plannerSession !== this.plannerSession) {
            return false;
        }
        if (flightState.epoch !== this.epoch) {
            return false;
        }
        if (flightState.correlation !== r4.correlation) {
            return false;
        }
        if (this.r4Current() !== r4 || r4.settled) {
            return false;
        }
        return true;
    }

    // Raw directional re-observation for R4 mid-write/follow fences: bypasses
    // dispatch-time validation (focused-in-source, homing, fingerprint,
    // revalidate) because the intended mover relocation itself breaks those
    // gates (half placement is unhomed, target placement moves focus). Only
    // structural identity is enforced by callers.
    private r4RawFresh(direction: PlanDirection): PlanObserved | null {
        const hook = this.env.observeDirectional;
        if (typeof hook !== "function") {
            return null;
        }
        let raw: DirectionalObservation | PlanObserved | null = null;
        try {
            raw = hook(direction);
        } catch (error) {
            void error;
            return null;
        }
        if (raw === null || raw === undefined) {
            return null;
        }
        if (typeof raw === "object" && "status" in raw) {
            const outcome = raw as DirectionalObservation;
            if (outcome.status !== "ready" || outcome.observed === null || outcome.observed === undefined) {
                return null;
            }
            return outcome.observed;
        }
        const candidate = raw as PlanObserved;
        if (candidate.windows === undefined || candidate.domains === undefined) {
            return null;
        }
        return candidate;
    }

    // Structural scope fence for R4 writes: exact domain/scope identity plus
    // window-set identity, ignoring rects, fingerprint, and focus. Tolerates
    // the intended mover relocation while rejecting unrelated stale changes:
    // - writes (`requireTarget` false): mover output/workspace may each be
    //   source or target (source, half, or target placement).
    // - follow (`requireTarget` true): mover must sit exactly on the target.
    // Non-mover windows must retain exact output/workspace plus observed
    // native flags (fullscreen/maximized/floating/sticky) against the dispatch
    // snapshot. Missing mover, extra/missing ids, changed domains, changed
    // non-mover flags, or an exceptional mover all fail.
    private r4FreshScopeAllowsMover(
        flightState: PendingFlight,
        moverId: string,
        source: PlanDomain,
        target: PlanDomain,
        requireTarget: boolean,
    ): boolean {
        const direction = flightState.direction;
        if (direction !== "left" && direction !== "right") {
            return false;
        }
        const fresh = this.r4RawFresh(direction);
        if (fresh === null) {
            return false;
        }
        const flightSnapshot = flightState.snapshot;
        if (!domainsEqual(fresh.domains, flightSnapshot.domains)) {
            return false;
        }
        if (
            fresh.domainOutput !== flightSnapshot.domainOutput ||
            fresh.domainWorkspace !== flightSnapshot.domainWorkspace ||
            fresh.domainBounds.x !== flightSnapshot.domainBounds.x ||
            fresh.domainBounds.y !== flightSnapshot.domainBounds.y ||
            fresh.domainBounds.w !== flightSnapshot.domainBounds.w ||
            fresh.domainBounds.h !== flightSnapshot.domainBounds.h ||
            fresh.domainGap !== flightSnapshot.domainGap ||
            fresh.domainOuterGap !== flightSnapshot.domainOuterGap
        ) {
            return false;
        }
        if (fresh.windows.length !== flightSnapshot.windows.length) {
            return false;
        }
        const flightById = new Map<string, PlanSnapshotWindow>();
        for (const entry of flightSnapshot.windows) {
            flightById.set(entry.id, entry);
        }
        let moverFound = false;
        for (const entry of fresh.windows) {
            const expected = flightById.get(entry.id);
            if (expected === undefined) {
                return false;
            }
            if (entry.id === moverId) {
                moverFound = true;
                if (entry.fullscreen || entry.maximized || entry.floating === true || entry.sticky === true) {
                    return false;
                }
                if (requireTarget) {
                    if (entry.output !== target.output || entry.workspace !== target.workspace) {
                        return false;
                    }
                } else {
                    const outputInScope = entry.output === source.output || entry.output === target.output;
                    const workspaceInScope = entry.workspace === source.workspace || entry.workspace === target.workspace;
                    if (!outputInScope || !workspaceInScope) {
                        return false;
                    }
                }
            } else {
                if (entry.output !== expected.output || entry.workspace !== expected.workspace) {
                    return false;
                }
                if (
                    entry.fullscreen !== expected.fullscreen ||
                    entry.maximized !== expected.maximized ||
                    (entry.floating === true) !== (expected.floating === true) ||
                    (entry.sticky === true) !== (expected.sticky === true)
                ) {
                    return false;
                }
            }
        }
        return moverFound;
    }

    // Fresh observed mover proof for follow: exact scope identity plus mover
    // absent from source and present on target in a fresh directional
    // observation, with matching ref identity and fresh native placement on
    // the freshly resolved ref. Never trusts the retained moverRef alone.
    // Uses raw re-observation (not dispatch validation) so the intended
    // target arrival passes despite moved focus. Returns false while arrival
    // is still pending so delayed arrival stays waiting; callers must not
    // treat false as terminal.
    private r4ObservedMoverOnTarget(r4: R4Flight): boolean {
        if (r4.direction !== "left" && r4.direction !== "right") {
            return false;
        }
        const fresh = this.r4RawFresh(r4.direction);
        if (fresh === null) {
            return false;
        }
        const flightSnapshot = r4.snapshot;
        const domains = flightSnapshot.domains;
        if (domains === undefined || domains.length !== 2) {
            return false;
        }
        const source = domains[0] as PlanDomain;
        const target = domains[1] as PlanDomain;
        if (target.output !== r4.targetOutput || target.workspace !== r4.targetWorkspace) {
            return false;
        }
        if (!domainsEqual(fresh.domains, flightSnapshot.domains)) {
            return false;
        }
        if (
            fresh.domainOutput !== flightSnapshot.domainOutput ||
            fresh.domainWorkspace !== flightSnapshot.domainWorkspace ||
            fresh.domainBounds.x !== flightSnapshot.domainBounds.x ||
            fresh.domainBounds.y !== flightSnapshot.domainBounds.y ||
            fresh.domainBounds.w !== flightSnapshot.domainBounds.w ||
            fresh.domainBounds.h !== flightSnapshot.domainBounds.h ||
            fresh.domainGap !== flightSnapshot.domainGap ||
            fresh.domainOuterGap !== flightSnapshot.domainOuterGap
        ) {
            return false;
        }
        if (fresh.windows.length !== flightSnapshot.windows.length) {
            return false;
        }
        const flightById = new Map<string, PlanSnapshotWindow>();
        for (const entry of flightSnapshot.windows) {
            flightById.set(entry.id, entry);
        }
        let moverRef: object | null = null;
        for (const entry of fresh.windows) {
            const expected = flightById.get(entry.id);
            if (expected === undefined) {
                return false;
            }
            if (entry.id === r4.moverId) {
                if (entry.output !== target.output || entry.workspace !== target.workspace) {
                    return false;
                }
                if (entry.fullscreen || entry.maximized || entry.floating === true || entry.sticky === true) {
                    return false;
                }
                moverRef = entry.ref;
            } else {
                if (entry.output !== expected.output || entry.workspace !== expected.workspace) {
                    return false;
                }
                if (
                    entry.fullscreen !== expected.fullscreen ||
                    entry.maximized !== expected.maximized ||
                    (entry.floating === true) !== (expected.floating === true) ||
                    (entry.sticky === true) !== (expected.sticky === true)
                ) {
                    return false;
                }
            }
        }
        if (moverRef === null || moverRef !== r4.moverRef) {
            return false;
        }
        let output: string | null = null;
        try {
            output = this.env.readOutputName?.(moverRef) ?? null;
        } catch (error) {
            void error;
            return false;
        }
        if (output !== r4.targetOutput) {
            return false;
        }
        let ids: ReadonlyArray<string> | null = null;
        try {
            ids = this.env.readDesktopIds?.(moverRef) ?? null;
        } catch (error) {
            void error;
            return false;
        }
        if (ids === null || ids.length !== 1 || ids[0] !== r4.targetWorkspace) {
            return false;
        }
        // Mover absent from source is implied by the single exact target
        // entry above plus unchanged non-mover placements; explicitly guard
        // the source domain identity already pinned in domainsEqual.
        void source;
        return true;
    }

    private r4MoverPlacementMatches(r4: R4Flight): boolean {
        let output: string | null = null;
        try {
            output = this.env.readOutputName?.(r4.moverRef) ?? null;
        } catch (error) {
            void error;
            return false;
        }
        if (output !== r4.targetOutput) {
            return false;
        }
        let ids: ReadonlyArray<string> | null = null;
        try {
            ids = this.env.readDesktopIds?.(r4.moverRef) ?? null;
        } catch (error) {
            void error;
            return false;
        }
        if (ids === null || ids.length !== 1 || ids[0] !== r4.targetWorkspace) {
            return false;
        }
        return true;
    }

    private checkR4Arrived(r4: R4Flight): boolean {
        return this.r4MoverPlacementMatches(r4);
    }

    private r4PlacementDetail(r4: R4Flight): "arrived" | "source" | "half" | "wrong-target" | "unreadable" {
        let output: string | null = null;
        let ids: ReadonlyArray<string> | null = null;
        try {
            output = this.env.readOutputName?.(r4.moverRef) ?? null;
            ids = this.env.readDesktopIds?.(r4.moverRef) ?? null;
        } catch (error) {
            void error;
            return "unreadable";
        }
        if (output === null || ids === null) {
            return "unreadable";
        }
        const domains = r4.snapshot.domains as ReadonlyArray<PlanDomain> | undefined;
        const source = domains !== undefined && domains.length === 2 ? (domains[0] as PlanDomain) : null;
        const outputIsTarget = output === r4.targetOutput;
        const desktopsIsTarget = ids.length === 1 && ids[0] === r4.targetWorkspace;
        if (outputIsTarget && desktopsIsTarget) {
            return "arrived";
        }
        const outputIsSource = source !== null && output === source.output;
        const desktopsIsSource = source !== null && ids.length === 1 && ids[0] === source.workspace;
        if (outputIsSource && desktopsIsSource) {
            return "source";
        }
        if ((outputIsTarget || outputIsSource) && (desktopsIsTarget || desktopsIsSource)) {
            return "half";
        }
        return "wrong-target";
    }

    private armR4ArrivalSignals(r4: R4Flight, flight: number, session: number): boolean {
        try {
            const detachOutput = this.env.subscribeMoverOutput?.(r4.moverRef, () => this.onR4ArrivalSignal(flight, session));
            if (detachOutput === null || detachOutput === undefined || typeof detachOutput !== "function") {
                return false;
            }
            r4.detaches.push(detachOutput);
        } catch (error) {
            void error;
            return false;
        }
        try {
            const detachDesktops = this.env.subscribeMoverDesktops?.(r4.moverRef, () => this.onR4ArrivalSignal(flight, session));
            if (detachDesktops === null || detachDesktops === undefined || typeof detachDesktops !== "function") {
                return false;
            }
            r4.detaches.push(detachDesktops);
        } catch (error) {
            void error;
            return false;
        }
        return true;
    }

    private onR4ArrivalSignal(flight: number, session: number): void {
        if (this.r4WriteDepth > 0) {
            return;
        }
        const r4 = this.r4Current();
        if (r4 === null || flight !== r4.flight || session !== r4.session || r4.settled) {
            return;
        }
        if (this.checkR4Arrived(r4)) {
            this.followR4Once(r4);
            return;
        }
        const placement = this.r4PlacementDetail(r4);
        if (placement === "wrong-target" || placement === "unreadable") {
            this.r4SettleTerminal(r4, placement === "wrong-target" ? "wrong-output" : "stale-scope");
        }
    }

    private followR4Once(r4: R4Flight): void {
        if (r4.followed || r4.settled) {
            return;
        }
        if (!this.checkR4Arrived(r4)) {
            return;
        }
        if (!this.r4ObservedMoverOnTarget(r4)) {
            return;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
            currentActive = null;
        }
        if (currentActive === r4.moverRef) {
            if (!this.checkR4Arrived(r4) || !this.r4ObservedMoverOnTarget(r4)) {
                return;
            }
            r4.followed = true;
            this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-followed");
            this.r4SettleTerminal(r4, "arrived");
            return;
        }
        if (!this.checkR4Arrived(r4)) {
            return;
        }
        if (!this.r4ObservedMoverOnTarget(r4)) {
            return;
        }
        if (!isUniqueOwner(this.pinnedOwner) || !isGeneration(this.generation)) {
            return;
        }
        if (this.r4Current() !== r4 || r4.flight !== this.activeToken || r4.session !== this.plannerSession || r4.epoch !== this.epoch) {
            return;
        }
        let focused = false;
        this.r4WriteDepth += 1;
        try {
            focused = this.env.setActive(r4.moverRef) === true;
        } catch (error) {
            void error;
            focused = false;
        } finally {
            this.r4WriteDepth = Math.max(0, this.r4WriteDepth - 1);
        }
        let after: object | null = null;
        try {
            after = this.env.active();
        } catch (error) {
            void error;
            after = null;
        }
        r4.followed = true;
        if (!focused || after !== r4.moverRef) {
            this.logToken(`${LOG_PREFIX}:r4-follow correlation=${r4.correlation} outcome=focus-unconfirmed`);
            this.r4SettleTerminal(r4, "focus-unconfirmed");
            return;
        }
        this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-followed");
        this.r4SettleTerminal(r4, "arrived");
    }

    private onR4ArrivalTimeout(flight: number, session: number): void {
        const r4 = this.r4Flight;
        if (r4 === null || r4.settled || flight !== r4.flight || session !== r4.session || !this.inFlight) {
            return;
        }
        if (this.checkR4Arrived(r4)) {
            this.followR4Once(r4);
            return;
        }
        this.r4SettleTerminal(r4, "arrival-timeout");
    }

    private r4SettleTerminal(r4: R4Flight, outcome: string): void {
        if (r4.settled) {
            return;
        }
        r4.settled = true;
        const op = r4.op;
        const correlation = r4.correlation;
        const count = r4.planned.geometry.length;
        const sourceTarget = (() => {
            try {
                const domains = r4.snapshot.domains as ReadonlyArray<PlanDomain> | undefined;
                if (domains === undefined || domains.length !== 2) {
                    return null;
                }
                const source = domains[0] as PlanDomain;
                const target = domains[1] as PlanDomain;
                return { source, target };
            } catch (error) {
                void error;
                return null;
            }
        })();
        this.clearR4Flight();
        this.clearR4ArrivalTimer();
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.r4WriteDepth = 0;
        this.diag(op, correlation, count, outcome);
        if (outcome === "arrived") {
            try {
                this.env.onPlannedApplied?.(op);
            } catch (error) {
                void error;
            }
        } else {
            this.noteReconcileTerminal(op);
        }
        if (sourceTarget !== null) {
            try {
                this.notifySendSettled({
                    sourceOutput: sourceTarget.source.output,
                    sourceWorkspace: sourceTarget.source.workspace,
                    targetOutput: sourceTarget.target.output,
                    targetWorkspace: sourceTarget.target.workspace,
                });
            } catch (error) {
                void error;
            }
        } else {
            try {
                this.requestResync();
            } catch (error) {
                void error;
            }
        }
    }

    private clearR4ArrivalTimer(): void {
        const cancel = this.r4ArrivalTimer;
        this.r4ArrivalTimer = null;
        if (cancel !== null) {
            try {
                cancel();
            } catch (error) {
                void error;
            }
        }
    }

    private clearR4Flight(): void {
        const r4 = this.r4Flight;
        this.r4Flight = null;
        if (r4 !== null) {
            for (const detach of r4.detaches) {
                try {
                    detach();
                } catch (error) {
                    void error;
                }
            }
            r4.detaches.length = 0;
        }
    }

    private failFlight(flightState: PendingFlight, outcome: string): void {
        if (flightState.plannerSession !== this.plannerSession) {
            return;
        }
        this.terminateFlight(flightState, outcome);
    }

    // Shared terminal core: exactly the historical failFlight teardown. R4-shape
    // flights additionally force both domains through the settlement chain.
    private terminateFlight(flightState: PendingFlight, outcome: string): void {
        if (flightState.plannerSession !== this.plannerSession) {
            return;
        }
        this.clearR4Flight();
        this.clearTimer();
        this.clearR4ArrivalTimer();
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.diag(flightState.op, flightState.correlation, flightState.windowCount, outcome);
        if (flightState.background === true) {
            this.noteBackgroundTerminal(flightState.snapshot);
        } else {
            this.noteReconcileTerminal(flightState.op, flightState.workAreaReprojection);
        }
        // Drop-intent converge for every terminal failure class, not just
        // Planner rejection (diverged/malformed/stale/timeout/fault): a
        // failed pointer feeds its marker, while a failed marker reconcile
        // gets one terminal per drag naming this plan (no retry).
        const dragPointer = this.dragSourceOf(flightState);
        if (dragPointer !== null) {
            this.noteDragRejected(dragPointer, outcome, flightState.pointerSource, flightState.snapshot.domainOutput, flightState.snapshot.domainWorkspace);
        } else {
            this.failDragRestore(flightState, outcome);
        }
        // Ambiguous terminal failures (timeout already probed via onTimeout;
        // service-fault, correlation mismatch, precondition mismatch, stale
        // scope, write failure, owner loss) may lead to one bounded identity
        // probe. Only absence or changed owner recovers; same owner retains.
        this.maybeProbeAfterTerminal(flightState);
        // R4-shape terminals force complete source AND target reconciliation
        // through the existing single-flight chain, including equal evidence.
        this.forceR4SettleFromPending(flightState);
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
        // Do not let a deferred foreground or hidden-domain command race the
        // one bounded identity check for a terminal Planner transport fault.
        if (this.activeProbe !== 0) {
            return;
        }
        const next = this.deferredAuto;
        this.deferredAuto = null;
        if (next !== null && !this.inFlight) {
            if (
                next.op === "reconcile" &&
                next.background !== true &&
                next.workAreaReprojection !== true &&
                this.interactiveResizeActive()
            ) {
                // Interactive guard drops the deferred intent without
                // touching markers: a deferred drag pointer folded into its
                // marker persists there, and any pending marker dispatches
                // once the slot is free again.
                this.absorbDeferredDragIntent(next, true);
                return;
            }
            this.dispatch(next);
        }
        // Converge one pending restore marker when idle: exactly one
        // existing-route reconcile per marker, unless an applied plan
        // already satisfied it. No retries, no queues, no slot bypass.
        if (!this.inFlight && this.deferredAuto === null && this.r4Flight === null && this.activeProbe === 0) {
            this.maybeDispatchDragRestore();
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

    private clearProbeTimer(): void {
        const cancel = this.probeCancel;
        this.probeCancel = null;
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

    // Normal-level lifecycle context for cancellable R4 flights. Retains the
    // established plan:cmd prefix while making the route independently
    // attributable without payload or trace logging.
    // Normal-level correlated activation transport diagnostics (logging
    // only). One bounded `lifecycleDiag` line per accepted activation
    // boundary: presence lookup response, start request/result, unique-owner
    // resolution/pin, planner request handoff, and activation-phase timeout.
    // Reuses correlation/generation/request-revision plus the shared
    // component/route mapping. Never carries raw owners, services,
    // exceptions, payloads, or native ids. Pre-call records mark initiation;
    // callback records follow flight/token/session/step fencing. Stale, late,
    // or duplicate callbacks return before logging and never look successful.
    // Best effort: logger faults are swallowed and never change control flow.
    private activateDiag(flight: PendingFlight, event: string, outcome: string, cause = "-"): void {
        this.lifecycleDiag(flight, "activate", event, outcome, cause);
    }

    private lifecycleDiag(
        flight: PendingFlight,
        stage: string,
        event: string,
        outcome: string,
        cause: string,
        revision: number | string = flight.requestRevision,
    ): void {
        try {
            const isR4 =
                flight.op === "move" &&
                (flight.direction === "left" || flight.direction === "right") &&
                flight.snapshot.domains !== undefined &&
                flight.snapshot.domains.length === 2;
            const revisionText = typeof revision === "number" ? String(revision) : revision;
            this.env.log(
                `${LOG_PREFIX}:cmd=${flight.correlation} kind=${flight.op} windows=${String(flight.windowCount)} component=${isR4 ? "cosmic-directional" : "cosmic-plan"} route=${isR4 ? "directional-r4" : "plan"} stage=${stage} correlation=${flight.correlation} generation=${this.generation} revision=${revisionText} event=${event} outcome=${sanitizeKind(outcome)} cause=${cause === "-" ? "-" : sanitizeKind(cause)}`,
            );
        } catch (error) {
            void error;
        }
    }

    // Ordinary Plan reply/apply lifecycle (logging only, after Planner send).
    // Truthful revision: the request revision before a planned reply is known;
    // the planned base revision after validation, or the unavailable placeholder
    // when the validated reply omits it. Never carries ids, owners, payloads,
    // geometry, or exceptions. Late/stale/duplicate callbacks return before any
    // line and never look successful. The ordinary route has no ack/verify:
    // only R4 stages those, so no ack/verify lines exist here.
    private ordinaryRevision(planned: PlannedReply | null, flight: PendingFlight): number | string {
        if (planned === null) {
            return flight.requestRevision;
        }
        return planned.baseRevision === null ? "unavailable" : planned.baseRevision;
    }

    private ordinaryTerminal(
        flight: PendingFlight,
        planned: PlannedReply | null,
        outcome: string,
        lastPhase: string,
    ): void {
        this.lifecycleDiag(flight, "terminal", "settled", outcome, lastPhase, this.ordinaryRevision(planned, flight));
    }

    // Bounded aggregate skip summary for one ordinary geometry application.
    // One fixed token, never per-window geometry or ids.
    private skipSummary(kinds: ReadonlySet<string>): string {
        if (kinds.size === 0) {
            return "-";
        }
        if (kinds.size > 1) {
            return "skipped-mixed";
        }
        for (const kind of kinds) {
            return kind;
        }
        return "-";
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

    private workAreaFor(snapshot: PlanSnapshot, output: string, workspace: string): PlanRect | null {
        if (snapshot.domainOutput === output && snapshot.domainWorkspace === workspace) {
            return snapshot.domainBounds;
        }
        return snapshot.domains?.find((domain) => domain.output === output && domain.workspace === workspace)?.bounds ?? null;
    }

    private traceConstraints(
        correlation: string,
        phase: "plan" | "write" | "post-signal",
        window: string,
        output: string,
        resourceClass: string,
        ref: object,
        workArea: PlanRect | null,
        requested: PlanRect | null,
        observed: PlanRect | null,
    ): void {
        if (!KWIN_TRACE_ENABLED || typeof this.env.readWindowConstraints !== "function") {
            return;
        }
        let constraints: PlanWindowConstraints | null = null;
        let actual = observed;
        try {
            constraints = this.env.readWindowConstraints(ref);
        } catch (error) {
            void error;
        }
        try {
            actual = this.env.readGeometry?.(ref) ?? actual;
        } catch (error) {
            void error;
        }
        const size = (value: { readonly w: number; readonly h: number } | null): string =>
            value === null ? "unknown" : `${String(value.w)},${String(value.h)}`;
        const rect = (value: PlanRect | null): string =>
            value === null ? "unknown" : `${String(value.x)},${String(value.y)},${String(value.w)},${String(value.h)}`;
        const resizeable = constraints?.resizeable === true ? "true" : constraints?.resizeable === false ? "false" : "unknown";
        this.logToken(
            `${LOG_PREFIX}:constraint-trace corr=${correlation} phase=${phase} window=${window} output=${output} resource_class=${resourceClass} resizeable=${resizeable} min=${size(constraints?.minSize ?? null)} max=${size(constraints?.maxSize ?? null)} workarea=${rect(workArea)} requested=${rect(requested)} observed=${rect(actual)}`,
        );
    }

    private rejectKind(kind: string, detail: string | null, snapshot: PlanSnapshot | null = null): void {
        try {
            const suffix = kind === "snapshot-invalid" && detail !== null ? ` detail=${detail}` : "";
            if (kind === "snapshot-invalid" && detail === "window-out-of-bounds" && snapshot !== null) {
                const ordinal = snapshot.windows.findIndex((entry) => !entry.floating && !rectContained(entry.rect, this.workAreaFor(snapshot, entry.output, entry.workspace) ?? snapshot.domainBounds));
                if (ordinal !== -1) {
                    const outside = snapshot.windows[ordinal] as PlanSnapshotWindow;
                    const bounds = this.workAreaFor(snapshot, outside.output, outside.workspace) ?? snapshot.domainBounds;
                    this.env.log(
                        `${LOG_PREFIX}:rejected kind=${kind}${suffix} output=${outside.output} ordinal=${String(ordinal)} resource_class=${outside.resourceClass} rect=${String(outside.rect.x)},${String(outside.rect.y)},${String(outside.rect.w)},${String(outside.rect.h)} bounds=${String(bounds.x)},${String(bounds.y)},${String(bounds.w)},${String(bounds.h)}`,
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
}
