import assert from "node:assert/strict";
import { readFileSync as readFsFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    DBUS_INTERFACE,
    DBUS_METHOD,
    DBUS_OBJECT,
    DBUS_SERVICE,
    SHADOW_INTERFACE,
    SHADOW_METHOD,
    SHADOW_OBJECT,
    SHADOW_SERVICE,
} from "../src/advisory-shadow-projection";
import {
    SHADOW_DESCRIBE_AFTER_FALSE,
    SHADOW_DESCRIBE_AFTER_PREFIX,
    SHADOW_DESCRIBE_AFTER_SCHEMA,
    SHADOW_DESCRIBE_AFTER_TRUE,
    SHADOW_DESCRIBE_GAP,
    SHADOW_DESCRIBE_GENERATION_RE,
    SHADOW_DESCRIBE_INVALID_LOG,
    SHADOW_DESCRIBE_MAX_REVISION,
    SHADOW_DESCRIBE_NONCE_RE,
    SHADOW_DESCRIBE_OWNER_RE,
    SHADOW_DESCRIBE_READY_PREFIX,
    SHADOW_DESCRIBE_RESULT_PREFIX,
    SHADOW_DESCRIBE_RESULT_SCHEMA,
    SHADOW_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL,
    SHADOW_DESCRIBE_SNAPSHOT_REJECT_PREFIX,
    SHADOW_DESCRIBE_SOURCE_PREFIX,
    SHADOW_DESCRIBE_STALE_DETAIL,
    startShadowDescribeEntry,
    validateShadowDescribeInput,
} from "../src/shadow-describe-entry";

const ENTRY_SOURCE = readFsFileSync("src/shadow-describe-entry.ts", "utf8");

const TEST_NONCE = "0123456789abcdef0123456789abcdef";
const TEST_OWNER = "shadow-owner-1";
const TEST_GENERATION = "shadow-gen-1";
const TEST_REVISION = 7;
const ENTRY_SHA = "a".repeat(64);
const SHADOW_SHA = "b".repeat(64);
const SNAPSHOT_SHA = "c".repeat(64);
const PINNED_OWNER = ":1.42";

interface StubWindow {
    [key: string]: unknown;
}

interface StubWorkspace {
    [key: string]: unknown;
}

const OUTPUT_GEOM = { x: 0, y: 0, width: 1920, height: 1080 };
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

function stubOutput(): Record<string, unknown> {
    return { geometry: { ...OUTPUT_GEOM } };
}

function stubDesktop(): Record<string, unknown> {
    return { id: "d1" };
}

function stubTile(): Record<string, unknown> {
    return { kind: "tile" };
}

function stubWindow(
    id: string,
    output: object,
    desktop: object,
    frameIndex = 0,
): StubWindow {
    const frames = [
        { x: 10, y: 10, width: 100, height: 100 },
        { x: 200, y: 10, width: 100, height: 100 },
        { x: 400, y: 10, width: 100, height: 100 },
    ];
    return {
        normalWindow: true,
        managed: true,
        resizeable: true,
        appletPopup: false,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        move: false,
        resize: false,
        tile: stubTile(),
        output,
        desktops: [desktop],
        frameGeometry: { ...(frames[frameIndex % frames.length] as Record<string, number>) },
        internalId: id,
    };
}

function stubWorkspace(windows: StubWindow[], active: StubWindow | null): StubWorkspace {
    const output = (windows[0]?.["output"] as object) ?? stubOutput();
    const firstDesktops = windows[0]?.["desktops"] as unknown[] | undefined;
    const desktop = (Array.isArray(firstDesktops) ? firstDesktops[0] : stubDesktop()) as object;
    return {
        activeWindow: active,
        windowList: (): unknown[] => [...windows],
        screens: [output],
        currentDesktopForScreen: (out: unknown): unknown => (out === output ? desktop : null),
        clientArea: (): unknown => ({ ...WORK_AREA }),
    };
}

