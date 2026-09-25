import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_DBUS_INTERFACE,
    PLAN_DBUS_OBJECT,
    PLAN_DBUS_SERVICE,
    PLAN_GET_OWNER_METHOD,
    PLAN_HAS_OWNER_METHOD,
    PLAN_INTERFACE,
    PLAN_METHOD,
    PLAN_OBJECT,
    PLAN_SERVICE,
    PLAN_START_METHOD,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
} from "../src/plan-adapter";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";

function makeRefs(): { a: object; b: object } {
    return { a: {}, b: {} };
}

function makeObserved(
    refs: { a: object; b: object },
    opts: {
        focused?: object;
        floating?: Record<string, boolean>;
        fullscreen?: Record<string, boolean>;
        maximized?: Record<string, boolean>;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const win = (id: string, ref: object): Record<string, unknown> => ({
        id,
        ref,
        rect: { x: 0, y: 0, w: 100, h: 100 },
        output: "out-1",
        workspace: "ws-1",
        fullscreen: opts.fullscreen?.[id] === true,
        maximized: opts.maximized?.[id] === true,
        floating: opts.floating?.[id] === true,
        sticky: false,
        resourceClass: "unknown",
    });
    const windows = Object.freeze([Object.freeze(win("win-a", refs.a)), Object.freeze(win("win-b", refs.b))]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: focused === refs.a ? "win-a" : "win-b",
        windows: windows as unknown as PlanObserved["windows"],
        activeRef: focused,
        fingerprint: "fp-1",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ service: string; path: string; iface: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    observeImpl: () => PlanObserved | null;
    hiddenImpl: () => ReadonlyArray<PlanObserved>;
    sendActive: boolean;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object }): Mocks {
    const state: Mocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        geometries: [],
        observeImpl: () => makeObserved(refs),
        hiddenImpl: () => [],
        sendActive: false,
        env: null as unknown as PlanAdapterEnv,
    };
    state.env = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            state.dbusCalls.push({ service, path, iface, method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            state.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        observeHidden: (): ReadonlyArray<PlanObserved> => state.hiddenImpl(),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        },
        setActive: (): boolean => true,
        active: () => refs.a,
        subscribe: (): (() => void) => (): void => {},
        isSendActive: (): boolean => state.sendActive,
    };
    return state;
}

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function plannedReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        desired_geometry: [
            { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ],
    });
}

function payloadOf(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function fireTimeout(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === 2000) {
            timer.callback();
        } else if (!timer.cancelled) {
            mocks.timers.push(timer);
        }
    }
}

function establishBaseline(mocks: Mocks, adapter: PlanAdapter, owner = ":1.5"): string {
    adapter.requestFocus("left");
    assert.equal(mocks.dbusCalls[0]?.method, PLAN_HAS_OWNER_METHOD);
    assert.equal(mocks.dbusCalls[0]?.service, PLAN_DBUS_SERVICE);
    mocks.callbacks[0]?.(true);
    assert.equal(mocks.dbusCalls[1]?.method, PLAN_GET_OWNER_METHOD);
    mocks.callbacks[1]?.(owner);
    const planIndex = mocks.dbusCalls.findIndex((c) => c.method === PLAN_METHOD);
    assert.ok(planIndex >= 0);
    assert.equal(mocks.dbusCalls[planIndex]?.service, owner);
    const correlation = (payloadOf(mocks, planIndex)["correlation_id"] as string) ?? "";
    mocks.callbacks[planIndex]?.(plannedReply(correlation));
    return correlation;
}

