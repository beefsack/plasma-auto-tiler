import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    ADVISORY_METHOD,
    ADVISORY_OBJECT,
    AdvisoryPlanQuery,
    AdvisoryProviderInput,
    DBUS_METHOD,
    DBUS_SERVICE,
    normalizeAdvisoryRequest,
} from "../src/advisory-plan-query";

const ENTRY_SOURCE = readFileSync("src/advisory-describe-entry.ts", "utf8");
const QUERY_SOURCE = readFileSync("src/advisory-plan-query.ts", "utf8");
const BUILDER_SOURCE = readFileSync("../scripts/advisory-describe-build.mjs", "utf8");

const PINNED_OWNER = ":1.42";

// Observation-only fixture: no tree/leaf/focused_leaf. Rust builds
// H[A,V[B,C]]; sorted [id-a,id-b,id-c] with id-b down swaps with leaf-id-c
// inside advisory-inner.
function validInput(overrides: Partial<Record<string, unknown>> = {}): AdvisoryProviderInput {
    return {
        correlationId: "corr-9",
        owner: "owner-9",
        generation: "gen-9",
        revision: 4,
        snapshot: {
            outputs: [
                {
                    id: "advisory-output",
                    workspace: "advisory-workspace",
                    adjacent: {},
                },
            ],
            windows: [
                { window: "id-a", output: "advisory-output", workspace: "advisory-workspace" },
                { window: "id-b", output: "advisory-output", workspace: "advisory-workspace" },
                { window: "id-c", output: "advisory-output", workspace: "advisory-workspace" },
            ],
        },
        intent: {
            source_output: "advisory-output",
            focused_window: "id-b",
            direction: "down",
        },
        capabilities: {
            swap_neighbor: true,
            wrap_perpendicular: false,
            wrap_siblings: false,
            insert_child: false,
            split_group_child: false,
            reparent_leaf: false,
            cross_output_transfer: false,
        },
        ...overrides,
    };
}

function plannedReply(): string {
    return JSON.stringify({
        v: 1,
        correlation_id: "corr-9",
        owner: "owner-9",
        generation: "gen-9",
        revision: 4,
        outcome: "planned",
        rule: "R2a",
        capability: "swap-neighbor",
        preconditions: ["adapter-must-verify-postconditions"],
        operation: { kind: "swap-neighbor", rule: "R2a", container: "advisory-inner", neighbor: "leaf-id-c" },
    });
}

function mockEnv(input: AdvisoryProviderInput | null, revalidate: boolean | (() => boolean) | undefined): {
    dbusCalls: Array<{ service: string; payload: string }>;
    callbacks: Array<(reply: unknown) => void>;
    logs: string[];
    env: {
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
        revalidateInput?: () => boolean;
    };
} {
    const dbusCalls: Array<{ service: string; payload: string }> = [];
    const callbacks: Array<(reply: unknown) => void> = [];
    const logs: string[] = [];
    const env: {
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
        revalidateInput?: () => boolean;
    } = {
        callDbus: (service, _path, _iface, _method, payload, callback): void => {
            dbusCalls.push({ service, payload });
            callbacks.push(callback);
        },
        scheduleOnce: (_delayMs, _callback): (() => void) => () => undefined,
        log: (message): void => {
            logs.push(message);
        },
        provideInput: (): AdvisoryProviderInput | null => input,
    };
    if (revalidate !== undefined) {
        env.revalidateInput = typeof revalidate === "function" ? revalidate : (): boolean => revalidate;
    }
    return { dbusCalls, callbacks, logs, env };
}