function validTrio(): { workspace: StubWorkspace; windows: StubWindow[] } {
    const output = stubOutput();
    const desktop = stubDesktop();
    const wa = stubWindow("id-c", output, desktop, 0);
    const wb = stubWindow("id-a", output, desktop, 1);
    const wc = stubWindow("id-b", output, desktop, 2);
    const windows = [wa, wb, wc];
    return { workspace: stubWorkspace(windows, wc), windows };
}

function validRequestJson(): string {
    return JSON.stringify({
        nonce: TEST_NONCE,
        correlationId: TEST_NONCE,
        owner: TEST_OWNER,
        generation: TEST_GENERATION,
        revision: TEST_REVISION,
    });
}

interface Mocks {
    readonly dbusCalls: Array<{ service: string; path: string; iface: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}

function mockSeams(workspace: StubWorkspace): Mocks & {
    readonly seams: {
        readonly workspace: unknown;
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
    };
} {
    const dbusCalls: Mocks["dbusCalls"] = [];
    const callbacks: Mocks["callbacks"] = [];
    const timers: Mocks["timers"] = [];
    const logs: string[] = [];
    return {
        dbusCalls,
        callbacks,
        timers,
        logs,
        seams: {
            workspace,
            callDbus: (service, path, iface, method, payload, callback): void => {
                dbusCalls.push({ service, path, iface, method, payload });
                callbacks.push(callback);
            },
            scheduleOnce: (delayMs, callback): (() => void) => {
                const entry = { delayMs, callback, cancelled: false };
                timers.push(entry);
                return () => {
                    entry.cancelled = true;
                };
            },
            log: (message): void => {
                logs.push(message);
            },
        },
    };
}

function flushCoalesce(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === 0) {
            timer.callback();
        } else if (!timer.cancelled) {
            mocks.timers.push(timer);
        }
    }
}

function startEntry(workspace: StubWorkspace): Mocks & {
    readonly handle: NonNullable<ReturnType<typeof startShadowDescribeEntry>>;
} {
    const mocks = mockSeams(workspace);
    const handle = startShadowDescribeEntry({
        ...mocks.seams,
        requestJson: validRequestJson(),
        entrySha: ENTRY_SHA,
        shadowSha: SHADOW_SHA,
        snapshotSha: SNAPSHOT_SHA,
    });
    assert.ok(handle !== null);
    return { ...mocks, handle: handle as NonNullable<ReturnType<typeof startShadowDescribeEntry>> };
}

function matchingReplyFor(payload: string): string {
    const request = JSON.parse(payload) as Record<string, unknown>;
    const windows = request["windows"] as Array<Record<string, unknown>>;
    return JSON.stringify({
        v: 1,
        correlation_id: request["correlation_id"],
        owner: request["owner"],
        generation: request["generation"],
        revision: request["revision"],
        outcome: "projected",
        capability: "shadow-projection",
        preconditions: [
            "trio-adopted",
            "projection-contained-and-disjoint",
            "adapter-must-verify-postconditions",
        ],
        desired: windows.map((entry) => ({ window: entry["window"], rect: entry["rect"] })),
        focused_window: request["focused_window"],
    });
}

function resultDetail(logs: string[]): string {
    const line = logs.find((entry) => entry.startsWith(`${SHADOW_DESCRIBE_RESULT_PREFIX}:`));
    assert.ok(line !== undefined);
    return (line as string).split(":").slice(8).join(":");
}

