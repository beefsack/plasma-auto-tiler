import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MaximizeClearOutcome,
    PlanAdapter,
    PlanAdapterEnv,
    PlanDirection,
    PlanObserved,
} from "../src/plan-adapter";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";

// G-06 maximized directional focus/move (REQ-MAX-08, User 2026-10-10).
// Offline only: native-mock adapter, no live KWin, no D-Bus.

function makeRefs(): { a: object; b: object } {
    return { a: {}, b: {} };
}

function makeObserved(
    refs: { a: object; b: object },
    opts: {
        focused?: object;
        activeExcluded?: boolean;
        maximized?: Record<string, boolean>;
        fullscreen?: Record<string, boolean>;
        floating?: Record<string, boolean>;
        domains?: boolean;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: Object.freeze({ x: 0, y: 0, w: 100, h: 100 }),
            output: "out-1",
            workspace: "ws-1",
            fullscreen: opts.fullscreen?.["win-a"] === true,
            maximized: opts.maximized?.["win-a"] === true,
            floating: opts.floating?.["win-a"] === true,
            sticky: false,
            resourceClass: "unknown",
        }),
        Object.freeze({
            id: "win-b",
            ref: refs.b,
            rect: Object.freeze({ x: 200, y: 0, w: 100, h: 100 }),
            output: opts.domains === true ? "out-2" : "out-1",
            workspace: opts.domains === true ? "ws-2" : "ws-1",
            fullscreen: opts.fullscreen?.["win-b"] === true,
            maximized: opts.maximized?.["win-b"] === true,
            floating: opts.floating?.["win-b"] === true,
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
        focusedId: focused === refs.a ? "win-a" : "win-b",
        ...(opts.domains === true
            ? {
                  domains: Object.freeze([
                      Object.freeze({
                          output: "out-1",
                          workspace: "ws-1",
                          bounds: { x: 0, y: 0, w: 1200, h: 800 },
                          gap: DOMAIN_GAP,
                          outerGap: OUTER_DOMAIN_GAP,
                          adjacent: Object.freeze({ right: "out-2" }),
                      }),
                      Object.freeze({
                          output: "out-2",
                          workspace: "ws-2",
                          bounds: { x: 1200, y: 0, w: 1200, h: 800 },
                          gap: DOMAIN_GAP,
                          outerGap: OUTER_DOMAIN_GAP,
                          adjacent: Object.freeze({ left: "out-1" }),
                      }),
                  ]),
              }
            : {}),
        ...(opts.activeExcluded === true ? { activeExcluded: true as const } : {}),
        windows,
        activeRef: focused,
        fingerprint: "fp-g06",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly maximizeClears: object[];
    readonly actives: object[];
    readonly geometries: Array<{ target: object; rect: unknown }>;
    readonly subscribes: Array<{ kind: string; handler: (target?: object) => void }>;
    observeImpl: () => PlanObserved | null;
    directionalImpl: (direction: PlanDirection) => PlanObserved | null;
    maximizeClearImpl: (target: object) => MaximizeClearOutcome;
    activeImpl: () => object | null;
    env: PlanAdapterEnv;
}

function fire(mocks: Mocks, kind: string, target?: object): void {
    for (const sub of mocks.subscribes) {
        if (sub.kind === kind) {
            sub.handler(target);
        }
    }
}

function mockEnv(refs: { a: object; b: object }): Mocks {
    const state = {
        dbusCalls: [] as Array<{ payload: string }>,
        callbacks: [] as Array<(reply: unknown) => void>,
        logs: [] as string[],
        maximizeClears: [] as object[],
        actives: [] as object[],
        geometries: [] as Array<{ target: object; rect: unknown }>,
        subscribes: [] as Array<{ kind: string; handler: (target?: object) => void }>,
        observeImpl: (() => makeObserved(refs)) as () => PlanObserved | null,
        directionalImpl: null as unknown as Mocks["directionalImpl"],
        maximizeClearImpl: ((_t: object): MaximizeClearOutcome => "invoked") as (
            target: object,
        ) => MaximizeClearOutcome,
        activeImpl: (): object | null => refs.a,
        env: null as unknown as PlanAdapterEnv,
    };
    state.directionalImpl = (): PlanObserved | null => state.observeImpl();
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
        observeDirectional: (direction): PlanObserved | null => state.directionalImpl(direction),
        clearMaximize: (target): MaximizeClearOutcome => {
            state.maximizeClears.push(target);
            return state.maximizeClearImpl(target);
        },
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect });
            return true;
        },
        setActive: (target): boolean => {
            state.actives.push(target);
            return true;
        },
        active: (): object | null => state.activeImpl(),
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
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

function payloadWindows(mocks: Mocks, index: number): Array<Record<string, unknown>> {
    return payload(mocks, index)["windows"] as Array<Record<string, unknown>>;
}

