import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_DEBOUNCE_MS,
    PLAN_TIMEOUT_MS,
    PLAN_MAX_DOMAINS,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
} from "../src/plan-adapter";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";

function makeRef(): object {
    return {};
}

interface World {
    fgA: object;
    fgB: object;
    hiddenRefs: Map<string, object>;
}

interface Mocks {
    readonly dbusCalls: Array<{ payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly subscribes: Array<{ kind: string; handler: (target?: object) => void }>;
    observeImpl: () => PlanObserved | null;
    observeHiddenImpl: () => ReadonlyArray<PlanObserved>;
    callDbusImpl: (payload: string, callback: (reply: unknown) => void) => void;
    env: PlanAdapterEnv;
}

function mockEnv(): Mocks {
    const state = {
        dbusCalls: [] as Array<{ payload: string }>,
        callbacks: [] as Array<(reply: unknown) => void>,
        timers: [] as Array<{ delayMs: number; callback: () => void; cancelled: boolean }>,
        logs: [] as string[],
        subscribes: [] as Array<{ kind: string; handler: (target?: object) => void }>,
        observeImpl: (() => null) as () => PlanObserved | null,
        observeHiddenImpl: (() => []) as () => ReadonlyArray<PlanObserved>,
        callDbusImpl: null as unknown as (payload: string, callback: (reply: unknown) => void) => void,
        env: null as unknown as PlanAdapterEnv,
    } as Mocks;
    state.callDbusImpl = (payload: string, callback: (reply: unknown) => void): void => {
        state.dbusCalls.push({ payload });
        state.callbacks.push(callback);
    };
    const env: PlanAdapterEnv = {
        callDbus: (_service, _path, _iface, _method, payload, callback): void => {
            if (_method === "NameHasOwner") { callback(true); return; }
            if (_method === "GetNameOwner") { callback(":1.7"); return; }
            if (_method === "StartServiceByName") { callback(1); return; }
            state.callDbusImpl(payload, callback);
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
        observeHidden: (): ReadonlyArray<PlanObserved> => state.observeHiddenImpl(),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (): boolean => true,
        setActive: (): boolean => true,
        active: (): object | null => null,
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
    };
    state.env = env;
    return state;
}

function fgObserved(fgA: object, fgB: object, rectA: { x: number; y: number; w: number; h: number }): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a",
            ref: fgA,
            rect: rectA,
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
            ref: fgB,
            rect: { x: 600, y: 0, w: 600, h: 800 },
            output: "out-1",
            workspace: "ws-1",
            fullscreen: false,
            maximized: false,
            floating: false,
            sticky: false,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "win-a",
        windows,
        activeRef: fgA,
        fingerprint: "fp-fg",
        revalidate: () => true,
    };
}

function hiddenObserved(
    workspace: string,
    windowId: string,
    ref: object,
    rect: { x: number; y: number; w: number; h: number },
): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: windowId,
            ref,
            rect,
            output: "out-1",
            workspace,
            fullscreen: false,
            maximized: false,
            floating: false,
            sticky: false,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: windowId,
        windows,
        activeRef: ref,
        fingerprint: `fp-${workspace}`,
        revalidate: () => true,
    };
}

function payload(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function plannedReplyFor(callPayload: Record<string, unknown>): string {
    const command = callPayload["command"] as Record<string, unknown>;
    const domain = callPayload["domain"] as Record<string, unknown>;
    const windows = callPayload["windows"] as Array<Record<string, unknown>>;
    const removed = command["op"] === "remove" ? (command["window"] as string) : null;
    const wanted = windows.filter((entry) => entry["window"] !== removed);
    return JSON.stringify({
        v: 1,
        correlation_id: callPayload["correlation_id"],
        outcome: "planned",
        desired_geometry: wanted.map((entry) => ({
            window: entry["window"],
            leaf: `${String(entry["window"])}-leaf`,
            output: domain["output"],
            workspace: domain["workspace"],
            rect: entry["rect"],
        })),
    });
}

function rejectedReply(correlation: string): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", kind: "snapshot-invalid" });
}

function fire(mocks: Mocks, kind: string): void {
    for (const sub of mocks.subscribes) {
        if (sub.kind === kind) {
            sub.handler();
        }
    }
}