describe("shadow describe entry identity", () => {
    it("requires high-entropy builder identity with correlation bound to nonce", () => {
        assert.ok(SHADOW_DESCRIBE_NONCE_RE.test(TEST_NONCE));
        assert.ok(!SHADOW_DESCRIBE_NONCE_RE.test("short"));
        assert.ok(SHADOW_DESCRIBE_OWNER_RE.test(TEST_OWNER));
        assert.ok(SHADOW_DESCRIBE_GENERATION_RE.test(TEST_GENERATION));
        assert.equal(SHADOW_DESCRIBE_MAX_REVISION, 1000000);
        const ok = validateShadowDescribeInput(JSON.parse(validRequestJson()));
        assert.equal(ok.ok, true);
        assert.equal(validateShadowDescribeInput({}).ok, false);
        assert.equal(validateShadowDescribeInput([]).ok, false);
        assert.equal(
            validateShadowDescribeInput({ ...JSON.parse(validRequestJson()), correlationId: "other" }).ok,
            false,
        );
        assert.equal(
            validateShadowDescribeInput({ ...JSON.parse(validRequestJson()), revision: 1000001 }).ok,
            false,
        );
    });

    it("accepts no injected window ids or geometry in the builder record", () => {
        const base = JSON.parse(validRequestJson()) as Record<string, unknown>;
        assert.equal(validateShadowDescribeInput({ ...base, windows: [] }).ok, false);
        assert.equal(validateShadowDescribeInput({ ...base, snapshot: {} }).ok, false);
        assert.equal(validateShadowDescribeInput({ ...base, geometry: {} }).ok, false);
        assert.ok(!ENTRY_SOURCE.includes("record.windows"));
        assert.ok(!ENTRY_SOURCE.includes("record.snapshot"));
        assert.ok(!ENTRY_SOURCE.includes("overrides.windows"));
        assert.ok(!ENTRY_SOURCE.includes("overrides.geometry"));
        assert.ok(ENTRY_SOURCE.includes("SHADOW_DESCRIBE_REQUEST_JSON"));
        assert.ok(ENTRY_SOURCE.includes("SHADOW_DESCRIBE_ENTRY_SHA256"));
        assert.ok(ENTRY_SOURCE.includes("SHADOW_DESCRIBE_SHADOW_SHA256"));
        assert.ok(ENTRY_SOURCE.includes("SHADOW_DESCRIBE_SNAPSHOT_SHA256"));
    });
});

