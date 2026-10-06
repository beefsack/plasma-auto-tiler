import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
    PlanWindowConstraints,
} from "../src/plan-adapter";

function makeRefs(): { a: object; b: object } {
    return { a: {}, b: {} };
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function makeObserved(
    refs: { a: object; b: object },
    opts: {
        focused?: object;
        rects?: Record<string, Rect>;
        bounds?: Rect;
        output?: string;
        workspace?: string;
        fingerprint?: string;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const rect = (id: string): Rect => opts.rects?.[id] ?? { x: 0, y: 0, w: 100, h: 100 };
    const output = opts.output ?? "out-1";
    const workspace = opts.workspace ?? "ws-1";
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: rect("win-a"),
            output,
            workspace,
            fullscreen: false,
            maximized: false,
            resourceClass: "unknown",
        }),
        Object.freeze({
            id: "win-b",
            ref: refs.b,
            rect: rect("win-b"),
            output,
            workspace,
            fullscreen: false,
            maximized: false,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: output,
        domainWorkspace: workspace,
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
    readonly geometries: Array<{ target: object; rect: Rect }>;
    readonly actives: object[];
    observeImpl: () => PlanObserved | null;
    constraintsImpl: (target: object) => PlanWindowConstraints | null;
    writeImpl: (target: object, rect: Rect) => boolean;
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
        actives: [],
        observeImpl: () => makeObserved(refs, { focused: refs.a }),
        constraintsImpl: (_target: object): PlanWindowConstraints | null => null,
        writeImpl: (target: object, rect: Rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        },
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
        setGeometry: (target, rect): boolean => state.writeImpl(target, rect),
        setActive: (target): boolean => {
            state.actives.push(target);
            return true;
        },
        active: (): object | null => refs.a,
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
        readWindowConstraints: (target: object): PlanWindowConstraints | null => state.constraintsImpl(target),
    };
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
    geom: ReadonlyArray<{ window: string; rect: Rect; overconstrained?: boolean; clientClamped?: boolean }>,
    output = "out-1",
    workspace = "ws-1",
): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        desired_geometry: geom.map((entry) => ({
            window: entry.window,
            leaf: `${entry.window}-leaf`,
            output,
            workspace,
            rect: entry.rect,
            ...(entry.overconstrained === true ? { overconstrained: true } : {}),
            ...(entry.clientClamped === true ? { client_clamped: true } : {}),
        })),
    });
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

function writesFor(mocks: Mocks, target: object): Rect[] {
    return mocks.geometries.filter((entry) => entry.target === target).map((entry) => entry.rect);
}

