// Bounded static movement adapter (standalone, opt-in only).
//
// Product-shaped but with no normal startup route: ordinary production
// startup never runs this module (src/entry.ts must not import it, and no
// controller route under src/controller*.ts may import it or reference the
// DescribeMovement route; the module constraints below are the explicit future
// wiring contract). The only activation is the explicit exported
// MovementAdapter class plus the separate entry helper, called by no
// production source.
//
// Future exclusive wiring contract: any future caller must supply an explicit
// hasExclusiveMovementAuthority boundary proving no prior handler runs in the
// same call for the same command domain; the adapter rechecks it before the
// request and again before native writes, and the entry requires it as a
// function (never a bare boolean). A false value rejects before any native
// write so legacy movement and geometry authority cannot co-exist. The module
// never reads, mirrors, or mutates the legacy tiling tree and never falls
// back.
//
// Rust owns normalized domains, move intent, capabilities, preconditions,
// revision binding, and reconciliation via the narrow JSON action protocol.
// This module owns KWin observation, native identity mapping, revalidation,
// sequential native frameGeometry writes, focus restore, signals, and
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
// is restored to the moved window. There is no configure barrier and no
// timer polling; adapter-originated geometry signals are guarded while
// unrelated geometry changes invalidate terminally.

export const MOVEMENT_SERVICE = "org.plasmaautotiler.Planner";
export const MOVEMENT_OBJECT = "/org/plasmaautotiler/Planner";
export const MOVEMENT_INTERFACE = "org.plasmaautotiler.Planner1";
export const MOVEMENT_METHOD = "DescribeMovement";

// Session D-Bus activation transport (one-flight, bounded, no poll/retry).
// Discovery is GetNameOwner on the well-known Planner name, pinned to one
// exact unique owner (`:N.M`) before any planner call. When absent, exactly
// one StartServiceByName(service, 0) phase runs, accepting only result codes
// 1 (PrimaryOwner) / 2 (AlreadyOwner), followed by exactly one more owner
// resolution and pin. Flags value 0 is fixed; the production entry appends
// it as the second native D-Bus argument.
export const MOVEMENT_DBUS_SERVICE = "org.freedesktop.DBus";
export const MOVEMENT_DBUS_OBJECT = "/org/freedesktop/DBus";
export const MOVEMENT_DBUS_INTERFACE = "org.freedesktop.DBus";
export const MOVEMENT_GET_OWNER_METHOD = "GetNameOwner";
export const MOVEMENT_START_METHOD = "StartServiceByName";
export const MOVEMENT_START_FLAGS = 0;
export const MOVEMENT_START_PRIMARY = 1;
export const MOVEMENT_START_ALREADY = 2;

export const MOVEMENT_CONTRACT_VERSION = 1;
export const MOVEMENT_MAX_REQUEST_BYTES = 64 * 1024;
export const MOVEMENT_MAX_REPLY_BYTES = 64 * 1024;
export const MOVEMENT_TIMEOUT_MS = 2000;
export const MOVEMENT_MAX_CORRELATION_LEN = 128;
export const MOVEMENT_MAX_OWNER_LEN = 128;
export const MOVEMENT_MAX_GENERATION_LEN = 64;
export const MOVEMENT_MAX_REVISION = 1000000;
export const MOVEMENT_MAX_ID_LEN = 128;
export const MOVEMENT_MAX_WINDOWS = 64;
export const MOVEMENT_MAX_GEOMETRY = 64;
export const MOVEMENT_MAX_DOMAINS = 16;
export const MOVEMENT_MAX_SEQ = 1000000;

const LOG_PREFIX = "plasma-auto-tiler:movement";

export type MovementDirection = "left" | "right" | "up" | "down";
export type MovementSignal = "active" | "added" | "removed" | "output" | "desktop" | "geometry";

export interface MovementRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

export interface MovementObservedWindow {
    readonly id: string;
    readonly ref: object;
    readonly rect: MovementRect;
    readonly output: string;
    readonly workspace: string;
}

export interface MovementDomain {
    readonly output: string;
    readonly workspace: string;
    readonly bounds: MovementRect;
    readonly gap: number;
    readonly adjacent: Readonly<Record<string, string>>;
}

export interface MovementObserved {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly focusedId: string;
    readonly windows: ReadonlyArray<MovementObservedWindow>;
    readonly domains: ReadonlyArray<MovementDomain>;
    readonly activeRef: object | null;
    readonly fingerprint: string;
    readonly revalidate: () => boolean;
}

export interface MovementAdapterEnv {
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
    readonly observe: () => MovementObserved | null;
    readonly setGeometry: (target: object, rect: MovementRect) => boolean;
    readonly setActive: (target: object) => boolean;
    readonly active: () => object | null;
    readonly hasExclusiveMovementAuthority: () => boolean;
    readonly subscribe: (kind: MovementSignal, handler: () => void) => () => void;
}

export interface MovementDesired {
    readonly window: string;
    readonly leaf: string;
    readonly output: string;
    readonly workspace: string;
    readonly rect: MovementRect;
}

export interface MovementDesiredFocus {
    readonly domainOutput: string;
    readonly domainWorkspace: string;
    readonly leaf: string;
}

// Deterministic bounded observation fingerprint (FNV-1a 32-bit over
// `output\x1fworkspace\x1ffocused\x1fids...`, sorted ids). Mirrors the Rust
// movement_fingerprint binding exactly; sent as the numeric fingerprint.
export function movementFingerprint(
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
    if (typeof value !== "string" || value.length === 0 || value.length > MOVEMENT_MAX_ID_LEN) {
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
        value.length <= MOVEMENT_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= MOVEMENT_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > MOVEMENT_MAX_GENERATION_LEN) {
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
        value <= MOVEMENT_MAX_REVISION
    );
}