describe("shadow describe entry flight", () => {
    it("captures the exact three-window observation with builder request identity", () => {
        const { workspace } = validTrio();
        const started = startEntry(workspace);
        assert.equal(started.logs[0], `${SHADOW_DESCRIBE_SOURCE_PREFIX}:${ENTRY_SHA}:${SHADOW_SHA}:${SNAPSHOT_SHA}`);
        assert.equal(started.logs[1], `${SHADOW_DESCRIBE_READY_PREFIX}:${TEST_NONCE}`);
        flushCoalesce(started);
        assert.equal(started.dbusCalls.length, 1);
        started.callbacks[0]?.(PINNED_OWNER);
        assert.equal(started.dbusCalls.length, 2);
        const flight = started.dbusCalls[1] as { service: string; payload: string };
        const payload = JSON.parse(flight.payload) as Record<string, unknown>;
        assert.equal(payload["correlation_id"], TEST_NONCE);
        assert.equal(payload["owner"], TEST_OWNER);
        assert.equal(payload["generation"], TEST_GENERATION);
        assert.equal(payload["revision"], TEST_REVISION);
        const windows = payload["windows"] as Array<Record<string, unknown>>;
        assert.equal(windows.length, 3);
        assert.deepEqual(
            windows.map((entry) => entry["window"]).sort(),
            ["id-a", "id-b", "id-c"],
        );
        assert.equal(payload["gap"], SHADOW_DESCRIBE_GAP);
        assert.equal(payload["focused_window"], "id-b");
        assert.deepEqual(payload["capabilities"], { shadow_projection: true });
        started.callbacks[1]?.(matchingReplyFor(flight.payload));
        started.callbacks[2]?.(PINNED_OWNER);
        assert.equal(resultDetail(started.logs), "match");
    });

    it("routes DescribeShadowProjection through the pinned unique owner only", () => {
        const { workspace } = validTrio();
        const started = startEntry(workspace);
        flushCoalesce(started);
        const first = started.dbusCalls[0] as { service: string; path: string; iface: string; method: string; payload: string };
        assert.equal(first.service, DBUS_SERVICE);
        assert.equal(first.path, DBUS_OBJECT);
        assert.equal(first.iface, DBUS_INTERFACE);
        assert.equal(first.method, DBUS_METHOD);
        assert.equal(first.payload, SHADOW_SERVICE);
        started.callbacks[0]?.(PINNED_OWNER);
        const second = started.dbusCalls[1] as { service: string; path: string; iface: string; method: string };
        assert.equal(second.service, PINNED_OWNER);
        assert.equal(second.path, SHADOW_OBJECT);
        assert.equal(second.iface, SHADOW_INTERFACE);
        assert.equal(second.method, SHADOW_METHOD);
        assert.notEqual(second.service, SHADOW_SERVICE);
        started.callbacks[1]?.(matchingReplyFor(started.dbusCalls[1]?.payload as string));
        const third = started.dbusCalls[2] as { service: string; method: string; payload: string };
        assert.equal(third.service, DBUS_SERVICE);
        assert.equal(third.method, DBUS_METHOD);
        assert.equal(third.payload, SHADOW_SERVICE);
        started.callbacks[2]?.(":1.99");
        assert.equal(resultDetail(started.logs), "reject:shadow-owner-changed");
    });

    it("emits only match/divergence result detail plus the correlated after marker", () => {
        const { workspace } = validTrio();
        const matched = startEntry(workspace);
        flushCoalesce(matched);
        matched.callbacks[0]?.(PINNED_OWNER);
        const payload = matched.dbusCalls[1]?.payload as string;
        matched.callbacks[1]?.(matchingReplyFor(payload));
        matched.callbacks[2]?.(PINNED_OWNER);
        assert.equal(matched.logs.length, 4);
        assert.equal(matched.logs[2], `${SHADOW_DESCRIBE_RESULT_PREFIX}:${SHADOW_DESCRIBE_RESULT_SCHEMA}:${TEST_NONCE}:${TEST_OWNER}:${TEST_GENERATION}:${TEST_REVISION}:${TEST_NONCE}:match`);
        assert.equal(matched.logs[3], `${SHADOW_DESCRIBE_AFTER_PREFIX}:${SHADOW_DESCRIBE_AFTER_SCHEMA}:${TEST_NONCE}:${SHADOW_DESCRIBE_AFTER_TRUE}`);
        assert.ok(!matched.logs.some((line) => line.startsWith("plasma-auto-tiler:shadow-projection:")));

        const { workspace: workspace2 } = validTrio();
        const diverged = startEntry(workspace2);
        flushCoalesce(diverged);
        diverged.callbacks[0]?.(PINNED_OWNER);
        const request = JSON.parse(diverged.dbusCalls[1]?.payload as string) as Record<string, unknown>;
        const windows = request["windows"] as Array<Record<string, unknown>>;
        const shifted = windows.map((entry, index) => {
            const rect = entry["rect"] as Record<string, number>;
            return index === 0
                ? { window: entry["window"], rect: { ...rect, w: (rect["w"] as number) + 1 } }
                : { window: entry["window"], rect: entry["rect"] };
        });
        diverged.callbacks[1]?.(JSON.stringify({
            v: 1,
            correlation_id: request["correlation_id"],
            owner: request["owner"],
            generation: request["generation"],
            revision: request["revision"],
            outcome: "projected",
            capability: "shadow-projection",
            preconditions: [
                "trio-adopted",
                "projection-contained-and-disjoint",
                "adapter-must-verify-postconditions",
            ],
            desired: shifted,
            focused_window: request["focused_window"],
        }));
        diverged.callbacks[2]?.(PINNED_OWNER);
        assert.equal(resultDetail(diverged.logs), "divergence");
        assert.ok(diverged.logs.includes(`${SHADOW_DESCRIBE_AFTER_PREFIX}:${SHADOW_DESCRIBE_AFTER_SCHEMA}:${TEST_NONCE}:${SHADOW_DESCRIBE_AFTER_TRUE}`));
        assert.equal(SHADOW_DESCRIBE_RESULT_SCHEMA, "v1");
        assert.equal(SHADOW_DESCRIBE_STALE_DETAIL, "reject:shadow-stale-snapshot");
    });

    it("fails closed to stale rejection with after false when the trio drifts", () => {
        const { workspace, windows } = validTrio();
        const started = startEntry(workspace);
        flushCoalesce(started);
        started.callbacks[0]?.(PINNED_OWNER);
        const payload = started.dbusCalls[1]?.payload as string;
        started.callbacks[1]?.(matchingReplyFor(payload));
        const frame = windows[0]?.["frameGeometry"] as Record<string, number>;
        frame["x"] = 9999;
        started.callbacks[2]?.(PINNED_OWNER);
        assert.equal(resultDetail(started.logs), SHADOW_DESCRIBE_STALE_DETAIL);
        assert.ok(started.logs.includes(`${SHADOW_DESCRIBE_AFTER_PREFIX}:${SHADOW_DESCRIBE_AFTER_SCHEMA}:${TEST_NONCE}:${SHADOW_DESCRIBE_AFTER_FALSE}`));
    });

    it("stops after its one terminal result and ignores later callbacks", () => {
        const { workspace } = validTrio();
        const started = startEntry(workspace);
        flushCoalesce(started);
        started.callbacks[0]?.(PINNED_OWNER);
        started.callbacks[1]?.(matchingReplyFor(started.dbusCalls[1]?.payload as string));
        started.callbacks[2]?.(PINNED_OWNER);
        assert.equal(started.handle.isFinished(), true);
        const count = started.logs.length;
        started.callbacks[2]?.(PINNED_OWNER);
        started.handle.stop();
        assert.equal(started.logs.length, count);
        assert.equal(started.logs.filter((line) => line.startsWith(SHADOW_DESCRIBE_RESULT_PREFIX)).length, 1);
        assert.equal(started.logs.filter((line) => line.startsWith(SHADOW_DESCRIBE_AFTER_PREFIX)).length, 1);
    });

    it("reports a correlated snapshot reject with after false when capture is not exact-three", () => {
        const output = stubOutput();
        const desktop = stubDesktop();
        const wa = stubWindow("id-a", output, desktop, 0);
        const wb = stubWindow("id-b", output, desktop, 1);
        const thin = stubWorkspace([wa, wb], wb);
        const mocks = mockSeams(thin);
        const handle = startShadowDescribeEntry({
            ...mocks.seams,
            requestJson: validRequestJson(),
            entrySha: ENTRY_SHA,
            shadowSha: SHADOW_SHA,
            snapshotSha: SNAPSHOT_SHA,
        });
        assert.ok(handle !== null);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.logs[0], `${SHADOW_DESCRIBE_SOURCE_PREFIX}:${ENTRY_SHA}:${SHADOW_SHA}:${SNAPSHOT_SHA}`);
        assert.equal(mocks.logs[1], `${SHADOW_DESCRIBE_READY_PREFIX}:${TEST_NONCE}`);
        const detail = resultDetail(mocks.logs);
        assert.ok(detail.startsWith(SHADOW_DESCRIBE_SNAPSHOT_REJECT_PREFIX));
        assert.ok(mocks.logs.includes(`${SHADOW_DESCRIBE_AFTER_PREFIX}:${SHADOW_DESCRIBE_AFTER_SCHEMA}:${TEST_NONCE}:${SHADOW_DESCRIBE_AFTER_FALSE}`));
        assert.equal(SHADOW_DESCRIBE_SNAPSHOT_FALLBACK_DETAIL, "reject:advisory-snapshot-invalid-input");
    });
});

