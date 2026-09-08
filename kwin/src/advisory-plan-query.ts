// Slice 3 KWin read-only DescribeAdvisoryPlan client (standalone, manually driven).
//
// Boundary: injected pure provider supplies exactly one bounded normalized
// 3-window advisory input; this module validates bounds/schema, resolves the
// Planner well-known name via org.freedesktop.DBus GetNameOwner, pins the
// exact unique owner, sends the request to that pinned unique name only,
// revalidates the well-known owner still equals the pinned owner before
// accepting any reply, and fails closed otherwise. No execution command is
// ever sent and no native mutation/application APIs are used. All logs are
// fixed redacted tokens.
//
// Ordinary production startup never runs this module: src/entry.ts must not
// import or construct it. There is no dedicated entry point; tests drive it
// directly through the injected env.

export const ADVISORY_SERVICE = "org.plasmaautotiler.Planner";
export const ADVISORY_OBJECT = "/org/plasmaautotiler/Planner";
export const ADVISORY_INTERFACE = "org.plasmaautotiler.Planner1";
export const ADVISORY_METHOD = "DescribeAdvisoryPlan";

export const ADVISORY_CONTRACT_VERSION = 1;
export const ADVISORY_MAX_REQUEST_BYTES = 64 * 1024;
export const ADVISORY_MAX_REPLY_BYTES = 64 * 1024;
export const ADVISORY_TIMEOUT_MS = 2000;
export const ADVISORY_MAX_CORRELATION_LEN = 128;
export const ADVISORY_MAX_OWNER_LEN = 128;
export const ADVISORY_MAX_GENERATION_LEN = 64;
export const ADVISORY_MAX_REVISION = 1000000;
export const ADVISORY_MAX_ID_LEN = 128;
export const ADVISORY_WINDOW_COUNT = 3;
export const ADVISORY_MAX_OUTPUTS = 16;
export const ADVISORY_MAX_NODES_TOTAL = 512;
export const ADVISORY_MAX_CHILDREN = 32;
export const ADVISORY_MAX_DEPTH = 16;

export const DBUS_SERVICE = "org.freedesktop.DBus";
export const DBUS_OBJECT = "/org/freedesktop/DBus";
export const DBUS_INTERFACE = "org.freedesktop.DBus";
export const DBUS_METHOD = "GetNameOwner";

const LOG_PREFIX = "plasma-auto-tiler:advisory-plan";

export type AdvisoryDirection = "left" | "right" | "up" | "down";

export interface AdvisoryCapabilities {
    readonly swap_neighbor: boolean;
    readonly wrap_perpendicular: boolean;
    readonly wrap_siblings: boolean;
    readonly insert_child: boolean;
    readonly split_group_child: boolean;
    readonly reparent_leaf: boolean;
    readonly cross_output_transfer: boolean;
}

// Pure provider input. All fields are unknown at the boundary and strictly
// validated; the provider must supply opaque logical ids only. Native
// objects/handles are never accepted here.
export interface AdvisoryProviderInput {
    readonly correlationId: unknown;
    readonly owner: unknown;
    readonly generation: unknown;
    readonly revision: unknown;
    readonly snapshot: unknown;
    readonly intent: unknown;
    readonly capabilities: unknown;
}

export interface NormalizedAdvisoryBundle {
    readonly requestJson: string;
    readonly correlationId: string;
    readonly owner: string;
    readonly generation: string;
    readonly revision: number;
    readonly snapshotIds: readonly string[];
}

export type AdvisoryNormalizeResult =
    | { readonly ok: true; readonly bundle: NormalizedAdvisoryBundle }
    | { readonly ok: false; readonly reason: string };

export type AdvisoryReply =
    | {
          readonly outcome: "planned";
          readonly rule: string;
          readonly capability: string;
          readonly preconditions: readonly string[];
          readonly operation: Record<string, unknown>;
      }
    | { readonly outcome: "noop"; readonly reason: string }
    | { readonly outcome: "rejected"; readonly kind: string };

