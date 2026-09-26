import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";
import {
    PLAN_DEBOUNCE_MS,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
} from "../src/plan-adapter";

function makeRefs(): { a: object; b: object; t: object } {
    return { a: {}, b: {}, t: {} };
}

function rect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
    return { x, y, w, h };
}

function foregroundObserved(refs: { a: object; b: object; t: object }): PlanObserved {
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "win-a",
        windows: Object.freeze([
            Object.freeze({
                id: "win-a",
                ref: refs.a,
                rect: rect(0, 0, 600, 800),
                output: "out-1",
                workspace: "ws-1",
                fullscreen: false,
                maximized: false,
                resourceClass: "unknown",
            }),
            Object.freeze({
                id: "win-b",
                ref: refs.b,
                rect: rect(600, 0, 600, 800),
                output: "out-1",
                workspace: "ws-1",
                fullscreen: false,
                maximized: false,
                resourceClass: "unknown",
            }),
        ]),
        activeRef: refs.a,
        fingerprint: "fp-send-foreground",
        revalidate: () => true,
    };
}

function hiddenObserved(refs: { a: object; b: object; t: object }): PlanObserved {
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-2",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "win-t",
        windows: Object.freeze([
            Object.freeze({
                id: "win-t",
                ref: refs.t,
                rect: rect(0, 0, 1200, 800),
                output: "out-1",
                workspace: "ws-2",
                fullscreen: false,
                maximized: false,
                resourceClass: "unknown",
            }),
        ]),
        activeRef: refs.t,
        fingerprint: "fp-send-hidden",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    hidden: ReadonlyArray<PlanObserved>;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object; t: object }): Mocks {
    const state: Mocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        hidden: [],
        env: null as unknown as PlanAdapterEnv,
    };
    state.env = {
        callDbus: (_service, _path, _iface, method, payload, callback) => {
            if (method === "NameHasOwner") {
                callback(true);
                return;
            }
            if (method === "GetNameOwner") {
                callback(":1.7");
                return;
            }
            if (method === "StartServiceByName") {
                callback(1);
                return;
            }
            state.dbusCalls.push({ method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback) => {
            const timer = { delayMs, callback, cancelled: false };
            state.timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
        log: (message) => {
            state.logs.push(message);
        },
        observe: () => foregroundObserved(refs),
        observeHidden: () => state.hidden,
        clearMaximize: () => "invoked",
        setGeometry: () => true,
        setActive: () => true,
        active: () => refs.a,
        subscribe: () => () => {},
    };
    return state;
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

function payloadOf(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function commandOp(mocks: Mocks, index: number): string {
    return (payloadOf(mocks, index)["command"] as Record<string, unknown>)["op"] as string;
}

function domainWorkspace(mocks: Mocks, index: number): string {
    return ((payloadOf(mocks, index)["domain"] as Record<string, unknown>)["workspace"] as string);
}

function plannedEcho(
    mocks: Mocks,
    index: number,
    geometry: Array<{ window: string; output: string; workspace: string; rect: { x: number; y: number; w: number; h: number } }>,
): void {
    const correlation = payloadOf(mocks, index)["correlation_id"] as string;
    mocks.callbacks[index]?.(
        JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            desired_geometry: geometry.map((entry) => ({
                window: entry.window,
                leaf: `leaf-${entry.window}`,
                output: entry.output,
                workspace: entry.workspace,
                rect: entry.rect,
            })),
        }),
    );
}

const FOREGROUND_GEOMETRY = [
    { window: "win-a", output: "out-1", workspace: "ws-1", rect: rect(0, 0, 600, 800) },
    { window: "win-b", output: "out-1", workspace: "ws-1", rect: rect(600, 0, 600, 800) },
];

const HIDDEN_GEOMETRY = [
    { window: "win-t", output: "out-1", workspace: "ws-2", rect: rect(0, 0, 1200, 800) },
];

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

describe("send settlement forced refresh", () => {
    it("reconciles a forced foreground domain despite equal applied evidence, exactly once", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(commandOp(mocks, 0), "reconcile");
        plannedEcho(mocks, 0, FOREGROUND_GEOMETRY);
        // Equal evidence stays quiet without a force.
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        // Terminal send settlement forces one complete reconcile.
        adapter.notifySendSettled({
            sourceOutput: "out-1",
            sourceWorkspace: "ws-1",
            targetOutput: "out-1",
            targetWorkspace: "ws-2",
        });
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(commandOp(mocks, 1), "reconcile");
        assert.equal(domainWorkspace(mocks, 1), "ws-1");
        plannedEcho(mocks, 1, FOREGROUND_GEOMETRY);
        // One-shot: the next equal observation is quiet again.
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("converges source AND target through the foreground plus hidden chain", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        (mocks as { hidden: ReadonlyArray<PlanObserved> }).hidden = [hiddenObserved(refs)];
        const adapter = enableAdapter(mocks);
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(domainWorkspace(mocks, 0), "ws-1");
        plannedEcho(mocks, 0, FOREGROUND_GEOMETRY);
        // The single-flight finish chain adopts the hidden target domain.
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(domainWorkspace(mocks, 1), "ws-2");
        plannedEcho(mocks, 1, HIDDEN_GEOMETRY);
        // Both domains quiet on equal evidence.
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        // Forced settlement reconciles the foreground source immediately and
        // chains the hidden target afterwards, with no invented empties.
        adapter.notifySendSettled({
            sourceOutput: "out-1",
            sourceWorkspace: "ws-1",
            targetOutput: "out-1",
            targetWorkspace: "ws-2",
        });
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(commandOp(mocks, 2), "reconcile");
        assert.equal(domainWorkspace(mocks, 2), "ws-1");
        plannedEcho(mocks, 2, FOREGROUND_GEOMETRY);
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(commandOp(mocks, 3), "reconcile");
        assert.equal(domainWorkspace(mocks, 3), "ws-2");
        const hiddenWindows = payloadOf(mocks, 3)["windows"] as Array<Record<string, unknown>>;
        assert.ok(hiddenWindows.some((entry) => entry["window"] === "win-t"));
        plannedEcho(mocks, 3, HIDDEN_GEOMETRY);
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 4);
    });

    it("keeps an unreadable forced domain forced until the next complete observation", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestResync();
        runDebounce(mocks);
        plannedEcho(mocks, 0, FOREGROUND_GEOMETRY);
        adapter.notifySendSettled({
            sourceOutput: "out-1",
            sourceWorkspace: "ws-1",
            targetOutput: "out-1",
            targetWorkspace: "ws-9",
        });
        // The hidden target domain is omitted (unknown, never empty), while
        // the foreground source still forces its reconcile.
        (mocks as { hidden: ReadonlyArray<PlanObserved> }).hidden = [];
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(domainWorkspace(mocks, 1), "ws-1");
        plannedEcho(mocks, 1, FOREGROUND_GEOMETRY);
        // The still-unobserved target retries on the next complete
        // observation instead of synthesizing an empty reconcile.
        (mocks as { hidden: ReadonlyArray<PlanObserved> }).hidden = [
            {
                ...hiddenObserved(refs),
                domainWorkspace: "ws-9",
                windows: Object.freeze([
                    Object.freeze({
                        id: "win-t",
                        ref: refs.t,
                        rect: rect(0, 0, 1200, 800),
                        output: "out-1",
                        workspace: "ws-9",
                        fullscreen: false,
                        maximized: false,
                        resourceClass: "unknown",
                    }),
                ]),
            },
        ];
        adapter.requestResync();
        runDebounce(mocks);
        const targetCalls = mocks.dbusCalls.filter(
            (_call, index) => commandOp(mocks, index) === "reconcile" && domainWorkspace(mocks, index) === "ws-9",
        );
        assert.equal(targetCalls.length, 1);
    });

    it("ignores the retired send block: normal intents work while sendActive claims true", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const sendClaiming = {
            ...mocks.env,
            isSendActive: () => true,
        };
        const adapter = new PlanAdapter(sendClaiming);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        plannedEcho(mocks, 0, FOREGROUND_GEOMETRY);
        adapter.requestMove("left");
        assert.equal(mocks.dbusCalls.length, 2);
        assert.ok(
            !mocks.logs.some((line) => line.includes("busy-refused kind=move")),
            mocks.logs.join("\n"),
        );
    });
});
