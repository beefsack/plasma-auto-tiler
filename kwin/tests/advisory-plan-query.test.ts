import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    ADVISORY_CONTRACT_VERSION,
    ADVISORY_INTERFACE,
    ADVISORY_MAX_REPLY_BYTES,
    ADVISORY_MAX_REQUEST_BYTES,
    ADVISORY_METHOD,
    ADVISORY_OBJECT,
    ADVISORY_SERVICE,
    ADVISORY_TIMEOUT_MS,
    ADVISORY_WINDOW_COUNT,
    AdvisoryPlanQuery,
    AdvisoryProviderInput,
    DBUS_INTERFACE,
    DBUS_METHOD,
    DBUS_OBJECT,
    DBUS_SERVICE,
    normalizeAdvisoryRequest,
    validateAdvisoryReply,
} from "../src/advisory-plan-query";

const PINNED_OWNER = ":1.42";

// Observation-only fixture: no tree/leaf/focused_leaf. Sorted [w-A,w-B,w-C]
// with w-B down plans R2a inside advisory-inner against leaf-w-C.
function validInput(overrides: Partial<Record<string, unknown>> = {}): AdvisoryProviderInput {
    return {
        correlationId: "corr-1",
        owner: "owner-1",
        generation: "gen-1",
        revision: 0,
        snapshot: {
            outputs: [
                {
                    id: "source",
                    workspace: "workspace-1",
                    adjacent: {},
                },
            ],
            windows: [
                { window: "w-A", output: "source", workspace: "workspace-1" },
                { window: "w-B", output: "source", workspace: "workspace-1" },
                { window: "w-C", output: "source", workspace: "workspace-1" },
            ],
        },
        intent: {
            source_output: "source",
            focused_window: "w-B",
            direction: "down",
        },
        capabilities: {
            swap_neighbor: true,
            wrap_perpendicular: true,
            wrap_siblings: true,
            insert_child: true,
            split_group_child: true,
            reparent_leaf: true,
            cross_output_transfer: true,
        },
        ...overrides,
    };
}

function plannedReply(): string {
    return JSON.stringify({
        v: 1,
        correlation_id: "corr-1",
        owner: "owner-1",
        generation: "gen-1",
        revision: 0,
        outcome: "planned",
        rule: "R2a",
        capability: "swap-neighbor",
        preconditions: ["adapter-must-verify-postconditions"],
        operation: { kind: "swap-neighbor", rule: "R2a", container: "advisory-inner", neighbor: "leaf-w-C" },
    });
}

interface QueryMocks {
    readonly dbusCalls: Array<{
        service: string;
        path: string;
        iface: string;
        method: string;
        payload: string;
    }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly env: {
        callDbus: (
            service: string,
            path: string,
            iface: string,
            method: string,
            payload: string,
            callback: (reply: unknown) => void,
        ) => void;
        scheduleOnce: (delayMs: number, callback: () => void) => () => void;
        log: (message: string) => void;
        provideInput: () => AdvisoryProviderInput | null;
    };
}

function mockEnv(input: AdvisoryProviderInput | null): QueryMocks {
    const mocks: Omit<QueryMocks, "env"> = { dbusCalls: [], callbacks: [], timers: [], logs: [] };
    const env: QueryMocks["env"] = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            mocks.dbusCalls.push({ service, path, iface, method, payload });
            mocks.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            mocks.timers.push(entry);
            return () => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            mocks.logs.push(message);
        },
        provideInput: (): AdvisoryProviderInput | null => input,
    };
    return { ...mocks, env };
}

function started(input: AdvisoryProviderInput | null): { query: AdvisoryPlanQuery; mocks: QueryMocks } {
    const mocks = mockEnv(input);
    const query = new AdvisoryPlanQuery(mocks.env);
    query.enableOnce();
    query.runOnce();
    return { query, mocks };
}

function driveSuccess(mocks: QueryMocks, reply: string = plannedReply()): void {
    assert.ok(mocks.callbacks[0] !== undefined);
    mocks.callbacks[0]?.(PINNED_OWNER);
    assert.ok(mocks.callbacks[1] !== undefined);
    mocks.callbacks[1]?.(reply);
    assert.ok(mocks.callbacks[2] !== undefined);
    mocks.callbacks[2]?.(PINNED_OWNER);
}