export type AdvisoryReplyValidation =
    | { readonly ok: true; readonly reply: AdvisoryReply }
    | { readonly ok: false; readonly reason: string };

export interface AdvisoryPlanEnv {
    readonly callDbus: (
        service: string,
        path: string,
        dbusInterface: string,
        method: string,
        payload: string,
        callback: (reply: unknown) => void,
    ) => void;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => () => void;
    readonly log: (message: string) => void;
    readonly provideInput: () => AdvisoryProviderInput | null;
}

const KNOWN_RULES: readonly string[] = Object.freeze(["R1", "R2a", "R2b", "R2c", "R3", "R4"]);
const KNOWN_CAPABILITIES_KEBAB: readonly string[] = Object.freeze([
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
const KNOWN_OPERATION_KINDS: readonly string[] = Object.freeze([
    "wrap-perpendicular",
    "swap-neighbor",
    "insert-into-group",
    "split-group-child",
    "wrap-neighbor",
    "escape-parent",
    "cross-output",
]);
const KNOWN_NOOP_REASONS: readonly string[] = Object.freeze([
    "boundary",
    "no-adjacent-output",
    "single-root-leaf",
]);
const KNOWN_REJECTION_KINDS: readonly string[] = Object.freeze([
    "snapshot-invalid",
    "capability-unsupported",
    "focused-leaf-not-found",
    "oversized",
    "request-malformed",
    "unknown-field",
    "unknown-value",
    "unsupported-version",
    "correlation-invalid",
    "owner-invalid",
    "generation-invalid",
    "revision-invalid",
    "owner-mismatch",
    "generation-mismatch",
    "stale-revision",
    "correlation-mismatch",
    "stale-request",
]);
const KNOWN_AXES: readonly string[] = Object.freeze(["horizontal", "vertical"]);
const KNOWN_DIRECTIONS: readonly string[] = Object.freeze(["left", "right", "up", "down"]);
const FORBIDDEN_REPLY_KEYS: readonly string[] = Object.freeze([
    "command",
    "desired",
    "execute",
    "exec",
    "script",
    "action",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isOpaqueId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > ADVISORY_MAX_ID_LEN) {
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
        value.length <= ADVISORY_MAX_CORRELATION_LEN &&
        isOpaqueId(value)
    );
}

function isOwnerId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= ADVISORY_MAX_OWNER_LEN &&
        isOpaqueId(value)
    );
}

function isGeneration(value: unknown): value is string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > ADVISORY_MAX_GENERATION_LEN
    ) {
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
        value <= ADVISORY_MAX_REVISION
    );
}

function isDirection(value: unknown): value is AdvisoryDirection {
    return value === "left" || value === "right" || value === "up" || value === "down";
}

function isUniqueOwner(value: unknown): value is string {
    return typeof value === "string" && /^:[0-9]+\.[0-9]+$/.test(value);
}

function contains(haystack: readonly string[], needle: unknown): boolean {
    return typeof needle === "string" && haystack.indexOf(needle) >= 0;
}

