import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_DEBOUNCE_MS,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
    planFingerprint,
} from "../src/plan-adapter";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";

interface Sub {
    readonly kind: string;
    readonly handler: (target?: object) => void;
}

function makeEnv(
    fg: () => PlanObserved,
    hidden: () => ReadonlyArray<PlanObserved>,
    calls: Array<{ payload: string }>,
    callbacks: Array<(reply: unknown) => void>,
    timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>,
    logs: string[],
    subs: Sub[],
): PlanAdapterEnv {
    return {
        callDbus: (_s, _p, _i, _m, payload, callback): void => {
            if (_m === "NameHasOwner") { callback(true); return; }
            if (_m === "GetNameOwner") { callback(":1.7"); return; }
            if (_m === "StartServiceByName") { callback(1); return; }
            calls.push({ payload });
            callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            logs.push(message);
        },
        observe: fg,
        observeHidden: hidden,
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (): boolean => true,
        setActive: (): boolean => true,
        active: (): object | null => null,
        subscribe: (kind, handler): (() => void) => {
            subs.push({ kind, handler });
            return (): void => {};
        },
    };
}

function fgObserved(winA: object, winB: object): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a", ref: winA, rect: { x: 0, y: 0, w: 600, h: 800 },
            output: "out-1", workspace: "ws-1",
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
        Object.freeze({
            id: "win-b", ref: winB, rect: { x: 600, y: 0, w: 600, h: 800 },
            output: "out-1", workspace: "ws-1",
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1", domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "win-a", windows, activeRef: winA, fingerprint: "fp-fg", revalidate: () => true,
    };
}

function hiddenObserved(workspace: string, windowId: string, ref: object): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: windowId, ref, rect: { x: 0, y: 0, w: 1200, h: 800 },
            output: "out-1", workspace,
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1", domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: windowId, windows, activeRef: ref, fingerprint: `fp-${workspace}`, revalidate: () => true,
    };
}

function hiddenPair(workspace: string, first: string, firstRef: object, second: string, secondRef: object): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: first, ref: firstRef, rect: { x: 0, y: 0, w: 600, h: 800 },
            output: "out-1", workspace,
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
        Object.freeze({
            id: second, ref: secondRef, rect: { x: 600, y: 0, w: 600, h: 800 },
            output: "out-1", workspace,
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1", domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: first, windows, activeRef: firstRef, fingerprint: `fp-${workspace}`, revalidate: () => true,
    };
}

function hiddenEmpty(workspace: string, activeRef: object): PlanObserved {
    return {
        domainOutput: "out-1", domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "", activeExcluded: true, windows: Object.freeze([]),
        activeRef, fingerprint: String(planFingerprint("out-1", workspace, "", [])),
        revalidate: () => true,
    };
}

function runDebounce(timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>): void {
    const pending = [...timers];
    timers.length = 0;
    for (const timer of pending) {
        if (timer.cancelled) continue;
        if (timer.delayMs === PLAN_DEBOUNCE_MS) timer.callback();
        else timers.push(timer);
    }
}

function payloadAt(calls: Array<{ payload: string }>, index: number): Record<string, unknown> {
    return JSON.parse(calls[index]?.payload as string) as Record<string, unknown>;
}