describe("G-06 maximized directional focus fence", () => {
    it("fences tile-origin focus while the focused window is maximized", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 0, "fenced focus dispatches nothing");
        assert.ok(mocks.logs.includes("omnitiler:plan:focus-refused-maximize"));
    });

    it("leaves ordinary tile-origin focus unchanged", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1, "ordinary focus still dispatches");
        assert.deepEqual((payload(mocks, 0)["command"] as Record<string, unknown>)["op"], "focus");
    });

    it("keeps fullscreen focus exempt even when maximized is also set", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, { fullscreen: { "win-a": true }, maximized: { "win-a": true } });
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1, "fullscreen focus still dispatches");
        assert.ok(!mocks.logs.includes("omnitiler:plan:focus-refused-maximize"));
    });

    it("fences float-origin focus for a maximized float subject", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                activeExcluded: true,
                floating: { "win-a": true },
                maximized: { "win-a": true },
            });
        mocks.activeImpl = () => refs.a;
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 0, "fenced float focus dispatches nothing");
        assert.deepEqual(mocks.actives, [], "fenced float focus actuates nothing");
        assert.ok(mocks.logs.includes("omnitiler:plan:focus-refused-maximize"));
    });

    it("leaves ordinary float-origin focus unchanged", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                activeExcluded: true,
                floating: { "win-a": true, "win-b": true },
            });
        mocks.activeImpl = () => refs.a;
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        // win-b sits right of win-a, so the local float search actuates it.
        assert.deepEqual(mocks.actives, [refs.b], "ordinary float focus still actuates the target");
        assert.ok(mocks.logs.some((line) => line.includes("focus-float-applied")));
    });

    it("keeps the native maximized flag local while the portable exclusion rides", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        // Focus stays on ordinary win-a; maximized win-b rides as a sibling.
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-b": true } });
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        const winB = payloadWindows(mocks, 0).find((entry) => entry["window"] === "win-b");
        assert.equal("maximized" in (winB ?? {}), false, "maximized stays local snapshot semantics");
        assert.equal(winB?.["fit_excluded"], true, "sibling overlay keeps portable fit exclusion");
    });
});

