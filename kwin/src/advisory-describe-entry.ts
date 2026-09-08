// Standalone read-only DescribeAdvisoryPlan KWin module (advisory-only).
//
// Separately bundled IIFE built ONLY by scripts/advisory-describe-build.mjs
// into kwin/dist/advisory-describe.js plus its sidecar manifest. Ordinary
// production startup never runs this module: src/entry.ts must not bring it
// in, and it brings in nothing except ./advisory-plan-query and
// ./advisory-snapshot.
//
// At load it checks the builder-supplied request record
// (ADVISORY_DESCRIBE_REQUEST_JSON), needs a high-entropy invocation nonce
// (at least 32 lower hex chars) with correlationId tied to that nonce, plus
// bounded owner/generation/revision and opaque snapshot/intent/capabilities.
// On success it notes a fixed source-binding marker and a fixed ready marker
// carrying the correlation, then runs exactly one AdvisoryPlanQuery flight
// through KWin callDBus with its own QTimer pacing and console notes. Every
// query note is mirrored with a correlation-bound result marker so a later
// host pass can match reply to request, followed by a bounded opaque
// correlated after-equality verdict after every terminal query result. A
// drifted after forces an explicit stale reject result instead of success.
// A bad record notes a fixed invalid marker and sends nothing. No native
// handles, no state changes, and no follow-on action path.

import { AdvisoryPlanQuery } from "./advisory-plan-query";
import { ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT, captureAdvisorySnapshot, isAdvisorySnapshotReject } from "./advisory-snapshot";

declare const ADVISORY_DESCRIBE_REQUEST_JSON: string;
declare const ADVISORY_DESCRIBE_ENTRY_SHA256: string;
declare const ADVISORY_DESCRIBE_QUERY_SHA256: string;
declare const ADVISORY_DESCRIBE_SNAPSHOT_SHA256: string;

export const ADVISORY_DESCRIBE_READY_PREFIX = "plasma-auto-tiler:advisory-describe-ready";
export const ADVISORY_DESCRIBE_RESULT_PREFIX = "plasma-auto-tiler:advisory-describe-result";
export const ADVISORY_DESCRIBE_RESULT_SCHEMA = "v1";
export const ADVISORY_DESCRIBE_AFTER_PREFIX = "plasma-auto-tiler:advisory-describe-after";
export const ADVISORY_DESCRIBE_AFTER_SCHEMA = "v1";
export const ADVISORY_DESCRIBE_AFTER_TRUE = "true";
export const ADVISORY_DESCRIBE_AFTER_FALSE = "false";
export const ADVISORY_DESCRIBE_STALE_DETAIL = "reject:advisory-stale-snapshot";
export const ADVISORY_DESCRIBE_SNAPSHOT_REJECT_PREFIX = "reject:advisory-snapshot-";
export const ADVISORY_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL =
    `reject:${ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT}`;
export const ADVISORY_DESCRIBE_SOURCE_PREFIX = "plasma-auto-tiler:advisory-describe-source";
export const ADVISORY_DESCRIBE_INVALID_LOG = "plasma-auto-tiler:advisory-describe-invalid";
export const ADVISORY_DESCRIBE_NONCE_RE = /^[0-9a-f]{32,128}$/;
export const ADVISORY_DESCRIBE_OWNER_RE = /^[A-Za-z0-9._-]{1,128}$/;
export const ADVISORY_DESCRIBE_GENERATION_RE = /^[a-z0-9-]{1,64}$/;
export const ADVISORY_DESCRIBE_MAX_REVISION = 1000000;

const ADVISORY_DESCRIBE_EXPECTED_KEYS: readonly string[] = [
    "nonce",
    "correlationId",
    "owner",
    "generation",
    "revision",
    "snapshot",
    "intent",
    "capabilities",
];

export interface AdvisoryDescribeRecord {
    readonly nonce: string;
    readonly correlationId: string;
    readonly owner: string;
    readonly generation: string;
    readonly revision: number;
    readonly snapshot: Record<string, unknown>;
    readonly intent: Record<string, unknown>;
    readonly capabilities: Record<string, unknown>;
}

export type AdvisoryDescribeValidation =
    | { readonly ok: true; readonly record: AdvisoryDescribeRecord }
    | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Strict bounded check of the builder-supplied record. The correlationId