function plannedFor(callPayload: Record<string, unknown>): string {
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

function answerAll(calls: Array<{ payload: string }>, callbacks: Array<(reply: unknown) => void>, from: number): number {
    let answered = from;
    for (;;) {
        if (answered >= calls.length) break;
        const payload = payloadAt(calls, answered);
        callbacks[answered]?.(plannedFor(payload));
        answered += 1;
        if (answered - from > 64) throw new Error("test did not converge");
    }
    return answered;
}

function innerState(adapter: PlanAdapter): { lastGoodByDomain: Map<string, { windows: ReadonlyArray<{ id: string }> }> } {
    return adapter as unknown as { lastGoodByDomain: Map<string, { windows: ReadonlyArray<{ id: string }> }> };
}

describe("background empty-domain retirement", () => {
    it("closing the final hidden member retires the baseline and frees the slot", () => {
        const fgA: object = {};
        const fgB: object = {};
        const hiddenRef: object = {};
        const nextRef: object = {};
        let hidden: ReadonlyArray<PlanObserved> = [hiddenObserved("ws-2", "win-h", hiddenRef)];
        const calls: Array<{ payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
        const logs: string[] = [];
        const subs: Sub[] = [];
        const env = makeEnv(() => fgObserved(fgA, fgB), () => [...hidden], calls, callbacks, timers, logs, subs);
        const adapter = new PlanAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const fire = (kind: string): void => {
            for (const sub of subs) if (sub.kind === kind) sub.handler();
        };
        fire("added");
        runDebounce(timers);
        let answered = answerAll(calls, callbacks, 0);
        assert.equal(innerState(adapter).lastGoodByDomain.size, 2);

        // Explicit fresh, complete empty evidence retires; absence alone
        // must not.
        hidden = [];
        fire("geometry");
        runDebounce(timers);
        assert.equal(calls.length, answered, "absence without explicit empty must not dispatch removal");

        const emptyAnchor: object = {};
        hidden = [hiddenEmpty("ws-2", emptyAnchor)];
        fire("geometry");
        runDebounce(timers);
        assert.equal(calls.length, answered + 1);
        const cleanup = payloadAt(calls, answered);
        assert.equal((cleanup["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(cleanup["command"], { op: "remove", window: "win-h" });
        callbacks[answered]?.(plannedFor(cleanup));
        answered += 1;
        assert.equal(innerState(adapter).lastGoodByDomain.size, 1);
        assert.ok(!innerState(adapter).lastGoodByDomain.has("out-1\u0000ws-2"));

        hidden = [hiddenObserved("ws-3", "win-n", nextRef)];
        fire("geometry");
        runDebounce(timers);
        assert.equal(calls.length, answered + 1);
        const admit = payloadAt(calls, answered);
        assert.equal((admit["domain"] as Record<string, unknown>)["workspace"], "ws-3");
        assert.equal((admit["command"] as Record<string, unknown>)["op"], "admit");
        callbacks[answered]?.(plannedFor(admit));
        assert.equal(innerState(adapter).lastGoodByDomain.size, 2);
    });

    it("retained empty cleanup runs and new admission succeeds with many domains", () => {
        const fgA: object = {};
        const fgB: object = {};
        const calls: Array<{ payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
        const logs: string[] = [];
        const subs: Sub[] = [];
        // Twenty retained single-window hidden domains (ws-21 is now empty
        // with explicit empty evidence); a brand-new hidden domain (ws-race)
        // is also observed.
        const emptyAnchor: object = {};
        let hidden: ReadonlyArray<PlanObserved> = [];
        const retainedRefs = new Map<string, object>();
        for (let index = 2; index <= 20; index += 1) {
            retainedRefs.set(`ws-${String(index)}`, {});
        }
        const raceRef: object = {};
        const retainedObserved = [...retainedRefs.entries()].map(([ws, ref]) => hiddenObserved(ws, `win-${ws}`, ref));
        hidden = [...retainedObserved, hiddenEmpty("ws-21", emptyAnchor)];
        const env = makeEnv(() => fgObserved(fgA, fgB), () => [...hidden], calls, callbacks, timers, logs, subs);
        const adapter = new PlanAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const inner = innerState(adapter) as unknown as { lastGoodByDomain: Map<string, Record<string, unknown>> };
        // Pre-retain: foreground plus ws-2..ws-21 (21 total), ws-21 holding
        // the single window that has since vanished.
        inner.lastGoodByDomain.set("out-1\u0000ws-1", {
            domainOutput: "out-1", domainWorkspace: "ws-1",
            domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
            domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
            focusedId: "win-a", fingerprint: "fp-fg",
            windows: Object.freeze([
                { id: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, floating: false, resourceClass: "unknown" },
                { id: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, floating: false, resourceClass: "unknown" },
            ]),
        } as unknown as Record<string, unknown>);
        for (let index = 2; index <= 21; index += 1) {
            const ws = `ws-${String(index)}`;
            inner.lastGoodByDomain.set(`out-1\u0000${ws}`, {
                domainOutput: "out-1", domainWorkspace: ws,
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
                focusedId: `win-${ws}`, fingerprint: `fp-${ws}`,
                windows: Object.freeze([{ id: `win-${ws}`, rect: { x: 0, y: 0, w: 1200, h: 800 }, output: "out-1", workspace: ws, fullscreen: false, maximized: false, floating: false, resourceClass: "unknown" }]),
            } as unknown as Record<string, unknown>);
        }
        assert.equal(inner.lastGoodByDomain.size, 21);
        const fire = (kind: string): void => {
            for (const sub of subs) if (sub.kind === kind) sub.handler();
        };
        fire("geometry");
        runDebounce(timers);
        // Cleanup for the already-retained empty ws-21 dispatches.
        assert.equal(calls.length, 1);
        const cleanup = payloadAt(calls, 0);
        assert.equal((cleanup["domain"] as Record<string, unknown>)["workspace"], "ws-21");
        assert.deepEqual(cleanup["command"], { op: "remove", window: "win-ws-21" });
        callbacks[0]?.(plannedFor(cleanup));
        assert.equal(inner.lastGoodByDomain.size, 20);
        assert.ok(!inner.lastGoodByDomain.has("out-1\u0000ws-21"));

        // A brand-new background admission dispatches even with twenty
        // domains already retained.
        hidden = [...retainedObserved, hiddenObserved("ws-race", "win-race", raceRef)];
        const before = calls.length;
        fire("geometry");
        runDebounce(timers);
        assert.equal(calls.length, before + 1);
        const admit = payloadAt(calls, before);
        assert.equal((admit["domain"] as Record<string, unknown>)["workspace"], "ws-race");
        assert.equal((admit["command"] as Record<string, unknown>)["op"], "admit");
        callbacks[before]?.(plannedFor(admit));
        assert.equal(inner.lastGoodByDomain.size, 21);
        assert.ok(inner.lastGoodByDomain.has("out-1\u0000ws-race"));
    });

    it("multi-member collapse is not falsely committed", () => {
        const fgA: object = {};
        const fgB: object = {};
        const firstRef: object = {};
        const secondRef: object = {};
        // Baseline holds two hidden members; both vanish together.
        let hidden: ReadonlyArray<PlanObserved> = [hiddenPair("ws-2", "win-h1", firstRef, "win-h2", secondRef)];
        const calls: Array<{ payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
        const logs: string[] = [];
        const subs: Sub[] = [];
        const env = makeEnv(() => fgObserved(fgA, fgB), () => [...hidden], calls, callbacks, timers, logs, subs);
        const adapter = new PlanAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const fire = (kind: string): void => {
            for (const sub of subs) if (sub.kind === kind) sub.handler();
        };
        fire("added");
        runDebounce(timers);
        answerAll(calls, callbacks, 0);
        const baseline = innerState(adapter).lastGoodByDomain.get("out-1\u0000ws-2");
        assert.equal(baseline?.windows.length, 2);

        hidden = [];
        const before = calls.length;
        fire("geometry");
        runDebounce(timers);
        const freshCalls = calls.slice(before).map((call) => JSON.parse(call.payload) as Record<string, unknown>);
        assert.ok(
            freshCalls.every((payload) => (payload["domain"] as Record<string, unknown>)["workspace"] !== "ws-2"),
            "two vanished members must not dispatch a single remove",
        );
        // Baseline is preserved fail-closed: no false empty commit.
        assert.equal(innerState(adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 2);
        void callbacks;
    });
});