describe("advisory plan contract constants", () => {
    it("targets the existing Planner DescribeAdvisoryPlan identity with bounds", () => {
        assert.equal(ADVISORY_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(ADVISORY_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(ADVISORY_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(ADVISORY_METHOD, "DescribeAdvisoryPlan");
        assert.equal(ADVISORY_CONTRACT_VERSION, 1);
        assert.equal(ADVISORY_MAX_REQUEST_BYTES, 64 * 1024);
        assert.equal(ADVISORY_MAX_REPLY_BYTES, 64 * 1024);
        assert.equal(ADVISORY_TIMEOUT_MS, 2000);
        assert.equal(ADVISORY_WINDOW_COUNT, 3);
        assert.equal(DBUS_SERVICE, "org.freedesktop.DBus");
        assert.equal(DBUS_OBJECT, "/org/freedesktop/DBus");
        assert.equal(DBUS_INTERFACE, "org.freedesktop.DBus");
        assert.equal(DBUS_METHOD, "GetNameOwner");
    });

    it("normalizes the injected 3-window observation without inventing topology", () => {
        const result = normalizeAdvisoryRequest(validInput());
        assert.equal(result.ok, true);
        if (!result.ok) {
            throw new Error("expected ok");
        }
        const request = JSON.parse(result.bundle.requestJson) as Record<string, unknown>;
        assert.deepEqual(Object.keys(request).sort(), [
            "capabilities",
            "correlation_id",
            "generation",
            "intent",
            "owner",
            "revision",
            "snapshot",
            "v",
        ]);
        assert.equal(request["v"], 1);
        assert.ok(result.bundle.requestJson.length <= ADVISORY_MAX_REQUEST_BYTES);
        // Observation-only: derived trio ids are not in the request; only
        // observed output/workspace/window ids are bound.
        assert.ok(result.bundle.snapshotIds.includes("w-A"));
        assert.ok(!result.bundle.snapshotIds.includes("advisory-inner"));
        assert.ok(!result.bundle.snapshotIds.includes("leaf-w-C"));
        const snapshot = request["snapshot"] as Record<string, unknown>;
        const outputs = snapshot["outputs"] as Array<Record<string, unknown>>;
        assert.ok(!Object.prototype.hasOwnProperty.call(outputs[0] ?? {}, "tree"));
        const intent = request["intent"] as Record<string, unknown>;
        assert.ok(!Object.prototype.hasOwnProperty.call(intent, "focused_leaf"));
    });

    it("rejects explicit topology so no caller can choose one", () => {
        const withTree = validInput({
            snapshot: {
                outputs: [{ id: "source", workspace: "workspace-1", tree: { kind: "leaf", id: "A" }, adjacent: {} }],
                windows: (validInput().snapshot as Record<string, unknown>)["windows"],
            },
        });
        assert.equal(normalizeAdvisoryRequest(withTree).ok, false);
        const withLeaf = validInput({
            snapshot: {
                outputs: (validInput().snapshot as Record<string, unknown>)["outputs"],
                windows: [
                    { window: "w-A", leaf: "A", output: "source", workspace: "workspace-1" },
                    { window: "w-B", output: "source", workspace: "workspace-1" },
                    { window: "w-C", output: "source", workspace: "workspace-1" },
                ],
            },
        });
        assert.equal(normalizeAdvisoryRequest(withLeaf).ok, false);
        const withFocusedLeaf = validInput({
            intent: { source_output: "source", focused_leaf: "A", focused_window: "w-B", direction: "down" },
        });
        assert.equal(normalizeAdvisoryRequest(withFocusedLeaf).ok, false);
    });
});

describe("advisory plan query", () => {
    it("completes the successful advisory path", () => {
        const { query, mocks } = started(validInput());
        driveSuccess(mocks);
        assert.ok(mocks.logs.some((line) => line.includes("could-execute:R2a:swap-neighbor")));
        assert.equal(query.isInFlight, false);
    });

    it("routes via resolved unique owner and never the well-known fallback", () => {
        const { mocks } = started(validInput());
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(
            [mocks.dbusCalls[0]?.service, mocks.dbusCalls[0]?.method, mocks.dbusCalls[0]?.payload],
            [DBUS_SERVICE, DBUS_METHOD, ADVISORY_SERVICE],
        );
        mocks.callbacks[0]?.(PINNED_OWNER);
        assert.equal(mocks.dbusCalls.length, 2);
        const planCall = mocks.dbusCalls[1];
        assert.equal(planCall?.service, PINNED_OWNER);
        assert.equal(planCall?.path, ADVISORY_OBJECT);
        assert.equal(planCall?.iface, ADVISORY_INTERFACE);
        assert.equal(planCall?.method, ADVISORY_METHOD);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === ADVISORY_SERVICE));
        const payload = JSON.parse(planCall?.payload ?? "{}") as Record<string, unknown>;
        assert.equal(payload["correlation_id"], "corr-1");
        assert.equal(payload["owner"], "owner-1");
        mocks.callbacks[1]?.(plannedReply());
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(
            [mocks.dbusCalls[2]?.service, mocks.dbusCalls[2]?.method],
            [DBUS_SERVICE, DBUS_METHOD],
        );
        mocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(mocks.logs.some((line) => line.includes("could-execute")));
    });

    it("times out once with no retry and ignores the late reply", () => {
        const { query, mocks } = started(validInput());
        mocks.timers[0]?.callback();
        assert.ok(mocks.logs.some((line) => line.includes("advisory-timeout")));
        assert.equal(query.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.(PINNED_OWNER);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.ok(!mocks.logs.some((line) => line.includes("could-execute")));
    });

    it("fails closed when the initial owner is missing or not unique", () => {
        for (const badOwner of [ADVISORY_SERVICE, "", "not-a-unique-name", null, 42]) {
            const { query, mocks } = started(validInput());
            mocks.callbacks[0]?.(badOwner);
            assert.ok(mocks.logs.some((line) => line.includes("advisory-owner-missing")));
            assert.equal(query.isInFlight, false);
            assert.equal(mocks.dbusCalls.length, 1);
        }
    });

    it("fails closed on owner loss or change at revalidation", () => {
        const { query, mocks } = started(validInput());
        mocks.callbacks[0]?.(PINNED_OWNER);
        mocks.callbacks[1]?.(plannedReply());
        mocks.callbacks[2]?.(":1.99");
        assert.ok(mocks.logs.some((line) => line.includes("advisory-owner-changed")));
        assert.equal(query.isInFlight, false);
        assert.ok(!mocks.logs.some((line) => line.includes("could-execute")));

        const lost = started(validInput());
        lost.mocks.callbacks[0]?.(PINNED_OWNER);
        lost.mocks.callbacks[1]?.(plannedReply());
        lost.mocks.callbacks[2]?.(null);
        assert.ok(lost.mocks.logs.some((line) => line.includes("advisory-owner-changed")));
        assert.ok(!lost.mocks.logs.some((line) => line.includes("could-execute")));
    });

    it("fails closed on malformed or oversized replies", () => {
        for (const bad of ["{not json}", 42, null]) {
            const { mocks } = started(validInput());
            mocks.callbacks[0]?.(PINNED_OWNER);
            mocks.callbacks[1]?.(bad);
            mocks.callbacks[2]?.(PINNED_OWNER);
            assert.ok(
                mocks.logs.some((line) => line.includes("advisory-reply-malformed")),
                `expected malformed for ${String(bad)}`,
            );
            assert.ok(!mocks.logs.some((line) => line.includes("could-execute")));
        }
        const bindingMismatch = started(validInput());
        bindingMismatch.mocks.callbacks[0]?.(PINNED_OWNER);
        bindingMismatch.mocks.callbacks[1]?.(JSON.stringify({ v: 1 }));
        bindingMismatch.mocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(
            bindingMismatch.mocks.logs.some((line) => line.includes("advisory-identity-mismatch")),
        );
        const oversized = started(validInput());
        oversized.mocks.callbacks[0]?.(PINNED_OWNER);
        oversized.mocks.callbacks[1]?.(`"${"x".repeat(ADVISORY_MAX_REPLY_BYTES)}"`);
        oversized.mocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(oversized.mocks.logs.some((line) => line.includes("advisory-reply-oversized")));
    });

    it("fails closed on correlation, owner, generation, and revision mismatch", () => {
        const variants: Array<{ mutate: (text: string) => string; token: string }> = [
            {
                mutate: (text) => text.replace("corr-1", "corr-2"),
                token: "advisory-identity-mismatch",
            },
            {
                mutate: (text) => text.replace("owner-1", "owner-2"),
                token: "advisory-identity-mismatch",
            },
            {
                mutate: (text) => text.replace("gen-1", "gen-2"),
                token: "advisory-identity-mismatch",
            },
            {
                mutate: (text) => text.replace('"revision":0', '"revision":1'),
                token: "advisory-identity-mismatch",
            },
        ];
        for (const variant of variants) {
            const { mocks } = started(validInput());
            mocks.callbacks[0]?.(PINNED_OWNER);
            mocks.callbacks[1]?.(variant.mutate(plannedReply()));
            mocks.callbacks[2]?.(PINNED_OWNER);
            assert.ok(mocks.logs.some((line) => line.includes(variant.token)));
            assert.ok(!mocks.logs.some((line) => line.includes("could-execute")));
        }
        const validated = validateAdvisoryReply(plannedReply(), {
            correlationId: "corr-1",
            owner: "owner-1",
            generation: "gen-1",
            revision: 0,
            snapshotIds: ["source", "workspace-1", "w-A", "w-B", "w-C"],
        });
        assert.equal(validated.ok, true);
    });

    it("fails closed on rejected and unknown outcomes without executing", () => {
        const rejected = JSON.stringify({
            v: 1,
            correlation_id: "corr-1",
            owner: "",
            generation: "",
            revision: 0,
            outcome: "rejected",
            kind: "owner-mismatch",
            message: "owner does not match the pinned session",
        });
        const { mocks } = started(validInput());
        driveSuccess(mocks, rejected);
        assert.ok(mocks.logs.some((line) => line.includes("advisory-rejected-owner-mismatch")));
        assert.ok(!mocks.logs.some((line) => line.includes("could-execute")));
        assert.equal(mocks.dbusCalls.length, 3);

        const withExtraOperationField = JSON.stringify({
            ...JSON.parse(plannedReply()),
            operation: {
                ...JSON.parse(plannedReply()).operation,
                geometry: "not-an-execution-command",
            },
        });
        const extra = started(validInput());
        driveSuccess(extra.mocks, withExtraOperationField);
        assert.ok(extra.mocks.logs.some((line) => line.includes("advisory-outcome-mismatch")));
    });

    it("enforces one-flight ordering with exactly one consumed run", () => {
        const { query, mocks } = started(validInput());
        query.runOnce();
        assert.ok(mocks.logs.some((line) => line.includes("advisory-busy")));
        assert.equal(mocks.dbusCalls.length, 1);
        driveSuccess(mocks);
        assert.ok(mocks.logs.some((line) => line.includes("could-execute")));
        query.enableOnce();
        query.runOnce();
        assert.ok(mocks.logs.some((line) => line.includes("advisory-disabled")));
        assert.equal(mocks.dbusCalls.length, 3);

        const dup = started(validInput());
        dup.mocks.callbacks[0]?.(PINNED_OWNER);
        dup.mocks.callbacks[0]?.(":1.98");
        dup.mocks.callbacks[1]?.(plannedReply());
        dup.mocks.callbacks[1]?.(plannedReply());
        dup.mocks.callbacks[2]?.(PINNED_OWNER);
        dup.mocks.callbacks[2]?.(PINNED_OWNER);
        assert.equal(
            dup.mocks.logs.filter((line) => line.includes("could-execute")).length,
            1,
        );
    });

    it("rejects out-of-bounds provider inputs without sending", () => {
        const twoWindows = validInput({
            snapshot: {
                outputs: (validInput().snapshot as Record<string, unknown>)["outputs"],
                windows: [
                    { window: "w-A", output: "source", workspace: "workspace-1" },
                    { window: "w-B", output: "source", workspace: "workspace-1" },
                ],
            },
        });
        assert.equal(normalizeAdvisoryRequest(twoWindows).ok, false);
        const badCorrelation = validInput({ correlationId: "bad corr" });
        assert.equal(normalizeAdvisoryRequest(badCorrelation).ok, false);
        const badGeneration = validInput({ generation: "UPPERCASE" });
        assert.equal(normalizeAdvisoryRequest(badGeneration).ok, false);
        const badRevision = validInput({ revision: 1000001 });
        assert.equal(normalizeAdvisoryRequest(badRevision).ok, false);
        const badCapabilities = validInput({
            capabilities: {
                swap_neighbor: true,
                wrap_perpendicular: true,
                wrap_siblings: true,
                insert_child: true,
                split_group_child: true,
                reparent_leaf: true,
                cross_output_transfer: true,
                extra: true,
            },
        });
        assert.equal(normalizeAdvisoryRequest(badCapabilities).ok, false);
        const unknownWindow = validInput({
            intent: {
                source_output: "source",
                focused_window: "w-Z",
                direction: "down",
            },
        });
        assert.equal(normalizeAdvisoryRequest(unknownWindow).ok, false);

        const { mocks } = started(twoWindows);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line.includes("advisory-unsupported-topology") ||
                    line.includes("advisory-invalid-input"),
            ),
        );
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("has no native mutation or application APIs and stays out of production paths", () => {
        const source = readFileSync("src/advisory-plan-query.ts", "utf8");
        assert.ok(source.includes("DescribeAdvisoryPlan"));
        assert.ok(source.includes("GetNameOwner"));
        for (const forbidden of [
            "workspace.",
            "activeWindow",
            "rootTile",
            "currentDesktopForScreen",
            "showOutline",
            "hideOutline",
            "registerShortcut",
            "TileController",
            'from "./controller',
            'from "./poc3',
            'from "./planner-shadow',
            "poc3-",
            "POC3",
            "planner-shadow",
            "EvaluateMove",
            "PublishSnapshot",
            "manageTile",
            "assignWindowToTile",
            "setActiveWindow",
            "createDesktop",
            "removeDesktop",
            "closeWindow",
        ]) {
            assert.ok(!source.includes(forbidden), `mutation coupling: ${forbidden}`);
        }
        const entry = readFileSync("src/entry.ts", "utf8");
        assert.ok(!entry.includes("advisory-plan-query"));
        assert.ok(!entry.includes("AdvisoryPlanQuery"));
    });
});