function isNonNegativeInteger(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
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

interface NodeCollect {
    total: number;
    ids: string[];
}

function collectNodeIds(node: unknown, depth: number, state: NodeCollect): boolean {
    if (depth > ADVISORY_MAX_DEPTH || state.total > ADVISORY_MAX_NODES_TOTAL) {
        return false;
    }
    if (!isRecord(node) || typeof node["kind"] !== "string") {
        return false;
    }
    const kind = node["kind"] as string;
    if (kind === "leaf") {
        if (!hasExactKeys(node, ["kind", "id"]) || node["kind"] !== "leaf") {
            return false;
        }
        if (!isOpaqueId(node["id"])) {
            return false;
        }
        state.total += 1;
        if (state.total > ADVISORY_MAX_NODES_TOTAL) {
            return false;
        }
        state.ids.push(node["id"] as string);
        return true;
    }
    if (kind === "group") {
        if (!hasExactKeys(node, ["kind", "id", "axis", "children"])) {
            return false;
        }
        if (!isOpaqueId(node["id"]) || !contains(KNOWN_AXES, node["axis"])) {
            return false;
        }
        if (!Array.isArray(node["children"]) || node["children"].length > ADVISORY_MAX_CHILDREN) {
            return false;
        }
        const children = node["children"] as unknown[];
        state.total += 1;
        if (state.total > ADVISORY_MAX_NODES_TOTAL) {
            return false;
        }
        state.ids.push(node["id"] as string);
        for (const child of children) {
            if (!collectNodeIds(child, depth + 1, state)) {
                return false;
            }
        }
        return true;
    }
    return false;
}

// Strict bounded normalization of the injected pure 3-window advisory input.
// Never reads native objects; only opaque logical ids supplied by the
// provider are validated and serialized.
export function normalizeAdvisoryRequest(input: unknown): AdvisoryNormalizeResult {
    if (!isRecord(input)) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    const correlationId = input["correlationId"];
    const owner = input["owner"];
    const generation = input["generation"];
    const revision = input["revision"];
    const snapshot = input["snapshot"];
    const intent = input["intent"];
    const capabilities = input["capabilities"];
    if (!isCorrelationId(correlationId) || !isOwnerId(owner)) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    if (!isGeneration(generation) || !isRevision(revision)) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    if (!isRecord(snapshot) || !isRecord(intent) || !isRecord(capabilities)) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    if (!hasExactKeys(snapshot, ["outputs", "windows"])) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    const outputs = snapshot["outputs"];
    const windows = snapshot["windows"];
    if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > ADVISORY_MAX_OUTPUTS) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    if (!Array.isArray(windows) || windows.length !== ADVISORY_WINDOW_COUNT) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    const snapshotIds: string[] = [];
    const outputIds: string[] = [];
    const nodeIds = new Set<string>();
    const windowIds = new Set<string>();
    const leafIds = new Set<string>();
    const collect: NodeCollect = { total: 0, ids: [] };
    for (const output of outputs as unknown[]) {
        if (!isRecord(output)) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        const hasTree = Object.prototype.hasOwnProperty.call(output, "tree");
        const expectedKeys = hasTree
            ? (["id", "workspace", "tree", "adjacent"] as const)
            : (["id", "workspace", "adjacent"] as const);
        if (!hasExactKeys(output, expectedKeys)) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        if (!isOpaqueId(output["id"]) || !isOpaqueId(output["workspace"])) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        const outputId = output["id"] as string;
        outputIds.push(outputId);
        snapshotIds.push(outputId, output["workspace"] as string);
        const adjacent = output["adjacent"];
        if (!isRecord(adjacent)) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        const adjacentKeys = Object.keys(adjacent);
        if (adjacentKeys.length > 4) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        for (const key of adjacentKeys) {
            if (!contains(KNOWN_DIRECTIONS, key) || !isOpaqueId(adjacent[key])) {
                return { ok: false, reason: "advisory-unsupported-topology" };
            }
            snapshotIds.push(adjacent[key] as string);
        }
        if (hasTree) {
            const before = collect.ids.length;
            if (!collectNodeIds(output["tree"], 0, collect)) {
                return { ok: false, reason: "advisory-unsupported-topology" };
            }
            for (let index = before; index < collect.ids.length; index += 1) {
                const id = collect.ids[index] as string;
                nodeIds.add(id);
                snapshotIds.push(id);
            }
        }
    }
    for (const link of windows as unknown[]) {
        if (!isRecord(link) || !hasExactKeys(link, ["window", "leaf", "output", "workspace"])) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        if (
            !isOpaqueId(link["window"]) ||
            !isOpaqueId(link["leaf"]) ||
            !isOpaqueId(link["output"]) ||
            !isOpaqueId(link["workspace"])
        ) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        const windowId = link["window"] as string;
        if (windowIds.has(windowId)) {
            return { ok: false, reason: "advisory-unsupported-topology" };
        }
        windowIds.add(windowId);
        leafIds.add(link["leaf"] as string);
        snapshotIds.push(windowId, link["leaf"] as string);
    }
    if (!hasExactKeys(intent, ["source_output", "focused_leaf", "focused_window", "direction"])) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    if (
        !isOpaqueId(intent["source_output"]) ||
        !isOpaqueId(intent["focused_leaf"]) ||
        !isOpaqueId(intent["focused_window"])
    ) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    if (!isDirection(intent["direction"])) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    if (outputIds.indexOf(intent["source_output"] as string) < 0) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    if (!nodeIds.has(intent["focused_leaf"] as string)) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    if (!windowIds.has(intent["focused_window"] as string)) {
        return { ok: false, reason: "advisory-unsupported-topology" };
    }
    if (
        !hasExactKeys(capabilities, [
            "swap_neighbor",
            "wrap_perpendicular",
            "wrap_siblings",
            "insert_child",
            "split_group_child",
            "reparent_leaf",
            "cross_output_transfer",
        ])
    ) {
        return { ok: false, reason: "advisory-invalid-input" };
    }
    for (const key of Object.keys(capabilities)) {
        if (typeof capabilities[key] !== "boolean") {
            return { ok: false, reason: "advisory-invalid-input" };
        }
    }
    const request = {
        v: ADVISORY_CONTRACT_VERSION,
        correlation_id: correlationId,
        owner,
        generation,
        revision,
        snapshot: {
            outputs: outputs as unknown,
            windows: windows as unknown,
        },
        intent: {
            source_output: intent["source_output"],
            focused_leaf: intent["focused_leaf"],
            focused_window: intent["focused_window"],
            direction: intent["direction"],
        },
        capabilities: {
            swap_neighbor: capabilities["swap_neighbor"],
            wrap_perpendicular: capabilities["wrap_perpendicular"],
            wrap_siblings: capabilities["wrap_siblings"],
            insert_child: capabilities["insert_child"],
            split_group_child: capabilities["split_group_child"],
            reparent_leaf: capabilities["reparent_leaf"],
            cross_output_transfer: capabilities["cross_output_transfer"],
        },
    };
    let requestJson = "";
    try {
        requestJson = JSON.stringify(request);
    } catch (error) {
        void error;
        return { ok: false, reason: "advisory-invalid-input" };
    }
    if (requestJson.length > ADVISORY_MAX_REQUEST_BYTES) {
        return { ok: false, reason: "advisory-oversized" };
    }
    return {
        ok: true,
        bundle: {
            requestJson,
            correlationId: correlationId as string,
            owner: owner as string,
            generation: generation as string,
            revision: revision as number,
            snapshotIds: Object.freeze([...snapshotIds]),
        },
    };
}