describe("shadow describe entry marker contract", () => {
    const RESULT_RE =
        /^plasma-auto-tiler:shadow-describe-result:v1:([0-9a-f]{32,128}):([A-Za-z0-9._-]{1,128}):([a-z0-9-]{1,64}):(\d+):([0-9a-f]{32,128}):(match|divergence|reject:[A-Za-z0-9._-]{1,128})$/;
    const AFTER_RE =
        /^plasma-auto-tiler:shadow-describe-after:v1:([0-9a-f]{32,128}):(true|false)$/;

    function parseResult(line: string): {
        correlationId: string;
        owner: string;
        generation: string;
        revision: string;
        nonce: string;
        detail: string;
    } {
        const match = RESULT_RE.exec(line);
        assert.ok(match !== null, `bad result schema: ${line}`);
        return {
            correlationId: match[1] as string,
            owner: match[2] as string,
            generation: match[3] as string,
            revision: match[4] as string,
            nonce: match[5] as string,
            detail: match[6] as string,
        };
    }

    function parseAfter(line: string): { correlationId: string; value: string } {
        const match = AFTER_RE.exec(line);
        assert.ok(match !== null, `bad after schema: ${line}`);
        return { correlationId: match[1] as string, value: match[2] as string };
    }

    it("validates the entire correlated result/after schema with fail-closed pairing", () => {
        const { workspace } = validTrio();
        const started = startEntry(workspace);
        flushCoalesce(started);
        started.callbacks[0]?.(PINNED_OWNER);
        started.callbacks[1]?.(matchingReplyFor(started.dbusCalls[1]?.payload as string));
        started.callbacks[2]?.(PINNED_OWNER);
        assert.equal(started.logs.length, 4);
        assert.equal(started.logs[0], `${SHADOW_DESCRIBE_SOURCE_PREFIX}:${ENTRY_SHA}:${SHADOW_SHA}:${SNAPSHOT_SHA}`);
        assert.equal(started.logs[1], `${SHADOW_DESCRIBE_READY_PREFIX}:${TEST_NONCE}`);
        const result = parseResult(started.logs[2] as string);
        const after = parseAfter(started.logs[3] as string);
        assert.equal(result.correlationId, TEST_NONCE);
        assert.equal(result.owner, TEST_OWNER);
        assert.equal(result.generation, TEST_GENERATION);
        assert.equal(result.revision, String(TEST_REVISION));
        assert.equal(result.nonce, TEST_NONCE);
        assert.equal(result.correlationId, result.nonce);
        assert.equal(after.correlationId, TEST_NONCE);
        assert.equal(after.correlationId, result.correlationId);
        if (result.detail === "match" || result.detail === "divergence") {
            assert.equal(after.value, SHADOW_DESCRIBE_AFTER_TRUE);
        } else {
            assert.equal(after.value, SHADOW_DESCRIBE_AFTER_FALSE);
        }
        assert.equal(result.detail, "match");
        assert.equal(after.value, SHADOW_DESCRIBE_AFTER_TRUE);
    });

    it("pairs a changed-owner refusal with after false when windows are otherwise unchanged", () => {
        const { workspace } = validTrio();
        const started = startEntry(workspace);
        flushCoalesce(started);
        started.callbacks[0]?.(PINNED_OWNER);
        started.callbacks[1]?.(matchingReplyFor(started.dbusCalls[1]?.payload as string));
        started.callbacks[2]?.(":1.99");
        assert.equal(started.handle.isFinished(), true);
        assert.equal(started.logs.length, 4);
        const result = parseResult(started.logs[2] as string);
        const after = parseAfter(started.logs[3] as string);
        assert.equal(result.correlationId, TEST_NONCE);
        assert.equal(result.owner, TEST_OWNER);
        assert.equal(result.nonce, TEST_NONCE);
        assert.equal(after.correlationId, TEST_NONCE);
        assert.ok(result.detail.startsWith("reject:"));
        assert.notEqual(result.detail, "match");
        assert.notEqual(result.detail, "divergence");
        assert.equal(after.value, SHADOW_DESCRIBE_AFTER_FALSE);
    });

    it("explicit stop before terminal emits no result/after and ignores later callbacks", () => {
        const { workspace } = validTrio();
        const started = startEntry(workspace);
        flushCoalesce(started);
        assert.equal(started.logs.length, 2);
        started.handle.stop();
        assert.equal(started.handle.isFinished(), false);
        started.callbacks[0]?.(PINNED_OWNER);
        if (started.dbusCalls[1]?.payload !== undefined) {
            started.callbacks[1]?.(matchingReplyFor(started.dbusCalls[1]?.payload as string));
        }
        started.callbacks[2]?.(PINNED_OWNER);
        started.handle.stop();
        assert.equal(started.handle.isFinished(), false);
        assert.equal(started.logs.length, 2);
        assert.equal(started.logs.filter((line) => line.startsWith(SHADOW_DESCRIBE_RESULT_PREFIX)).length, 0);
        assert.equal(started.logs.filter((line) => line.startsWith(SHADOW_DESCRIBE_AFTER_PREFIX)).length, 0);
    });
});