describe("plan planner-loss recovery", () => {
    it("pins a unique owner before DescribePlan (present name)", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.dbusCalls[0]?.service, PLAN_DBUS_SERVICE);
        assert.equal(mocks.dbusCalls[0]?.path, PLAN_DBUS_OBJECT);
        assert.equal(mocks.dbusCalls[0]?.iface, PLAN_DBUS_INTERFACE);
        assert.equal(mocks.dbusCalls[0]?.method, PLAN_HAS_OWNER_METHOD);
        assert.equal(mocks.dbusCalls[0]?.payload, PLAN_SERVICE);
        mocks.callbacks[0]?.(true);
        assert.equal(mocks.dbusCalls[1]?.method, PLAN_GET_OWNER_METHOD);
        mocks.callbacks[1]?.(":1.5");
        assert.equal(mocks.dbusCalls[2]?.method, PLAN_METHOD);
        assert.equal(mocks.dbusCalls[2]?.service, ":1.5");
        assert.equal(mocks.dbusCalls[2]?.path, PLAN_OBJECT);
        assert.equal(mocks.dbusCalls[2]?.iface, PLAN_INTERFACE);
        adapter.disable();
    });

    it("absent name runs one bounded StartServiceByName accepting only 1/2 then pins", () => {
        for (const code of [1, 2]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(false);
            assert.equal(mocks.dbusCalls[1]?.method, PLAN_START_METHOD);
            mocks.callbacks[1]?.(code);
            assert.equal(mocks.dbusCalls[2]?.method, PLAN_GET_OWNER_METHOD);
            mocks.callbacks[2]?.(":1.9");
            assert.equal(mocks.dbusCalls[3]?.method, PLAN_METHOD);
            assert.equal(mocks.dbusCalls[3]?.service, ":1.9");
            adapter.disable();
        }
        for (const code of [0, 3, "1", null]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(false);
            mocks.callbacks[1]?.(code);
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")));
            adapter.disable();
        }
    });

    it("strict boolean only: non-boolean presence is terminal without DescribePlan or probe", () => {
        for (const bad of [1, 0, "true", null, undefined]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(bad);
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")));
            assert.equal(mocks.dbusCalls.length, 1);
            adapter.disable();
        }
    });

    it("same-owner timeout retains baseline with no rebuild", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        const geoBefore = mocks.geometries.length;
        adapter.requestMove("left");
        assert.equal(mocks.dbusCalls[base]?.method, PLAN_HAS_OWNER_METHOD);
        mocks.callbacks[base]?.(true);
        assert.equal(mocks.dbusCalls[base + 1]?.method, PLAN_GET_OWNER_METHOD);
        mocks.callbacks[base + 1]?.(":1.5");
        const planIndex = base + 2;
        assert.equal(mocks.dbusCalls[planIndex]?.method, PLAN_METHOD);
        fireTimeout(mocks);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=timeout")));
        const probeName = mocks.dbusCalls.length - 1;
        assert.equal(mocks.dbusCalls[probeName]?.method, PLAN_HAS_OWNER_METHOD);
        mocks.callbacks[probeName]?.(true);
        assert.equal(mocks.dbusCalls[mocks.dbusCalls.length - 1]?.method, PLAN_GET_OWNER_METHOD);
        mocks.callbacks[mocks.dbusCalls.length - 1]?.(":1.5");
        assert.ok(!mocks.logs.some((l) => l.includes("plan:recovery")));
        assert.equal(mocks.geometries.length, geoBefore);
        const after = mocks.dbusCalls.length;
        assert.equal(after, probeName + 2);
        adapter.disable();
    });

    it("absent probe triggers a fresh reconcile without replaying the old command", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        adapter.requestMove("left");
        mocks.callbacks[base]?.(true);
        mocks.callbacks[base + 1]?.(":1.5");
        fireTimeout(mocks);
        const lastProbe = mocks.dbusCalls.length - 1;
        assert.equal(mocks.dbusCalls[lastProbe]?.method, PLAN_HAS_OWNER_METHOD);
        mocks.callbacks[lastProbe]?.(false);
        assert.ok(mocks.logs.some((l) => l.includes("plan:recovery") && l.includes("reason=absent")));
        // Recovery clears the baseline and dispatches one fresh reconcile through
        // the existing route: one bounded activation plus one current
        // observation. The old move command is never replayed.
        drainRecovery(mocks);
        const freshPlans = mocks.dbusCalls
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => c.method === PLAN_METHOD)
            .slice(-1);
        assert.equal(freshPlans.length, 1);
        const freshPayload = payloadOf(mocks, freshPlans[0]?.i as number);
        assert.deepEqual((freshPayload["command"] as Record<string, unknown>)["op"], "reconcile");
        adapter.disable();
    });

    it("changed owner triggers a fresh session", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        adapter.requestFocus("right");
        mocks.callbacks[base]?.(true);
        mocks.callbacks[base + 1]?.(":1.5");
        fireTimeout(mocks);
        const lastProbe = mocks.dbusCalls.length - 1;
        assert.equal(mocks.dbusCalls[lastProbe]?.method, PLAN_HAS_OWNER_METHOD);
        mocks.callbacks[lastProbe]?.(true);
        const ownerProbe = mocks.dbusCalls.length - 1;
        assert.equal(mocks.dbusCalls[ownerProbe]?.method, PLAN_GET_OWNER_METHOD);
        mocks.callbacks[ownerProbe]?.(":1.9");
        assert.ok(mocks.logs.some((l) => l.includes("plan:recovery") && l.includes("reason=changed")));
        drainRecovery(mocks);
        const fresh = mocks.dbusCalls.filter((c) => c.method === PLAN_METHOD).slice(-1)[0];
        assert.ok(fresh !== undefined);
        assert.equal(fresh?.service, ":1.9");
        adapter.disable();
    });

    it("late old-generation replies are rejected after confirmed loss", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        adapter.requestFocus("left");
        mocks.callbacks[base]?.(true);
        mocks.callbacks[base + 1]?.(":1.5");
        const oldPlanIndex = base + 2;
        assert.equal(mocks.dbusCalls[oldPlanIndex]?.method, PLAN_METHOD);
        const oldPayload = payloadOf(mocks, oldPlanIndex);
        const oldCorrelation = oldPayload["correlation_id"] as string;
        const oldCallback = mocks.callbacks[oldPlanIndex] as (reply: unknown) => void;
        fireTimeout(mocks);
        const lastProbe = mocks.dbusCalls.length - 1;
        mocks.callbacks[lastProbe]?.(false);
        drainRecovery(mocks);
        const geoBefore = mocks.geometries.length;
        oldCallback(plannedReply(oldCorrelation));
        assert.equal(mocks.geometries.length, geoBefore);
        adapter.disable();
    });

    it("no probe or recovery while a workspace send blocks Plan", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        mocks.sendActive = true;
        adapter.requestFocus("left");
        // Blocked dispatch never touches D-Bus.
        const before = mocks.dbusCalls.length;
        // Force a terminal via direct malformed reply on the established
        // flight instead: use a fresh flight started before the block.
        mocks.sendActive = false;
        adapter.requestFocus("left");
        drainOwnersFor(mocks);
        const planIndex = mocks.dbusCalls.map((c, i) => ({ c, i })).filter(({ c }) => c.method === PLAN_METHOD).slice(-1)[0]?.i as number;
        mocks.sendActive = true;
        mocks.callbacks[planIndex]?.("not-json");
        assert.ok(mocks.logs.some((l) => l.includes("outcome=service-fault")));
        const afterFault = mocks.dbusCalls.length;
        assert.ok(!mocks.logs.some((l) => l.includes("plan:recovery")));
        assert.equal(mocks.dbusCalls.length, afterFault);
        assert.ok(before >= 0);
        adapter.disable();
    });

    it("failed recovery stays bounded without loops", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        adapter.requestFocus("left");
        mocks.callbacks[base]?.(true);
        mocks.callbacks[base + 1]?.(":1.5");
        fireTimeout(mocks);
        const lastProbe = mocks.dbusCalls.length - 1;
        mocks.callbacks[lastProbe]?.(false);
        assert.ok(mocks.logs.some((l) => l.includes("plan:recovery") && l.includes("outcome=confirmed-loss")));
        // Fresh recovery activation fails (StartServiceByName 0): bounded
        // terminal, no second recovery.
        answerRecoveryActivationFailure(mocks);
        const recoveryLines = mocks.logs.filter((l) => l.includes("plan:recovery") && l.includes("outcome=confirmed-loss"));
        assert.equal(recoveryLines.length, 1);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")));
        const total = mocks.dbusCalls.length;
        assert.ok(total <= 14);
        adapter.disable();
    });

    it("reentrant dispatch during a probe aborts the probe without recovery", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        adapter.requestFocus("left");
        mocks.callbacks[base]?.(true);
        mocks.callbacks[base + 1]?.(":1.5");
        fireTimeout(mocks);
        const probeName = mocks.dbusCalls.length - 1;
        assert.equal(mocks.dbusCalls[probeName]?.method, PLAN_HAS_OWNER_METHOD);
        // New user command before the probe answers starts a fresh flight.
        adapter.requestFocus("right");
        assert.ok(adapter.isInFlight);
        mocks.callbacks[probeName]?.(false);
        assert.ok(!mocks.logs.some((l) => l.includes("plan:recovery")));
        adapter.disable();
    });

    it("fresh reconcile after recovery carries current windows with fit exclusion", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": true } });
        const base = mocks.dbusCalls.length;
        adapter.requestFocus("left");
        mocks.callbacks[base]?.(true);
        mocks.callbacks[base + 1]?.(":1.5");
        fireTimeout(mocks);
        const lastProbe = mocks.dbusCalls.length - 1;
        mocks.callbacks[lastProbe]?.(false);
        drainRecovery(mocks);
        const freshIndex = mocks.dbusCalls.map((c, i) => ({ c, i })).filter(({ c }) => c.method === PLAN_METHOD).slice(-1)[0]?.i as number;
        const fresh = payloadOf(mocks, freshIndex);
        assert.equal((fresh["command"] as Record<string, unknown>)["op"], "reconcile");
        const windows = fresh["windows"] as Array<Record<string, unknown>>;
        assert.equal(windows.length, 2);
        assert.equal((windows.find((w) => w["window"] === "win-a") as Record<string, unknown>)["fit_excluded"], true);
        assert.equal("fit_excluded" in (windows.find((w) => w["window"] === "win-b") as Record<string, unknown>), false);
        adapter.disable();
    });

    it("recovers an eligible hidden domain when no foreground observation remains", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        adapter.requestFocus("left");
        mocks.callbacks[base]?.(true);
        mocks.callbacks[base + 1]?.(":1.5");
        mocks.observeImpl = () => null;
        mocks.hiddenImpl = () => [makeObserved(refs)];
        fireTimeout(mocks);
        mocks.callbacks[mocks.dbusCalls.length - 1]?.(false);
        drainRecovery(mocks);
        const freshIndex = mocks.dbusCalls.map((c, i) => ({ c, i })).filter(({ c }) => c.method === PLAN_METHOD).slice(-1)[0]?.i as number;
        const fresh = payloadOf(mocks, freshIndex);
        assert.equal((fresh["command"] as Record<string, unknown>)["op"], "reconcile");
        const freshWindows = fresh["windows"] as Array<Record<string, unknown>>;
        assert.equal(freshWindows.length, 2);
        assert.ok(freshWindows.some((w) => w["window"] === "win-a"));
        assert.ok(freshWindows.some((w) => w["window"] === "win-b"));
        adapter.disable();
    });

});