export interface AdvisoryReplyExpectation {
    readonly correlationId: string;
    readonly owner: string;
    readonly generation: string;
    readonly revision: number;
    readonly snapshotIds: readonly string[];
}

function operationReferencesResolve(
    operation: Record<string, unknown>,
    snapshotIds: readonly string[],
): boolean {
    const excluded = new Set([
        "kind",
        "rule",
        "axis",
        "insertion",
        "focused_side",
        "continuation",
        "target",
    ]);
    for (const key of Object.keys(operation)) {
        if (excluded.has(key)) {
            continue;
        }
        const value = operation[key];
        if (typeof value === "string") {
            if (snapshotIds.indexOf(value) < 0) {
                return false;
            }
        }
    }
    return true;
}

function validateOperationShape(operation: unknown, rule: string): operation is Record<string, unknown> {
    if (!isRecord(operation) || typeof operation["kind"] !== "string") {
        return false;
    }
    const kind = operation["kind"] as string;
    if (!contains(KNOWN_OPERATION_KINDS, kind)) {
        return false;
    }
    if (operation["rule"] !== rule) {
        return false;
    }
    switch (kind) {
        case "wrap-perpendicular":
            return (
                hasExactKeys(operation, ["kind", "rule", "container", "axis"]) &&
                typeof operation["container"] === "string" &&
                contains(KNOWN_AXES, operation["axis"])
            );
        case "swap-neighbor":
            return (
                hasExactKeys(operation, ["kind", "rule", "container", "neighbor"]) &&
                typeof operation["container"] === "string" &&
                typeof operation["neighbor"] === "string"
            );
        case "insert-into-group":
            return (
                hasExactKeys(operation, [
                    "kind",
                    "rule",
                    "container",
                    "target_group",
                    "insertion_index",
                    "insertion",
                ]) &&
                typeof operation["container"] === "string" &&
                typeof operation["target_group"] === "string" &&
                isNonNegativeInteger(operation["insertion_index"]) &&
                (operation["insertion"] === "midpoint" || operation["insertion"] === "near-edge")
            );
        case "split-group-child":
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
                typeof operation["container"] === "string" &&
                typeof operation["target_group"] === "string" &&
                typeof operation["target_child"] === "string" &&
                isNonNegativeInteger(operation["target_child_index"]) &&
                (operation["focused_side"] === "first" || operation["focused_side"] === "second") &&
                contains(KNOWN_AXES, operation["axis"])
            );
        case "wrap-neighbor":
            return (
                hasExactKeys(operation, [
                    "kind",
                    "rule",
                    "container",
                    "neighbor",
                    "focused_before_neighbor",
                    "axis",
                ]) &&
                typeof operation["container"] === "string" &&
                typeof operation["neighbor"] === "string" &&
                typeof operation["focused_before_neighbor"] === "boolean" &&
                contains(KNOWN_AXES, operation["axis"])
            );
        case "escape-parent":
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
                typeof operation["container"] === "string" &&
                typeof operation["parent"] === "string" &&
                isNonNegativeInteger(operation["container_child_index"]) &&
                (isNonNegativeInteger(operation["parent_insertion_index"]) ||
                    operation["parent_insertion_index"] === null) &&
                (operation["continuation"] === "none" || operation["continuation"] === "R1")
            );
        case "cross-output":
            return (
                hasExactKeys(operation, ["kind", "rule", "target_output", "source_root_child_index", "target"]) &&
                typeof operation["target_output"] === "string" &&
                isNonNegativeInteger(operation["source_root_child_index"]) &&
                (operation["target"] === "empty" || operation["target"] === "occupied")
            );
        default:
            return false;
    }
}

