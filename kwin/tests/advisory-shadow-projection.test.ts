import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    SHADOW_CONTRACT_VERSION,
    SHADOW_INTERFACE,
    SHADOW_MAX_REPLY_BYTES,
    SHADOW_MAX_REQUEST_BYTES,
    SHADOW_METHOD,
    SHADOW_OBJECT,
    SHADOW_SERVICE,
    SHADOW_TIMEOUT_MS,
    SHADOW_WINDOW_COUNT,
    ShadowProjection,
    ShadowProjectionEnv,
    ShadowProviderInput,
    normalizeShadowRequest,
    validateShadowReply,
} from "../src/advisory-shadow-projection";

const PINNED_OWNER = ":1.42";

function kwinSrcDir(): string {
    const override = process.env["KWIN_SRC_DIR"];
    if (typeof override === "string" && override.length > 0) {
        try {
            if (existsSync(join(override, "entry.ts"))) {
                return override;
            }
        } catch (error) {
            void error;
        }
    }
    const candidates: string[] = [];
    try {
        const here: unknown = typeof __dirname === "string" ? __dirname : process.cwd();
        if (typeof here === "string") {
            candidates.push(resolve(here, "..", "..", "src"));
            candidates.push(resolve(here, "..", "src"));
            candidates.push(resolve(here, "src"));
        }
    } catch (error) {
        void error;
    }
    candidates.push(resolve(process.cwd(), "src"));
    candidates.push(resolve(process.cwd(), "kwin", "src"));
    for (const dir of candidates) {
        try {
            if (existsSync(join(dir, "entry.ts"))) {
                return dir;
            }
        } catch (error) {
            void error;
        }
    }
    return resolve(process.cwd(), "src");
}

function readKwinSource(name: string): string {
    return readFileSync(join(kwinSrcDir(), name), "utf8");
}

function validInput(overrides: Partial<Record<string, unknown>> = {}): ShadowProviderInput {
    return {
        correlationId: "corr-1",
        owner: "owner-1",
        generation: "gen-1",
        revision: 0,
        output: {
            id: "source",
            workspace: "workspace-1",
            workArea: { x: 0, y: 0, w: 90, h: 60 },
        },
        windows: [
            { window: "w-A", output: "source", workspace: "workspace-1", rect: { x: 0, y: 0, w: 10, h: 10 } },
            { window: "w-B", output: "source", workspace: "workspace-1", rect: { x: 10, y: 0, w: 10, h: 10 } },
            { window: "w-C", output: "source", workspace: "workspace-1", rect: { x: 20, y: 0, w: 10, h: 10 } },
        ],
        gap: 4,
        focusedWindow: "w-B",
        capabilities: { shadow_projection: true },
        ...overrides,
    };
}

function projectedReply(): string {
    return JSON.stringify({
        v: 1,
        correlation_id: "corr-1",
        owner: "owner-1",
        generation: "gen-1",
        revision: 0,
        outcome: "projected",
        capability: "shadow-projection",
        preconditions: [
            "trio-adopted",
            "projection-contained-and-disjoint",
            "adapter-must-verify-postconditions",
        ],
        desired: [
            { window: "w-A", rect: { x: 0, y: 0, w: 43, h: 60 } },
            { window: "w-B", rect: { x: 47, y: 0, w: 43, h: 28 } },
            { window: "w-C", rect: { x: 47, y: 32, w: 43, h: 28 } },
        ],
        focused_window: "w-B",
    });
}

interface Mocks {
    readonly dbusCalls: Array<{ service: string; path: string; iface: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly env: ShadowProjectionEnv;
}

function mockEnv(inputs: Array<ShadowProviderInput | null>): Mocks & { setInputs: (next: Array<ShadowProviderInput | null>) => void } {
    const mocks: { dbusCalls: Mocks["dbusCalls"]; callbacks: Mocks["callbacks"]; timers: Mocks["timers"]; logs: string[] } = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
    };
    let queue = [...inputs];
    const env: ShadowProjectionEnv = {
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
        provideInput: (): ShadowProviderInput | null => {
            if (queue.length === 0) {
                return null;
            }
            return (queue.shift() ?? null) as ShadowProviderInput | null;
        },
        revalidateInput: (): boolean => true,
    };
    return { ...mocks, env, setInputs: (next) => { queue = [...next]; } };
}

