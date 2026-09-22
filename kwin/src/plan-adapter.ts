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

// Deliberate gap-update scope: the same logical domain and complete window
// set with a changed inner and/or outer gap. Work-area bounds may or may not
// have changed alongside; the retained route folds both into one projection.
// Membership changes never qualify: admit/remove own those. Gap values here
// only ever change on the deliberate Options `configChanged` reload, so this
// branch cannot fire on ordinary drift.
function sameGapUpdateScope(a: PlanSnapshot, b: PlanSnapshot): boolean {
    if (a.domainGap === b.domainGap && a.domainOuterGap === b.domainOuterGap) {
        return false;
    }
    if (a.domainOutput !== b.domainOutput || a.domainWorkspace !== b.domainWorkspace) {
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
    }
    return true;
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
    // Entry-owned coordination: true while a workspace-send flight is active.
    // While blocked, lifecycle auto intents are dropped (a single normal
    // resync after send completes converges) and foreground commands refuse
    // with the existing busy-refused diagnostic. No queues or coalescing.
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
    if (!Array.isArray(route) || route.length === 0 || route.length > PLAN_MAX_WINDOWS) {
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
    // True when dispatched from confirmed-loss recovery: a terminal failure
    // stays bounded without a second identity probe, so a failed recovery
    // never loops.
    readonly isRecovery: boolean;
}

// Production R4 cross-output move flight: retained after the first R4
// `planned` reply (which stages but never commits) across native transfer,
// accepted ack, and verified verify. Exactly one flight serializes through
// the shared single-flight; while live every other PlanAdapter operation
// refuses busy and no replay ever occurs.
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
    acked: boolean;
    followed: boolean;
    outputSeen: boolean;
    desktopsSeen: boolean;
    geoPending: Set<string>;
    detaches: Array<() => void>;
    settled: boolean;
    // Bounded duplicate-callback fences: the original `planned` reply stays
    // bound to the shared `callbackSeen`, while R4 ack and verify each bind
    // to their own exact flight/session/phase flag. A stale callback with a
    // mismatched flight/session returns before touching the live flags, and
    // a duplicate with matching flight/session is dropped by the consumed
    // flag without restarting native transfer, resetting the timer, or
    // issuing a second verify/settle. Verify additionally requires an issued
    // verify request so an out-of-order verify can never consume the guard.
    ackReplySeen: boolean;
    verifyRequested: boolean;
    verifyReplySeen: boolean;
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
    readonly direction?: PlanDirection | null;
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
    // in-memory Planner survives sleep: same-owner failures retain every
    // baseline and never rebuild. Only actual absence/identity evidence
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
    // Live production R4 flight (planned staged, native/ack/verify pending).
    // While non-null the shared single-flight stays held and every other
    // PlanAdapter operation refuses busy; completion or terminal failure
    // always clears it exactly once with no replay.
    private r4Flight: R4Flight | null = null;

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
        this.lastGoodByDomain.clear();
        this.reconcileAttempts = 0;
        this.parked = false;
        this.backgroundAttempts.clear();
        this.backgroundParked.clear();
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
        this.lastGoodByDomain.clear();
        this.reconcileAttempts = 0;
        this.parked = false;
        this.backgroundAttempts.clear();
        this.backgroundParked.clear();
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
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=focus`);
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
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=resize`);
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
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-float`);
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
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-fullscreen`);
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
        if (this.blockedBySend()) {
            this.logToken(`${LOG_PREFIX}:busy-refused kind=toggle-sticky`);
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
        }
        this.retainStickyFocus(target);
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
        if (this.r4Flight !== null) {
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
        // A final-geometry pointer route is selected ahead of the ordinary
        // finish resync. Do not let that resync restore the old split first.
        this.clearDebounce();
        if (this.deferredAuto?.op === "reconcile" && this.deferredAuto.workAreaReprojection !== true) {
            this.deferredAuto = null;
        }
        this.discardInteractiveReconcile();
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

    setInteractiveResizeActive(active: boolean): void {
        if (active) {
            this.clearDebounce();
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
    }

    private onSignal(kind?: PlanSignal, target?: object): void {
        if (!this.enabled) {
            return;
        }
        // While an R4 flight holds the single-flight across native transfer
        // plus ack/verify, lifecycle signals (including echoes of our own
        // native writes) must not advance epoch or queue auto intents. The
        // R4 fence consumes its own echoes; one resync after R4 settles
        // converges everything else.
        if (this.r4Flight !== null) {
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
        if (this.r4Flight !== null) {
            return;
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
        for (const entry of fresh.windows) {
            const trace = this.constraintTracePending.get(entry.id);
            if (trace === undefined) {
                continue;
            }
            this.constraintTracePending.delete(entry.id);
            if (
                entry.rect.x !== trace.requested.x ||
                entry.rect.y !== trace.requested.y ||
                entry.rect.w !== trace.requested.w ||
                entry.rect.h !== trace.requested.h
            ) {
                this.traceConstraints(
                    trace.correlation,
                    "post-signal",
                    entry.id,
                    freshSnapshot.domainOutput,
                    trace.resourceClass,
                    entry.ref,
                    freshSnapshot.domainBounds,
                    trace.requested,
                    entry.rect,
                );
            }
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
                this.keepAbovePrevious.delete(entry.id);
                this.stickyPreviousFloating.delete(entry.id);
                this.adoptedSticky.delete(entry.id);
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
        // Deliberate gap reload: the same domain and complete window set with
        // a changed inner and/or outer gap reprojection through the retained
        // route, preserving topology, shares, and focus. Bounds may have
        // changed alongside; the retained route folds both into one
        // projection. This never reseeds: a rejected update keeps the old
        // baseline and ordinary drift accounting is untouched.
        if (sameGapUpdateScope(previous, freshSnapshot)) {
            const oldInner = previous.domainGap;
            const oldOuter = previous.domainOuterGap;
            this.logToken(
                `${LOG_PREFIX}:gap-reprojection selected=retained inner=${String(oldInner)}->${String(freshSnapshot.domainGap)} outer=${String(oldOuter)}->${String(freshSnapshot.domainOuterGap)}`,
            );
            this.pointerEcho = null;
            this.deferredAuto = {
                op: "update-gaps",
                snapshot: freshSnapshot,
                removed: null,
                body: { op: "update-gaps" },
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
        if (this.interactiveResizeActive()) {
            if (this.deferredAuto?.op === "reconcile" && this.deferredAuto.workAreaReprojection !== true) {
                this.deferredAuto = null;
            }
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
                this.stickyPreviousFloating.delete(entry.id);
                this.adoptedSticky.delete(entry.id);
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
        // Deliberate gap reload for a background domain: same membership with
        // a changed inner and/or outer gap, converged through the shared
        // single-flight without touching visibility or focus.
        if (sameGapUpdateScope(previous, freshSnapshot)) {
            this.logToken(`${LOG_PREFIX}:gap-reprojection selected=retained`);
            return {
                op: "update-gaps",
                snapshot: freshSnapshot,
                removed: null,
                body: { op: "update-gaps" },
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
        if (!this.enabled || this.inFlight || this.r4Flight !== null) {
            return;
        }
        // A new lifecycle command supersedes an unanswered terminal probe. Its
        // callback must not make a later recovery decision for an older flight.
        this.activeProbe = 0;
        if (this.blockedBySend()) {
            return;
        }
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
            return;
        }
        const correlation = `${this.generation}-p${String(this.seq)}`;
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
            return;
        }
        if (payload.length > PLAN_MAX_REQUEST_BYTES) {
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
            isRecovery,
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
            this.finishFlight();
            return;
        }
        // Phase 1: strict NameHasOwner presence. KWin does not deliver
        // GetNameOwner's absent-name error to callbacks, so presence must be
        // distinguished first. Strict boolean only; anything else is terminal
        // no-planner with no recovery and no retry.
        try {
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
            this.inFlight = false;
            this.pending = null;
            this.activationStep = 0;
            this.diag(intent.op, correlation, sortedIds.length, "dbus-failed");
            if (intent.background === true) {
                this.noteBackgroundTerminal(intent.snapshot);
            } else {
                this.noteReconcileTerminal(intent.op, intent.workAreaReprojection === true);
            }
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
            this.activationStep = 2;
            try {
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
                this.failActivation(flightState, "no-planner");
            }
            return;
        }
        if (reply !== false) {
            this.failActivation(flightState, "no-planner");
            return;
        }
        // Strictly absent name. With a previously pinned owner this is
        // confirmed absence: the old flight is terminal and a fresh session
        // recovery replaces it; the old command is never replayed. Without a
        // prior owner this is initial activation: proceed to one bounded start.
        if (this.knownOwner !== null) {
            const lost = flightState;
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
        this.activationStep = 3;
        try {
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
            this.failActivation(flightState, "no-planner");
            return;
        }
        // A changed unique owner after a previously pinned Planner is
        // confirmed identity evidence: terminal old flight plus fresh-session
        // recovery, never replaying the old command.
        if (this.knownOwner !== null && reply !== this.knownOwner) {
            const lost = flightState;
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
            this.failActivation(flightState, "no-planner");
            return;
        }
        this.activationStep = 4;
        try {
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
            this.failActivation(flightState, "no-planner");
            return;
        }
        this.pinnedOwner = reply;
        if (this.knownOwner === null) {
            this.knownOwner = reply;
        }
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
            this.env.callDbus(
                target,
                PLAN_OBJECT,
                PLAN_INTERFACE,
                PLAN_METHOD,
                flightState.requestPayload,
                (reply) => this.onRequestReply(reply, flight, session),
            );
        } catch (error) {
            void error;
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
        if (this.blockedBySend()) {
            return;
        }
        if (this.knownOwner === null) {
            return;
        }
        // One bounded identity probe only when the flight is otherwise
        // terminal. Timeout, malformed, service fault, missing callback, and
        // correlation mismatch alone never recover; only a probe result
        // proving absence (strict false) or a changed unique owner triggers
        // recovery. No retry, polling, or systemd behavior.
        this.probeToken += 1;
        const probe = this.probeToken;
        this.activeProbe = probe;
        const session = this.plannerSession;
        const expectedOwner = this.knownOwner;
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
            this.activeProbe = 0;
        }
    }

    private onProbePresence(reply: unknown, probe: number, session: number, expectedOwner: string | null): void {
        if (probe !== this.activeProbe || session !== this.plannerSession) {
            return;
        }
        if (this.inFlight || this.blockedBySend()) {
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (reply === false) {
            this.triggerRecovery("absent");
            return;
        }
        if (reply !== true) {
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
            this.activeProbe = 0;
            this.finishFlight();
        }
    }

    private onProbeOwner(reply: unknown, probe: number, session: number, expectedOwner: string | null): void {
        if (probe !== this.activeProbe || session !== this.plannerSession) {
            return;
        }
        if (this.inFlight || this.blockedBySend()) {
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (!isUniqueOwner(reply)) {
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (expectedOwner === null) {
            this.activeProbe = 0;
            this.finishFlight();
            return;
        }
        if (reply !== expectedOwner) {
            this.triggerRecovery("changed");
            return;
        }
        this.activeProbe = 0;
        this.finishFlight();
    }

    private triggerRecovery(reason: string): void {
        if (!this.enabled || this.inFlight || this.r4Flight !== null) {
            return;
        }
        if (this.blockedBySend()) {
            return;
        }
        // Old flight is already terminal here; late old-generation callbacks
        // are fenced by the session bump below. Clear the KWin lifecycle
        // baseline so CURRENT eligible windows form a fresh session through
        // the existing fresh-admit route (Rust near-strip fitting with normal
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
        this.lastGoodByDomain.clear();
        this.reconcileAttempts = 0;
        this.parked = false;
        this.backgroundAttempts.clear();
        this.backgroundParked.clear();
        this.pointerEcho = null;
        this.deferredAuto = null;
        this.logToken(`${LOG_PREFIX}:recovery reason=${reason} outcome=confirmed-loss`);
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
        // The dispatch-phase timer is always cleared before R4 arming; a late
        // fire while R4 holds the flight belongs to the R4 deadline.
        if (this.r4Flight !== null) {
            this.onR4Timeout(flight, session);
            return;
        }
        const lost = this.pending;
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
            this.maybeProbeAfterTerminal(lost);
            this.finishFlight();
            return;
        }
        this.finishFlight();
    }

    private onRequestReply(reply: unknown, flight: number, session: number): void {
        if (!this.inFlight || flight !== this.activeToken || session !== this.plannerSession || this.callbackSeen) {
            return;
        }
        // A live R4 flight owns the single-flight across native/ack/verify.
        // A duplicate `planned` must never restart native transfer, overwrite
        // `r4Flight`, or reset the whole-flight timer.
        if (this.r4Flight !== null) {
            return;
        }
        const flightState = this.pending;
        if (flightState === null || flightState.plannerSession !== session || this.activationStep !== 5) {
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
            if (isUniqueOwner(this.pinnedOwner) && this.knownOwner === null) {
                this.knownOwner = this.pinnedOwner;
            }
            this.inFlight = false;
            this.pending = null;
            this.pinnedOwner = null;
            this.activationStep = 0;
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
            this.failFlight(flightState, "precondition-mismatch");
            return;
        }
        const domains = flightState.snapshot.domains;
        if (domains === undefined || domains.length !== 2) {
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

    // R4 native transfer plus ack/verify. Called once per staged R4 plan with
    // the shared single-flight held: the dispatch timer is already cleared
    // and a fresh whole-flight timer is armed below. Order is fixed:
    // sendClientToScreen with the exact target Output object, mover desktops
    // write with the exact target VirtualDesktop refs, planned geometries in
    // canonical order, then active focus only after all output/membership/
    // geometry readback proves, then accepted ack, then verified verify only
    // after full desired observed proof. Any timeout, stale output/scope,
    // owner loss, wrong output, write failure, or focus failure is terminal:
    // one best-effort adapter-lost ack (when ack is still unbound) or no
    // verify at all, never a replay.
    private beginR4Transfer(
        planned: PlannedReply,
        flightState: PendingFlight,
        current: PlanObserved,
    ): void {
        const operation = planned.operation as PlanMoveOperation;
        const domains = flightState.snapshot.domains as ReadonlyArray<PlanDomain>;
        const target = domains[1] as PlanDomain;
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
        const baseRevision = planned.baseRevision;
        // Resolve every native target from the fresh observation only. The
        // mover must still be homed on the source; exceptional movers never
        // transfer.
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
        // Whole-flight timer spans native transfer plus ack/verify.
        const flight = this.activeToken;
        const session = this.plannerSession;
        try {
            const cancel = this.env.scheduleOnce(PLAN_TIMEOUT_MS, () => this.onR4Timeout(flight, session));
            this.cancelTimer = cancel;
        } catch (error) {
            void error;
            this.failFlight(flightState, "timer-failed");
            return;
        }
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
            acked: false,
            followed: false,
            outputSeen: false,
            desktopsSeen: false,
            geoPending: new Set<string>(),
            detaches: [],
            settled: false,
            ackReplySeen: false,
            verifyRequested: false,
            verifyReplySeen: false,
        };
        this.r4Flight = r4;
        this.diag(flightState.op, correlation, windowCount, "r4-transfer-started");
        // Bounded one-shot fences armed before any native write: mover
        // outputChanged (old value re-read), mover desktopsChanged, and one
        // frameGeometryChanged per window whose rect must change. Unchanged
        // geometry never waits for a signal.
        const changedIds = this.r4ChangedGeometryIds(planned, current);
        let fenceOk = true;
        try {
            const detachOutput = this.env.subscribeMoverOutput?.(moverRef, (old) => this.onR4OutputEcho(old, flight, session));
            if (detachOutput === null || detachOutput === undefined || typeof detachOutput !== "function") {
                fenceOk = false;
            } else {
                r4.detaches.push(detachOutput);
            }
        } catch (error) {
            void error;
            fenceOk = false;
        }
        try {
            const detachDesktops = this.env.subscribeMoverDesktops?.(moverRef, () => this.onR4DesktopsEcho(flight, session));
            if (detachDesktops === null || detachDesktops === undefined || typeof detachDesktops !== "function") {
                fenceOk = false;
            } else {
                r4.detaches.push(detachDesktops);
            }
        } catch (error) {
            void error;
            fenceOk = false;
        }
        if (changedIds.length > 0) {
            for (const id of changedIds) {
                const ref = byRef.get(id);
                if (ref === undefined) {
                    fenceOk = false;
                    break;
                }
                const windowId = id;
                try {
                    const detachGeo = this.env.subscribeWindowGeometry?.(ref, () => this.onR4GeometryEcho(windowId, flight, session));
                    if (detachGeo === null || detachGeo === undefined || typeof detachGeo !== "function") {
                        fenceOk = false;
                        break;
                    }
                    r4.detaches.push(detachGeo);
                    r4.geoPending.add(windowId);
                } catch (error) {
                    void error;
                    fenceOk = false;
                    break;
                }
            }
        }
        if (!fenceOk) {
            this.failR4Terminal("write-failed", true);
            return;
        }
        // Native actuation in plan order: output transfer, desktop
        // membership, then geometries. Any failure is terminal before ack.
        let transferred = false;
        try {
            transferred = this.env.sendClientToScreen?.(moverRef, targetOutputRef) === true;
        } catch (error) {
            void error;
            transferred = false;
        }
        if (!transferred) {
            this.failR4Terminal("write-failed", true);
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
            this.failR4Terminal("write-failed", true);
            return;
        }
        const oldById = new Map<string, PlanRect>();
        for (const entry of current.windows) {
            oldById.set(entry.id, { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h });
        }
        const ordered = orderGeometryWrites(oldById, planned.geometry);
        for (const entry of ordered) {
            const ref = byRef.get(entry.window);
            if (ref === undefined) {
                this.failR4Terminal("write-failed", true);
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
                this.failR4Terminal("write-failed", true);
                return;
            }
            this.writeDiag(entry.window, resourceClass, "written", entry.rect);
        }
        this.diag(flightState.op, correlation, windowCount, "r4-native-written");
        // Synchronous fence callbacks may have consumed every echo while the
        // writes ran. Resume only when all three proofs have initiated.
        this.tryR4MaybeAck(flight, session);
        if (this.r4Flight === r4 && !r4.settled) {
            this.diag(flightState.op, correlation, windowCount, "r4-echo-waiting");
        }
    }

    private writeGeometries(
        planned: PlannedReply,
        flightState: PendingFlight,
        current: PlanObserved,
    ): void {
        // Production cross-output routes: fenced before any native write.
        if (flightState.op === "focus" && this.isCrossFocus(planned, flightState)) {
            this.applyCrossFocus(planned, flightState, current);
            return;
        }
        // Production R4 cross-output move: the first `planned` reply stages
        // but never commits. Native transfer plus accepted ack plus verified
        // verify complete it asynchronously; the shared single-flight stays
        // held throughout with no replay.
        if (flightState.op === "move" && this.isCrossMove(planned, flightState)) {
            this.beginR4Transfer(planned, flightState, current);
            return;
        }
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
                    this.failFlight(flightState, "precondition-mismatch");
                    return;
                }
            } else if (planned.operation !== null) {
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
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                if (!this.ensureKeepAbove(target, transition.window, resourceClassById.get(transition.window) ?? "unknown")) {
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
                    this.failFlight(flightState, "write-failed");
                    return;
                }
                this.writeDiag(transition.window, resourceClassById.get(transition.window) ?? "unknown", "float-written", floatGeometry.rect);
                try { this.env.setFloating?.(transition.window, true); } catch (error) { void error; this.failFlight(flightState, "write-failed"); return; }
            } else if (transition !== null) {
                if (!this.restoreKeepAbove(transition.window, resourceClassById.get(transition.window) ?? "unknown")) {
                    this.failFlight(flightState, "write-failed");
                    return;
                }
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
                    this.failFlight(flightState, "stale-scope");
                    return;
                }
                if (!this.retainFloatFocus(floatTransition.window, floatRef, resourceClassById.get(floatTransition.window) ?? "unknown")) {
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
                            this.failFlight(flightState, "write-failed");
                            return;
                        }
                    }
                }
            }
        }
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
                    this.keepAbovePrevious.delete(flightState.removed);
                    this.stickyPreviousFloating.delete(flightState.removed);
                    this.adoptedSticky.delete(flightState.removed);
                    try {
                        this.env.noteRemoved?.(flightState.removed);
                    } catch (error) {
                        void error;
                    }
                }
            } else {
                const retained = this.setLastGood({ ...retainedBase, windows: Object.freeze(windows) }, flightState.background === true);
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
                    if (flightState.workAreaReprojection === true) {
                        this.clearBackgroundReconcile(flightState.snapshot);
                    } else {
                        this.noteBackgroundTerminal(flightState.snapshot);
                    }
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
        if (isUniqueOwner(this.pinnedOwner)) {
            this.knownOwner = this.pinnedOwner;
        }
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
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

    // R4 helpers: bounded echo fence, native proof, ack/verify, terminal.
    private r4ChangedGeometryIds(planned: PlannedReply, current: PlanObserved): string[] {
        const freshById = new Map<string, PlanRect>();
        for (const entry of current.windows) {
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

    // Mover outputChanged echo: the signal carries the old output; the
    // current value is always re-read for proof. A wrong-output read fails
    // terminal without ack.
    private onR4OutputEcho(old: unknown, flight: number, session: number): void {
        void old;
        const r4 = this.r4Current();
        if (r4 === null || flight !== r4.flight || session !== r4.session || r4.acked) {
            return;
        }
        let current: string | null = null;
        try {
            current = this.env.readOutputName?.(r4.moverRef) ?? null;
        } catch (error) {
            void error;
            current = null;
        }
        if (current === null) {
            this.failR4Terminal("stale-scope", true);
            return;
        }
        if (current !== r4.targetOutput) {
            this.failR4Terminal("wrong-output", true);
            return;
        }
        r4.outputSeen = true;
        this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-output-echo");
        this.tryR4MaybeAck(flight, session);
    }

    private onR4DesktopsEcho(flight: number, session: number): void {
        const r4 = this.r4Current();
        if (r4 === null || flight !== r4.flight || session !== r4.session || r4.acked) {
            return;
        }
        let ids: ReadonlyArray<string> | null = null;
        try {
            ids = this.env.readDesktopIds?.(r4.moverRef) ?? null;
        } catch (error) {
            void error;
            ids = null;
        }
        if (ids === null) {
            this.failR4Terminal("stale-scope", true);
            return;
        }
        if (ids.length !== 1 || ids[0] !== r4.targetWorkspace) {
            this.failR4Terminal("wrong-output", true);
            return;
        }
        r4.desktopsSeen = true;
        this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-desktops-echo");
        this.tryR4MaybeAck(flight, session);
    }

    private onR4GeometryEcho(windowId: string, flight: number, session: number): void {
        const r4 = this.r4Current();
        if (r4 === null || flight !== r4.flight || session !== r4.session || r4.acked) {
            return;
        }
        if (!r4.geoPending.has(windowId)) {
            return;
        }
        const expected = r4.planned.geometry.find((entry) => entry.window === windowId);
        if (expected === undefined) {
            this.failR4Terminal("precondition-mismatch", true);
            return;
        }
        const ref = r4.byRef.get(windowId);
        if (ref === undefined) {
            this.failR4Terminal("precondition-mismatch", true);
            return;
        }
        let rect: PlanRect | null = null;
        try {
            rect = this.env.readGeometry?.(ref) ?? null;
        } catch (error) {
            void error;
        }
        // sendClientToScreen can emit an intermediate mover geometry before
        // its queued Wayland resize commits. Keep this per-window fence armed
        // until an echo reads back the exact planned rectangle.
        if (rect === null || rect.x !== expected.rect.x || rect.y !== expected.rect.y || rect.w !== expected.rect.w || rect.h !== expected.rect.h) {
            return;
        }
        r4.geoPending.delete(windowId);
        this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-geometry-echo");
        this.tryR4MaybeAck(flight, session);
    }

    // Follow is a confirmed partial native success: it needs output and exact
    // desktop membership proof, but must not wait for an unrelated sibling's
    // geometry. Ack/verify still require the complete desired geometry below.
    private tryR4Follow(r4: R4Flight): boolean {
        if (r4.followed) {
            return true;
        }
        if (!r4.outputSeen || !r4.desktopsSeen) {
            return true;
        }
        if (r4.epoch !== this.epoch || !this.r4MoverPlacementMatches(r4)) {
            this.failR4Terminal("stale-scope", true);
            return false;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
        }
        if (currentActive !== r4.moverRef) {
            let focused = false;
            try {
                focused = this.env.setActive(r4.moverRef) === true;
            } catch (error) {
                void error;
            }
            try {
                currentActive = this.env.active();
            } catch (error) {
                void error;
                currentActive = null;
            }
            if (!focused || currentActive !== r4.moverRef) {
                this.failR4Terminal("focus-unconfirmed", true);
                return false;
            }
        }
        r4.followed = true;
        return true;
    }

    // Ack only after every fence echo plus full native readback proof. Follow
    // may already have completed from confirmed mover placement above.
    private tryR4MaybeAck(flight: number, session: number): void {
        const r4 = this.r4Current();
        if (r4 === null || flight !== r4.flight || session !== r4.session || r4.acked || r4.settled) {
            return;
        }
        // KWin does not notify an unchanged desktop assignment. Readback keeps
        // same-workspace cross-output transfers from waiting for that absent echo.
        const membershipWasUnchanged = r4.snapshot.windows.some(
            (window) => window.id === r4.moverId && window.workspace === r4.targetWorkspace,
        );
        if (!r4.desktopsSeen && membershipWasUnchanged) {
            let ids: ReadonlyArray<string> | null = null;
            try {
                ids = this.env.readDesktopIds?.(r4.moverRef) ?? null;
            } catch (error) {
                void error;
            }
            if (ids !== null && ids.length === 1 && ids[0] === r4.targetWorkspace) {
                r4.desktopsSeen = true;
                this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-desktops-readback");
            }
        }
        if (!r4.outputSeen || !r4.desktopsSeen) {
            return;
        }
        if (!this.tryR4Follow(r4) || r4.geoPending.size > 0) {
            return;
        }
        if (r4.epoch !== this.epoch) {
            this.failR4Terminal("stale-scope", true);
            return;
        }
        if (!this.r4ProofMatches(r4)) {
            this.failR4Terminal("post-observation-mismatch", true);
            return;
        }
        r4.acked = true;
        const payload = this.buildR4AckPayload(r4);
        if (payload === null || payload.length > PLAN_MAX_REQUEST_BYTES) {
            this.failR4Terminal("precondition-mismatch", false);
            return;
        }
        this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-ack");
        this.sendR4Request(payload, (reply) => this.onR4AckReply(reply, flight, session));
    }

    // Full desired observed proof against the retained plan: mover on the
    // exact target output with exact single-target membership, and every
    // desired window at its planned rectangle.
    private r4ProofMatches(r4: R4Flight): boolean {
        if (!this.r4MoverPlacementMatches(r4)) {
            return false;
        }
        for (const entry of r4.planned.geometry) {
            const ref = r4.byRef.get(entry.window);
            if (ref === undefined) {
                return false;
            }
            let rect: PlanRect | null = null;
            try {
                rect = this.env.readGeometry?.(ref) ?? null;
            } catch (error) {
                void error;
                return false;
            }
            if (rect === null || rect.x !== entry.rect.x || rect.y !== entry.rect.y || rect.w !== entry.rect.w || rect.h !== entry.rect.h) {
                return false;
            }
        }
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

    // Post-observation windows carried by ack/verify: exactly the retained
    // desired geometry (output/workspace/rect per window).
    private r4PostWindows(r4: R4Flight): Array<Record<string, unknown>> {
        return r4.planned.geometry.map((entry) => ({
            window: entry.window,
            output: entry.output,
            workspace: entry.workspace,
            rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
        }));
    }

    private r4DomainsPayload(r4: R4Flight): Array<Record<string, unknown>> {
        const domains = r4.snapshot.domains as ReadonlyArray<PlanDomain>;
        return domains.map((entry) => ({
            output: entry.output,
            workspace: entry.workspace,
            bounds: { x: entry.bounds.x, y: entry.bounds.y, w: entry.bounds.w, h: entry.bounds.h },
            gap: entry.gap,
            outer_gap: entry.outerGap,
            adjacent: { ...(entry.adjacent as Record<string, string>) },
        }));
    }

    private r4PostFingerprint(r4: R4Flight): number {
        const domains = r4.snapshot.domains as ReadonlyArray<PlanDomain>;
        return planDirectionalFingerprint(
            domains,
            "",
            r4.planned.geometry.map((entry) => ({
                window: entry.window,
                output: entry.output,
                workspace: entry.workspace,
                rect: entry.rect,
                floating: false,
                fitExcluded: false,
            })),
        );
    }

    private buildR4AckPayload(r4: R4Flight): string | null {
        const snapshot = r4.snapshot;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: PLAN_CONTRACT_VERSION,
                correlation_id: r4.correlation,
                owner: this.owner,
                generation: this.generation,
                revision: r4.baseRevision,
                fingerprint: this.r4PostFingerprint(r4),
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
                domains: this.r4DomainsPayload(r4),
                focused_window: "",
                windows: this.r4PostWindows(r4),
                command: { op: "directional-move-ack", ack_outcome: "accepted" },
            });
        } catch (error) {
            void error;
            return null;
        }
        return payload;
    }

    private buildR4VerifyPayload(r4: R4Flight): string | null {
        const snapshot = r4.snapshot;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: PLAN_CONTRACT_VERSION,
                correlation_id: r4.correlation,
                owner: this.owner,
                generation: this.generation,
                revision: r4.baseRevision,
                fingerprint: this.r4PostFingerprint(r4),
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
                domains: this.r4DomainsPayload(r4),
                focused_window: "",
                windows: this.r4PostWindows(r4),
                command: {
                    op: "directional-move-verify",
                    verified: true,
                    preconditions: r4.planned.rawPreconditions,
                    operation: r4.planned.rawOperation,
                },
            });
        } catch (error) {
            void error;
            return null;
        }
        return payload;
    }

    // Best-effort terminal adapter-lost ack to the still pinned owner before
    // local teardown. Never the well-known name, never a retry, and a failed
    // report never changes the failure behavior. Sent only while ack is still
    // unbound; after ack the pending is Rust-bound and local teardown without
    // verify is the only safe path.
    private sendR4LostAck(r4: R4Flight): void {
        if (r4.acked || !isUniqueOwner(this.pinnedOwner)) {
            return;
        }
        const snapshot = r4.snapshot;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: PLAN_CONTRACT_VERSION,
                correlation_id: r4.correlation,
                owner: this.owner,
                generation: this.generation,
                revision: r4.baseRevision,
                fingerprint: this.r4PostFingerprint(r4),
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
                domains: this.r4DomainsPayload(r4),
                focused_window: "",
                windows: this.r4PostWindows(r4),
                command: { op: "directional-move-ack", ack_outcome: "adapter-lost" },
            });
        } catch (error) {
            void error;
            return;
        }
        if (payload.length > PLAN_MAX_REQUEST_BYTES) {
            return;
        }
        try {
            const target = this.pinnedOwner as string;
            this.env.callDbus(target, PLAN_OBJECT, PLAN_INTERFACE, PLAN_METHOD, payload, () => {});
        } catch (error) {
            void error;
        }
    }

    private sendR4Request(payload: string, callback: (reply: unknown) => void): void {
        const r4 = this.r4Current();
        if (r4 === null || !isUniqueOwner(this.pinnedOwner)) {
            this.failR4Terminal("owner-loss", false);
            return;
        }
        // The original `planned` guard (`callbackSeen`) stays consumed across
        // the whole R4 flight so a duplicate planned reply can never restart
        // native transfer. Ack/verify bind to their own `r4` flags below.
        try {
            const target = this.pinnedOwner as string;
            this.env.callDbus(target, PLAN_OBJECT, PLAN_INTERFACE, PLAN_METHOD, payload, callback);
        } catch (error) {
            void error;
            this.failR4Terminal("owner-loss", false);
        }
    }

    private onR4AckReply(reply: unknown, flight: number, session: number): void {
        const r4 = this.r4Current();
        if (r4 === null || flight !== r4.flight || session !== r4.session || !r4.acked || r4.settled) {
            return;
        }
        if (r4.ackReplySeen) {
            return;
        }
        r4.ackReplySeen = true;
        if (typeof reply !== "string" || reply.length > PLAN_MAX_REPLY_BYTES) {
            this.failR4Terminal("service-fault", false);
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.failR4Terminal("service-fault", false);
            return;
        }
        if (!isRecord(parsed) || parsed["v"] !== PLAN_CONTRACT_VERSION || parsed["correlation_id"] !== r4.correlation) {
            this.failR4Terminal("service-fault", false);
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome !== "acknowledged") {
            this.failR4Terminal(outcome === "diverged" ? sanitizeKind(parsed["kind"]) : "service-fault", false);
            return;
        }
        this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-acknowledged");
        // Scope may have changed between ack and verify: rerun the full
        // desired observed proof so stale data never reaches verify.
        if (r4.epoch !== this.epoch || !this.r4ProofMatches(r4)) {
            this.failR4Terminal("stale-scope", false);
            return;
        }
        const payload = this.buildR4VerifyPayload(r4);
        if (payload === null || payload.length > PLAN_MAX_REQUEST_BYTES) {
            this.failR4Terminal("precondition-mismatch", false);
            return;
        }
        this.diag(r4.op, r4.correlation, r4.planned.geometry.length, "r4-verify");
        r4.verifyRequested = true;
        r4.verifyReplySeen = false;
        this.sendR4Request(payload, (verifyReply) => this.onR4VerifyReply(verifyReply, flight, session));
    }

    private onR4VerifyReply(reply: unknown, flight: number, session: number): void {
        const r4 = this.r4Current();
        if (r4 === null || flight !== r4.flight || session !== r4.session || !r4.acked || !r4.verifyRequested || r4.settled) {
            return;
        }
        if (r4.verifyReplySeen) {
            return;
        }
        r4.verifyReplySeen = true;
        this.clearTimer();
        if (typeof reply !== "string" || reply.length > PLAN_MAX_REPLY_BYTES) {
            this.failR4Terminal("service-fault", false);
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.failR4Terminal("service-fault", false);
            return;
        }
        if (!isRecord(parsed) || parsed["v"] !== PLAN_CONTRACT_VERSION || parsed["correlation_id"] !== r4.correlation) {
            this.failR4Terminal("service-fault", false);
            return;
        }
        if (parsed["outcome"] !== "committed") {
            this.failR4Terminal(parsed["outcome"] === "diverged" ? sanitizeKind(parsed["kind"]) : "service-fault", false);
            return;
        }
        const settled = r4;
        settled.settled = true;
        this.clearR4Flight();
        if (isUniqueOwner(this.pinnedOwner)) {
            this.knownOwner = this.pinnedOwner;
        }
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.diag(settled.op, settled.correlation, settled.planned.geometry.length, "planned-applied");
        // Exactly one observational active-group refresh after the committed
        // R4 boundary, mirroring the local geometry-plan edge.
        try {
            this.env.onPlannedApplied?.(settled.op);
        } catch (error) {
            void error;
        }
        this.finishFlight();
        try {
            this.requestResync();
        } catch (error) {
            void error;
        }
    }

    private onR4Timeout(flight: number, session: number): void {
        const r4 = this.r4Flight;
        if (r4 === null || r4.settled || flight !== r4.flight || session !== r4.session || !this.inFlight) {
            return;
        }
        this.failR4Terminal("timeout", true);
    }

    // Terminal R4 failure: exactly one best-effort adapter-lost ack while ack
    // is still unbound, otherwise no verify at all. Never replays the
    // command. Local teardown releases the single-flight; one resync after
    // converges from fresh observation.
    private failR4Terminal(outcome: string, sendLostAck: boolean): void {
        const r4 = this.r4Flight;
        if (r4 === null || r4.settled) {
            return;
        }
        r4.settled = true;
        if (sendLostAck && !r4.acked) {
            try {
                this.sendR4LostAck(r4);
            } catch (error) {
                void error;
            }
        }
        const op = r4.op;
        const correlation = r4.correlation;
        const count = r4.planned.geometry.length;
        this.clearR4Flight();
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.diag(op, correlation, count, outcome);
        this.noteReconcileTerminal(op);
        this.finishFlight();
        try {
            this.requestResync();
        } catch (error) {
            void error;
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
            r4.geoPending.clear();
        }
    }

    private failFlight(flightState: PendingFlight, outcome: string): void {
        if (flightState.plannerSession !== this.plannerSession) {
            return;
        }
        this.clearR4Flight();
        this.clearTimer();
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
        // Ambiguous terminal failures (timeout already probed via onTimeout;
        // service-fault, correlation mismatch, precondition mismatch, stale
        // scope, write failure, owner loss) may lead to one bounded identity
        // probe. Only absence or changed owner recovers; same owner retains.
        this.maybeProbeAfterTerminal(flightState);
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
        // An R4 flight holds the single-flight across native/ack/verify: no
        // deferred or hidden-domain command may interleave until it settles.
        if (this.r4Flight !== null) {
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
                (this.interactiveResizeActive() || this.parked || this.reconcileAttempts >= MAX_RECONCILE_ATTEMPTS)
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
