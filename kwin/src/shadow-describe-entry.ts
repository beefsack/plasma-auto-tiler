// Standalone one-shot shadow describe KWin entry (opt-in only).
//
// Separately bundled ES2017 IIFE invokes its one-shot entry exactly once at
// load with no exported globals: ordinary startup never runs this module,
// there is no builder in this source, and the load-time call is guarded by
// the builder request define plus the KWin seams so a plain import stays a
// silent no-op for tests. The explicit exported startShadowDescribeEntry
// function remains for tests and is called by no production source.
//
// At start it reads only builder-supplied bounded identity
// (nonce/correlation/owner/generation/revision) plus three source bindings,
// captures exactly one current trio observation through the shared read-only
// snapshot helper, and runs exactly one owner-pinned ShadowProjection flight
// with its own revalidation. It emits a fixed source binding marker, a fixed
// ready marker, exactly one correlated versioned result whose detail is
// exactly match or divergence with after true, or one bounded stale/reject
// refusal with after false, and exactly one correlated versioned
// after-equality verdict. Fail-closed pairing holds: match/divergence only
// with after true; stale/reject only with after false. A drifted after
// forces an explicit stale reject instead of success, and a fresh reject
// terminal stays a refusal with after false. After its one terminal result
// it disables the flight and ignores later callbacks; an explicit stop
// before terminal disables the flight, emits no result/after, and ignores
// later callbacks. No polling, no follow-on action path.

import { ShadowProjection } from "./advisory-shadow-projection";
import {
    captureShadowProjectionObservation,
    isAdvisorySnapshotReject,
} from "./advisory-snapshot";

declare const SHADOW_DESCRIBE_REQUEST_JSON: string;
declare const SHADOW_DESCRIBE_ENTRY_SHA256: string;
declare const SHADOW_DESCRIBE_SHADOW_SHA256: string;
declare const SHADOW_DESCRIBE_SNAPSHOT_SHA256: string;

export const SHADOW_DESCRIBE_READY_PREFIX = "plasma-auto-tiler:shadow-describe-ready";
export const SHADOW_DESCRIBE_RESULT_PREFIX = "plasma-auto-tiler:shadow-describe-result";
export const SHADOW_DESCRIBE_RESULT_SCHEMA = "v1";
export const SHADOW_DESCRIBE_AFTER_PREFIX = "plasma-auto-tiler:shadow-describe-after";
export const SHADOW_DESCRIBE_AFTER_SCHEMA = "v1";
export const SHADOW_DESCRIBE_AFTER_TRUE = "true";
export const SHADOW_DESCRIBE_AFTER_FALSE = "false";
export const SHADOW_DESCRIBE_STALE_DETAIL = "reject:shadow-stale-snapshot";
export const SHADOW_DESCRIBE_SNAPSHOT_REJECT_PREFIX = "reject:advisory-snapshot-";
export const SHADOW_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL = "reject:advisory-snapshot-invalid-input";
export const SHADOW_DESCRIBE_SOURCE_PREFIX = "plasma-auto-tiler:shadow-describe-source";
export const SHADOW_DESCRIBE_INVALID_LOG = "plasma-auto-tiler:shadow-describe-invalid";
export const SHADOW_DESCRIBE_NONCE_RE = /^[0-9a-f]{32,128}$/;
export const SHADOW_DESCRIBE_OWNER_RE = /^[A-Za-z0-9._-]{1,128}$/;
export const SHADOW_DESCRIBE_GENERATION_RE = /^[a-z0-9-]{1,64}$/;
export const SHADOW_DESCRIBE_MAX_REVISION = 1000000;
export const SHADOW_DESCRIBE_GAP = 8;

const SHADOW_DESCRIBE_EXPECTED_KEYS: readonly string[] = [
    "nonce",
    "correlationId",
    "owner",
    "generation",
    "revision",
];

const SHADOW_TERMINAL_PREFIX = "plasma-auto-tiler:shadow-projection:";
const SHADOW_TERMINAL_MATCH = `${SHADOW_TERMINAL_PREFIX}match`;
const SHADOW_TERMINAL_DIVERGENCE = `${SHADOW_TERMINAL_PREFIX}divergence`;
const SHADOW_TERMINAL_REJECT_PREFIX = `${SHADOW_TERMINAL_PREFIX}reject:`;
const SHADOW_DETAIL_RE = /^(match|divergence|reject:[A-Za-z0-9._-]{1,128})$/;

export interface ShadowDescribeRecord {
    readonly nonce: string;
    readonly correlationId: string;
    readonly owner: string;
    readonly generation: string;
    readonly revision: number;
}