// Strict JSON reply schema/size/binding validation. Fixed redacted reasons
// only; received values are never echoed. Any rejected outcome fails closed.
export function validateAdvisoryReply(
    replyText: unknown,
    expected: AdvisoryReplyExpectation,
): AdvisoryReplyValidation {
    if (typeof replyText !== "string") {
        return { ok: false, reason: "advisory-reply-malformed" };
    }
    if (replyText.length > ADVISORY_MAX_REPLY_BYTES) {
        return { ok: false, reason: "advisory-reply-oversized" };
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(replyText);
    } catch (error) {
        void error;
        return { ok: false, reason: "advisory-reply-malformed" };
    }
    if (!isRecord(parsed)) {
        return { ok: false, reason: "advisory-reply-malformed" };
    }
    for (const forbidden of FORBIDDEN_REPLY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(parsed, forbidden)) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
    }
    if (parsed["v"] !== ADVISORY_CONTRACT_VERSION || parsed["correlation_id"] !== expected.correlationId) {
        return { ok: false, reason: "advisory-identity-mismatch" };
    }
    const outcome = parsed["outcome"];
    if (
        outcome !== "rejected" &&
        (parsed["owner"] !== expected.owner ||
            parsed["generation"] !== expected.generation ||
            parsed["revision"] !== expected.revision)
    ) {
        return { ok: false, reason: "advisory-identity-mismatch" };
    }
    if (outcome === "planned") {
        if (!hasExactKeys(parsed, [
            "v",
            "correlation_id",
            "owner",
            "generation",
            "revision",
            "outcome",
            "rule",
            "capability",
            "preconditions",
            "operation",
        ])) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        const rule = parsed["rule"];
        const capability = parsed["capability"];
        const preconditions = parsed["preconditions"];
        const operation = parsed["operation"];
        if (typeof rule !== "string" || !contains(KNOWN_RULES, rule)) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        if (typeof capability !== "string" || !contains(KNOWN_CAPABILITIES_KEBAB, capability)) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        if (!Array.isArray(preconditions)) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        for (const precondition of preconditions) {
            if (!contains(KNOWN_PRECONDITIONS, precondition)) {
                return { ok: false, reason: "advisory-outcome-mismatch" };
            }
        }
        if (!validateOperationShape(operation, rule)) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        const operationRecord = operation as Record<string, unknown>;
        for (const forbidden of FORBIDDEN_REPLY_KEYS) {
            if (Object.prototype.hasOwnProperty.call(operationRecord, forbidden)) {
                return { ok: false, reason: "advisory-outcome-mismatch" };
            }
        }
        if (!operationReferencesResolve(operationRecord, expected.snapshotIds)) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        return {
            ok: true,
            reply: {
                outcome: "planned",
                rule,
                capability,
                preconditions: Object.freeze([...(preconditions as string[])]),
                operation: operationRecord,
            },
        };
    }
    if (outcome === "noop") {
        if (!hasExactKeys(parsed, ["v", "correlation_id", "owner", "generation", "revision", "outcome", "reason"])) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        if (!contains(KNOWN_NOOP_REASONS, parsed["reason"])) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        return { ok: true, reply: { outcome: "noop", reason: parsed["reason"] as string } };
    }
    if (outcome === "rejected") {
        // Rust redacts owner/generation on rejected requests. A rejected reply
        // cannot enable native action, but correlation still binds it to this
        // one flight.
        if (!hasExactKeys(parsed, ["v", "correlation_id", "owner", "generation", "revision", "outcome", "kind", "message"]) ||
            !contains(KNOWN_REJECTION_KINDS, parsed["kind"])) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        if (typeof parsed["message"] !== "string" || (parsed["message"] as string).length === 0) {
            return { ok: false, reason: "advisory-outcome-mismatch" };
        }
        return { ok: true, reply: { outcome: "rejected", kind: parsed["kind"] as string } };
    }
    return { ok: false, reason: "advisory-outcome-mismatch" };
}