// must equal the invocation nonce so the later reply binds to this exact
// invocation. Deeper topology checks stay with normalizeAdvisoryRequest at
// query time; this gate only shapes safe identity fields.
export function validateDescribeInput(raw: unknown): AdvisoryDescribeValidation {
    if (!isRecord(raw)) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    const keys = Object.keys(raw);
    if (keys.length !== ADVISORY_DESCRIBE_EXPECTED_KEYS.length) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    for (const key of ADVISORY_DESCRIBE_EXPECTED_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) {
            return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
        }
    }
    const nonce = raw["nonce"];
    const correlationId = raw["correlationId"];
    const owner = raw["owner"];
    const generation = raw["generation"];
    const revision = raw["revision"];
    const snapshot = raw["snapshot"];
    const intent = raw["intent"];
    const capabilities = raw["capabilities"];
    if (typeof nonce !== "string" || !ADVISORY_DESCRIBE_NONCE_RE.test(nonce)) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    if (correlationId !== nonce) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    if (typeof owner !== "string" || !ADVISORY_DESCRIBE_OWNER_RE.test(owner)) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    if (typeof generation !== "string" || !ADVISORY_DESCRIBE_GENERATION_RE.test(generation)) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    if (
        typeof revision !== "number" ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision > ADVISORY_DESCRIBE_MAX_REVISION
    ) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    if (!isRecord(snapshot) || !isRecord(intent) || !isRecord(capabilities)) {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    return {
        ok: true,
        record: {
            nonce,
            correlationId: nonce,
            owner,
            generation,
            revision,
            snapshot,
            intent,
            capabilities,
        },
    };
}

const describeTimers = new Set<QTimer>();

function scheduleDescribeOnce(delayMs: number, callback: () => void): () => void {
    const timer = new QTimer();
    describeTimers.add(timer);
    timer.interval = delayMs;
    timer.singleShot = true;
    timer.timeout.connect(() => {
        try {
            callback();
        } finally {
            describeTimers.delete(timer);
        }
    });
    timer.start();
    return () => {
        try {
            timer.stop();
        } catch (error) {
            void error;
        } finally {
            describeTimers.delete(timer);
        }
    };
}