function drainOwnersFor(mocks: Mocks): void {
    for (let i = 0; i < mocks.dbusCalls.length; i += 1) {
        if (mocks.dbusCalls[i]?.method === PLAN_HAS_OWNER_METHOD) {
            try {
                mocks.callbacks[i]?.(true);
            } catch {
                void 0;
            }
        }
    }
    for (let i = 0; i < mocks.dbusCalls.length; i += 1) {
        if (mocks.dbusCalls[i]?.method === PLAN_GET_OWNER_METHOD) {
            try {
                mocks.callbacks[i]?.(":1.5");
            } catch {
                void 0;
            }
        }
    }
}

function drainRecovery(mocks: Mocks): void {
    for (let round = 0; round < 6; round += 1) {
        let madeCall = false;
        const before = mocks.dbusCalls.length;
        for (let i = 0; i < mocks.dbusCalls.length; i += 1) {
            const call = mocks.dbusCalls[i];
            if (call === undefined) {
                continue;
            }
            if (call.method === PLAN_HAS_OWNER_METHOD) {
                try {
                    mocks.callbacks[i]?.(true);
                } catch {
                    void 0;
                }
            } else if (call.method === PLAN_GET_OWNER_METHOD) {
                try {
                    mocks.callbacks[i]?.(":1.9");
                } catch {
                    void 0;
                }
            }
        }
        if (mocks.dbusCalls.length !== before) {
            madeCall = true;
        }
        if (!madeCall) {
            break;
        }
    }
}

