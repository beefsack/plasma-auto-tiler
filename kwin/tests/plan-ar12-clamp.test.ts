import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_DEBOUNCE_MS,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
    PlanWindowConstraints,
} from "../src/plan-adapter";

function makeRefs(): { a: object; b: object } {
    return { a: {}, b: {} };
}

function makeObserved(
    refs: { a: object; b: object },
    opts: {
        focused?: object;
        rects?: Record<string, { x: number; y: number; w: number; h: number }>;
        floating?: Record<string, boolean>;
        sticky?: Record<string, boolean>;
        fingerprint?: string;
        bounds?: { x: number; y: number; w: number; h: number };
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const rect = (id: string): { x: number; y: number; w: number; h: number } =>
        opts.rects?.[id] ?? { x: 0, y: 0, w: 100, h: 100 };
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: rect("win-a"),
            output: "out-1",
            workspace: "ws-1",
            fullscreen: false,
            maximized: false,
            floating: opts.floating?.["win-a"] === true,
            sticky: opts.sticky?.["win-a"] === true,
            resourceClass: "unknown",
        }),
        Object.freeze({
            id: "win-b",
            ref: refs.b,
            rect: rect("win-b"),
            output: "out-1",
            workspace: "ws-1",
            fullscreen: false,
            maximized: false,
            floating: opts.floating?.["win-b"] === true,
            sticky: opts.sticky?.["win-b"] === true,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: opts.bounds ?? { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: 8,
        domainOuterGap: 8,
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
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly subscribes: Array<{ kind: string; handler: (target?: object) => void }>;
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    observeImpl: () => PlanObserved | null;
    constraintsImpl: (target: object) => PlanWindowConstraints | null;
    withConstraints: boolean;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object }): Mocks {
    const state: Mocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        subscribes: [],
        geometries: [],
        observeImpl: () => makeObserved(refs, { focused: refs.a }),
        constraintsImpl: (_target: object): PlanWindowConstraints | null => null,
        withConstraints: true,
        env: null as unknown as PlanAdapterEnv,
    };
    const env: PlanAdapterEnv = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            void service;
            void path;
            void iface;
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
        clearMaximize: (_target): "invoked" => "invoked",
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        },
        setActive: (_target): boolean => true,
        active: (): object | null => refs.a,
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
    };
    // Optional reader so tests can cover both the hinted and the
    // hintless (older script surface) shapes through one harness.
    (env as unknown as Record<string, unknown>)["readWindowConstraints"] = (target: object): PlanWindowConstraints | null =>
        state.withConstraints ? state.constraintsImpl(target) : null;
    state.env = env;
    return state;
}

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function plannerPayload(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function plannedReplyWithFlags(
    correlation: string,
    geom: ReadonlyArray<{
        window: string;
        rect: { x: number; y: number; w: number; h: number };
        overconstrained?: boolean;
        clientClamped?: boolean;
    }>,
): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        desired_geometry: geom.map((entry) => ({
            window: entry.window,
            leaf: `${entry.window}-leaf`,
            output: "out-1",
            workspace: "ws-1",
            rect: entry.rect,
            ...(entry.overconstrained === true ? { overconstrained: true } : {}),
            ...(entry.clientClamped === true ? { client_clamped: true } : {}),
        })),
    });
}

function rejectedReply(correlation: string, kind: string): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", kind, message: "no" });
}

function fire(mocks: Mocks, kind: string, target?: object): void {
    for (const sub of mocks.subscribes) {
        if (sub.kind === kind) {
            sub.handler(target);
        }
    }
}