function logReject(env: AdvisoryPlanEnv, token: string): void {
    try {
        env.log(`${LOG_PREFIX}:reject:${token}`);
    } catch (error) {
        void error;
    }
}

// Standalone one-shot read-only advisory query. Exactly one flight, bounded
// timeout, pinned-unique routing with pre-accept revalidation. Sends no
// execution command and performs no native mutation.
export class AdvisoryPlanQuery {
    private armed = false;
    private inFlight = false;
    private consumed = false;
    private ownerResolved = false;
    private planReceived = false;
    private revalidated = false;
    private pinnedOwner: string | null = null;
    private pendingReply: unknown = null;
    private bundle: NormalizedAdvisoryBundle | null = null;
    private cancelTimer: (() => void) | null = null;

    constructor(private readonly env: AdvisoryPlanEnv) {}

    get isArmed(): boolean {
        return this.armed;
    }

    get isInFlight(): boolean {
        return this.inFlight;
    }

    enableOnce(): void {
        if (this.consumed || this.inFlight) {
            return;
        }
        this.armed = true;
    }

    runOnce(): void {
        if (this.consumed || this.inFlight || !this.armed) {
            logReject(this.env, this.inFlight ? "advisory-busy" : "advisory-disabled");
            return;
        }
        this.armed = false;
        this.consumed = true;
        let input: AdvisoryProviderInput | null = null;
        try {
            input = this.env.provideInput();
        } catch (error) {
            void error;
            input = null;
        }
        if (input === null) {
            logReject(this.env, "advisory-invalid-input");
            return;
        }
        const normalized = normalizeAdvisoryRequest(input);
        if (!normalized.ok) {
            logReject(this.env, normalized.reason);
            return;
        }
        this.bundle = normalized.bundle;
        this.inFlight = true;
        this.ownerResolved = false;
        this.planReceived = false;
        this.revalidated = false;
        this.pinnedOwner = null;
        this.pendingReply = null;
        let timerCancel: (() => void) | null = null;
        try {
            timerCancel = this.env.scheduleOnce(ADVISORY_TIMEOUT_MS, () => this.onTimeout());
        } catch (error) {
            void error;
            this.inFlight = false;
            logReject(this.env, "advisory-timer-failed");
            return;
        }
        this.cancelTimer = timerCancel;
        try {
            this.env.callDbus(
                DBUS_SERVICE,
                DBUS_OBJECT,
                DBUS_INTERFACE,
                DBUS_METHOD,
                ADVISORY_SERVICE,
                (reply) => this.onOwner(reply),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "advisory-dbus-failed");
        }
    }

