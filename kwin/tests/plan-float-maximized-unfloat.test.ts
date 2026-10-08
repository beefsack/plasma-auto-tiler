import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MaximizeClearOutcome,
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
        rects?: Record<string, { x: number; y: number; w: number; h: number }>;
        fullscreen?: Record<string, boolean>;
        maximized?: Record<string, boolean>;
        floating?: Record<string, boolean>;
        sticky?: Record<string, boolean>;
        resourceClasses?: Record<string, string>;
        fingerprint?: string;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const rect = (id: string) => opts.rects?.[id] ?? { x: 0, y: 0, w: 100, h: 100 };
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: rect("win-a"),
            output: "out-1",
            workspace: "ws-1",
            fullscreen: opts.fullscreen?.["win-a"] === true,
            maximized: opts.maximized?.["win-a"] === true,
            floating: opts.floating?.["win-a"] === true,
            sticky: opts.sticky?.["win-a"] === true,
            resourceClass: opts.resourceClasses?.["win-a"] ?? "unknown",
        }),
        Object.freeze({
            id: "win-b",
            ref: refs.b,
            rect: rect("win-b"),
            output: "out-1",
            workspace: "ws-1",
            fullscreen: opts.fullscreen?.["win-b"] === true,
            maximized: opts.maximized?.["win-b"] === true,
            floating: opts.floating?.["win-b"] === true,
            sticky: opts.sticky?.["win-b"] === true,
            resourceClass: opts.resourceClasses?.["win-b"] ?? "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: focused === refs.a ? "win-a" : "win-b",
        windows,
        activeRef: focused,
        fingerprint: opts.fingerprint ?? "fp-1",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly maximizeClears: object[];
    observeImpl: () => PlanObserved | null;
    maximizeClearImpl: (target: object) => MaximizeClearOutcome;
    constraintsImpl: ((ref: object) => { resizeable: boolean | null; minSize: { w: number; h: number } | null; maxSize: { w: number; h: number } | null } | null) | null;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object }): Mocks {
    const state = {
        dbusCalls: [] as Array<{ payload: string }>,
        callbacks: [] as Array<(reply: unknown) => void>,
        logs: [] as string[],
        maximizeClears: [] as object[],
        observeImpl: (() => makeObserved(refs)) as () => PlanObserved | null,
        maximizeClearImpl: ((_t: object): MaximizeClearOutcome => "invoked") as (target: object) => MaximizeClearOutcome,
        constraintsImpl: null as Mocks["constraintsImpl"],
        env: null as unknown as PlanAdapterEnv,
    };
    const env: PlanAdapterEnv = {
        callDbus: (_s, _p, _i, method, payload, callback): void => {
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
            state.dbusCalls.push({ payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (_d, _c): (() => void) => (): void => {},
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        clearMaximize: (target): MaximizeClearOutcome => {
            state.maximizeClears.push(target);
            return state.maximizeClearImpl(target);
        },
        setGeometry: (): boolean => true,
        setActive: (): boolean => true,
        active: () => refs.a,
        subscribe: (): (() => void) => (): void => {},
    };
    // Attach optional constraint reader dynamically so tests can enable it.
    (env as unknown as Record<string, unknown>)["readWindowConstraints"] = (ref: object) => {
        if (state.constraintsImpl === null) {
            return null;
        }
        return state.constraintsImpl(ref);
    };
    state.env = env;
    return state as Mocks;
}

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function payload(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

describe("B9 maximized intentional unfloat", () => {
    it("clears maximize before admission and fresh-admits the restored frame", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximizedA = true;
        let rectA = { x: 0, y: 0, w: 1200, h: 800 };
        mocks.observeImpl = () =>
            makeObserved(refs, {
                floating: { "win-a": true },
                maximized: maximizedA ? { "win-a": true } : {},
                rects: { "win-a": rectA, "win-b": { x: 0, y: 0, w: 100, h: 100 } },
            });
        mocks.maximizeClearImpl = (target): MaximizeClearOutcome => {
            assert.equal(target, refs.a);
            maximizedA = false;
            rectA = { x: 100, y: 100, w: 400, h: 300 };
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.equal(mocks.maximizeClears.length, 1, "exactly one native clear before admission");
        assert.equal(mocks.dbusCalls.length, 1, "observed-clear fresh-admits");
        const body = payload(mocks, 0)["command"] as Record<string, unknown>;
        assert.deepEqual(body, { op: "toggle-float", window: "win-a", float_rect: { x: 100, y: 100, w: 400, h: 300 } });
        assert.ok(mocks.logs.some((line) => line.includes("float-unfloat-maximize-clear") && line.includes("outcome=issued")));
        assert.ok(mocks.logs.some((line) => line.includes("float-unfloat-maximize-clear") && line.includes("outcome=invoked")));
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-cleared")), "settlement observed before dispatch");
        assert.equal(adapter.isInFlight, true, "operation held by the fresh admission flight");
    });

    it("leaves an ordinary non-maximized unfloat unchanged with no native clear", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                floating: { "win-a": true },
                rects: { "win-a": { x: 10, y: 20, w: 300, h: 200 } },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.deepEqual(mocks.maximizeClears, [], "no maximize interference on the ordinary path");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(payload(mocks, 0)["command"], { op: "toggle-float", window: "win-a", float_rect: { x: 10, y: 20, w: 300, h: 200 } });
    });

    it("keeps the normal-to-float maximize refusal without native writes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.deepEqual(mocks.maximizeClears, [], "tiled maximize still refuses before any clear");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:float-refused-maximize"));
    });

    it("degrades a refused native clear narrowly and allows a later press to retry", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximizedA = true;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                floating: { "win-a": true },
                maximized: maximizedA ? { "win-a": true } : {},
            });
        let fail = true;
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => (fail ? "missing" : "invoked");
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.equal(mocks.maximizeClears.length, 1, "one clear attempt on the first press");
        assert.equal(mocks.dbusCalls.length, 0, "refused clear dispatches nothing");
        assert.ok(mocks.logs.some((line) => line.includes("float-refused-maximize-clear") && line.includes("cause=native-write-missing")));
        assert.equal(adapter.isInFlight, false, "operation released with no stuck state");
        // Later explicit press retries once and fresh-admits.
        fail = false;
        maximizedA = false;
        adapter.requestFloat();
        assert.equal(mocks.maximizeClears.length, 1, "cleared target needs no second clear");
        assert.equal(mocks.dbusCalls.length, 1, "retry fresh-admits once observed clear");
    });

    it("degrades an unobserved post-clear settlement narrowly with no dispatch", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": true }, maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            mocks.observeImpl = () => null;
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.equal(mocks.maximizeClears.length, 1);
        assert.equal(mocks.dbusCalls.length, 0, "unobserved clear dispatches nothing");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-missing")));
        assert.ok(mocks.logs.some((line) => line.includes("float-refused-maximize-clear") && line.includes("cause=observe-missing")));
        assert.equal(adapter.isInFlight, false);
    });

    it("degrades a still-maximized settlement narrowly with no dispatch", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": true }, maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => "invoked";
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.equal(mocks.maximizeClears.length, 1, "one attempt per press");
        assert.equal(mocks.dbusCalls.length, 0, "raced clear never admits beneath retained maximize");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-maximized")));
        assert.ok(mocks.logs.some((line) => line.includes("float-refused-maximize-clear") && line.includes("cause=still-maximized")));
        assert.equal(adapter.isInFlight, false);
        // A later press after the host settles can still admit.
        mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": true } });
        adapter.requestFloat();
        assert.equal(mocks.dbusCalls.length, 1, "later press remains possible");
    });

    it("fences a replaced native ref and a raced focus change", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const replacement = {};
        // Ref race: the fresh observation carries a different live ref.
        mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": true }, maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            mocks.observeImpl = () => {
                const seen = makeObserved(refs, { floating: { "win-a": true } });
                const first = seen.windows[0];
                const second = seen.windows[1];
                assert.ok(first !== undefined && second !== undefined);
                return {
                    ...seen,
                    windows: Object.freeze([Object.freeze({ ...first, ref: replacement }), second]),
                };
            };
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.equal(mocks.dbusCalls.length, 0, "replaced ref never admits");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-absent")));
        assert.equal(adapter.isInFlight, false);

        // Focus race: the cleared window is no longer focused.
        const mocks2 = mockEnv(refs);
        mocks2.observeImpl = () => makeObserved(refs, { floating: { "win-a": true }, maximized: { "win-a": true } });
        mocks2.maximizeClearImpl = (): MaximizeClearOutcome => {
            mocks2.observeImpl = () => makeObserved(refs, { focused: refs.b, floating: { "win-a": true } });
            return "invoked";
        };
        const adapter2 = enableAdapter(mocks2);
        adapter2.requestFloat();
        assert.equal(mocks2.dbusCalls.length, 0, "focus-raced clear never admits");
        assert.ok(mocks2.logs.some((line) => line.includes("outcome=observed-focus-raced")));
        assert.equal(adapter2.isInFlight, false);
    });

    it("preserves fullscreen handling with no maximize clear on a floating fullscreen target", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                floating: { "win-a": true },
                fullscreen: { "win-a": true },
                maximized: { "win-a": true },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.deepEqual(mocks.maximizeClears, [], "fullscreen path never clears maximize");
        assert.equal(mocks.dbusCalls.length, 1, "fullscreen unfloat keeps its existing dispatch shape");
    });

    it("keeps the sticky maximized refusal without a maximize clear", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { sticky: { "win-a": true }, maximized: { "win-a": true } });
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.deepEqual(mocks.maximizeClears, [], "sticky maximized still refuses before any clear");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("sticky-refused-maximize")));
    });

    it("stages the D3 suppress pin for a fixed-size maximized unfloat", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximizedA = true;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                floating: { "win-a": true },
                maximized: maximizedA ? { "win-a": true } : {},
                rects: { "win-a": { x: 100, y: 100, w: 400, h: 300 } },
            });
        mocks.constraintsImpl = () => ({
            resizeable: true,
            minSize: { w: 640, h: 480 },
            maxSize: { w: 640, h: 480 },
        });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            maximizedA = false;
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestFloat();
        assert.equal(mocks.maximizeClears.length, 1, "fixed clients still clear before admission");
        assert.equal(mocks.dbusCalls.length, 1, "explicit tile dispatches despite fixed hints");
        const body = payload(mocks, 0)["command"] as Record<string, unknown>;
        assert.deepEqual(body, { op: "toggle-float", window: "win-a", float_rect: { x: 100, y: 100, w: 400, h: 300 } });
    });
});