describe("shadow describe entry load contract", () => {
    it("invokes its one-shot entry exactly once at load without globals and stays import-safe", () => {
        const autoCalls = ENTRY_SOURCE.match(/startShadowDescribeEntry\(\);/g) ?? [];
        assert.equal(autoCalls.length, 1);
        assert.ok(ENTRY_SOURCE.includes("shouldAutoStartShadowDescribeEntry"));
        assert.ok(ENTRY_SOURCE.includes("typeof SHADOW_DESCRIBE_REQUEST_JSON"));
        assert.ok(ENTRY_SOURCE.includes("typeof workspace"));
        assert.ok(ENTRY_SOURCE.includes("typeof callDBus"));
        assert.ok(ENTRY_SOURCE.includes("typeof QTimer"));
        assert.ok(!ENTRY_SOURCE.includes("globalThis"));
        assert.ok(!ENTRY_SOURCE.includes("new Function"));
        assert.ok(!ENTRY_SOURCE.includes("Function(\"return"));
        assert.ok(!ENTRY_SOURCE.includes("eval("));
        const logs: string[] = [];
        assert.equal(
            startShadowDescribeEntry({ log: (message: string): void => void logs.push(message) }),
            null,
        );
        assert.deepEqual(logs, [SHADOW_DESCRIBE_INVALID_LOG]);
    });
});