export type ShadowDescribeValidation =
    | { readonly ok: true; readonly record: ShadowDescribeRecord }
    | { readonly ok: false; readonly reason: string };

export interface ShadowDescribeOverrides {
    readonly workspace?: unknown;
    readonly callDbus?: (
        service: string,
        path: string,
        dbusInterface: string,
        method: string,
        payload: string,
        callback: (reply: unknown) => void,
    ) => void;
    readonly scheduleOnce?: (delayMs: number, callback: () => void) => () => void;
    readonly log?: (message: string) => void;
    readonly requestJson?: string | Record<string, unknown>;
    readonly entrySha?: string;
    readonly shadowSha?: string;
    readonly snapshotSha?: string;
}

export interface ShadowDescribeHandle {
    readonly stop: () => void;
    readonly isFinished: () => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Strict bounded check of the builder-supplied identity record. The
// correlationId must equal the invocation nonce so the later reply binds to
// this exact invocation. No window ids or geometry are accepted here; the
// observation always comes from the live trio capture.
export function validateShadowDescribeInput(raw: unknown): ShadowDescribeValidation {
    if (!isRecord(raw)) {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    const keys = Object.keys(raw);
    if (keys.length !== SHADOW_DESCRIBE_EXPECTED_KEYS.length) {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    for (const key of SHADOW_DESCRIBE_EXPECTED_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) {
            return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
        }
    }
    const nonce = raw["nonce"];
    const correlationId = raw["correlationId"];
    const owner = raw["owner"];
    const generation = raw["generation"];
    const revision = raw["revision"];
    if (typeof nonce !== "string" || !SHADOW_DESCRIBE_NONCE_RE.test(nonce)) {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    if (correlationId !== nonce) {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    if (typeof owner !== "string" || !SHADOW_DESCRIBE_OWNER_RE.test(owner)) {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    if (typeof generation !== "string" || !SHADOW_DESCRIBE_GENERATION_RE.test(generation)) {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    if (
        typeof revision !== "number" ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision > SHADOW_DESCRIBE_MAX_REVISION
    ) {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    return {
        ok: true,
        record: {
            nonce,
            correlationId: nonce,
            owner,
            generation,
            revision,
        },
    };
}

function resolveLexicalWorkspace(): unknown {
    try {
        const candidate: unknown = workspace;
        if (typeof candidate === "object" && candidate !== null) {
            return candidate;
        }
    } catch (error) {
        void error;
    }
    return null;
}

function resolveCallDbus(
    override: ShadowDescribeOverrides["callDbus"],
): ShadowDescribeOverrides["callDbus"] {
    if (override !== undefined) {
        return override;
    }
    try {
        const native: unknown = callDBus;
        if (typeof native === "function") {
            return (service, path, dbusInterface, method, payload, callback) => {
                (native as (...args: readonly unknown[]) => void)(
                    service,
                    path,
                    dbusInterface,
                    method,
                    payload,
                    callback,
                );
            };
        }
    } catch (error) {
        void error;
    }
    return undefined;
}

function resolveScheduleOnce(
    override: ShadowDescribeOverrides["scheduleOnce"],
): ShadowDescribeOverrides["scheduleOnce"] {
    if (override !== undefined) {
        return override;
    }
    try {
        const ctor: unknown = QTimer;
        if (typeof ctor === "function") {
            return (delayMs, callback) => {
                const timer = new (ctor as new () => QTimer)();
                timer.interval = delayMs;
                timer.singleShot = true;
                timer.timeout.connect(callback);
                timer.start();
                return () => {
                    try {
                        timer.stop();
                    } catch (error) {
                        void error;
                    }
                };
            };
        }
    } catch (error) {
        void error;
    }
    return undefined;
}

function resolveLog(override: ShadowDescribeOverrides["log"]): (message: string) => void {
    if (override !== undefined) {
        return override;
    }
    return (message: string): void => {
        try {
            console.log(message);
        } catch (error) {
            void error;
        }
    };
}

function readInjectedRecord(overrides: ShadowDescribeOverrides): ShadowDescribeValidation {
    const injected = overrides.requestJson;
    if (injected !== undefined) {
        if (typeof injected === "string") {
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(injected);
            } catch (error) {
                void error;
                return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
            }
            return validateShadowDescribeInput(parsed);
        }
        return validateShadowDescribeInput(injected);
    }
    let text: unknown = null;
    try {
        text = SHADOW_DESCRIBE_REQUEST_JSON;
    } catch (error) {
        void error;
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    if (typeof text !== "string") {
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        void error;
        return { ok: false, reason: SHADOW_DESCRIBE_INVALID_LOG };
    }
    return validateShadowDescribeInput(parsed);
}

function isSourceSha(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function readSourceBinding(
    overrides: ShadowDescribeOverrides,
): { readonly ok: true; readonly entrySha: string; readonly shadowSha: string; readonly snapshotSha: string } | { readonly ok: false } {
    let entrySha: unknown = null;
    let shadowSha: unknown = null;
    let snapshotSha: unknown = null;
    try {
        entrySha = overrides.entrySha !== undefined ? overrides.entrySha : SHADOW_DESCRIBE_ENTRY_SHA256;
    } catch (error) {
        void error;
        return { ok: false };
    }
    try {
        shadowSha = overrides.shadowSha !== undefined ? overrides.shadowSha : SHADOW_DESCRIBE_SHADOW_SHA256;
    } catch (error) {
        void error;
        return { ok: false };
    }
    try {
        snapshotSha = overrides.snapshotSha !== undefined ? overrides.snapshotSha : SHADOW_DESCRIBE_SNAPSHOT_SHA256;
    } catch (error) {
        void error;
        return { ok: false };
    }
    if (!isSourceSha(entrySha) || !isSourceSha(shadowSha) || !isSourceSha(snapshotSha)) {
        return { ok: false };
    }
    return { ok: true, entrySha, shadowSha, snapshotSha };
}

function sourceBindingLine(entrySha: string, shadowSha: string, snapshotSha: string): string {
    return `${SHADOW_DESCRIBE_SOURCE_PREFIX}:${entrySha}:${shadowSha}:${snapshotSha}`;
}

function afterVerdictLine(correlationId: string, equal: boolean): string {
    return `${SHADOW_DESCRIBE_AFTER_PREFIX}:${SHADOW_DESCRIBE_AFTER_SCHEMA}:${correlationId}:${equal ? SHADOW_DESCRIBE_AFTER_TRUE : SHADOW_DESCRIBE_AFTER_FALSE}`;
}

function resultLine(record: ShadowDescribeRecord, detail: string): string {
    return `${SHADOW_DESCRIBE_RESULT_PREFIX}:${SHADOW_DESCRIBE_RESULT_SCHEMA}:${record.correlationId}:${record.owner}:${record.generation}:${record.revision}:${record.nonce}:${detail}`;
}

function readAfterEquality(revalidate: () => boolean): boolean {
    try {
        return revalidate() === true;
    } catch (error) {
        void error;
        return false;
    }
}

function snapshotRejectDetail(reason: unknown): string {
    if (isAdvisorySnapshotReject(reason)) {
        return `${SHADOW_DESCRIBE_SNAPSHOT_REJECT_PREFIX}${reason.slice("advisory-snapshot-".length)}`;
    }
    return SHADOW_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL;
}

// Explicit opt-in one-shot activation only; called by no production source.
// Returns a stop handle on success, null fail-closed after logging one fixed
// token when builder identity, source binding, or transport seams are bad.
// A failed trio capture still emits its correlated source/ready/result/after
// sequence with a bounded snapshot reject before returning a finished handle.
export function startShadowDescribeEntry(overrides: ShadowDescribeOverrides = {}): ShadowDescribeHandle | null {
    const log = resolveLog(overrides.log);
    const invalid = (): null => {
        try {
            log(SHADOW_DESCRIBE_INVALID_LOG);
        } catch (error) {
            void error;
        }
        return null;
    };
    const binding = readSourceBinding(overrides);
    if (!binding.ok) {
        return invalid();
    }
    const checked = readInjectedRecord(overrides);
    if (!checked.ok) {
        return invalid();
    }
    const record = checked.record;
    const liveWorkspace: unknown =
        overrides.workspace !== undefined ? overrides.workspace : resolveLexicalWorkspace();
    const callDbus = resolveCallDbus(overrides.callDbus);
    const scheduleOnce = resolveScheduleOnce(overrides.scheduleOnce);
    if (typeof liveWorkspace !== "object" || liveWorkspace === null) {
        return invalid();
    }
    if (callDbus === undefined || scheduleOnce === undefined) {
        return invalid();
    }
    let captured: ReturnType<typeof captureShadowProjectionObservation> | null = null;
    try {
        captured = captureShadowProjectionObservation(liveWorkspace as Workspace);
    } catch (error) {
        void error;
        captured = null;
    }
    if (captured === null || !captured.ok) {
        const reason = captured === null
            ? SHADOW_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL
            : snapshotRejectDetail(captured.reason);
        const detail = SHADOW_DETAIL_RE.test(reason) ? reason : SHADOW_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL;
        try {
            log(sourceBindingLine(binding.entrySha, binding.shadowSha, binding.snapshotSha));
        } catch (error) {
            void error;
        }
        try {
            log(`${SHADOW_DESCRIBE_READY_PREFIX}:${record.correlationId}`);
        } catch (error) {
            void error;
        }
        try {
            log(resultLine(record, detail));
        } catch (error) {
            void error;
        }
        try {
            log(afterVerdictLine(record.correlationId, false));
        } catch (error) {
            void error;
        }
        return {
            stop: (): void => undefined,
            isFinished: (): boolean => true,
        };
    }
    const observation = captured.observation;
    const revalidate = observation.revalidate;
    let finished = false;
    let stopped = false;
    const projection = new ShadowProjection({
        callDbus,
        scheduleOnce,
        log: (message: string): void => {
            if (finished || stopped) {
                return;
            }
            if (
                message !== SHADOW_TERMINAL_MATCH &&
                message !== SHADOW_TERMINAL_DIVERGENCE &&
                message.indexOf(SHADOW_TERMINAL_REJECT_PREFIX) !== 0
            ) {
                return;
            }
            const terminal = message.slice(SHADOW_TERMINAL_PREFIX.length);
            const equal = readAfterEquality(revalidate);
            const isSuccessTerminal = terminal === "match" || terminal === "divergence";
            let detail: string;
            let after: boolean;
            if (equal && isSuccessTerminal) {
                detail = terminal;
                after = true;
            } else if (equal) {
                detail = SHADOW_DETAIL_RE.test(terminal) ? terminal : SHADOW_DESCRIBE_STALE_DETAIL;
                after = false;
            } else {
                detail = SHADOW_DESCRIBE_STALE_DETAIL;
                after = false;
            }
            if (!SHADOW_DETAIL_RE.test(detail)) {
                detail = SHADOW_DESCRIBE_STALE_DETAIL;
                after = false;
            }
            finished = true;
            stopped = true;
            try {
                projection.disable();
            } catch (error) {
                void error;
            }
            try {
                log(resultLine(record, detail));
            } catch (error) {
                void error;
            }
            try {
                log(afterVerdictLine(record.correlationId, after));
            } catch (error) {
                void error;
            }
        },
        provideInput: () => {
            if (stopped || finished) {
                return null;
            }
            return {
                correlationId: record.correlationId,
                owner: record.owner,
                generation: record.generation,
                revision: record.revision,
                output: {
                    id: observation.output.id,
                    workspace: observation.output.workspace,
                    workArea: {
                        x: observation.output.workArea.x,
                        y: observation.output.workArea.y,
                        w: observation.output.workArea.w,
                        h: observation.output.workArea.h,
                    },
                },
                windows: observation.windows.map((entry) => ({
                    window: entry.window,
                    output: entry.output,
                    workspace: entry.workspace,
                    rect: {
                        x: entry.rect.x,
                        y: entry.rect.y,
                        w: entry.rect.w,
                        h: entry.rect.h,
                    },
                })),
                gap: SHADOW_DESCRIBE_GAP,
                focusedWindow: observation.focusedWindow,
                capabilities: { shadow_projection: true },
            };
        },
        revalidateInput: () => {
            try {
                return revalidate() === true;
            } catch (error) {
                void error;
                return false;
            }
        },
    });
    try {
        log(sourceBindingLine(binding.entrySha, binding.shadowSha, binding.snapshotSha));
    } catch (error) {
        void error;
    }
    try {
        log(`${SHADOW_DESCRIBE_READY_PREFIX}:${record.correlationId}`);
    } catch (error) {
        void error;
    }
    projection.enable();
    projection.requestRecompute();
    return {
        stop: (): void => {
            stopped = true;
            try {
                projection.disable();
            } catch (error) {
                void error;
            }
        },
        isFinished: (): boolean => finished,
    };
}

function shouldAutoStartShadowDescribeEntry(): boolean {
    try {
        if (typeof SHADOW_DESCRIBE_REQUEST_JSON !== "string") {
            return false;
        }
    } catch (error) {
        void error;
        return false;
    }
    try {
        if (typeof workspace === "undefined") {
            return false;
        }
    } catch (error) {
        void error;
        return false;
    }
    try {
        if (typeof callDBus === "undefined") {
            return false;
        }
    } catch (error) {
        void error;
        return false;
    }
    try {
        if (typeof QTimer === "undefined") {
            return false;
        }
    } catch (error) {
        void error;
        return false;
    }
    return true;
}

let shadowDescribeAutoStarted = false;
if (!shadowDescribeAutoStarted) {
    shadowDescribeAutoStarted = true;
    if (shouldAutoStartShadowDescribeEntry()) {
        try {
            startShadowDescribeEntry();
        } catch (error) {
            void error;
        }
    }
}