    private onOwner(reply: unknown): void {
        if (!this.inFlight || this.ownerResolved || this.bundle === null) {
            return;
        }
        this.ownerResolved = true;
        if (!isUniqueOwner(reply)) {
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "advisory-owner-missing");
            return;
        }
        this.pinnedOwner = reply;
        try {
            this.env.callDbus(
                reply,
                ADVISORY_OBJECT,
                ADVISORY_INTERFACE,
                ADVISORY_METHOD,
                this.bundle.requestJson,
                (planReply) => this.onPlan(planReply),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "advisory-dbus-failed");
        }
    }

    private onPlan(reply: unknown): void {
        if (!this.inFlight || this.planReceived || this.pinnedOwner === null) {
            return;
        }
        this.planReceived = true;
        this.pendingReply = reply;
        try {
            this.env.callDbus(
                DBUS_SERVICE,
                DBUS_OBJECT,
                DBUS_INTERFACE,
                DBUS_METHOD,
                ADVISORY_SERVICE,
                (current) => this.onRevalidate(current),
            );
        } catch (error) {
            void error;
            this.clearTimer();
            this.inFlight = false;
            logReject(this.env, "advisory-dbus-failed");
        }
    }

    private onRevalidate(current: unknown): void {
        if (!this.inFlight || !this.planReceived || this.revalidated || this.bundle === null) {
            return;
        }
        this.revalidated = true;
        this.clearTimer();
        this.inFlight = false;
        if (current !== this.pinnedOwner) {
            logReject(this.env, "advisory-owner-changed");
            return;
        }
        const validated = validateAdvisoryReply(this.pendingReply, {
            correlationId: this.bundle.correlationId,
            owner: this.bundle.owner,
            generation: this.bundle.generation,
            revision: this.bundle.revision,
            snapshotIds: this.bundle.snapshotIds,
        });
        if (!validated.ok) {
            logReject(this.env, validated.reason);
            return;
        }
        const result = validated.reply;
        if (result.outcome === "planned") {
            try {
                this.env.log(`${LOG_PREFIX}:could-execute:${result.rule}:${result.capability}`);
            } catch (error) {
                void error;
            }
            return;
        }
        if (result.outcome === "noop") {
            logReject(this.env, `advisory-noop-${result.reason}`);
            return;
        }
        logReject(this.env, `advisory-rejected-${result.kind}`);
    }

    private onTimeout(): void {
        if (!this.inFlight) {
            return;
        }
        this.clearTimer();
        this.inFlight = false;
        logReject(this.env, "advisory-timeout");
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
}