describe("shadow describe entry isolation", () => {
    it("is not reachable from production startup and imports only the shadow seams", () => {
        const production = readFsFileSync("src/entry.ts", "utf8");
        assert.ok(!production.includes("shadow-describe"));
        assert.ok(!production.includes("startShadowDescribeEntry"));
        const imports = ENTRY_SOURCE.match(/^import /gm) ?? [];
        assert.equal(imports.length, 2);
        assert.ok(ENTRY_SOURCE.includes('from "./advisory-shadow-projection"'));
        assert.ok(ENTRY_SOURCE.includes('from "./advisory-snapshot"'));
        assert.ok(ENTRY_SOURCE.includes("new ShadowProjection"));
        assert.ok(ENTRY_SOURCE.includes("captureShadowProjectionObservation"));
        assert.ok(ENTRY_SOURCE.includes("SHADOW_DESCRIBE_REQUEST_JSON"));
    });

    it("carries no native mutation or production trigger tokens", () => {
        for (const forbidden of [
            "TileController",
            "TrayPublisher",
            "registerShortcut",
            'from "./controller',
            'from "./entry',
            'from "./tray',
            'from "./poc3',
            'from "./planner-shadow',
            "poc3-",
            "POC3",
            "planner-shadow",
            "activeWindow",
            "rootTile",
            "showOutline",
            "hideOutline",
            "createDesktop",
            "removeDesktop",
            "closeWindow",
            "frameGeometry",
            "windowList",
            "clientArea",
            "currentDesktop",
            "setActiveWindow",
            "CustomTile",
            "EvaluateMove",
            "PublishSnapshot",
            "manageTile",
            "assignWindow",
            "queryWindowInfo",
            "readConfig(",
            "Reflect.set",
            "setTimeout",
            "setInterval",
            "require(",
            "globalThis",
            "new Function",
            "eval(",
            "desktopsChanged",
            "windowAdded",
            "windowRemoved",
        ]) {
            assert.ok(!ENTRY_SOURCE.includes(forbidden), `shadow coupling: ${forbidden}`);
        }
    });
});