function answerRecoveryActivationFailure(mocks: Mocks): void {
    // The recovery fresh admit starts with NameHasOwner (hidden true in real
    // harness? here recorded). Answer absent then bad start result.
    for (let i = mocks.dbusCalls.length - 1; i >= 0; i -= 1) {
        if (mocks.dbusCalls[i]?.method === PLAN_HAS_OWNER_METHOD) {
            try {
                mocks.callbacks[i]?.(false);
            } catch {
                void 0;
            }
            break;
        }
    }
    for (let i = mocks.dbusCalls.length - 1; i >= 0; i -= 1) {
        if (mocks.dbusCalls[i]?.method === PLAN_START_METHOD) {
            try {
                mocks.callbacks[i]?.(0);
            } catch {
                void 0;
            }
            break;
        }
    }
}

describe("plan activation correlated diagnostics", () => {
    function activateLines(mocks: Mocks): string[] {
        return mocks.logs.filter((l) => l.includes("stage=activate"));
    }

    function correlationOf(mocks: Mocks, planIndex: number): string {
        return (payloadOf(mocks, planIndex)["correlation_id"] as string) ?? "";
    }

    it("present owner pins and hands off with shared correlation/generation/revision", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.(true);
        assert.equal(mocks.dbusCalls.length, 2);
        mocks.callbacks[1]?.(":1.5");
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(mocks.dbusCalls[2]?.method, PLAN_METHOD);
        const correlation = correlationOf(mocks, 2);
        assert.ok(correlation.startsWith("gen-1-p"));
        const lines = activateLines(mocks);
        assert.ok(lines.some((l) => l.includes("event=presence") && l.includes("outcome=present")), lines.join("\n"));
        assert.ok(lines.some((l) => l.includes("event=resolve") && l.includes("outcome=owner-pinned")), lines.join("\n"));
        assert.ok(lines.some((l) => l.includes("event=send") && l.includes("outcome=request-sent")), lines.join("\n"));
        for (const line of lines) {
            assert.ok(line.includes(`correlation=${correlation}`), line);
            assert.ok(line.includes("generation=gen-1"), line);
            assert.ok(line.includes("revision=0"), line);
            assert.ok(line.includes("component=cosmic-plan"), line);
            assert.ok(line.includes("route=plan"), line);
        }
        // Existing behavior preserved: same call order/count and dispatch line.
        assert.ok(mocks.logs.some((l) => l.includes("event=dispatch") && l.includes("outcome=started")), lines.join("\n"));
        adapter.disable();
    });

    it("absent name runs start request/result then pins with exact call counts", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        mocks.callbacks[0]?.(false);
        assert.equal(mocks.dbusCalls[1]?.method, PLAN_START_METHOD);
        const before = mocks.dbusCalls.length;
        mocks.callbacks[1]?.(1);
        assert.equal(mocks.dbusCalls[2]?.method, PLAN_GET_OWNER_METHOD);
        mocks.callbacks[2]?.(":1.9");
        assert.equal(mocks.dbusCalls[3]?.method, PLAN_METHOD);
        assert.equal(mocks.dbusCalls.length, before + 2);
        const lines = activateLines(mocks);
        assert.ok(lines.some((l) => l.includes("event=presence") && l.includes("outcome=absent")), lines.join("\n"));
        assert.ok(lines.some((l) => l.includes("event=start") && l.includes("outcome=start-requested")), lines.join("\n"));
        assert.ok(lines.some((l) => l.includes("event=start-result") && l.includes("outcome=start-primary")), lines.join("\n"));
        assert.ok(lines.some((l) => l.includes("event=resolve") && l.includes("outcome=owner-pinned")), lines.join("\n"));
        assert.ok(lines.some((l) => l.includes("event=send") && l.includes("outcome=request-sent")), lines.join("\n"));
        // Absent-path continuity: every activate line shares the handed-off
        // correlation/generation/revision/component/route.
        const correlation = correlationOf(mocks, 3);
        assert.ok(correlation.startsWith("gen-1-p"), correlation);
        for (const line of lines) {
            assert.ok(line.includes(`correlation=${correlation}`), line);
            assert.ok(line.includes("generation=gen-1"), line);
            assert.ok(line.includes("revision=0"), line);
            assert.ok(line.includes("component=cosmic-plan"), line);
            assert.ok(line.includes("route=plan"), line);
        }
        adapter.disable();
        {
            const refs2 = makeRefs();
            const mocks2 = mockEnv(refs2);
            const adapter2 = enableAdapter(mocks2);
            adapter2.requestFocus("left");
            mocks2.callbacks[0]?.(false);
            mocks2.callbacks[1]?.(2);
            mocks2.callbacks[2]?.(":1.9");
            assert.equal(mocks2.dbusCalls[3]?.method, PLAN_METHOD);
            assert.ok(
                activateLines(mocks2).some((l) => l.includes("event=start-result") && l.includes("outcome=start-already")),
                activateLines(mocks2).join("\n"),
            );
            adapter2.disable();
        }
    });

    it("distinguishes malformed presence/start/owner replies without DescribePlan", () => {
        for (const bad of [1, 0, "true", null, undefined]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(bad);
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")));
            assert.ok(activateLines(mocks).some((l) => l.includes("event=presence") && l.includes("outcome=presence-malformed")));
            assert.equal(mocks.dbusCalls.length, 1);
            adapter.disable();
        }
        for (const bad of [0, 3, "1", null]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(false);
            mocks.callbacks[1]?.(bad);
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")));
            const lines = activateLines(mocks);
            const expected = typeof bad === "number" ? "start-refused" : "start-malformed";
            assert.ok(lines.some((l) => l.includes("event=start-result") && l.includes(`outcome=${expected}`)), lines.join("\n"));
            adapter.disable();
        }
        for (const bad of ["not-owner", "", 42, null]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(true);
            mocks.callbacks[1]?.(bad);
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")));
            assert.ok(activateLines(mocks).some((l) => l.includes("event=resolve") && l.includes("outcome=owner-malformed")));
            adapter.disable();
        }
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(false);
            mocks.callbacks[1]?.(2);
            mocks.callbacks[2]?.("bad-owner");
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            assert.ok(activateLines(mocks).some((l) => l.includes("event=resolve") && l.includes("outcome=owner-malformed")));
            adapter.disable();
        }
    });

    it("distinguishes thrown activation calls without changing terminal behavior", () => {
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            const orig = mocks.env.callDbus;
            (mocks.env as { callDbus: PlanAdapterEnv["callDbus"] }).callDbus = ((service, path, iface, method, payload, callback): void => {
                if (method === PLAN_GET_OWNER_METHOD) {
                    throw new Error("resolve-boom");
                }
                return orig(service, path, iface, method, payload, callback);
            }) as PlanAdapterEnv["callDbus"];
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(true);
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")));
            const lines = activateLines(mocks);
            assert.ok(lines.some((l) => l.includes("event=resolve") && l.includes("outcome=resolve-requested")), lines.join("\n"));
            assert.ok(lines.some((l) => l.includes("event=resolve") && l.includes("outcome=resolve-throw")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=owner-pinned")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=request-sent")), lines.join("\n"));
            adapter.disable();
        }
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            const orig = mocks.env.callDbus;
            (mocks.env as { callDbus: PlanAdapterEnv["callDbus"] }).callDbus = ((service, path, iface, method, payload, callback): void => {
                if (method === PLAN_START_METHOD) {
                    throw new Error("start-boom");
                }
                return orig(service, path, iface, method, payload, callback);
            }) as PlanAdapterEnv["callDbus"];
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(false);
            assert.ok(!mocks.dbusCalls.some((c) => c.method === PLAN_METHOD));
            const lines = activateLines(mocks);
            assert.ok(lines.some((l) => l.includes("event=start") && l.includes("outcome=start-requested")), lines.join("\n"));
            assert.ok(lines.some((l) => l.includes("event=start") && l.includes("outcome=start-throw")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=start-primary") || l.includes("outcome=start-already")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=owner-pinned")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=request-sent")), lines.join("\n"));
            adapter.disable();
        }
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            const orig = mocks.env.callDbus;
            (mocks.env as { callDbus: PlanAdapterEnv["callDbus"] }).callDbus = ((service, path, iface, method, payload, callback): void => {
                if (method === PLAN_METHOD) {
                    throw new Error("send-boom");
                }
                return orig(service, path, iface, method, payload, callback);
            }) as PlanAdapterEnv["callDbus"];
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(true);
            mocks.callbacks[1]?.(":1.5");
            const lines = activateLines(mocks);
            assert.ok(lines.some((l) => l.includes("event=send") && l.includes("outcome=send-requested")), lines.join("\n"));
            assert.ok(lines.some((l) => l.includes("event=send") && l.includes("outcome=send-throw")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=request-sent")), lines.join("\n"));
            assert.ok(mocks.logs.some((l) => l.includes("outcome=owner-loss")));
            adapter.disable();
        }
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            const orig = mocks.env.callDbus;
            (mocks.env as { callDbus: PlanAdapterEnv["callDbus"] }).callDbus = (() => {
                throw new Error("presence-boom");
            }) as PlanAdapterEnv["callDbus"];
            void orig;
            adapter.requestFocus("left");
            assert.ok(mocks.logs.some((l) => l.includes("outcome=dbus-failed")));
            const lines = activateLines(mocks);
            assert.ok(lines.some((l) => l.includes("event=presence") && l.includes("outcome=presence-requested")), lines.join("\n"));
            assert.ok(lines.some((l) => l.includes("event=presence") && l.includes("outcome=presence-throw")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=present")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=owner-pinned")), lines.join("\n"));
            assert.ok(!lines.some((l) => l.includes("outcome=request-sent")), lines.join("\n"));
            adapter.disable();
        }
    });

    it("logs initiation before each D-Bus call even with synchronous callbacks", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        const orig = mocks.env.callDbus;
        const seen: string[] = [];
        (mocks.env as { callDbus: PlanAdapterEnv["callDbus"] }).callDbus = ((service, path, iface, method, payload, callback): void => {
            seen.push(method);
            if (method === PLAN_HAS_OWNER_METHOD) {
                callback(true);
                return;
            }
            if (method === PLAN_GET_OWNER_METHOD) {
                callback(":1.5");
                return;
            }
            return orig(service, path, iface, method, payload, callback);
        }) as PlanAdapterEnv["callDbus"];
        adapter.requestFocus("left");
        assert.deepEqual(seen, [PLAN_HAS_OWNER_METHOD, PLAN_GET_OWNER_METHOD, PLAN_METHOD]);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.dbusCalls[0]?.method, PLAN_METHOD);
        const lines = activateLines(mocks);
        const at = (event: string, outcome: string): number =>
            lines.findIndex((l) => l.includes(`event=${event}`) && l.includes(`outcome=${outcome}`));
        const presenceRequested = at("presence", "presence-requested");
        const present = at("presence", "present");
        const resolveRequested = at("resolve", "resolve-requested");
        const pinned = at("resolve", "owner-pinned");
        const sendRequested = at("send", "send-requested");
        const sent = at("send", "request-sent");
        assert.ok(presenceRequested >= 0 && present > presenceRequested, lines.join("\n"));
        assert.ok(resolveRequested > present && pinned > resolveRequested, lines.join("\n"));
        assert.ok(sendRequested > pinned && sent > sendRequested, lines.join("\n"));
        adapter.disable();
        const refs2 = makeRefs();
        const mocks2 = mockEnv(refs2);
        const adapter2 = enableAdapter(mocks2);
        const orig2 = mocks2.env.callDbus;
        (mocks2.env as { callDbus: PlanAdapterEnv["callDbus"] }).callDbus = ((service, path, iface, method, payload, callback): void => {
            if (method === PLAN_HAS_OWNER_METHOD) {
                callback(false);
                return;
            }
            if (method === PLAN_START_METHOD) {
                callback(1);
                return;
            }
            if (method === PLAN_GET_OWNER_METHOD) {
                callback(":1.9");
                return;
            }
            return orig2(service, path, iface, method, payload, callback);
        }) as PlanAdapterEnv["callDbus"];
        adapter2.requestFocus("left");
        assert.equal(mocks2.dbusCalls.length, 1);
        assert.equal(mocks2.dbusCalls[0]?.method, PLAN_METHOD);
        const lines2 = activateLines(mocks2);
        const at2 = (event: string, outcome: string): number =>
            lines2.findIndex((l) => l.includes(`event=${event}`) && l.includes(`outcome=${outcome}`));
        assert.ok(at2("presence", "presence-requested") >= 0, lines2.join("\n"));
        assert.ok(at2("presence", "absent") > at2("presence", "presence-requested"), lines2.join("\n"));
        assert.ok(at2("start", "start-requested") > at2("presence", "absent"), lines2.join("\n"));
        assert.ok(at2("start-result", "start-primary") > at2("start", "start-requested"), lines2.join("\n"));
        assert.ok(at2("resolve", "resolve-requested") > at2("start-result", "start-primary"), lines2.join("\n"));
        assert.ok(at2("resolve", "owner-pinned") > at2("resolve", "resolve-requested"), lines2.join("\n"));
        assert.ok(at2("send", "send-requested") > at2("resolve", "owner-pinned"), lines2.join("\n"));
        assert.ok(at2("send", "request-sent") > at2("send", "send-requested"), lines2.join("\n"));
        adapter2.disable();
    });

    it("distinguishes name-loss and owner-change with existing recovery intact", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        establishBaseline(mocks, adapter, ":1.5");
        const base = mocks.dbusCalls.length;
        adapter.requestFocus("left");
        mocks.callbacks[base]?.(false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=owner-absent")));
        assert.ok(activateLines(mocks).some((l) => l.includes("event=presence") && l.includes("outcome=name-loss")));
        assert.ok(mocks.logs.some((l) => l.includes("plan:recovery") && l.includes("reason=absent")));
        adapter.disable();
        const refs2 = makeRefs();
        const mocks2 = mockEnv(refs2);
        const adapter2 = enableAdapter(mocks2);
        establishBaseline(mocks2, adapter2, ":1.5");
        const base2 = mocks2.dbusCalls.length;
        adapter2.requestFocus("left");
        mocks2.callbacks[base2]?.(true);
        mocks2.callbacks[base2 + 1]?.(":1.9");
        assert.ok(mocks2.logs.some((l) => l.includes("outcome=owner-changed")));
        assert.ok(activateLines(mocks2).some((l) => l.includes("event=resolve") && l.includes("outcome=owner-changed")));
        assert.ok(mocks2.logs.some((l) => l.includes("plan:recovery") && l.includes("reason=changed")));
        adapter2.disable();
    });

    it("logs activation-phase timeouts distinctly and ignores late/duplicate callbacks", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const presenceCallback = mocks.callbacks[0] as (reply: unknown) => void;
        fireTimeout(mocks);
        const lines = activateLines(mocks);
        assert.ok(lines.some((l) => l.includes("event=timeout") && l.includes("outcome=timeout") && l.includes("cause=presence")), lines.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("outcome=timeout")));
        const countAfterTimeout = mocks.dbusCalls.length;
        const logsAfterTimeout = mocks.logs.length;
        presenceCallback(true);
        assert.equal(mocks.dbusCalls.length, countAfterTimeout);
        assert.equal(mocks.logs.length, logsAfterTimeout);
        assert.ok(!activateLines(mocks).some((l) => l.includes("outcome=owner-pinned") || l.includes("outcome=request-sent")));
        adapter.disable();
        const refs2 = makeRefs();
        const mocks2 = mockEnv(refs2);
        const adapter2 = enableAdapter(mocks2);
        adapter2.requestFocus("left");
        mocks2.callbacks[0]?.(true);
        fireTimeout(mocks2);
        assert.ok(activateLines(mocks2).some((l) => l.includes("event=timeout") && l.includes("cause=resolve")), activateLines(mocks2).join("\n"));
        const ownerCallback = mocks2.callbacks[1] as (reply: unknown) => void;
        const logsBefore = mocks2.logs.length;
        ownerCallback(":1.5");
        assert.equal(mocks2.logs.length, logsBefore);
        adapter2.disable();
        {
            const refs3 = makeRefs();
            const mocks3 = mockEnv(refs3);
            const adapter3 = enableAdapter(mocks3);
            adapter3.requestFocus("left");
            mocks3.callbacks[0]?.(false);
            fireTimeout(mocks3);
            assert.ok(
                activateLines(mocks3).some((l) => l.includes("event=timeout") && l.includes("outcome=timeout") && l.endsWith("cause=start")),
                activateLines(mocks3).join("\n"),
            );
            adapter3.disable();
        }
        {
            const refs4 = makeRefs();
            const mocks4 = mockEnv(refs4);
            const adapter4 = enableAdapter(mocks4);
            adapter4.requestFocus("left");
            mocks4.callbacks[0]?.(false);
            mocks4.callbacks[1]?.(1);
            fireTimeout(mocks4);
            const lines4 = activateLines(mocks4);
            assert.ok(
                lines4.some((l) => l.includes("event=timeout") && l.includes("outcome=timeout") && l.includes("cause=start-resolve")),
                lines4.join("\n"),
            );
            adapter4.disable();
        }
    });

    it("emits no raw owners/services/payloads and survives a throwing logger", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        mocks.callbacks[0]?.(false);
        mocks.callbacks[1]?.(1);
        mocks.callbacks[2]?.(":1.9");
        const forbidden = [":1.9", ":1.5", "org.plasmaautotiler", "org.freedesktop", "DescribePlan", "win-a", "win-b", "fp-1", "600,0", "resolve-boom", "start-boom", "send-boom", "presence-boom", "logger-boom"];
        for (const line of activateLines(mocks)) {
            for (const token of forbidden) {
                assert.ok(!line.includes(token), `${token} leaked in: ${line}`);
            }
        }
        adapter.disable();
        {
            const refsT = makeRefs();
            const mocksT = mockEnv(refsT);
            const adapterT = enableAdapter(mocksT);
            const origT = mocksT.env.callDbus;
            (mocksT.env as { callDbus: PlanAdapterEnv["callDbus"] }).callDbus = ((service, path, iface, method, payload, callback): void => {
                if (method === PLAN_METHOD) {
                    throw new Error("send-boom");
                }
                return origT(service, path, iface, method, payload, callback);
            }) as PlanAdapterEnv["callDbus"];
            adapterT.requestFocus("left");
            mocksT.callbacks[0]?.(true);
            mocksT.callbacks[1]?.(":1.5");
            for (const line of mocksT.logs) {
                assert.ok(!line.includes("send-boom"), line);
            }
            adapterT.disable();
        }
        const refs2 = makeRefs();
        const mocks2 = mockEnv(refs2);
        const adapter2 = enableAdapter(mocks2);
        let throws = 1;
        const origLog = mocks2.env.log;
        (mocks2.env as { log: PlanAdapterEnv["log"] }).log = ((message: string): void => {
            if (message.includes("stage=activate") && throws > 0) {
                throws -= 1;
                throw new Error("logger-boom");
            }
            return origLog(message);
        }) as PlanAdapterEnv["log"];
        adapter2.requestFocus("left");
        mocks2.callbacks[0]?.(true);
        mocks2.callbacks[1]?.(":1.5");
        assert.equal(mocks2.dbusCalls[2]?.method, PLAN_METHOD);
        assert.equal(adapter2.isInFlight, true);
        adapter2.disable();
        {
            const refs3 = makeRefs();
            const mocks3 = mockEnv(refs3);
            const adapter3 = enableAdapter(mocks3);
            const origLog3 = mocks3.env.log;
            (mocks3.env as { log: PlanAdapterEnv["log"] }).log = ((message: string): void => {
                if (message.includes("outcome=request-sent")) {
                    throw new Error("logger-boom");
                }
                return origLog3(message);
            }) as PlanAdapterEnv["log"];
            adapter3.requestFocus("left");
            mocks3.callbacks[0]?.(true);
            mocks3.callbacks[1]?.(":1.5");
            assert.equal(mocks3.dbusCalls[2]?.method, PLAN_METHOD);
            assert.equal(adapter3.isInFlight, true);
            assert.ok(!activateLines(mocks3).some((l) => l.includes("outcome=send-throw")), activateLines(mocks3).join("\n"));
            const planIndex = mocks3.dbusCalls.findIndex((c) => c.method === PLAN_METHOD);
            const correlation3 = correlationOf(mocks3, planIndex);
            mocks3.callbacks[planIndex]?.(plannedReply(correlation3));
            assert.equal(adapter3.isInFlight, false);
            adapter3.disable();
        }
    });

    it("keeps stale token/session and duplicate-after-success callbacks silent", () => {
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("left");
            mocks.callbacks[0]?.(true);
            const logsAfterFirst = mocks.logs.length;
            const callsAfterFirst = mocks.dbusCalls.length;
            mocks.callbacks[0]?.(true);
            assert.equal(mocks.dbusCalls.length, callsAfterFirst);
            assert.equal(mocks.logs.length, logsAfterFirst);
            mocks.callbacks[1]?.(":1.5");
            const logsAfterPin = mocks.logs.length;
            mocks.callbacks[1]?.(":1.5");
            assert.equal(mocks.logs.length, logsAfterPin);
            adapter.disable();
        }
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            establishBaseline(mocks, adapter, ":1.5");
            const base = mocks.dbusCalls.length;
            adapter.requestFocus("left");
            const stalePresence = mocks.callbacks[base] as (reply: unknown) => void;
            mocks.callbacks[base]?.(true);
            mocks.callbacks[base + 1]?.(":1.5");
            fireTimeout(mocks);
            const probeIndex = mocks.dbusCalls.length - 1;
            assert.equal(mocks.dbusCalls[probeIndex]?.method, PLAN_HAS_OWNER_METHOD);
            mocks.callbacks[probeIndex]?.(false);
            drainRecovery(mocks);
            const logsAfterRecovery = mocks.logs.length;
            const callsAfterRecovery = mocks.dbusCalls.length;
            stalePresence(true);
            assert.equal(mocks.dbusCalls.length, callsAfterRecovery);
            assert.equal(mocks.logs.length, logsAfterRecovery);
            adapter.disable();
        }
    });

    it("maps directional R4 flights to the cosmic-directional route", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        (mocks.env as { observeDirectional?: PlanAdapterEnv["observeDirectional"] }).observeDirectional = () => ({
            status: "ready",
            observed: {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 8,
                domainOuterGap: 8,
                focusedId: "win-a",
                domains: Object.freeze([
                    Object.freeze({
                        output: "out-1",
                        workspace: "ws-1",
                        bounds: { x: 0, y: 0, w: 1200, h: 800 },
                        gap: 8,
                        outerGap: 8,
                        adjacent: Object.freeze({ right: "out-2" }),
                    }),
                    Object.freeze({
                        output: "out-2",
                        workspace: "ws-2",
                        bounds: { x: 1200, y: 0, w: 800, h: 600 },
                        gap: 8,
                        outerGap: 8,
                        adjacent: Object.freeze({ left: "out-1" }),
                    }),
                ]),
                windows: Object.freeze([
                    Object.freeze({
                        id: "win-a",
                        ref: refs.a,
                        rect: { x: 0, y: 0, w: 100, h: 100 },
                        output: "out-1",
                        workspace: "ws-1",
                        fullscreen: false,
                        maximized: false,
                        floating: false,
                        sticky: false,
                        resourceClass: "unknown",
                    }),
                    Object.freeze({
                        id: "win-b",
                        ref: refs.b,
                        rect: { x: 1200, y: 0, w: 100, h: 100 },
                        output: "out-2",
                        workspace: "ws-2",
                        fullscreen: false,
                        maximized: false,
                        floating: false,
                        sticky: false,
                        resourceClass: "unknown",
                    }),
                ]),
                activeRef: refs.a,
                fingerprint: "dir-fp-1",
                revalidate: () => true,
            },
        });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        assert.equal(mocks.dbusCalls[0]?.method, PLAN_HAS_OWNER_METHOD);
        mocks.callbacks[0]?.(true);
        mocks.callbacks[1]?.(":1.5");
        assert.equal(mocks.dbusCalls[2]?.method, PLAN_METHOD);
        const lines = activateLines(mocks);
        assert.ok(lines.length > 0, mocks.logs.join("\n"));
        for (const line of lines) {
            assert.ok(line.includes("component=cosmic-directional"), line);
            assert.ok(line.includes("route=directional-r4"), line);
        }
        adapter.disable();
    });
});