describe("G-06 maximized directional move unmaximizes first", () => {
    it("clears once then dispatches the ordinary move in the same invocation", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximizedA = true;
        mocks.observeImpl = () => makeObserved(refs, { maximized: maximizedA ? { "win-a": true } : {} });
        mocks.maximizeClearImpl = (target): MaximizeClearOutcome => {
            assert.equal(target, refs.a);
            maximizedA = false;
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.maximizeClears.length, 1, "exactly one native clear before the move");
        assert.equal(mocks.dbusCalls.length, 1, "observed-clear continues the ordinary move");
        const body = payload(mocks, 0)["command"] as Record<string, unknown>;
        assert.deepEqual({ op: body["op"], window: body["window"], direction: body["direction"] }, {
            op: "move",
            window: "win-a",
            direction: "right",
        });
        assert.ok(mocks.logs.some((line) => line.includes("move-maximize-clear") && line.includes("outcome=issued")));
        assert.ok(mocks.logs.some((line) => line.includes("move-maximize-clear") && line.includes("outcome=invoked")));
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-cleared")), "settlement observed before dispatch");
    });

    it("keeps directional domains across the clear for cross-output routing", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximizedA = true;
        mocks.observeImpl = () =>
            makeObserved(refs, { domains: true, maximized: maximizedA ? { "win-a": true } : {} });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            maximizedA = false;
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        assert.ok(Array.isArray(body["domains"]) && (body["domains"] as Array<unknown>).length === 2, "R4 domains survive the clear");
    });

    it("leaves the ordinary move unchanged with no native clear", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.deepEqual(mocks.maximizeClears, [], "ordinary move never clears maximize");
        assert.equal(mocks.dbusCalls.length, 1);
    });

    it("keeps the fullscreen move refusal with no native clear", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, { fullscreen: { "win-a": true }, maximized: { "win-a": true } });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.deepEqual(mocks.maximizeClears, [], "fullscreen path never clears maximize");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.includes("omnitiler:plan:move-refused-fullscreen"));
    });

    it("degrades a refused native clear narrowly with no structural move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => "missing";
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.maximizeClears.length, 1, "one clear attempt per press");
        assert.equal(mocks.dbusCalls.length, 0, "refused clear moves nothing");
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-maximize-clear") && line.includes("cause=native-write-missing")));
        assert.equal(adapter.isInFlight, false, "no stuck operation");
        // A later press after the host settles retries and moves.
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => "invoked";
        mocks.observeImpl = () => makeObserved(refs);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1, "later press remains possible");
    });

    it("degrades a still-maximized settlement narrowly with no structural move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => "invoked";
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.maximizeClears.length, 1);
        assert.equal(mocks.dbusCalls.length, 0, "raced clear never moves beneath retained maximize");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-maximized")));
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-maximize-clear") && line.includes("cause=still-maximized")));
        assert.equal(adapter.isInFlight, false);
    });

    it("fences a focus-raced settlement with no structural move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            mocks.observeImpl = () => makeObserved(refs, { focused: refs.b });
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 0, "focus-raced clear never moves");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-focus-raced")));
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-maximize-clear") && line.includes("cause=focus-raced")));
        assert.equal(adapter.isInFlight, false);
    });

    it("half-snaps a maximized float after exactly one clear with no dispatch", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximizedA = true;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                activeExcluded: true,
                floating: { "win-a": true },
                maximized: maximizedA ? { "win-a": true } : {},
            });
        mocks.activeImpl = () => refs.a;
        mocks.maximizeClearImpl = (target): MaximizeClearOutcome => {
            assert.equal(target, refs.a);
            maximizedA = false;
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.maximizeClears.length, 1, "exactly one clear before the float step");
        assert.equal(mocks.dbusCalls.length, 0, "half-snap never dispatches");
        assert.equal(mocks.geometries.length, 1, "exactly one half-snap geometry write");
        assert.deepEqual(mocks.geometries[0]?.target, refs.a, "half-snap targets the cleared float");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-cleared")));
        assert.ok(mocks.logs.some((line) => line.includes("move-float-applied direction=right")));
    });

    it("writes nothing when a maximized float clear fails", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                activeExcluded: true,
                floating: { "win-a": true },
                maximized: { "win-a": true },
            });
        mocks.activeImpl = () => refs.a;
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => "missing";
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.maximizeClears.length, 1, "one clear attempt per press");
        assert.deepEqual(mocks.geometries, [], "failed clear writes no geometry");
        assert.equal(mocks.dbusCalls.length, 0, "failed clear dispatches nothing");
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-maximize-clear") && line.includes("cause=native-write-missing")));
        assert.equal(adapter.isInFlight, false);
    });

    it("refuses an unmanaged maximized exclusion with the established float refusal", () => {
        // activeExcluded but the focused window is not a same-domain float:
        // no clear, the ordinary float route refuses unchanged.
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, { activeExcluded: true, maximized: { "win-a": true } });
        mocks.activeImpl = () => refs.a;
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.deepEqual(mocks.maximizeClears, [], "unmanaged subjects never clear");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.includes("omnitiler:plan:move-refused-floating"));
    });

    it("fences a domain-raced settlement with no structural move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            // Synchronous view switch: the cleared mover re-homes with the
            // new workspace scope, so the observation validates but names a
            // different source domain than the pre-clear read.
            mocks.observeImpl = () => {
                const seen = makeObserved(refs);
                const windows = seen.windows.map((entry) =>
                    Object.freeze({ ...entry, output: "out-1", workspace: "ws-9" }),
                );
                return {
                    ...seen,
                    domainWorkspace: "ws-9",
                    windows: Object.freeze(windows),
                };
            };
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 0, "domain-raced clear never moves");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=domain-raced")));
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-maximize-clear") && line.includes("cause=domain-raced")));
        assert.equal(adapter.isInFlight, false);
    });

    it("fences an identity-raced settlement with no structural move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const replacement = {};
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            mocks.observeImpl = () => {
                const seen = makeObserved(refs);
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
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 0, "replaced ref never moves");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-absent")));
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-maximize-clear") && line.includes("cause=identity-raced")));
        assert.equal(adapter.isInFlight, false);
    });

    it("fences a synchronous directional race with no structural move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let cleared = false;
        mocks.observeImpl = () => makeObserved(refs, { maximized: cleared ? {} : { "win-a": true } });
        mocks.directionalImpl = (): PlanObserved | null => {
            if (!cleared) {
                return mocks.observeImpl();
            }
            return null;
        };
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            cleared = true;
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.maximizeClears.length, 1, "one clear attempt per press");
        assert.equal(mocks.dbusCalls.length, 0, "directional-raced clear never moves");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=directional-raced")));
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-maximize-clear") && line.includes("cause=directional-raced")));
        assert.equal(adapter.isInFlight, false);
    });

    it("consumes a synchronous maximize signal during the clear and still moves", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximizedA = true;
        mocks.observeImpl = () => makeObserved(refs, { maximized: maximizedA ? { "win-a": true } : {} });
        mocks.maximizeClearImpl = (target): MaximizeClearOutcome => {
            assert.equal(target, refs.a);
            maximizedA = false;
            // Native maximizedChanged delivered synchronously from the
            // setter consumes the armed echo before we return.
            fire(mocks, "maximize", refs.a);
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.ok(mocks.logs.includes("omnitiler:plan:maximize-admission-echo-consumed"), "synchronous signal consumes the echo");
        assert.ok(
            !mocks.logs.includes("omnitiler:plan:maximize-admission-echo-cleared-no-signal"),
            "consumed echo is never cleared as missing",
        );
        assert.equal(mocks.dbusCalls.length, 1, "observed-clear still continues the ordinary move");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=observed-cleared")));
    });

    it("refuses busy before any clear with no native write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        // Stage an unanswered focus flight first.
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1, "setup flight outstanding");
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": true } });
        adapter.requestMove("right");
        assert.deepEqual(mocks.maximizeClears, [], "busy refuses before any clear");
        assert.equal(mocks.dbusCalls.length, 1, "busy dispatches nothing further");
        assert.ok(mocks.logs.some((line) => line === "omnitiler:plan:busy-refused kind=move"));
    });
});