function runDebounce(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (timer.cancelled) {
            continue;
        }
        if (timer.delayMs === PLAN_DEBOUNCE_MS) {
            timer.callback();
        } else {
            mocks.timers.push(timer);
        }
    }
}

function runTimeouts(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (timer.cancelled) {
            continue;
        }
        if (timer.delayMs === PLAN_TIMEOUT_MS) {
            timer.callback();
        } else {
            mocks.timers.push(timer);
        }
    }
}

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

const ALLOC_A = { x: 0, y: 0, w: 600, h: 800 };
const DRIFT_A = { x: 0, y: 0, w: 616, h: 800 };
const HIDDEN_STABLE = { x: 0, y: 0, w: 1200, h: 800 };
const HIDDEN_DRIFT = { x: 0, y: 0, w: 500, h: 800 };

function baselineFgAndHidden(mocks: Mocks, world: World, hiddenWs = "ws-2"): void {
    mocks.observeImpl = () => fgObserved(world.fgA, world.fgB, ALLOC_A);
    const hiddenRef = world.hiddenRefs.get(hiddenWs) ?? makeRef();
    world.hiddenRefs.set(hiddenWs, hiddenRef);
    mocks.observeHiddenImpl = () => [hiddenObserved(hiddenWs, `win-${hiddenWs}`, hiddenRef, HIDDEN_STABLE)];
    fire(mocks, "added");
    runDebounce(mocks);
    assert.equal(mocks.dbusCalls.length, 1);
    mocks.callbacks[0]?.(plannedReplyFor(payload(mocks, 0)));
    assert.equal(mocks.dbusCalls.length, 2);
    mocks.callbacks[1]?.(plannedReplyFor(payload(mocks, 1)));
}