function isDirection(value: unknown): value is MovementDirection {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInt(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isTargetRect(value: unknown): value is MovementRect {
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

function sameRect(a: MovementRect, b: MovementRect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function rectArea(rect: MovementRect): number {
    return rect.w * rect.h;
}

function rectsOverlap(a: MovementRect, b: MovementRect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function rectContained(inner: MovementRect, outer: MovementRect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.w <= outer.x + outer.w &&
        inner.y + inner.h <= outer.y + outer.h
    );
}

const KNOWN_RULES: readonly string[] = Object.freeze(["R1", "R2a", "R2b", "R2c", "R3", "R4"]);
const KNOWN_CAPABILITIES: readonly string[] = Object.freeze([
    "swap-neighbor",
    "wrap-perpendicular",
    "wrap-siblings",
    "insert-child",
    "split-group-child",
    "reparent-leaf",
    "cross-output-transfer",
]);
const KNOWN_PRECONDITIONS: readonly string[] = Object.freeze([
    "focused-leaf-occupied-by-focused-window",
    "neighbor-leaf-occupied",
    "container-is-direct-parent",
    "target-group-membership",
    "parent-group-membership",
    "source-root-membership-and-adjacent-same-workspace-output",
    "adapter-must-verify-postconditions",
]);
const KNOWN_KINDS: readonly string[] = Object.freeze([
    "WrapPerpendicular",
    "SwapNeighbor",
    "InsertIntoGroup",
    "SplitGroupChild",
    "WrapNeighbor",
    "EscapeParent",
    "CrossOutput",
]);
const KNOWN_AXES: readonly string[] = Object.freeze(["horizontal", "vertical"]);
const KNOWN_DIRECTIONS: readonly string[] = Object.freeze(["left", "right", "up", "down"]);

function expectedPreconditions(kind: string): readonly string[] | null {
    switch (kind) {
        case "WrapPerpendicular":
            return [
                "focused-leaf-occupied-by-focused-window",
                "container-is-direct-parent",
                "adapter-must-verify-postconditions",
            ];
        case "SwapNeighbor":
            return [
                "focused-leaf-occupied-by-focused-window",
                "neighbor-leaf-occupied",
                "container-is-direct-parent",
                "adapter-must-verify-postconditions",
            ];
        case "InsertIntoGroup":
            return [
                "focused-leaf-occupied-by-focused-window",
                "container-is-direct-parent",
                "target-group-membership",
                "adapter-must-verify-postconditions",
            ];
        case "SplitGroupChild":
            return [
                "focused-leaf-occupied-by-focused-window",
                "neighbor-leaf-occupied",
                "container-is-direct-parent",
                "target-group-membership",
                "adapter-must-verify-postconditions",
            ];
        case "WrapNeighbor":
            return [
                "focused-leaf-occupied-by-focused-window",
                "neighbor-leaf-occupied",
                "container-is-direct-parent",
                "adapter-must-verify-postconditions",
            ];
        case "EscapeParent":
            return [
                "focused-leaf-occupied-by-focused-window",
                "container-is-direct-parent",
                "parent-group-membership",
                "adapter-must-verify-postconditions",
            ];
        case "CrossOutput":
            return [
                "focused-leaf-occupied-by-focused-window",
                "source-root-membership-and-adjacent-same-workspace-output",
                "adapter-must-verify-postconditions",
            ];
        default:
            return null;
    }
}

function expectedCapability(kind: string): string | null {
    switch (kind) {
        case "WrapPerpendicular":
            return "wrap-perpendicular";
        case "SwapNeighbor":
            return "swap-neighbor";
        case "InsertIntoGroup":
            return "insert-child";
        case "SplitGroupChild":
            return "split-group-child";
        case "WrapNeighbor":
            return "wrap-siblings";
        case "EscapeParent":
            return "reparent-leaf";
        case "CrossOutput":
            return "cross-output-transfer";
        default:
            return null;
    }
}

function expectedRule(kind: string): string | null {
    switch (kind) {
        case "WrapPerpendicular":
            return "R1";
        case "SwapNeighbor":
            return "R2a";
        case "InsertIntoGroup":
        case "SplitGroupChild":
            return "R2b";
        case "WrapNeighbor":
            return "R2c";
        case "EscapeParent":
            return "R3";
        case "CrossOutput":
            return "R4";
        default:
            return null;
    }
}

function oppositeMovementDirection(direction: MovementDirection): MovementDirection {
    switch (direction) {
        case "left":
            return "right";
        case "right":
            return "left";
        case "up":
            return "down";
        case "down":
            return "up";
    }
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

function isNonNegativeInt(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validateOperationShape(operation: unknown, rule: string, capability: string): boolean {
    if (!isRecord(operation) || typeof operation["kind"] !== "string") {
        return false;
    }
    const kind = operation["kind"] as string;
    if (KNOWN_KINDS.indexOf(kind) < 0) {
        return false;
    }
    if (operation["rule"] !== rule) {
        return false;
    }
    if (expectedRule(kind) !== rule) {
        return false;
    }
    if (expectedCapability(kind) !== capability) {
        return false;
    }
    switch (kind) {
        case "WrapPerpendicular":
            return (
                hasExactKeys(operation, ["kind", "rule", "container", "axis"]) &&
                isOpaqueId(operation["container"]) &&
                KNOWN_AXES.indexOf(operation["axis"] as string) >= 0
            );
        case "SwapNeighbor":
            return (
                hasExactKeys(operation, ["kind", "rule", "container", "neighbor"]) &&
                isOpaqueId(operation["container"]) &&
                isOpaqueId(operation["neighbor"])
            );
        case "InsertIntoGroup":
            return (
                hasExactKeys(operation, [
                    "kind",
                    "rule",
                    "container",
                    "target_group",
                    "insertion_index",
                    "insertion",
                ]) &&
                isOpaqueId(operation["container"]) &&
                isOpaqueId(operation["target_group"]) &&
                isNonNegativeInt(operation["insertion_index"]) &&
                (operation["insertion"] === "midpoint" || operation["insertion"] === "near-edge")
            );
        case "SplitGroupChild":
            return (
                hasExactKeys(operation, [
                    "kind",
                    "rule",
                    "container",
                    "target_group",
                    "target_child",
                    "target_child_index",
                    "focused_side",
                    "axis",
                ]) &&
                isOpaqueId(operation["container"]) &&
                isOpaqueId(operation["target_group"]) &&
                isOpaqueId(operation["target_child"]) &&
                isNonNegativeInt(operation["target_child_index"]) &&
                (operation["focused_side"] === "first" || operation["focused_side"] === "second") &&
                KNOWN_AXES.indexOf(operation["axis"] as string) >= 0
            );
        case "WrapNeighbor":
            return (
                hasExactKeys(operation, [
                    "kind",
                    "rule",
                    "container",
                    "neighbor",
                    "focused_before_neighbor",
                    "axis",
                ]) &&
                isOpaqueId(operation["container"]) &&
                isOpaqueId(operation["neighbor"]) &&
                typeof operation["focused_before_neighbor"] === "boolean" &&
                KNOWN_AXES.indexOf(operation["axis"] as string) >= 0
            );
        case "EscapeParent":
            return (
                hasExactKeys(operation, [
                    "kind",
                    "rule",
                    "container",
                    "parent",
                    "container_child_index",
                    "parent_insertion_index",
                    "continuation",
                ]) &&
                isOpaqueId(operation["container"]) &&
                isOpaqueId(operation["parent"]) &&
                isNonNegativeInt(operation["container_child_index"]) &&
                (isNonNegativeInt(operation["parent_insertion_index"]) ||
                    operation["parent_insertion_index"] === null) &&
                (operation["continuation"] === "none" || operation["continuation"] === "R1")
            );
        case "CrossOutput":
            return (
                hasExactKeys(operation, [
                    "kind",
                    "rule",
                    "target_output",
                    "source_root_child_index",
                    "target",
                ]) &&
                isOpaqueId(operation["target_output"]) &&
                isNonNegativeInt(operation["source_root_child_index"]) &&
                (operation["target"] === "empty" || operation["target"] === "occupied")
            );
        default:
            return false;
    }
}

function validateGeometryEntry(value: unknown): value is MovementDesired {
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

function validateDesiredFocus(value: unknown): value is MovementDesiredFocus {
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

interface PlannedMovement {
    readonly correlationId: string;
    readonly baseRevision: number;
    readonly capability: string;
    readonly rule: string;
    readonly preconditions: ReadonlyArray<string>;
    readonly operation: Record<string, unknown>;
    readonly geometry: ReadonlyArray<MovementDesired>;
    readonly focus: MovementDesiredFocus;
}

function validatePlanned(reply: unknown, correlationId: string): PlannedMovement | null {
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
            "rule",
            "preconditions",
            "operation",
            "desired_geometry",
            "desired_focus",
        ])
    ) {
        return null;
    }
    if (reply["v"] !== MOVEMENT_CONTRACT_VERSION) {
        return null;
    }
    if (reply["correlation_id"] !== correlationId) {
        return null;
    }
    if (reply["outcome"] !== "planned") {
        return null;
    }
    const capability = reply["capability"];
    const rule = reply["rule"];
    if (typeof capability !== "string" || KNOWN_CAPABILITIES.indexOf(capability) < 0) {
        return null;
    }
    if (typeof rule !== "string" || KNOWN_RULES.indexOf(rule) < 0) {
        return null;
    }
    const preconditions = reply["preconditions"];
    if (!Array.isArray(preconditions) || preconditions.length === 0 || preconditions.length > 7) {
        return null;
    }
    const seenPre = new Set<string>();
    for (const entry of preconditions) {
        if (typeof entry !== "string" || KNOWN_PRECONDITIONS.indexOf(entry) < 0 || seenPre.has(entry)) {
            return null;
        }
        seenPre.add(entry);
    }
    const operation = reply["operation"];
    if (!validateOperationShape(operation, rule as string, capability as string)) {
        return null;
    }
    const expected = expectedPreconditions((operation as Record<string, unknown>)["kind"] as string);
    if (expected === null || preconditions.length !== expected.length) {
        return null;
    }
    for (let index = 0; index < expected.length; index += 1) {
        if (preconditions[index] !== expected[index]) {
            return null;
        }
    }
    const baseRevision = reply["base_revision"];
    if (!isRevision(baseRevision)) {
        return null;
    }
    const geometryRaw = reply["desired_geometry"];
    if (!Array.isArray(geometryRaw) || geometryRaw.length === 0 || geometryRaw.length > MOVEMENT_MAX_GEOMETRY) {
        return null;
    }
    const geometry: MovementDesired[] = [];
    const seenWindow = new Set<string>();
    for (const entry of geometryRaw) {
        if (!validateGeometryEntry(entry)) {
            return null;
        }
        const typed = entry as unknown as MovementDesired;
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
        capability: capability as string,
        rule: rule as string,
        preconditions: Object.freeze([...(preconditions as string[])]),
        operation: operation as Record<string, unknown>,
        geometry: Object.freeze(geometry),
        focus: {
            domainOutput: focusRecord["domain_output"] as string,
            domainWorkspace: focusRecord["domain_workspace"] as string,
            leaf: focusRecord["leaf"] as string,
        },
    };
}

function toDesiredFocus(raw: Record<string, unknown>): MovementDesiredFocus {
    return {
        domainOutput: raw["domain_output"] as string,
        domainWorkspace: raw["domain_workspace"] as string,
        leaf: raw["leaf"] as string,
    };
}

function validateObserved(observed: MovementObserved | null): observed is MovementObserved {
    if (observed === null || typeof observed !== "object") {
        return false;
    }
    if (!isOpaqueId(observed.domainOutput) || !isOpaqueId(observed.domainWorkspace)) {
        return false;
    }
    if (!isOpaqueId(observed.focusedId)) {
        return false;
    }
    if (!Array.isArray(observed.windows as unknown) || !Array.isArray(observed.domains as unknown)) {
        return false;
    }
    const windows = observed.windows;
    const domains = observed.domains;
    if (windows.length === 0 || windows.length > MOVEMENT_MAX_WINDOWS) {
        return false;
    }
    if (domains.length === 0 || domains.length > MOVEMENT_MAX_DOMAINS) {
        return false;
    }
    const seen = new Set<string>();
    let focusedFound = false;
    const domainKeys = new Set<string>();
    for (const domain of domains) {
        if (typeof domain !== "object" || domain === null) {
            return false;
        }
        const candidate = domain as MovementDomain;
        if (!isOpaqueId(candidate.output) || !isOpaqueId(candidate.workspace)) {
            return false;
        }
        if (!isTargetRect({ x: candidate.bounds.x, y: candidate.bounds.y, w: candidate.bounds.w, h: candidate.bounds.h })) {
            return false;
        }
        if (!isFiniteInt(candidate.gap) || candidate.gap < 0 || candidate.gap > 64) {
            return false;
        }
        if (typeof candidate.adjacent !== "object" || candidate.adjacent === null || Array.isArray(candidate.adjacent)) {
            return false;
        }
        const keys = Object.keys(candidate.adjacent);
        if (keys.length > 4) {
            return false;
        }
        for (const key of keys) {
            if (KNOWN_DIRECTIONS.indexOf(key) < 0) {
                return false;
            }
            const target = (candidate.adjacent as Record<string, unknown>)[key];
            if (!isOpaqueId(target) || target === candidate.output) {
                return false;
            }
        }
        const pair = `${candidate.output}\x1f${candidate.workspace}`;
        if (domainKeys.has(pair)) {
            return false;
        }
        domainKeys.add(pair);
    }
    // Observed adjacency must be strictly reciprocal between known
    // same-workspace domains (mirrors the Rust session binding): every named
    // target resolves to a known domain sharing the source workspace and
    // points back via the opposite cardinal direction.
    const domainByKey = new Map<string, MovementDomain>();
    for (const domain of domains) {
        const candidate = domain as MovementDomain;
        domainByKey.set(`${candidate.output}\x1f${candidate.workspace}`, candidate);
    }
    const oppositeOf: Readonly<Record<string, string>> = {
        left: "right",
        right: "left",
        up: "down",
        down: "up",
    };
    for (const domain of domains) {
        const candidate = domain as MovementDomain;
        for (const key of Object.keys(candidate.adjacent)) {
            const target = (candidate.adjacent as Record<string, unknown>)[key] as string;
            const targetDomain = domainByKey.get(`${target}\x1f${candidate.workspace}`);
            if (targetDomain === undefined) {
                return false;
            }
            const back = (targetDomain.adjacent as Record<string, unknown>)[
                oppositeOf[key] as string
            ];
            if (back !== candidate.output) {
                return false;
            }
        }
    }
    for (const entry of windows) {
        if (typeof entry !== "object" || entry === null) {
            return false;
        }
        const candidate = entry as MovementObservedWindow;
        if (!isOpaqueId(candidate.id) || typeof candidate.ref !== "object" || candidate.ref === null) {
            return false;
        }
        if (!isOpaqueId(candidate.output) || !isOpaqueId(candidate.workspace)) {
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
        if (!domainKeys.has(`${candidate.output}\x1f${candidate.workspace}`)) {
            return false;
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

import { orderGeometryWrites } from "./geometry-order";

// Deterministic native-boundary application order: changed windows only,
// descending new-minus-old area delta (growing covering rectangles first),
// lexical window id tie-break. Every changed window appears exactly once;
// unchanged windows are skipped. N-window swaps and cycles keep all writes.
// Shared canonical order via geometry-order; this wrapper preserves the
// existing movement entry point and behavior exactly.
export function orderMovementWrites(
    oldById: ReadonlyMap<string, MovementRect>,
    desired: ReadonlyArray<MovementDesired>,
): ReadonlyArray<MovementDesired> {
    return orderGeometryWrites(oldById, desired);
}

export interface MovementEnableAuth {
    readonly owner: unknown;
    readonly generation: unknown;
    readonly revision?: unknown;
}

export class MovementAdapter {
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
    private pending: PlannedMovement | null = null;
    private pendingObserved: MovementObserved | null = null;
    private pendingDirection: MovementDirection | null = null;
    private pendingMover: string | null = null;
    private lossReported = false;
    // Session D-Bus activation pin: exact planner unique owner (`:N.M`)
    // resolved via GetNameOwner (plus one StartServiceByName phase only when
    // absent) before any planner call. Null means unpinned; planner calls
    // never fall back to the well-known name.
    private pinnedOwner: string | null = null;
    // 0 idle, 1 awaiting initial owner, 2 awaiting start result, 3 awaiting
    // post-start owner, 4 planner dispatched. Single flight, no retry.
    private activationStep = 0;

    constructor(private readonly env: MovementAdapterEnv) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    private clearDedup(): void {
        this.lastFingerprint = "";
        this.lastDirection = "";
    }

    private reportAdapterLost(planned: PlannedMovement | null): void {
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
                v: MOVEMENT_CONTRACT_VERSION,
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
        if (payload.length === 0 || payload.length > MOVEMENT_MAX_REQUEST_BYTES) {
            return;
        }
        try {
            this.env.callDbus(
                target,
                MOVEMENT_OBJECT,
                MOVEMENT_INTERFACE,
                MOVEMENT_METHOD,
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

    enable(auth: MovementEnableAuth): boolean {
        if (this.enabled) {
            return false;
        }
        if (!isRecord(auth as unknown as Record<string, unknown>)) {
            this.reject("movement-invalid-auth");
            return false;
        }
        if (!isOwnerId(auth.owner) || !isGeneration(auth.generation)) {
            this.reject("movement-invalid-auth");
            return false;
        }
        const revision = auth.revision === undefined ? 0 : auth.revision;
        if (this.isSharedRevisionBinding(revision)) {
            if (!isRevision(revision.current)) {
                this.reject("movement-invalid-auth");
                return false;
            }
        } else if (!isRevision(revision)) {
            this.reject("movement-invalid-auth");
            return false;
        }
        const kinds: readonly MovementSignal[] = ["active", "added", "removed", "output", "desktop", "geometry"];
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
                this.reject("movement-signal-failed");
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
        this.pendingMover = null;
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
        this.pendingMover = null;
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

    requestMovement(direction: unknown): void {
        if (!this.enabled) {
            this.reject("movement-disabled");
            return;
        }
        if (this.inFlight) {
            this.reject("movement-busy");
            return;
        }
        if (!isDirection(direction)) {
            this.reject("movement-invalid-intent");
            return;
        }
        let authority = false;
        try {
            authority = this.env.hasExclusiveMovementAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reject("movement-exclusive-conflict");
            this.disable();
            return;
        }
        let observed: MovementObserved | null = null;
        try {
            observed = this.env.observe();
        } catch (error) {
            void error;
            observed = null;
        }
        if (!validateObserved(observed)) {
            this.reject("movement-stale-scope");
            this.disable();
            return;
        }
        const current = observed as MovementObserved;
        if (current.fingerprint === this.lastFingerprint && direction === this.lastDirection) {
            this.reject("movement-dedup");
            return;
        }
        if (this.seq < 0 || this.seq > MOVEMENT_MAX_SEQ) {
            this.reject("movement-seq-exhausted");
            this.disable();
            return;
        }
        const correlation = `${this.generation}-m${String(this.seq)}`;
        this.seq += 1;
        if (!isCorrelationId(correlation)) {
            this.reject("movement-invalid-auth");
            this.disable();
            return;
        }
        const windows = current.windows.map((entry) => ({
            window: entry.id,
            output: entry.output,
            workspace: entry.workspace,
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
        const fingerprint = movementFingerprint(
            current.domainOutput,
            current.domainWorkspace,
            current.focusedId,
            sortedIds,
        );
        const domains = current.domains.map((domain) => ({
            output: domain.output,
            workspace: domain.workspace,
            bounds: { x: domain.bounds.x, y: domain.bounds.y, w: domain.bounds.w, h: domain.bounds.h },
            gap: domain.gap,
            adjacent: { ...(domain.adjacent as Record<string, string>) },
        }));
        let payload = "";
        try {
            payload = JSON.stringify({
                v: MOVEMENT_CONTRACT_VERSION,
                action: "request",
                correlation_id: correlation,
                owner: this.owner,
                generation: this.generation,
                revision: requestRevision,
                fingerprint,
                domain: { output: current.domainOutput, workspace: current.domainWorkspace },
                focused_window: current.focusedId,
                direction,
                windows,
                capabilities: {
                    swap_neighbor: true,
                    wrap_perpendicular: true,
                    wrap_siblings: true,
                    insert_child: true,
                    split_group_child: true,
                    reparent_leaf: true,
                    cross_output_transfer: true,
                },
                domains,
            });
        } catch (error) {
            void error;
            this.reject("movement-invalid-intent");
            return;
        }
        if (payload.length > MOVEMENT_MAX_REQUEST_BYTES) {
            this.reject("movement-oversized");
            return;
        }
        this.lastFingerprint = current.fingerprint;
        this.lastDirection = direction;
        this.startFlight(payload, correlation, direction, current);
    }

    private onSignal(kind: MovementSignal): void {
        if (kind === "geometry" && this.suppressing) {
            return;
        }
        this.invalidated = true;
    }

    private startFlight(
        payload: string,
        correlation: string,
        direction: MovementDirection,
        observed: MovementObserved,
    ): void {
        this.inFlight = true;
        this.invalidated = false;
        this.suppressing = false;
        this.pending = null;
        this.pendingObserved = observed;
        this.pendingDirection = direction;
        this.pendingMover = observed.focusedId;
        this.lossReported = false;
        this.callbackSeen = false;
        this.pinnedOwner = null;
        this.activationStep = 1;
        this.token += 1;
        const flight = this.token;
        this.activeToken = flight;
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(MOVEMENT_TIMEOUT_MS, () => this.onTimeout(flight, "request"));
        } catch (error) {
            void error;
            this.inFlight = false;
            this.activationStep = 0;
            this.reject("movement-timer-failed");
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
                MOVEMENT_DBUS_SERVICE,
                MOVEMENT_DBUS_OBJECT,
                MOVEMENT_DBUS_INTERFACE,
                MOVEMENT_GET_OWNER_METHOD,
                MOVEMENT_SERVICE,
                (reply) => this.onOwnerInitial(reply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.reject("movement-dbus-failed");
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
            this.sendPlannerRequest(flight, payload, correlation);
            return;
        }
        // Absent name: exactly one StartServiceByName(service, 0) phase. The
        // flags value 0 is fixed (MOVEMENT_START_FLAGS); the production entry
        // appends it as the second native D-Bus argument.
        this.activationStep = 2;
        try {
            this.env.callDbus(
                MOVEMENT_DBUS_SERVICE,
                MOVEMENT_DBUS_OBJECT,
                MOVEMENT_DBUS_INTERFACE,
                MOVEMENT_START_METHOD,
                MOVEMENT_SERVICE,
                (startReply) => this.onStartResult(startReply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.reject("movement-dbus-failed");
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
        if (reply !== MOVEMENT_START_PRIMARY && reply !== MOVEMENT_START_ALREADY) {
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMover = null;
            this.reject("movement-activation-failed");
            this.disable();
            return;
        }
        // Exactly one bounded post-activation owner resolution, then pin
        // before any planner call. No retry on failure.
        this.activationStep = 3;
        try {
            this.env.callDbus(
                MOVEMENT_DBUS_SERVICE,
                MOVEMENT_DBUS_OBJECT,
                MOVEMENT_DBUS_INTERFACE,
                MOVEMENT_GET_OWNER_METHOD,
                MOVEMENT_SERVICE,
                (ownerReply) => this.onOwnerAfterStart(ownerReply, flight, payload, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.reject("movement-dbus-failed");
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
            this.pendingMover = null;
            this.reject("movement-owner-missing");
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
            this.reject("movement-owner-missing");
            this.disable();
            return;
        }
        try {
            this.env.callDbus(
                target,
                MOVEMENT_OBJECT,
                MOVEMENT_INTERFACE,
                MOVEMENT_METHOD,
                payload,
                (reply) => this.onRequestReply(reply, flight, correlation),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            this.activationStep = 0;
            this.pinnedOwner = null;
            this.reject("movement-dbus-failed");
            this.disable();
        }
    }

    private onTimeout(flight: number, stage: string): void {
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
        this.pendingMover = null;
        this.reject(`movement-timeout-${stage}`);
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
        if (typeof reply !== "string" || reply.length > MOVEMENT_MAX_REPLY_BYTES) {
            this.inFlight = false;
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.inFlight = false;
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed)) {
            this.inFlight = false;
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        const outcome = parsed["outcome"];
        if (outcome === "noop") {
            if (parsed["v"] !== MOVEMENT_CONTRACT_VERSION) {
                this.inFlight = false;
                this.reject("movement-service-fault");
                this.disable();
                return;
            }
            if (parsed["correlation_id"] !== correlation) {
                this.inFlight = false;
                this.reject("movement-correlation-mismatch");
                this.disable();
                return;
            }
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMover = null;
            // Idle reset: drop the pin so the next idle command re-resolves
            // and re-pins. Adapter stays enabled (no disable here).
            this.pinnedOwner = null;
            this.activationStep = 0;
            this.log(`${LOG_PREFIX}:noop`);
            return;
        }
        if (outcome === "rejected") {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMover = null;
            this.reject("movement-rejected");
            this.disable();
            return;
        }
        if (outcome === "diverged") {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMover = null;
            this.reject("movement-diverged");
            this.disable();
            return;
        }
        if (outcome !== "planned") {
            this.inFlight = false;
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        // Rehydrate the strict focus shape lost by the compact validator.
        const rawFocus = (parsed as Record<string, unknown>)["desired_focus"];
        const planned = validatePlanned(parsed, correlation);
        if (planned === null || !isRecord(rawFocus)) {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMover = null;
            this.reject("movement-precondition-mismatch");
            this.disable();
            return;
        }
        if (!validateDesiredFocus(rawFocus)) {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMover = null;
            this.reject("movement-precondition-mismatch");
            this.disable();
            return;
        }
        const full: PlannedMovement = {
            correlationId: planned.correlationId,
            baseRevision: planned.baseRevision,
            capability: planned.capability,
            rule: planned.rule,
            preconditions: planned.preconditions,
            operation: planned.operation,
            geometry: planned.geometry,
            focus: toDesiredFocus(rawFocus as Record<string, unknown>),
        };
        if (full.baseRevision !== this.readRevision()) {
            this.inFlight = false;
            this.pending = null;
            this.pendingObserved = null;
            this.pendingDirection = null;
            this.pendingMover = null;
            this.reject("movement-revision-mismatch");
            this.disable();
            return;
        }
        this.pending = full;
        this.applyPlanned(flight);
    }

    private boundsFor(
        output: string,
        workspace: string,
        domains: ReadonlyArray<MovementDomain>,
    ): MovementRect | null {
        for (const domain of domains) {
            if (domain.output === output && domain.workspace === workspace) {
                return domain.bounds;
            }
        }
        return null;
    }

    private applyPlanned(flight: number): void {
        const planned = this.pending;
        const captured = this.pendingObserved;
        const wantedDirection = this.pendingDirection;
        const mover = this.pendingMover;
        if (planned === null || captured === null || wantedDirection === null || mover === null) {
            this.inFlight = false;
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        // Desired projection must exactly cover the captured membership.
        const capturedIds = captured.windows.map((entry) => entry.id).sort();
        const desiredIds = planned.geometry.map((entry) => entry.window).sort();
        if (capturedIds.length !== desiredIds.length) {
            this.reportAdapterLost(planned);
            this.failApply("movement-target-mismatch");
            return;
        }
        for (let index = 0; index < capturedIds.length; index += 1) {
            if (capturedIds[index] !== desiredIds[index]) {
                this.reportAdapterLost(planned);
                this.failApply("movement-target-mismatch");
                return;
            }
        }
        // Finite integer targets, membership containment, no overlap.
        for (const entry of planned.geometry) {
            if (!isTargetRect({ x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h })) {
                this.reportAdapterLost(planned);
                this.failApply("movement-geometry-mismatch");
                return;
            }
            const bounds = this.boundsFor(entry.output, entry.workspace, captured.domains);
            if (bounds === null || !rectContained(entry.rect, bounds)) {
                this.reportAdapterLost(planned);
                this.failApply("movement-geometry-mismatch");
                return;
            }
        }
        for (let a = 0; a < planned.geometry.length; a += 1) {
            for (let b = a + 1; b < planned.geometry.length; b += 1) {
                const ra = (planned.geometry[a] as MovementDesired).rect;
                const rb = (planned.geometry[b] as MovementDesired).rect;
                if (rectsOverlap(ra, rb)) {
                    this.reportAdapterLost(planned);
                    this.failApply("movement-overlap-mismatch");
                    return;
                }
            }
        }
        // Complete desired final projection per affected nonempty domain:
        // every entry is contained in its domain bounds, entries within one
        // domain never overlap, and a zero-gap domain must be exactly filled
        // (no unaccounted gap). Domains with no desired windows (an emptied
        // R4 source) are skipped. Identity/membership exactness is checked by
        // the caller; this is native plan validation, not a geometry policy.
        const byDomain = new Map<string, MovementDesired[]>();
        for (const entry of planned.geometry) {
            const key = `${entry.output}\x1f${entry.workspace}`;
            const group = byDomain.get(key);
            if (group === undefined) {
                byDomain.set(key, [entry]);
            } else {
                group.push(entry);
            }
        }
        for (const [key, group] of byDomain) {
            for (let a = 0; a < group.length; a += 1) {
                for (let b = a + 1; b < group.length; b += 1) {
                    const ra = (group[a] as MovementDesired).rect;
                    const rb = (group[b] as MovementDesired).rect;
                    if (rectsOverlap(ra, rb)) {
                        this.reportAdapterLost(planned);
                        this.failApply("movement-overlap-mismatch");
                        return;
                    }
                }
            }
            const first = group[0] as MovementDesired;
            const bounds = this.boundsFor(first.output, first.workspace, captured.domains);
            if (bounds === null) {
                this.reportAdapterLost(planned);
                this.failApply("movement-geometry-mismatch");
                return;
            }
            let gap = 0;
            let gapFound = false;
            for (const domain of captured.domains) {
                if (domain.output === first.output && domain.workspace === first.workspace) {
                    gap = domain.gap;
                    gapFound = true;
                    break;
                }
            }
            void key;
            if (!gapFound) {
                this.reportAdapterLost(planned);
                this.failApply("movement-geometry-mismatch");
                return;
            }
            if (gap === 0) {
                let area = 0;
                for (const entry of group) {
                    area += rectArea(entry.rect);
                }
                if (area !== rectArea(bounds)) {
                    this.reportAdapterLost(planned);
                    this.failApply("movement-gap-mismatch");
                    return;
                }
            }
        }
        // R4 cross-output target must be reciprocal and current-direction
        // adjacent to the source domain: the source domain names the target
        // output in the requested direction and the target names the source
        // back via the opposite direction in the same workspace.
        if (planned.rule === "R4") {
            const operation = planned.operation;
            const targetOutput = operation["target_output"];
            const sourceDomain =
                captured.domains.find(
                    (domain) =>
                        domain.output === captured.domainOutput &&
                        domain.workspace === captured.domainWorkspace,
                ) ?? null;
            const sourceOut = sourceDomain?.output ?? captured.domainOutput;
            const sourceWs = sourceDomain?.workspace ?? captured.domainWorkspace;
            const targetDomain =
                captured.domains.find(
                    (domain) => domain.output === targetOutput && domain.workspace === sourceWs,
                ) ?? null;
            if (
                typeof targetOutput !== "string" ||
                sourceDomain === null ||
                targetDomain === null ||
                wantedDirection === null
            ) {
                this.reportAdapterLost(planned);
                this.failApply("movement-target-mismatch");
                return;
            }
            const forward = (sourceDomain.adjacent as Record<string, unknown>)[
                wantedDirection
            ];
            const back = (targetDomain.adjacent as Record<string, unknown>)[
                oppositeMovementDirection(wantedDirection)
            ];
            if (forward !== targetOutput || back !== sourceOut) {
                this.reportAdapterLost(planned);
                this.failApply("movement-target-mismatch");
                return;
            }
        }
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.failApply("movement-signal-invalid");
            return;
        }
        let authority = false;
        try {
            authority = this.env.hasExclusiveMovementAuthority() === true;
        } catch (error) {
            void error;
            authority = false;
        }
        if (!authority) {
            this.reportAdapterLost(planned);
            this.failApply("movement-exclusive-conflict");
            return;
        }
        let fresh: MovementObserved | null = null;
        try {
            fresh = this.env.observe();
        } catch (error) {
            void error;
            fresh = null;
        }
        if (!validateObserved(fresh)) {
            this.reportAdapterLost(planned);
            this.failApply("movement-stale-scope");
            return;
        }
        const current = fresh as MovementObserved;
        let ok = false;
        try {
            ok = current.revalidate() === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            this.reportAdapterLost(planned);
            this.failApply("movement-stale-revalidate");
            return;
        }
        if (current.fingerprint !== captured.fingerprint) {
            this.reportAdapterLost(planned);
            this.failApply("movement-stale-revalidate");
            return;
        }
        if (
            current.domainOutput !== captured.domainOutput ||
            current.domainWorkspace !== captured.domainWorkspace ||
            current.focusedId !== captured.focusedId
        ) {
            this.reportAdapterLost(planned);
            this.failApply("movement-stale-scope");
            return;
        }
        // Geometries and work areas must still match the captured preconditions.
        const capturedRects = new Map<string, MovementRect>();
        for (const entry of captured.windows) {
            capturedRects.set(entry.id, entry.rect);
        }
        for (const entry of current.windows) {
            const want = capturedRects.get(entry.id);
            if (want === undefined || !sameRect(want, entry.rect)) {
                this.reportAdapterLost(planned);
                this.failApply("movement-stale-revalidate");
                return;
            }
        }
        if (current.domains.length !== captured.domains.length) {
            this.reportAdapterLost(planned);
            this.failApply("movement-stale-scope");
            return;
        }
        // Deterministic native-boundary order, changed-only.
        const ordered = orderMovementWrites(capturedRects, planned.geometry);
        const byId = new Map<string, object>();
        for (const entry of current.windows) {
            byId.set(entry.id, entry.ref);
        }
        this.suppressing = false;
        let applied = 0;
        let partial = false;
        let partialToken = "movement-partial-apply";
        const desiredById = new Map<string, MovementDesired>();
        for (const entry of planned.geometry) {
            desiredById.set(entry.window, entry);
        }
        const writtenIds = new Set<string>();
        for (const entry of ordered) {
            // A queued public signal between writes invalidates terminally;
            // the loop polls no timer and waits on no configure barrier.
            if (this.invalidated) {
                partial = true;
                partialToken = "movement-signal-invalid";
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
            const bounds = this.boundsFor(entry.output, entry.workspace, captured.domains);
            if (bounds === null || !rectContained(entry.rect, bounds)) {
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
                partialToken = "movement-signal-invalid";
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
                    partialToken = "movement-signal-invalid";
                    break;
                }
                if (refetch.windows.length !== captured.windows.length) {
                    partial = true;
                    partialToken = "movement-signal-invalid";
                    break;
                }
                for (const candidate of refetch.windows) {
                    const want = writtenIds.has(candidate.id)
                        ? (desiredById.get(candidate.id) as MovementDesired).rect
                        : capturedRects.get(candidate.id);
                    if (want === undefined || !sameRect(want, candidate.rect)) {
                        partial = true;
                        partialToken = "movement-signal-invalid";
                        break;
                    }
                }
                if (partial) {
                    break;
                }
            } catch (error) {
                void error;
                partial = true;
                partialToken = "movement-signal-invalid";
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
        // Restore focus to the moved window.
        const moverRef = byId.get(mover);
        if (typeof moverRef !== "object" || moverRef === null) {
            this.reportAdapterLost(planned);
            this.failApply("movement-target-mismatch");
            return;
        }
        let currentActive: object | null = null;
        try {
            currentActive = this.env.active();
        } catch (error) {
            void error;
            currentActive = null;
        }
        if (currentActive !== moverRef) {
            let focused = false;
            try {
                focused = this.env.setActive(moverRef) === true;
            } catch (error) {
                void error;
                focused = false;
            }
            if (!focused) {
                this.reportAdapterLost(planned);
                this.failApply("movement-focus-failed");
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
        this.pendingMover = null;
        this.suppressing = false;
        this.pinnedOwner = null;
        this.activationStep = 0;
        this.reject(token);
        this.disable();
    }

    private sendAcknowledge(flight: number, planned: PlannedMovement): void {
        void flight;
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.failApply("movement-signal-invalid");
            return;
        }
        const target = this.plannerService();
        if (!isUniqueOwner(target)) {
            this.reportAdapterLost(planned);
            this.failApply("movement-owner-missing");
            return;
        }
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        let payload = "";
        try {
            payload = JSON.stringify({
                v: MOVEMENT_CONTRACT_VERSION,
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
            this.failApply("movement-service-fault");
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(MOVEMENT_TIMEOUT_MS, () => this.onTimeout(next, "ack"));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.failApply("movement-timer-failed");
            return;
        }
        this.cancelTimer = cancel;
        try {
            this.env.callDbus(
                target,
                MOVEMENT_OBJECT,
                MOVEMENT_INTERFACE,
                MOVEMENT_METHOD,
                payload,
                (reply) => this.onAckReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.reportAdapterLost(planned);
            this.failApply("movement-dbus-failed");
        }
    }

    private onAckReply(reply: unknown, flight: number, planned: PlannedMovement): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.failApply("movement-signal-invalid");
            return;
        }
        if (typeof reply !== "string" || reply.length > MOVEMENT_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.failApply("movement-service-fault");
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.failApply("movement-service-fault");
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "acknowledged") {
            this.reportAdapterLost(planned);
            this.failApply("movement-service-fault");
            return;
        }
        if (parsed["v"] !== MOVEMENT_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.failApply("movement-service-fault");
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.failApply("movement-correlation-mismatch");
            return;
        }
        if (parsed["base_revision"] !== planned.baseRevision) {
            this.reportAdapterLost(planned);
            this.failApply("movement-revision-mismatch");
            return;
        }
        this.sendVerify(planned);
    }

    private sendVerify(planned: PlannedMovement): void {
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.failApply("movement-signal-invalid");
            return;
        }
        const target = this.plannerService();
        if (!isUniqueOwner(target)) {
            this.reportAdapterLost(planned);
            this.failApply("movement-owner-missing");
            return;
        }
        this.callbackSeen = false;
        this.token += 1;
        const next = this.token;
        this.activeToken = next;
        let fresh: MovementObserved | null = null;
        try {
            fresh = this.env.observe();
        } catch (error) {
            void error;
            fresh = null;
        }
        if (!validateObserved(fresh)) {
            this.reportAdapterLost(planned);
            this.failApply("movement-post-stale");
            return;
        }
        const current = fresh as MovementObserved;
        let ok = false;
        try {
            ok = current.revalidate() === true;
        } catch (error) {
            void error;
            ok = false;
        }
        if (!ok) {
            this.reportAdapterLost(planned);
            this.failApply("movement-post-stale");
            return;
        }
        if (
            current.domainOutput !== planned.focus.domainOutput ||
            current.domainWorkspace !== planned.focus.domainWorkspace
        ) {
            this.reportAdapterLost(planned);
            this.failApply("movement-post-mismatch");
            return;
        }
        // Post-observation must still focus the moved window in the desired
        // domain: either a domain drift or a focus mismatch rejects before
        // any verify payload is built.
        const moverId = this.pendingMover;
        if (moverId === null || current.focusedId !== moverId) {
            this.reportAdapterLost(planned);
            this.failApply("movement-post-mismatch");
            return;
        }
        // Post-observation must project exactly to the desired geometry.
        const freshById = new Map<string, MovementObservedWindow>();
        for (const entry of current.windows) {
            freshById.set(entry.id, entry);
        }
        if (freshById.size !== planned.geometry.length) {
            this.reportAdapterLost(planned);
            this.failApply("movement-post-mismatch");
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
                this.failApply("movement-post-mismatch");
                return;
            }
            if (!sameRect(live.rect, entry.rect)) {
                this.reportAdapterLost(planned);
                this.failApply("movement-post-mismatch");
                return;
            }
            if (live.output !== entry.output || live.workspace !== entry.workspace) {
                this.reportAdapterLost(planned);
                this.failApply("movement-post-mismatch");
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
        // Focus must be restored to the mover.
        let activeRef: object | null = null;
        try {
            activeRef = this.env.active();
        } catch (error) {
            void error;
            activeRef = null;
        }
        const moverRef = freshById.get(this.pendingMover as string)?.ref ?? null;
        if (activeRef !== moverRef || moverRef === null) {
            this.reportAdapterLost(planned);
            this.failApply("movement-post-mismatch");
            return;
        }
        const sortedIds = current.windows.map((entry) => entry.id).sort();
        const fingerprint = movementFingerprint(
            planned.focus.domainOutput,
            planned.focus.domainWorkspace,
            this.pendingMover as string,
            sortedIds,
        );
        let payload = "";
        try {
            payload = JSON.stringify({
                v: MOVEMENT_CONTRACT_VERSION,
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
            this.failApply("movement-service-fault");
            return;
        }
        let cancel: (() => void) | null = null;
        try {
            cancel = this.env.scheduleOnce(MOVEMENT_TIMEOUT_MS, () => this.onTimeout(next, "verify"));
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.failApply("movement-timer-failed");
            return;
        }
        this.cancelTimer = cancel;
        try {
            this.env.callDbus(
                target,
                MOVEMENT_OBJECT,
                MOVEMENT_INTERFACE,
                MOVEMENT_METHOD,
                payload,
                (reply) => this.onVerifyReply(reply, next, planned),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.reportAdapterLost(planned);
            this.failApply("movement-dbus-failed");
        }
    }

    private onVerifyReply(reply: unknown, flight: number, planned: PlannedMovement): void {
        if (!this.inFlight || flight !== this.activeToken || this.callbackSeen) {
            return;
        }
        this.callbackSeen = true;
        this.clearTimer();
        this.inFlight = false;
        this.pending = null;
        this.pendingObserved = null;
        this.pendingDirection = null;
        this.pendingMover = null;
        this.suppressing = false;
        if (this.invalidated) {
            this.reportAdapterLost(planned);
            this.reject("movement-signal-invalid");
            this.disable();
            return;
        }
        if (typeof reply !== "string" || reply.length > MOVEMENT_MAX_REPLY_BYTES) {
            this.reportAdapterLost(planned);
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(reply);
        } catch (error) {
            void error;
            this.reportAdapterLost(planned);
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        if (!isRecord(parsed) || parsed["outcome"] !== "committed") {
            this.reportAdapterLost(planned);
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        if (parsed["v"] !== MOVEMENT_CONTRACT_VERSION) {
            this.reportAdapterLost(planned);
            this.reject("movement-service-fault");
            this.disable();
            return;
        }
        if (parsed["correlation_id"] !== planned.correlationId) {
            this.reportAdapterLost(planned);
            this.reject("movement-correlation-mismatch");
            this.disable();
            return;
        }
        const revision = parsed["revision"];
        if (typeof revision === "number" && Number.isInteger(revision) && revision === this.readRevision() + 1) {
            this.writeRevision(revision);
        } else {
            this.reportAdapterLost(planned);
            this.reject("movement-revision-mismatch");
            this.disable();
            return;
        }
        // Idle reset: drop the pin so the next idle command re-resolves.
        this.pinnedOwner = null;
        this.activationStep = 0;
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

    private log(message: string): void {
        try {
            this.env.log(message);
        } catch (error) {
            void error;
        }
    }
}