describe("advisory query revalidateInput gate", () => {
    it("dispatches when revalidation passes with exact identity", () => {
        const mocks = mockEnv(validInput(), true);
        const query = new AdvisoryPlanQuery(mocks.env);
        query.enableOnce();
        query.runOnce();
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.(PINNED_OWNER);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(mocks.dbusCalls[1]?.service, PINNED_OWNER);
        const payload = JSON.parse(mocks.dbusCalls[1]?.payload ?? "{}") as Record<string, unknown>;
        assert.equal(payload["correlation_id"], "corr-9");
        assert.equal(payload["owner"], "owner-9");
        assert.equal(payload["generation"], "gen-9");
        assert.equal(payload["revision"], 4);
        mocks.callbacks[1]?.(plannedReply());
        mocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(mocks.logs.some((line) => line.includes("could-execute:R2a:swap-neighbor")));
    });

    it("fails closed with stale-snapshot and no plan call when revalidation is false", () => {
        const mocks = mockEnv(validInput(), false);
        const query = new AdvisoryPlanQuery(mocks.env);
        query.enableOnce();
        query.runOnce();
        mocks.callbacks[0]?.(PINNED_OWNER);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.ok(mocks.logs.some((line) => line.includes("advisory-stale-snapshot")));
        assert.ok(!mocks.logs.some((line) => line.includes("could-execute")));
        assert.equal(query.isInFlight, false);
    });

    it("fails closed when revalidation throws", () => {
        const mocks = mockEnv(validInput(), (): boolean => {
            throw new Error("drift");
        });
        const query = new AdvisoryPlanQuery(mocks.env);
        query.enableOnce();
        query.runOnce();
        mocks.callbacks[0]?.(PINNED_OWNER);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.ok(mocks.logs.some((line) => line.includes("advisory-stale-snapshot")));
        assert.equal(query.isInFlight, false);
    });

    it("leaves the existing service-loss path unaffected", () => {
        const mocks = mockEnv(validInput(), true);
        const query = new AdvisoryPlanQuery(mocks.env);
        query.enableOnce();
        query.runOnce();
        mocks.callbacks[0]?.("not-a-unique-name");
        assert.ok(mocks.logs.some((line) => line.includes("advisory-owner-missing")));
        assert.equal(mocks.dbusCalls.length, 1);

        const absent = mockEnv(validInput(), undefined);
        const q2 = new AdvisoryPlanQuery(absent.env);
        q2.enableOnce();
        q2.runOnce();
        absent.callbacks[0]?.(PINNED_OWNER);
        assert.equal(absent.dbusCalls.length, 2);
    });

    it("carries adapter snapshot correlation/owner/generation/revision into the request", () => {
        const normalized = normalizeAdvisoryRequest(validInput());
        assert.equal(normalized.ok, true);
        if (!normalized.ok) throw new Error("expected ok");
        assert.equal(normalized.bundle.correlationId, "corr-9");
        assert.equal(normalized.bundle.owner, "owner-9");
        assert.equal(normalized.bundle.generation, "gen-9");
        assert.equal(normalized.bundle.revision, 4);
        const request = JSON.parse(normalized.bundle.requestJson) as Record<string, unknown>;
        assert.equal(request["correlation_id"], "corr-9");
        assert.equal(request["owner"], "owner-9");
    });
});

describe("advisory describe entry snapshot wiring", () => {
    it("imports the snapshot adapter and uses the lexical workspace", () => {
        const imports = ENTRY_SOURCE.split("\n").filter((line) => line.startsWith("import "));
        assert.equal(imports.length, 2);
        assert.ok(imports.some((line) => line.includes('from "./advisory-plan-query"')));
        assert.ok(imports.some((line) => line.includes('from "./advisory-snapshot"')));
        assert.ok(ENTRY_SOURCE.includes("captureAdvisorySnapshot(workspace"));
        assert.ok(ENTRY_SOURCE.includes("ADVISORY_DESCRIBE_SNAPSHOT_SHA256"));
        assert.ok(ENTRY_SOURCE.includes("revalidateInput"));
        assert.ok(ENTRY_SOURCE.includes("captured.snapshot"));
        assert.ok(ENTRY_SOURCE.includes("captured.intent"));
        assert.ok(ENTRY_SOURCE.includes("captured.capabilities"));
        assert.ok(ENTRY_SOURCE.includes("captured.revalidate"));
    });

    it("never lets prebuilt snapshot/capabilities become request authority", () => {
        assert.ok(!ENTRY_SOURCE.includes("snapshot: record.snapshot"));
        assert.ok(!ENTRY_SOURCE.includes("capabilities: record.capabilities"));
        assert.ok(QUERY_SOURCE.includes("revalidateInput"));
        assert.ok(QUERY_SOURCE.includes("advisory-stale-snapshot"));
        const ownerPos = QUERY_SOURCE.indexOf("this.pinnedOwner = reply");
        const revalidatePos = QUERY_SOURCE.indexOf("this.env.revalidateInput", ownerPos);
        const dispatchPos = QUERY_SOURCE.indexOf("this.bundle.requestJson", ownerPos);
        assert.ok(ownerPos >= 0 && revalidatePos > ownerPos);
        assert.ok(dispatchPos > revalidatePos);
        assert.ok(ENTRY_SOURCE.includes(ADVISORY_OBJECT) || ENTRY_SOURCE.includes("AdvisoryPlanQuery"));
        void ADVISORY_METHOD;
        void ADVISORY_OBJECT;
        void DBUS_METHOD;
        void DBUS_SERVICE;
    });

    it("keeps the entry free of mutation and production routes", () => {
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
            "EvaluateMove",
            "PublishSnapshot",
            "showOutline",
            "hideOutline",
            "createDesktop",
            "removeDesktop",
            "closeWindow",
            "readConfig(",
            "Reflect.set",
            "setTimeout",
            "setInterval",
            "require(",
            "globalThis",
            "new Function",
            "eval(",
        ]) {
            assert.ok(!ENTRY_SOURCE.includes(forbidden), `entry coupling: ${forbidden}`);
        }
        assert.ok(!QUERY_SOURCE.includes('from "./controller'));
        assert.ok(!QUERY_SOURCE.includes("workspace."));
    });

    it("binds the snapshot source deterministically in builder and manifest", () => {
        assert.ok(BUILDER_SOURCE.includes("advisory-snapshot.ts"));
        assert.ok(BUILDER_SOURCE.includes("ADVISORY_DESCRIBE_SNAPSHOT_SHA256"));
        assert.ok(BUILDER_SOURCE.includes("snapshotSha256"));
        assert.ok(BUILDER_SOURCE.includes("snapshot source does not match"));
        assert.ok(BUILDER_SOURCE.includes("snapshot source binding"));
    });
});