describe("hidden terminal isolation", () => {
    it("rejected hidden flights park background only and leave foreground usable", () => {
        const world: World = { fgA: makeRef(), fgB: makeRef(), hiddenRefs: new Map() };
        const mocks = mockEnv();
        enableAdapter(mocks);
        baselineFgAndHidden(mocks, world, "ws-2");
        const hiddenRef = world.hiddenRefs.get("ws-2") as object;
        mocks.observeHiddenImpl = () => [hiddenObserved("ws-2", "win-ws-2", hiddenRef, HIDDEN_DRIFT)];
        for (let attempt = 0; attempt < 3; attempt += 1) {
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 2 + attempt;
            assert.equal(mocks.dbusCalls.length, index + 1);
            assert.equal((payload(mocks, index)["domain"] as Record<string, unknown>)["workspace"], "ws-2");
            assert.deepEqual((payload(mocks, index)["command"] as Record<string, unknown>)["op"], "reconcile");
            const correlation = payload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(rejectedReply(correlation));
        }
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:reconcile-parked"));
        const parkedCalls = mocks.dbusCalls.length;
        mocks.observeHiddenImpl = () => [hiddenObserved("ws-2", "win-ws-2", hiddenRef, HIDDEN_DRIFT)];
        mocks.observeImpl = () => fgObserved(world.fgA, world.fgB, ALLOC_A);
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, parkedCalls, "parked hidden domain dispatches nothing further");
        mocks.observeImpl = () => fgObserved(world.fgA, world.fgB, DRIFT_A);
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, parkedCalls + 1);
        const fgCall = payload(mocks, parkedCalls);
        assert.equal((fgCall["domain"] as Record<string, unknown>)["workspace"], "ws-1");
        assert.deepEqual((fgCall["command"] as Record<string, unknown>)["op"], "reconcile");
    });

    it("timeout hidden flights park background only and leave foreground usable", () => {
        const world: World = { fgA: makeRef(), fgB: makeRef(), hiddenRefs: new Map() };
        const mocks = mockEnv();
        enableAdapter(mocks);
        baselineFgAndHidden(mocks, world, "ws-2");
        const hiddenRef = world.hiddenRefs.get("ws-2") as object;
        mocks.observeHiddenImpl = () => [hiddenObserved("ws-2", "win-ws-2", hiddenRef, HIDDEN_DRIFT)];
        for (let attempt = 0; attempt < 3; attempt += 1) {
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 2 + attempt;
            assert.equal(mocks.dbusCalls.length, index + 1);
            assert.equal((payload(mocks, index)["domain"] as Record<string, unknown>)["workspace"], "ws-2");
            runTimeouts(mocks);
            assert.ok(mocks.logs.some((line) => line.includes("outcome=timeout")));
        }
        const parkedCalls = mocks.dbusCalls.length;
        mocks.observeImpl = () => fgObserved(world.fgA, world.fgB, DRIFT_A);
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, parkedCalls + 1);
        const fgCall = payload(mocks, parkedCalls);
        assert.equal((fgCall["domain"] as Record<string, unknown>)["workspace"], "ws-1");
        assert.deepEqual((fgCall["command"] as Record<string, unknown>)["op"], "reconcile");
    });

    it("hidden candidate at the domain cap does not evict the foreground baseline", () => {
        const world: World = { fgA: makeRef(), fgB: makeRef(), hiddenRefs: new Map() };
        const mocks = mockEnv();
        enableAdapter(mocks);
        const hiddenWorkspaces: string[] = [];
        for (let index = 2; index <= PLAN_MAX_DOMAINS; index += 1) {
            hiddenWorkspaces.push(`ws-${String(index)}`);
        }
        assert.equal(hiddenWorkspaces.length, PLAN_MAX_DOMAINS - 1);
        for (const workspace of hiddenWorkspaces) {
            const ref = makeRef();
            world.hiddenRefs.set(workspace, ref);
        }
        mocks.observeImpl = () => fgObserved(world.fgA, world.fgB, ALLOC_A);
        mocks.observeHiddenImpl = () =>
            hiddenWorkspaces.map((workspace) =>
                hiddenObserved(workspace, `win-${workspace}`, world.hiddenRefs.get(workspace) as object, HIDDEN_STABLE),
            );
        fire(mocks, "added");
        runDebounce(mocks);
        let answered = 0;
        for (;;) {
            if (answered >= mocks.dbusCalls.length) {
                break;
            }
            const index = answered;
            answered += 1;
            mocks.callbacks[index]?.(plannedReplyFor(payload(mocks, index)));
            if (answered > PLAN_MAX_DOMAINS + 2) {
                throw new Error("cap test did not converge");
            }
        }
        assert.equal(mocks.dbusCalls.length, PLAN_MAX_DOMAINS);
        const extraRef = makeRef();
        mocks.observeHiddenImpl = () => [
            ...hiddenWorkspaces.map((workspace) =>
                hiddenObserved(workspace, `win-${workspace}`, world.hiddenRefs.get(workspace) as object, HIDDEN_STABLE),
            ),
            hiddenObserved("ws-99", "win-ws-99", extraRef, HIDDEN_STABLE),
        ];
        const before = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, before, "over-cap hidden candidate fails closed");
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, before, "foreground baseline still retained, no re-admission");
        mocks.observeImpl = () => fgObserved(world.fgA, world.fgB, DRIFT_A);
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, before + 1);
        assert.equal((payload(mocks, before)["domain"] as Record<string, unknown>)["workspace"], "ws-1");
    });

    it("synchronous hidden dispatch failure chains at most one hidden step per round", () => {
        const world: World = { fgA: makeRef(), fgB: makeRef(), hiddenRefs: new Map() };
        const mocks = mockEnv();
        enableAdapter(mocks);
        baselineFgAndHidden(mocks, world, "ws-2");
        const hiddenRef2 = world.hiddenRefs.get("ws-2") as object;
        const hiddenRef3 = makeRef();
        world.hiddenRefs.set("ws-3", hiddenRef3);
        mocks.callbacks.length = 0;
        mocks.dbusCalls.length = 0;
        mocks.observeImpl = () => fgObserved(world.fgA, world.fgB, ALLOC_A);
        mocks.observeHiddenImpl = () => [
            hiddenObserved("ws-2", "win-ws-2", hiddenRef2, HIDDEN_DRIFT),
            hiddenObserved("ws-3", "win-ws-3", hiddenRef3, HIDDEN_DRIFT),
        ];
        let attempts = 0;
        mocks.callDbusImpl = (payloadText): void => {
            attempts += 1;
            mocks.dbusCalls.push({ payload: payloadText });
            throw new Error("sync-dbus-failed");
        };
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(attempts, 1, "exactly one hidden step despite two eligible hidden domains");
    });
});