function flushTimers(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled) {
            timer.callback();
        }
    }
}

function startEnabled(inputs: Array<ShadowProviderInput | null>): { projection: ShadowProjection; mocks: Mocks & { setInputs: (next: Array<ShadowProviderInput | null>) => void } } {
    const mocks = mockEnv(inputs);
    const projection = new ShadowProjection(mocks.env);
    assert.equal(projection.isEnabled, false);
    projection.enable();
    return { projection, mocks };
}

function driveSuccess(mocks: Mocks, reply: string = projectedReply()): void {
    assert.ok(mocks.callbacks[0] !== undefined);
    mocks.callbacks[0]?.(PINNED_OWNER);
    assert.ok(mocks.callbacks[1] !== undefined);
    mocks.callbacks[1]?.(reply);
    assert.ok(mocks.callbacks[2] !== undefined);
    mocks.callbacks[2]?.(PINNED_OWNER);
}

describe("shadow projection contract constants", () => {
    it("targets the new DescribeShadowProjection identity with bounds", () => {
        assert.equal(SHADOW_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(SHADOW_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(SHADOW_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(SHADOW_METHOD, "DescribeShadowProjection");
        assert.notEqual(SHADOW_METHOD, "DescribeAdvisoryPlan");
        assert.notEqual(SHADOW_METHOD, "EvaluateMove");
        assert.equal(SHADOW_CONTRACT_VERSION, 1);
        assert.equal(SHADOW_MAX_REQUEST_BYTES, 64 * 1024);
        assert.equal(SHADOW_MAX_REPLY_BYTES, 64 * 1024);
        assert.equal(SHADOW_TIMEOUT_MS, 2000);
        assert.equal(SHADOW_WINDOW_COUNT, 3);
    });

    it("normalizes the injected observation without inventing topology", () => {
        const result = normalizeShadowRequest(validInput());
        assert.equal(result.ok, true);
        if (!result.ok) {
            throw new Error("expected ok");
        }
        const request = JSON.parse(result.bundle.requestJson) as Record<string, unknown>;
        assert.deepEqual(Object.keys(request).sort(), [
            "capabilities",
            "correlation_id",
            "focused_window",
            "gap",
            "generation",
            "output",
            "owner",
            "revision",
            "v",
            "windows",
        ]);
        assert.ok(result.bundle.requestJson.length <= SHADOW_MAX_REQUEST_BYTES);
        assert.equal(result.bundle.observed.size, 3);
    });

    it("rejects explicit tree/leaf/focused_leaf inputs", () => {
        const withTree = validInput({
            output: { id: "source", workspace: "workspace-1", tree: {}, workArea: { x: 0, y: 0, w: 90, h: 60 } },
        });
        assert.equal(normalizeShadowRequest(withTree).ok, false);
        const withLeaf = validInput({
            windows: [
                { window: "w-A", leaf: "leaf-w-A", output: "source", workspace: "workspace-1", rect: { x: 0, y: 0, w: 10, h: 10 } },
                { window: "w-B", output: "source", workspace: "workspace-1", rect: { x: 10, y: 0, w: 10, h: 10 } },
                { window: "w-C", output: "source", workspace: "workspace-1", rect: { x: 20, y: 0, w: 10, h: 10 } },
            ],
        });
        assert.equal(normalizeShadowRequest(withLeaf).ok, false);
        const withFocusedLeaf = { ...validInput(), focused_leaf: "leaf-w-B" } as unknown as ShadowProviderInput;
        assert.equal(normalizeShadowRequest(withFocusedLeaf).ok, false);
    });
});

describe("shadow projection adapter", () => {
    it("is disabled by default with no production route", () => {
        const mocks = mockEnv([validInput()]);
        const projection = new ShadowProjection(mocks.env);
        assert.equal(projection.isEnabled, false);
        projection.requestRecompute();
        assert.ok(mocks.logs.some((line) => line.includes("reject:shadow-disabled")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.timers.length, 0);
        const entry = readKwinSource("entry.ts");
        assert.ok(!entry.includes("advisory-shadow-projection"));
        assert.ok(!entry.includes("advisory-shadow-projection-entry"));
        assert.ok(!entry.includes("ShadowProjection"));
    });

    it("coalesces bursts, dedups equal fingerprints, and keeps one flight", () => {
        const { projection, mocks } = startEnabled([validInput()]);
        projection.requestRecompute();
        projection.requestRecompute();
        projection.requestRecompute();
        assert.equal(mocks.timers.length, 1);
        flushTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        // Burst while in flight coalesces instead of queueing another flight.
        projection.requestRecompute();
        assert.equal(mocks.dbusCalls.length, 1);
        driveSuccess(mocks);
        assert.ok(mocks.logs.some((line) => line.endsWith(":divergence")));
        assert.equal(projection.isInFlight, false);
        // Equal observation dedups without sending.
        mocks.setInputs([validInput()]);
        projection.requestRecompute();
        flushTimers(mocks);
        assert.ok(mocks.logs.some((line) => line.includes("shadow-duplicate-observation")));
        const callsAfterDedup = mocks.dbusCalls.length;
        assert.equal(callsAfterDedup, 3);
        // Changed observation recomputes again.
        const changed = validInput();
        (changed.windows as Array<Record<string, unknown>>)[0] = {
            window: "w-A",
            output: "source",
            workspace: "workspace-1",
            rect: { x: 1, y: 0, w: 10, h: 10 },
        };
        mocks.setInputs([changed]);
        projection.requestRecompute();
        flushTimers(mocks);
        assert.ok(mocks.dbusCalls.length > callsAfterDedup);
    });

    it("compares every desired rect exactly: match versus divergence", () => {
        const matching = validInput();
        const normalized = normalizeShadowRequest(matching);
        assert.equal(normalized.ok, true);
        if (!normalized.ok) {
            throw new Error("expected ok");
        }
        const observed = normalized.bundle.observed;
        const exact = JSON.stringify({
            v: 1,
            correlation_id: "corr-1",
            owner: "owner-1",
            generation: "gen-1",
            revision: 0,
            outcome: "projected",
            capability: "shadow-projection",
            preconditions: [
                "trio-adopted",
                "projection-contained-and-disjoint",
                "adapter-must-verify-postconditions",
            ],
            desired: [...observed.keys()].sort().map((id) => {
                const rect = observed.get(id) as { x: number; y: number; w: number; h: number };
                return { window: id, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
            }),
            focused_window: "w-B",
        });
        const validated = validateShadowReply(exact, {
            correlationId: "corr-1",
            owner: "owner-1",
            generation: "gen-1",
            revision: 0,
            observedWindows: new Set(observed.keys()),
        });
        assert.equal(validated.ok, true);

        const { projection, mocks } = startEnabled([matching]);
        projection.requestRecompute();
        flushTimers(mocks);
        driveSuccess(mocks, exact);
        assert.ok(mocks.logs.includes("plasma-auto-tiler:shadow-projection:match"));
        assert.ok(!mocks.logs.includes("plasma-auto-tiler:shadow-projection:divergence"));

        const divergent = startEnabled([validInput()]);
        divergent.projection.requestRecompute();
        flushTimers(divergent.mocks);
        driveSuccess(divergent.mocks, projectedReply());
        assert.ok(divergent.mocks.logs.includes("plasma-auto-tiler:shadow-projection:divergence"));
        assert.ok(!divergent.mocks.logs.includes("plasma-auto-tiler:shadow-projection:match"));
        // Redacted tokens carry no ids, geometry, or host detail.
        for (const line of [...mocks.logs, ...divergent.mocks.logs]) {
            assert.ok(!line.includes("w-A") && !line.includes("corr-1"));
            assert.ok(!line.includes("caption") && !line.includes("appId") && !line.includes("PID"));
            assert.ok(!line.includes("/tmp/") && !line.includes("/proc/"));
            assert.ok(line.length <= 1024);
        }
    });

    it("refuses malformed and stale replies plus owner loss", () => {
        const malformed = startEnabled([validInput()]);
        malformed.projection.requestRecompute();
        flushTimers(malformed.mocks);
        driveSuccess(malformed.mocks, "{not json}");
        assert.ok(malformed.mocks.logs.some((line) => line.includes("shadow-reply-malformed")));

        const stale = startEnabled([validInput()]);
        stale.projection.requestRecompute();
        flushTimers(stale.mocks);
        assert.ok(stale.mocks.callbacks[0] !== undefined);
        stale.mocks.callbacks[0]?.(PINNED_OWNER);
        assert.ok(stale.mocks.callbacks[1] !== undefined);
        const wrongCorrelation = projectedReply().replace("corr-1", "corr-2");
        stale.mocks.callbacks[1]?.(wrongCorrelation);
        assert.ok(stale.mocks.callbacks[2] !== undefined);
        stale.mocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(stale.mocks.logs.some((line) => line.includes("shadow-identity-mismatch")));

        const lost = startEnabled([validInput()]);
        lost.projection.requestRecompute();
        flushTimers(lost.mocks);
        lost.mocks.callbacks[0]?.(PINNED_OWNER);
        lost.mocks.callbacks[1]?.(projectedReply());
        lost.mocks.callbacks[2]?.(":1.99");
        assert.ok(lost.mocks.logs.some((line) => line.includes("shadow-owner-changed")));
        assert.ok(!lost.mocks.logs.some((line) => line.endsWith(":match") || line.endsWith(":divergence")));
    });

    it("refuses stale input via the supplier revalidation hook and stays bounded", () => {
        const mocks = mockEnv([validInput()]);
        const env: ShadowProjectionEnv = {
            ...mocks.env,
            revalidateInput: () => false,
        };
        const projection = new ShadowProjection(env);
        projection.enable();
        projection.requestRecompute();
        const pending = [...mocks.timers];
        mocks.timers.length = 0;
        for (const timer of pending) {
            if (!timer.cancelled) {
                timer.callback();
            }
        }
        mocks.callbacks[0]?.(PINNED_OWNER);
        assert.ok(mocks.logs.some((line) => line.includes("shadow-stale-snapshot")));
        assert.equal(projection.isInFlight, false);
        for (const line of mocks.logs) {
            assert.ok(line.length <= 1024);
        }
    });

    it("requires the revalidation hook and fails closed when absent or throwing", () => {
        const bare = mockEnv([validInput()]);
        const withoutHook = { ...bare.env, revalidateInput: undefined } as unknown as ShadowProjectionEnv;
        const missing = new ShadowProjection(withoutHook);
        missing.enable();
        missing.requestRecompute();
        flushTimers(bare);
        assert.ok(bare.callbacks[0] !== undefined);
        bare.callbacks[0]?.(PINNED_OWNER);
        assert.ok(bare.logs.some((line) => line.includes("shadow-stale-snapshot")));
        assert.equal(missing.isInFlight, false);
        assert.equal(bare.dbusCalls.length, 1);

        const throwing = mockEnv([validInput()]);
        const throwingEnv: ShadowProjectionEnv = {
            ...throwing.env,
            revalidateInput: (): boolean => {
                throw new Error("revalidate exploded");
            },
        };
        const boom = new ShadowProjection(throwingEnv);
        boom.enable();
        boom.requestRecompute();
        flushTimers(throwing);
        throwing.callbacks[0]?.(PINNED_OWNER);
        assert.ok(throwing.logs.some((line) => line.includes("shadow-stale-snapshot")));
        assert.equal(boom.isInFlight, false);
    });

    it("revalidates after plan reply and owner recheck before accepting", () => {
        const mocks = mockEnv([validInput()]);
        let fresh = true;
        const env: ShadowProjectionEnv = {
            ...mocks.env,
            revalidateInput: (): boolean => {
                if (!fresh) {
                    return false;
                }
                return true;
            },
        };
        const projection = new ShadowProjection(env);
        projection.enable();
        projection.requestRecompute();
        flushTimers(mocks);
        assert.ok(mocks.callbacks[0] !== undefined);
        mocks.callbacks[0]?.(PINNED_OWNER);
        assert.ok(mocks.callbacks[1] !== undefined);
        // Queue a coalesced recompute while in flight, then drift stale.
        projection.requestRecompute();
        fresh = false;
        mocks.callbacks[1]?.(projectedReply());
        assert.ok(mocks.callbacks[2] !== undefined);
        mocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(mocks.logs.some((line) => line.includes("shadow-stale-snapshot")));
        assert.ok(!mocks.logs.some((line) => line.endsWith(":match") || line.endsWith(":divergence")));
        assert.equal(projection.isInFlight, false);
        // Exactly one pending recompute drains under normal coalescing semantics.
        const live = mocks.timers.filter((timer) => !timer.cancelled);
        assert.equal(live.length, 1);
    });

    it("fails closed after plan reply when revalidation throws or is absent", () => {
        const throwingMocks = mockEnv([validInput()]);
        let calls = 0;
        const throwingEnv: ShadowProjectionEnv = {
            ...throwingMocks.env,
            revalidateInput: (): boolean => {
                calls += 1;
                if (calls <= 1) {
                    return true;
                }
                throw new Error("drifted");
            },
        };
        const throwingProjection = new ShadowProjection(throwingEnv);
        throwingProjection.enable();
        throwingProjection.requestRecompute();
        flushTimers(throwingMocks);
        throwingMocks.callbacks[0]?.(PINNED_OWNER);
        throwingMocks.callbacks[1]?.(projectedReply());
        throwingMocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(throwingMocks.logs.some((line) => line.includes("shadow-stale-snapshot")));
        assert.ok(!throwingMocks.logs.some((line) => line.endsWith(":match") || line.endsWith(":divergence")));
        assert.equal(throwingProjection.isInFlight, false);

        const absentMocks = mockEnv([validInput()]);
        const mutableEnv = {
            ...absentMocks.env,
            revalidateInput: (): boolean => true,
        };
        const absentProjection = new ShadowProjection(mutableEnv);
        absentProjection.enable();
        absentProjection.requestRecompute();
        flushTimers(absentMocks);
        absentMocks.callbacks[0]?.(PINNED_OWNER);
        (mutableEnv as unknown as Record<string, unknown>)["revalidateInput"] = undefined;
        absentMocks.callbacks[1]?.(projectedReply());
        absentMocks.callbacks[2]?.(PINNED_OWNER);
        assert.ok(absentMocks.logs.some((line) => line.includes("shadow-stale-snapshot")));
        assert.ok(!absentMocks.logs.some((line) => line.endsWith(":match") || line.endsWith(":divergence")));
        assert.equal(absentProjection.isInFlight, false);
    });

    it("never drops a pending recompute across flights", () => {
        const first = validInput();
        const second = validInput({
            correlationId: "corr-2",
            revision: 1,
            windows: [
                { window: "w-A", output: "source", workspace: "workspace-1", rect: { x: 1, y: 0, w: 10, h: 10 } },
                { window: "w-B", output: "source", workspace: "workspace-1", rect: { x: 10, y: 0, w: 10, h: 10 } },
                { window: "w-C", output: "source", workspace: "workspace-1", rect: { x: 20, y: 0, w: 10, h: 10 } },
            ],
        });
        const { projection, mocks } = startEnabled([first]);
        const live = (): number => mocks.timers.filter((timer) => !timer.cancelled).length;
        projection.requestRecompute();
        projection.requestRecompute();
        assert.equal(live(), 1);
        flushTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.setInputs([second]);
        projection.requestRecompute();
        assert.equal(mocks.dbusCalls.length, 1);
        driveSuccess(mocks);
        assert.equal(projection.isInFlight, false);
        assert.ok(live() >= 1);
        const callsBeforeFollowUp = mocks.dbusCalls.length;
        flushTimers(mocks);
        assert.ok(mocks.dbusCalls.length > callsBeforeFollowUp);
        assert.ok(mocks.callbacks[callsBeforeFollowUp] !== undefined);
    });

    it("contains no native mutation APIs", () => {
        const source = readKwinSource("advisory-shadow-projection.ts");
        assert.ok(source.includes("DescribeShadowProjection"));
        assert.ok(source.includes("GetNameOwner"));
        for (const forbidden of [
            "workspace.",
            "activeWindow",
            "setActive",
            "rootTile",
            "showOutline",
            "hideOutline",
            "registerShortcut",
            "TileController",
            "manageTile",
            "assignWindow",
            "createDesktop",
            "removeDesktop",
            "closeWindow",
            "frameGeometry",
            ".tile",
            "callDBus",
            "QTimer",
            "from \"./controller",
            "from \"./poc3",
            "from \"./planner-shadow",
            "EvaluateMove",
            "PublishSnapshot",
        ]) {
            assert.ok(!source.includes(forbidden), `mutation coupling: ${forbidden}`);
        }
    });
});

describe("shadow projection signal-bound entry", () => {
    it("is not production-imported and exposes only an explicit start function", () => {
        const production = readKwinSource("entry.ts");
        assert.ok(!production.includes("advisory-shadow-projection-entry"));
        assert.ok(!production.includes("startShadowProjectionEntry"));
        const source = readKwinSource("advisory-shadow-projection-entry.ts");
        assert.ok(source.includes("startShadowProjectionEntry"));
        assert.ok(source.includes("lexical KWin `workspace`"));
        assert.ok(source.includes("captureShadowProjectionObservation"));
        assert.ok(source.includes("attachShadowTrioGeometry"));
        assert.ok(source.includes("windowActivated"));
        assert.ok(source.includes("windowAdded"));
        assert.ok(source.includes("windowRemoved"));
        assert.ok(source.includes("SHADOW_ENTRY_GAP = 8"));
        assert.ok(!source.includes("startShadowProjectionEntry(") || source.includes("export function startShadowProjectionEntry"));
        for (const forbidden of [
            "registerShortcut",
            "showOutline",
            "hideOutline",
            "createDesktop",
            "removeDesktop",
            "closeWindow",
            "Reflect.set",
            "frameGeometry =",
            ".tile =",
            "activeWindow =",
            "TileController",
            "TrayPublisher",
            "EvaluateMove",
            "PublishSnapshot",
            "setTimeout",
            "setInterval",
        ]) {
            assert.ok(!source.includes(forbidden), `entry mutation coupling: ${forbidden}`);
        }
        for (const line of source.split("\n")) {
            if (line.includes("plasma-auto-tiler:shadow-entry")) {
                assert.ok(line.length <= 1024);
            }
        }
    });

    it("fails closed on trio rebind and detaches disconnectable workspace signals", () => {
        const source = readKwinSource("advisory-shadow-projection-entry.ts");
        assert.ok(source.includes("disconnect"));
        assert.ok(source.includes("workspaceDetaches") || source.includes("detachWorkspace"));
        assert.ok(source.includes("detachTrio") || source.includes("trioDetach"));
        assert.ok(source.includes("projection.disable()"));
        assert.ok(source.includes("failClosedRebind"));
        assert.ok(source.includes("stop:"));
    });
});