describe("plan adapter B6 minimum origin placement", () => {
    it("R-MIN-01: overconstrained newcomer writes planned origin with raised extents, feasible sibling untouched", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        // B6: win-a moves to its planned origin with each violated extent
        // raised to the declared minimum; win-b already equals its plan and
        // is never rewritten (satisfied height axis of win-a is untouched).
        assert.deepEqual(writesFor(mocks, refs.a), [{ x: 0, y: 0, w: 900, h: 800 }]);
        assert.deepEqual(writesFor(mocks, refs.b), []);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:minimum-placed correlation=${correlation} window=win-a resource_class=unknown op=move rect=0,0,900,800`,
            ),
            "structured minimum-placed diagnostic carries the actual written rect",
        );
    });

    it("R-MIN-02: shrink writes effective minimum with origin kept, feasible axis untouched", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        mocks.constraintsImpl = (): PlanWindowConstraints | null => ({
            resizeable: true,
            minSize: { w: 650, h: 100 },
            maxSize: null,
        });
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        // Only the violating width axis grows; origin and height are kept,
        // and the feasible sibling is never rewritten.
        assert.deepEqual(writesFor(mocks, refs.a), [{ x: 0, y: 0, w: 650, h: 800 }]);
        assert.deepEqual(writesFor(mocks, refs.b), []);
    });

    it("R-MIN-03: oversized sole minimum writes origin plus minimum extents", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const planned = { x: 0, y: 0, w: 1080, h: 600 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 1200, h: 500 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                bounds: { x: 0, y: 0, w: 1080, h: 600 },
                rects: { "win-a": planned, "win-b": { x: 0, y: 0, w: 100, h: 100 } },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: planned, overconstrained: true },
                { window: "win-b", rect: { x: 0, y: 0, w: 100, h: 100 } },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [{ x: 0, y: 0, w: 1200, h: 600 }]);
    });

    it("sentinel hints behave as absent and never raise the write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 0, h: -5 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        // Unknown/sentinel minimum keeps the planned rect; both members
        // already equal it, so nothing is written.
        assert.deepEqual(mocks.geometries, []);
    });

    it("nonzero gap origin is preserved while raising violated extents", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const planned = { x: 8, y: 8, w: 400, h: 300 };
        const sibling = { x: 416, y: 8, w: 400, h: 300 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 864, h: 617 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": planned, "win-b": sibling } });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: planned, overconstrained: true },
                { window: "win-b", rect: sibling },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [{ x: 8, y: 8, w: 864, h: 617 }]);
        assert.deepEqual(writesFor(mocks, refs.b), []);
    });

    it("repeated observation at the effective target stays quiet", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        const effectiveA = { x: 0, y: 0, w: 900, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        void adapter;
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(admitCorr, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [effectiveA], "admission writes the effective target once");
        // Native readback now shows the effective rect. A repeated
        // observation at the effective target must stay quiet: applied
        // evidence already equals it, so no second dispatch and no second
        // write lands.
        const writesBefore = mocks.geometries.length;
        const callsBefore = mocks.dbusCalls.length;
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, rects: { "win-a": effectiveA, "win-b": allocB } });
        fire(mocks, "geometry");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore, "effective equality stays quiet, no new dispatch");
        assert.equal(mocks.geometries.length, writesBefore, "effective equality stays quiet, no write fight");
    });

    it("sibling drift reasserts only the sibling while the minimum member stays at effective", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        const effectiveA = { x: 0, y: 0, w: 900, h: 800 };
        const driftB = { x: 600, y: 0, w: 550, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        void adapter;
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(admitCorr, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [effectiveA]);
        // The minimum member reads back at effective while the feasible
        // sibling drifts: the next reconcile reasserts only the sibling
        // against the same plan, never refighting the minimum member.
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, rects: { "win-a": effectiveA, "win-b": driftB } });
        fire(mocks, "geometry");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 2, "sibling drift dispatches one reconcile");
        const correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [effectiveA], "minimum member never refights effective");
        assert.deepEqual(writesFor(mocks, refs.b), [allocB], "feasible sibling reasserts to plan");
    });

    it("minimum-placed is absent when the effective target is already equal", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        const effectiveA = { x: 0, y: 0, w: 900, h: 800 };
        const driftB = { x: 600, y: 0, w: 550, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        void adapter;
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(admitCorr, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [effectiveA]);
        // The minimum member reads back at effective while the sibling
        // drifts: the flagged member needs no write, so no minimum-placed
        // line is emitted for a placement that never happened.
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, rects: { "win-a": effectiveA, "win-b": driftB } });
        fire(mocks, "geometry");
        runTimers(mocks);
        const correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [effectiveA], "already-equal effective is never rewritten");
        assert.deepEqual(writesFor(mocks, refs.b), [allocB], "drifted sibling still reasserts");
        assert.ok(
            !mocks.logs.some((line) => line.includes("minimum-placed") && line.includes(`correlation=${correlation}`)),
            "no minimum-placed without a successful minimum write",
        );
    });

    it("a refused minimum write keeps the failure contract with no placement log and no retry", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        let attempts = 0;
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.writeImpl = (target, rect): boolean => {
            if (target === refs.a) {
                attempts += 1;
                return false;
            }
            mocks.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        assert.equal(attempts, 1, "exactly one native attempt for the refused minimum write");
        assert.deepEqual(mocks.geometries, [], "refused write records no geometry");
        assert.ok(
            mocks.logs.some((line) => line.includes("outcome=write-failed")),
            "refusal keeps the write-failed terminal",
        );
        assert.ok(
            !mocks.logs.some((line) => line.includes("minimum-placed")),
            "no minimum-placed without a successful write",
        );
        // No silent retry: a second attempt needs a second signal.
        runTimers(mocks);
        assert.equal(attempts, 1, "failure never retries without a new signal");
    });

    it("a both-flagged member keeps minimum precedence over the clamp", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        const driftA = { x: 0, y: 0, w: 616, h: 800 };
        const effectiveA = { x: 0, y: 0, w: 900, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        void adapter;
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReplyWithFlags(admitCorr, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }]));
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": driftA, "win-b": allocB } });
        fire(mocks, "geometry");
        runTimers(mocks);
        const correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA, overconstrained: true, clientClamped: true },
                { window: "win-b", rect: allocB },
            ]),
        );
        // Minimum wins over the contradictory clamp (core resolves
        // contradictory pairs minimum-first): the effective target is
        // written, never clamp-skipped.
        assert.deepEqual(writesFor(mocks, refs.a), [effectiveA]);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    `plasma-auto-tiler:plan:minimum-placed correlation=${correlation} window=win-a resource_class=unknown op=reconcile rect=0,0,900,800`,
            ),
        );
        assert.ok(
            !mocks.logs.some((line) => line.includes("clamp-accepted") && line.includes(`correlation=${correlation}`)),
            "both-flagged member is never clamp-accepted",
        );
    });

    it("post-transfer evidence converges to effective with zero rewrites and no focus theft", () => {
        // Simulates exactly what a forced post-R4 reconcile sees: applied
        // evidence still homed on the source while the observation already
        // shows the target at the effective minimum. The same plan must
        // write nothing for the effective member, re-home evidence, and
        // stay quiet afterwards without touching focus.
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const srcA = { x: 0, y: 0, w: 600, h: 800 };
        const srcB = { x: 600, y: 0, w: 600, h: 800 };
        const planA = { x: 0, y: 0, w: 500, h: 800 };
        const effectiveA = { x: 0, y: 0, w: 900, h: 800 };
        const planB = { x: 500, y: 0, w: 700, h: 800 };
        const driftB = { x: 500, y: 0, w: 650, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": srcA, "win-b": srcB } });
        const adapter = enableAdapter(mocks);
        void adapter;
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReplyWithFlags(admitCorr, [{ window: "win-a", rect: srcA }, { window: "win-b", rect: srcB }]));
        // Transfer happened natively: both members now home on ws-2 with
        // win-a already at its effective minimum.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                output: "out-1",
                workspace: "ws-2",
                rects: { "win-a": effectiveA, "win-b": driftB },
            });
        fire(mocks, "geometry");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 2, "homing change dispatches one reconcile");
        const correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReplyWithFlags(
                correlation,
                [
                    { window: "win-a", rect: planA, overconstrained: true },
                    { window: "win-b", rect: planB },
                ],
                "out-1",
                "ws-2",
            ),
        );
        assert.deepEqual(writesFor(mocks, refs.a), [], "effective member writes nothing after transfer");
        assert.deepEqual(writesFor(mocks, refs.b), [planB], "drifted sibling converges to plan");
        assert.deepEqual(mocks.actives, [], "convergence never touches native focus");
        assert.ok(
            !mocks.logs.some((line) => line.includes("minimum-placed") && line.includes(`correlation=${correlation}`)),
            "no placement log without a write",
        );
        // Native readback now shows the converged rects; a repeat
        // observation stays quiet, proving evidence re-homed to ws-2.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                output: "out-1",
                workspace: "ws-2",
                rects: { "win-a": effectiveA, "win-b": planB },
            });
        const callsBefore = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore, "re-homed evidence stays quiet");
    });

    it("pointer echo compares the effective neighbour rect, not the planned one", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 300, h: 800 };
        const allocB = { x: 300, y: 0, w: 500, h: 800 };
        const effectiveB = { x: 300, y: 0, w: 700, h: 800 };
        const driftA = { x: 0, y: 0, w: 250, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.b) {
                return { resizeable: true, minSize: { w: 700, h: 100 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.requestPointerResize("win-a", "right", 400), true);
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReplyWithFlags(correlation, [
                { window: "win-a", rect: allocA },
                { window: "win-b", rect: allocB, overconstrained: true },
            ]),
        );
        assert.deepEqual(writesFor(mocks, refs.b), [effectiveB], "neighbour writes effective");
        assert.ok(mocks.logs.some((line) => line.includes("echo-fence-armed")), "pointer echo armed");
        // Pointer source drift is tolerated; the neighbour already shows the
        // effective target, so the echo must consume instead of dispatching.
        const callsBefore = mocks.dbusCalls.length;
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, rects: { "win-a": driftA, "win-b": effectiveB } });
        fire(mocks, "geometry");
        runTimers(mocks);
        assert.ok(mocks.logs.some((line) => line.includes("echo-fence-consumed")), "effective echo consumed");
        assert.equal(mocks.dbusCalls.length, callsBefore, "consumed echo dispatches nothing");
    });

    it("foreground short minimum readback converges boundedly with echoes interleaved", () => {
        // Foreground mirror of the short-readback journey: the host holds
        // every effective write short while echoing each write first. The
        // marked B6 member keeps its reassertion count across the converged
        // echoes, accepts after three reasserts, then stays quiet.
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        const effectiveA = { x: 0, y: 0, w: 900, h: 800 };
        const shortA = { x: 0, y: 0, w: 700, h: 800 };
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: { w: 900, h: 700 }, maxSize: null };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        const adapter = enableAdapter(mocks);
        void adapter;
        const flagged = (correlation: string): void => {
            mocks.callbacks[mocks.callbacks.length - 1]?.(
                plannedReplyWithFlags(correlation, [
                    { window: "win-a", rect: allocA, overconstrained: true },
                    { window: "win-b", rect: allocB },
                ]),
            );
        };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        fire(mocks, "added");
        runTimers(mocks);
        flagged(plannerPayload(mocks, 0)["correlation_id"] as string);
        assert.deepEqual(writesFor(mocks, refs.a), [effectiveA], "admission writes effective");
        // Three reassert rounds, each verified through an echo observation
        // that must stay quiet without resetting the count.
        for (let round = 0; round < 3; round += 1) {
            mocks.observeImpl = () =>
                makeObserved(refs, { focused: refs.a, rects: { "win-a": effectiveA, "win-b": allocB } });
            const echoCalls = mocks.dbusCalls.length;
            fire(mocks, "geometry");
            runTimers(mocks);
            assert.equal(mocks.dbusCalls.length, echoCalls, `round ${String(round)} echo stays quiet`);
            mocks.observeImpl = () =>
                makeObserved(refs, { focused: refs.a, rects: { "win-a": shortA, "win-b": allocB } });
            fire(mocks, "geometry");
            runTimers(mocks);
            const index = 1 + round;
            assert.equal(mocks.dbusCalls.length, index + 1, `round ${String(round)} shortfall dispatches`);
            flagged(plannerPayload(mocks, index)["correlation_id"] as string);
        }
        assert.deepEqual(
            writesFor(mocks, refs.a),
            [effectiveA, effectiveA, effectiveA, effectiveA],
            "one admission plus exactly three bounded reasserts",
        );
        assert.equal(
            mocks.logs.filter((line) => line.includes("minimum-placed")).length,
            4,
            "one placement line per successful minimum write",
        );
        // The next shortfall accepts instead of dispatching, then stays
        // quiet across repeats with no rejection or park.
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, rects: { "win-a": shortA, "win-b": allocB } });
        fire(mocks, "geometry");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 4, "fourth shortfall accepts without dispatching");
        assert.ok(
            mocks.logs.some((line) => line.includes("reconcile-accepted") && line.includes("cause=stable-drift")),
            "bounded acceptance adopts the held rect",
        );
        assert.deepEqual(writesFor(mocks, refs.a).length, 4, "acceptance writes nothing");
        for (let quiet = 0; quiet < 2; quiet += 1) {
            const writesBefore = mocks.geometries.length;
            fire(mocks, "geometry");
            runTimers(mocks);
            assert.equal(mocks.dbusCalls.length, 4, `quiet cycle ${String(quiet)} dispatches nothing`);
            assert.equal(mocks.geometries.length, writesBefore, `quiet cycle ${String(quiet)} writes nothing`);
        }
        assert.ok(
            !mocks.logs.some((line) => line.includes("parked") || line.includes("write-failed")),
            "no park or failure around the journey",
        );
    });

    it("feasible-domain quiet resets separate drift episodes as baseline", () => {
        // No minimums anywhere: converged observations reset reassertion
        // accounting exactly as before, so three isolated single-round
        // drift episodes never accumulate into an acceptance, and a fourth
        // drift still dispatches instead of accepting.
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const allocA = { x: 0, y: 0, w: 600, h: 800 };
        const allocB = { x: 600, y: 0, w: 600, h: 800 };
        const driftA = { x: 0, y: 0, w: 616, h: 800 };
        mocks.constraintsImpl = (): PlanWindowConstraints | null => null;
        const adapter = enableAdapter(mocks);
        void adapter;
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReplyWithFlags(admitCorr, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }]));
        assert.deepEqual(mocks.geometries, [], "feasible admission writes nothing");
        for (let episode = 0; episode < 3; episode += 1) {
            mocks.observeImpl = () =>
                makeObserved(refs, { focused: refs.a, rects: { "win-a": driftA, "win-b": allocB } });
            fire(mocks, "geometry");
            runTimers(mocks);
            const index = 1 + episode;
            assert.equal(mocks.dbusCalls.length, index + 1, `episode ${String(episode)} dispatches`);
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(
                plannedReplyWithFlags(correlation, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }]),
            );
            mocks.observeImpl = () =>
                makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
            const quietCalls = mocks.dbusCalls.length;
            fire(mocks, "geometry");
            runTimers(mocks);
            assert.equal(mocks.dbusCalls.length, quietCalls, `episode ${String(episode)} converges quiet`);
        }
        assert.ok(
            !mocks.logs.some((line) => line.includes("stable-drift-accepted")),
            "isolated episodes never accumulate into acceptance",
        );
        assert.ok(!mocks.logs.some((line) => line.includes("minimum-placed")), "feasible path never places");
        // A fourth isolated drift still dispatches (count was reset), never accepts.
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, rects: { "win-a": driftA, "win-b": allocB } });
        fire(mocks, "geometry");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 5, "fourth drift dispatches instead of accepting");
        assert.ok(
            !mocks.logs.some((line) => line.includes("stable-drift-accepted")),
            "still no acceptance after reset episodes",
        );
    });
});
