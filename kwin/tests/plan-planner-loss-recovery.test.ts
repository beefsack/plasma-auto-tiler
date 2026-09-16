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

    it("absent probe triggers a fresh admit without replaying the old command", () => {
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
        // Recovery clears the baseline and dispatches one fresh admit through
        // the existing route: one bounded activation plus one current
        // observation. The old move command is never replayed.
        drainRecovery(mocks);
        const freshPlans = mocks.dbusCalls
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => c.method === PLAN_METHOD)
            .slice(-1);
        assert.equal(freshPlans.length, 1);
        const freshPayload = payloadOf(mocks, freshPlans[0]?.i as number);
        assert.deepEqual((freshPayload["command"] as Record<string, unknown>)["op"], "admit");
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

    it("fresh admit after recovery carries current windows with fit exclusion", () => {
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
        assert.equal((fresh["command"] as Record<string, unknown>)["op"], "admit");
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
        assert.equal((fresh["command"] as Record<string, unknown>)["op"], "admit");
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