function runTimers(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled) {
            timer.callback();
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

function requestWindows(mocks: Mocks, index: number): Array<Record<string, unknown>> {
    return plannerPayload(mocks, index)["windows"] as Array<Record<string, unknown>>;
}

describe("plan adapter AR12 size-hint requests", () => {
    it("sends fresh min_size/max_size on every request window", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 80, h: 60 }, maxSize: { w: 1600, h: 900 } };
            }
            return { resizeable: false, minSize: null, maxSize: { w: 1012, h: 1036 } };
        };
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const windows = requestWindows(mocks, 0);
        assert.deepEqual(windows.find((entry) => entry["window"] === "win-a"), {
            window: "win-a",
            output: "out-1",
            workspace: "ws-1",
            rect: { x: 0, y: 0, w: 100, h: 100 },
            min_size: { w: 80, h: 60 },
            max_size: { w: 1600, h: 900 },
        });
        assert.deepEqual(windows.find((entry) => entry["window"] === "win-b"), {
            window: "win-b",
            output: "out-1",
            workspace: "ws-1",
            rect: { x: 0, y: 0, w: 100, h: 100 },
            max_size: { w: 1012, h: 1036 },
        });
    });

    it("omits hint keys when the constraint reader is absent", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.withConstraints = false;
        delete (mocks.env as unknown as Record<string, unknown>)["readWindowConstraints"];
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        for (const entry of requestWindows(mocks, 0)) {
            assert.equal("min_size" in entry, false);
            assert.equal("max_size" in entry, false);
        }
    });
});

describe("plan adapter AR12 Ghostty-like client clamp", () => {
    const bounds = { x: 0, y: 0, w: 2024, h: 1200 };
    const desiredA = { x: 0, y: 0, w: 1012, h: 1092 };
    const desiredB = { x: 1012, y: 0, w: 1012, h: 1092 };
    const clampedB = { x: 1012, y: 0, w: 1012, h: 1036 };

    function ghosttyMocks(): { refs: { a: object; b: object }; mocks: Mocks } {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.b) {
                return { resizeable: true, minSize: null, maxSize: { w: 2048, h: 1036 } };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        return { refs, mocks };
    }

    function admitBaseline(mocks: Mocks, refs: { a: object; b: object }): PlanAdapter {
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, bounds, rects: { "win-a": desiredA, "win-b": desiredB } });
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const corr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReplyWithFlags(corr, [{ window: "win-a", rect: desiredA }, { window: "win-b", rect: desiredB }]));
        assert.equal(mocks.geometries.length, 0);
        return adapter;
    }

    function driftToClamp(mocks: Mocks, refs: { a: object; b: object }): void {
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, bounds, rects: { "win-a": desiredA, "win-b": clampedB } });
        fire(mocks, "geometry");
        runDebounce(mocks);
    }

    it("accepts the clamp without reasserting and without parking", () => {
        const { refs, mocks } = ghosttyMocks();
        const adapter = admitBaseline(mocks, refs);
        void adapter;
        for (let cycle = 0; cycle < 3; cycle += 1) {
            const writesBefore = mocks.geometries.length;
            driftToClamp(mocks, refs);
            const index = 1 + cycle;
            assert.equal(mocks.dbusCalls.length, index + 1, `cycle ${String(cycle)} dispatches one reconcile`);
            assert.deepEqual((plannerPayload(mocks, index)["command"] as Record<string, unknown>)["op"], "reconcile");
            // True max_h evidence rides the request: the observed clamp bound.
            const winB = requestWindows(mocks, index).find((entry) => entry["window"] === "win-b");
            assert.deepEqual(winB?.["max_size"], { w: 2048, h: 1036 });
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(
                plannedReplyWithFlags(correlation, [
                    { window: "win-a", rect: desiredA },
                    { window: "win-b", rect: desiredB, clientClamped: true },
                ]),
            );
            assert.equal(mocks.geometries.length, writesBefore, `cycle ${String(cycle)} never rewrites the clamped window`);
            assert.ok(
                mocks.logs.some(
                    (line) =>
                        line ===
                        `plasma-auto-tiler:plan:clamp-accepted correlation=${correlation} window=win-b resource_class=unknown op=reconcile`,
                ),
                `cycle ${String(cycle)} logs clamp acceptance`,
            );
            assert.ok(
                mocks.logs.some((line) => line.includes(`cmd=${correlation}`) && line.includes("outcome=planned-applied")),
                `cycle ${String(cycle)} still applies`,
            );
        }
        assert.ok(
            !mocks.logs.some((line) => line === "plasma-auto-tiler:plan:reconcile-parked"),
            "explained clamp drift never parks",
        );
        for (const line of mocks.logs.filter((entry) => entry.includes("clamp-accepted"))) {
            assert.ok(!line.includes("[object"), "no raw native ids in clamp logs");
        }
    });

    it("still advances park attempts for genuine drift mixed with a clamp", () => {
        const { refs, mocks } = ghosttyMocks();
        const adapter = admitBaseline(mocks, refs);
        void adapter;
        // Each cycle: win-b stays client-clamped (skipped) while win-a
        // drifts genuinely (rewritten). The genuine reassert must keep
        // advancing the bounded park attempts.
        const driftA = { x: 0, y: 0, w: 900, h: 1092 };
        for (let cycle = 0; cycle < 3; cycle += 1) {
            mocks.observeImpl = () =>
                makeObserved(refs, { focused: refs.a, bounds, rects: { "win-a": driftA, "win-b": clampedB } });
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + cycle;
            assert.equal(mocks.dbusCalls.length, index + 1, `cycle ${String(cycle)} dispatches one reconcile`);
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            const writesBefore = mocks.geometries.length;
            mocks.callbacks[index]?.(
                plannedReplyWithFlags(correlation, [
                    { window: "win-a", rect: desiredA },
                    { window: "win-b", rect: desiredB, clientClamped: true },
                ]),
            );
            assert.ok(
                mocks.geometries.length > writesBefore,
                `cycle ${String(cycle)} still reasserts the genuine drift`,
            );
            assert.ok(
                mocks.geometries.every((entry) => entry.target !== refs.b),
                `cycle ${String(cycle)} never rewrites the clamped window`,
            );
            assert.ok(
                mocks.logs.some(
                    (line) =>
                        line ===
                        `plasma-auto-tiler:plan:clamp-accepted correlation=${correlation} window=win-b resource_class=unknown op=reconcile`,
                ),
            );
        }
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:reconcile-parked"),
            "genuine drift mixed with a clamp still parks boundedly",
        );
    });
});