function readInjectedRecord(): AdvisoryDescribeValidation {
    let text: unknown = null;
    try {
        text = ADVISORY_DESCRIBE_REQUEST_JSON;
    } catch (error) {
        void error;
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    if (typeof text !== "string") {
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        void error;
        return { ok: false, reason: ADVISORY_DESCRIBE_INVALID_LOG };
    }
    return validateDescribeInput(parsed);
}

function isSourceSha(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function readSourceBinding(): { readonly ok: true; readonly entrySha: string; readonly querySha: string; readonly snapshotSha: string } | { readonly ok: false } {
    let entrySha: unknown = null;
    let querySha: unknown = null;
    let snapshotSha: unknown = null;
    try {
        entrySha = ADVISORY_DESCRIBE_ENTRY_SHA256;
    } catch (error) {
        void error;
        return { ok: false };
    }
    try {
        querySha = ADVISORY_DESCRIBE_QUERY_SHA256;
    } catch (error) {
        void error;
        return { ok: false };
    }
    try {
        snapshotSha = ADVISORY_DESCRIBE_SNAPSHOT_SHA256;
    } catch (error) {
        void error;
        return { ok: false };
    }
    if (!isSourceSha(entrySha) || !isSourceSha(querySha) || !isSourceSha(snapshotSha)) {
        return { ok: false };
    }
    return { ok: true, entrySha, querySha, snapshotSha };
}

function sourceBindingLine(entrySha: string, querySha: string, snapshotSha: string): string {
    return `${ADVISORY_DESCRIBE_SOURCE_PREFIX}:${entrySha}:${querySha}:${snapshotSha}`;
}

function afterVerdictLine(correlationId: string, equal: boolean): string {
    return `${ADVISORY_DESCRIBE_AFTER_PREFIX}:${ADVISORY_DESCRIBE_AFTER_SCHEMA}:${correlationId}:${equal ? ADVISORY_DESCRIBE_AFTER_TRUE : ADVISORY_DESCRIBE_AFTER_FALSE}`;
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
        return `${ADVISORY_DESCRIBE_SNAPSHOT_REJECT_PREFIX}${reason.slice("advisory-snapshot-".length)}`;
    }
    return ADVISORY_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL;
}

function logCaptureFailure(
    record: AdvisoryDescribeRecord,
    entrySha: string,
    querySha: string,
    snapshotSha: string,
    reason: unknown,
): void {
    const detail = snapshotRejectDetail(reason);
    try {
        console.log(sourceBindingLine(entrySha, querySha, snapshotSha));
    } catch (error) {
        void error;
    }
    try {
        console.log(`${ADVISORY_DESCRIBE_READY_PREFIX}:${record.correlationId}`);
    } catch (error) {
        void error;
    }
    try {
        console.log(ADVISORY_DESCRIBE_INVALID_LOG);
    } catch (error) {
        void error;
    }
    try {
        console.log(
            `${ADVISORY_DESCRIBE_RESULT_PREFIX}:${ADVISORY_DESCRIBE_RESULT_SCHEMA}:${record.correlationId}:${record.owner}:${record.generation}:${record.revision}:${record.nonce}:${detail}`,
        );
    } catch (error) {
        void error;
    }
    try {
        console.log(afterVerdictLine(record.correlationId, false));
    } catch (error) {
        void error;
    }
}

function startAdvisoryDescribeOnce(): void {
    const binding = readSourceBinding();
    if (!binding.ok) {
        try {
            console.log(ADVISORY_DESCRIBE_INVALID_LOG);
        } catch (error) {
            void error;
        }
        return;
    }
    const checked = readInjectedRecord();
    if (!checked.ok) {
        try {
            console.log(ADVISORY_DESCRIBE_INVALID_LOG);
        } catch (error) {
            void error;
        }
        return;
    }
    const record = checked.record;
    let direction: unknown = null;
    try {
        direction = (record.intent as Record<string, unknown>)["direction"];
    } catch (error) {
        void error;
        direction = null;
    }
    let captured: ReturnType<typeof captureAdvisorySnapshot> | null = null;
    try {
        captured = captureAdvisorySnapshot(workspace, direction);
    } catch (error) {
        void error;
        captured = null;
    }
    if (captured === null || !captured.ok) {
        const reason = captured === null ? ADVISORY_SNAPSHOT_REJECT_INVALID_INPUT : captured.reason;
        logCaptureFailure(record, binding.entrySha, binding.querySha, binding.snapshotSha, reason);
        return;
    }
    const snapshot = captured.snapshot;
    const intent = captured.intent;
    const capabilities = captured.capabilities;
    const revalidate = captured.revalidate;
    const query = new AdvisoryPlanQuery({
        callDbus: (service, path, dbusInterface, method, payload, callback) => {
            callDBus(service, path, dbusInterface, method, payload, callback);
        },
        scheduleOnce: (delayMs, callback) => scheduleDescribeOnce(delayMs, callback),
        log: (message) => {
            try {
                console.log(message);
            } catch (error) {
                void error;
            }
            try {
                const marker = "plasma-auto-tiler:advisory-plan:";
                if (message.indexOf(marker) === 0) {
                    const terminal = message.slice(marker.length);
                    const equal = readAfterEquality(revalidate);
                    const detail = equal ? terminal : ADVISORY_DESCRIBE_STALE_DETAIL;
                    console.log(
                        `${ADVISORY_DESCRIBE_RESULT_PREFIX}:${ADVISORY_DESCRIBE_RESULT_SCHEMA}:${record.correlationId}:${record.owner}:${record.generation}:${record.revision}:${record.nonce}:${detail}`,
                    );
                    try {
                        console.log(afterVerdictLine(record.correlationId, equal));
                    } catch (error) {
                        void error;
                    }
                }
            } catch (error) {
                void error;
            }
        },
        provideInput: () => ({
            correlationId: record.correlationId,
            owner: record.owner,
            generation: record.generation,
            revision: record.revision,
            snapshot,
            intent,
            capabilities,
        }),
        revalidateInput: () => {
            try {
                return revalidate();
            } catch (error) {
                void error;
                return false;
            }
        },
    });
    try {
        console.log(sourceBindingLine(binding.entrySha, binding.querySha, binding.snapshotSha));
    } catch (error) {
        void error;
    }
    try {
        console.log(`${ADVISORY_DESCRIBE_READY_PREFIX}:${record.correlationId}`);
    } catch (error) {
        void error;
    }
    query.enableOnce();
    query.runOnce();
}

startAdvisoryDescribeOnce();