describe("plan adapter AR12 overconstrained minimum", () => {
    const bounds = { x: 0, y: 0, w: 1200, h: 800 };
    const allocA = { x: 0, y: 0, w: 600, h: 800 };
    const allocB = { x: 600, y: 0, w: 600, h: 800 };
    const driftA = { x: 0, y: 0, w: 616, h: 800 };

    it("never reasserts an overconstrained window and never parks", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, bounds, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        void adapter;
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReplyWithFlags(admitCorr, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }]));
        // The admission itself carries the fresh minimum evidence.
        assert.deepEqual(
            requestWindows(mocks, 0).find((entry) => entry["window"] === "win-a")?.["min_size"],
            { w: 900, h: 700 },
        );
        for (let cycle = 0; cycle < 3; cycle += 1) {
            const writesBefore = mocks.geometries.length;
            mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, bounds, rects: { "win-a": driftA, "win-b": allocB } });
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + cycle;
            assert.equal(mocks.dbusCalls.length, index + 1);
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(
                plannedReplyWithFlags(correlation, [
                    { window: "win-a", rect: allocA, overconstrained: true },
                    { window: "win-b", rect: allocB },
                ]),
            );
            assert.equal(mocks.geometries.length, writesBefore, "overconstrained drift is never rewritten");
            assert.ok(
                mocks.logs.some(
                    (line) =>
                        line ===
                        `plasma-auto-tiler:plan:overconstrained-skipped correlation=${correlation} window=win-a resource_class=unknown op=reconcile`,
                ),
            );
        }
        assert.ok(!mocks.logs.some((line) => line === "plasma-auto-tiler:plan:reconcile-parked"));
    });

    it("honors overconstrained on a move reply too", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.constraintsImpl = (): PlanWindowConstraints | null => ({
            resizeable: true,
            minSize: { w: 900, h: 700 },
            maxSize: null,
        });
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, bounds, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        const movedB = { x: 500, y: 0, w: 700, h: 800 };
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: movedB },
            ]),
        );
        assert.deepEqual(
            mocks.geometries,
            [{ target: refs.b, rect: movedB }],
            "only the unconstrained member is written",
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:overconstrained-skipped correlation=${correlation} window=win-a resource_class=unknown op=move`,
            ),
        );
    });
});

describe("plan adapter AR12 membership-skew diagnostics", () => {
    it("logs per-member skew on cover mismatch without changing the gate", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, floating: { "win-b": true } });
        const adapter = enableAdapter(mocks);
        void adapter;
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        // The reply names only the floating window: wanted (tiled win-a) is
        // missing and the floating member is extra. No baseline exists yet,
        // so retained evidence is unknown.
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [{ window: "win-b", rect: { x: 0, y: 0, w: 200, h: 200 } }]),
        );
        assert.equal(mocks.geometries.length, 0, "gate unchanged: no native writes");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=precondition-mismatch")));
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:membership-skew correlation=${correlation} op=focus reason=cover-mismatch wanted=1 planned=1 missing=1 extra=1 floating=1 sticky=0 fullscreen=0 maximized=0 retained=unknown retained-wanted=- retained-ids=-`,
            ),
            "summary keeps counts and reports unknown retained evidence",
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:membership-skew-member correlation=${correlation} window=win-a side=missing floating=false sticky=false fullscreen=false maximized=false float-src=none`,
            ),
            "missing member carries its exact id and observed flags",
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:membership-skew-member correlation=${correlation} window=win-b side=extra floating=true sticky=false fullscreen=false maximized=false float-src=float-set`,
            ),
            "extra floating member names the float-set provenance",
        );
    });

    it("names the all-desktops provenance for sticky extra members", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, floating: { "win-b": true }, sticky: { "win-b": true } });
        const adapter = enableAdapter(mocks);
        void adapter;
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [{ window: "win-b", rect: { x: 0, y: 0, w: 200, h: 200 } }]),
        );
        assert.equal(mocks.geometries.length, 0);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:membership-skew-member correlation=${correlation} window=win-b side=extra floating=true sticky=true fullscreen=false maximized=false float-src=all-desktops`,
            ),
            "sticky extra member names the all-desktops provenance",
        );
    });

    it("reports retained=unknown for partial-observation without baseline", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, floating: { "win-b": true } });
        const adapter = enableAdapter(mocks);
        void adapter;
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(rejectedReply(correlation, "partial-observation"));
        assert.equal(mocks.geometries.length, 0);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:membership-skew correlation=${correlation} op=focus reason=partial-observation wanted=1 planned=unknown missing=unknown extra=unknown floating=1 sticky=0 fullscreen=0 maximized=0 retained=unknown retained-wanted=- retained-ids=-`,
            ),
            "no retained evidence means no precise cause is claimed",
        );
        assert.ok(
            !mocks.logs.some((line) => line.includes("membership-skew-member")),
            "no member records without a reference set",
        );
    });

    it("compares against applied evidence for partial-observation", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const rects = { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects });
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(admitCorr, [{ window: "win-a", rect: rects["win-a"] }, { window: "win-b", rect: rects["win-b"] }]),
        );
        // win-b floats after application; the next focus flight wants only
        // win-a while applied evidence still retains both as tiled.
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects, floating: { "win-b": true } });
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(rejectedReply(correlation, "partial-observation"));
        assert.equal(mocks.geometries.length, 0);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:membership-skew correlation=${correlation} op=focus reason=partial-observation wanted=1 planned=unknown missing=0 extra=1 floating=1 sticky=0 fullscreen=0 maximized=0 retained=known retained-wanted=2 retained-ids=win-a,win-b`,
            ),
            "applied tiled membership is shown as adapter evidence",
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    // Sticky and floating flags are applied evidence, not
                    // assertions about current core state.
                    `plasma-auto-tiler:plan:membership-skew-member correlation=${correlation} window=win-b side=extra floating=false sticky=false fullscreen=false maximized=false float-src=none`,
            ),
            "extra retained member carries retained flags, not asserted core state",
        );
    });

    it("logs skew for a malformed planned reply", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a });
        const adapter = enableAdapter(mocks);
        void adapter;
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: correlation,
                outcome: "planned",
                base_revision: 2,
                desired_geometry: [{ window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 100, h: 100 }, bogus: true }],
            }),
        );
        assert.equal(mocks.geometries.length, 0);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:membership-skew correlation=${correlation} op=focus reason=malformed wanted=2 planned=unknown missing=unknown extra=unknown floating=0 sticky=0 fullscreen=0 maximized=0 retained=unknown retained-wanted=- retained-ids=-`,
            ),
        );
    });
});
