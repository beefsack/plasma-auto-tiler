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

type Rect = { x: number; y: number; w: number; h: number };

const BOUNDS: Rect = { x: 0, y: 0, w: 800, h: 2184 };
const EVEN_A: Rect = { x: 0, y: 0, w: 800, h: 1092 };
const EVEN_B: Rect = { x: 0, y: 1092, w: 800, h: 1092 };
const HELD_A: Rect = { x: 0, y: 0, w: 800, h: 1036 };
const SPARE_B: Rect = { x: 0, y: 1036, w: 800, h: 1148 };

function makeObserved(
    refs: { a: object; b: object },
    opts: {
        focused?: object;
        rects?: Record<string, Rect>;
        floating?: Record<string, boolean>;
        fullscreen?: Record<string, boolean>;
        maximized?: Record<string, boolean>;
        fingerprint?: string;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const rect = (id: string): Rect => opts.rects?.[id] ?? { x: 0, y: 0, w: 100, h: 100 };
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
            sticky: false,
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
            floating: false,
            sticky: false,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { ...BOUNDS },
        domainGap: 0,
        domainOuterGap: 0,
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
    observeImpl: () => PlanObserved | null;
    constraintsImpl: (target: object) => PlanWindowConstraints | null;
    interactiveImpl: () => boolean;
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
        observeImpl: () => makeObserved(refs, { rects: { "win-a": EVEN_A, "win-b": EVEN_B } }),
        constraintsImpl: (_target: object): PlanWindowConstraints | null => null,
        interactiveImpl: (): boolean => false,
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
    (env as unknown as Record<string, unknown>)["readWindowConstraints"] = (
        target: object,
    ): PlanWindowConstraints | null => state.constraintsImpl(target);
    (env as unknown as Record<string, unknown>)["isInteractiveResizeActive"] = (): boolean =>
        state.interactiveImpl();
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

function plannedReply(
    correlation: string,
    geom: ReadonlyArray<{ window: string; rect: Rect; overconstrained?: boolean; clientClamped?: boolean }>,
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

function learnedOf(mocks: Mocks, index: number): unknown {
    return (plannerPayload(mocks, index) as Record<string, unknown>)["learned_max_sizes"];
}

// Drives the Ghostty-class lifecycle to the promotion dispatch:
// uneven start -> even writes (evidence 1), held drift -> even rewrite
// (evidence 2, armed), held drift again -> promotion dispatch with caps.
// Returns the promotion call index (2).
function driveToPromotion(mocks: Mocks, refs: { a: object; b: object }): number {
    mocks.observeImpl = () =>
        makeObserved(refs, {
            rects: {
                "win-a": { x: 0, y: 0, w: 800, h: 800 },
                "win-b": { x: 0, y: 800, w: 800, h: 1384 },
            },
        });
    fire(mocks, "added");
    runTimers(mocks);
    assert.equal(mocks.dbusCalls.length, 1);
    let correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
    mocks.callbacks[0]?.(plannedReply(correlation, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
    assert.equal(mocks.geometries.length, 2);

    mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
    fire(mocks, "geometry");
    runDebounce(mocks);
    assert.equal(mocks.dbusCalls.length, 2);
    correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
    mocks.callbacks[1]?.(plannedReply(correlation, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
    assert.ok(mocks.geometries.length > 2);

    mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
    fire(mocks, "geometry");
    runDebounce(mocks);
    assert.equal(mocks.dbusCalls.length, 3);
    return 2;
}

describe("plan adapter learned size caps (Ghostty-class 1092/1036)", () => {
    it("sends learned_max_sizes after two writes and gives the neighbour +56 without reasserting", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        void adapter;
        const promotion = driveToPromotion(mocks, refs);
        assert.deepEqual(learnedOf(mocks, promotion), { "win-a": { w: 0, h: 1036 } });
        assert.ok(
            mocks.logs.some((line) => line.includes("learned-cap-learned") && line.includes("window=win-a")),
            "promotion is diagnosed",
        );
        const correlation = plannerPayload(mocks, promotion)["correlation_id"] as string;
        const writesBefore = mocks.geometries.length;
        mocks.callbacks[promotion]?.(
            plannedReply(correlation, [{ window: "win-a", rect: HELD_A }, { window: "win-b", rect: SPARE_B }]),
        );
        const freshWrites = mocks.geometries.slice(writesBefore);
        assert.ok(
            freshWrites.every((entry) => entry.target !== refs.a),
            "the held window is never rewritten once reprojected",
        );
        assert.deepEqual(
            freshWrites.map((entry) => entry.rect),
            [SPARE_B],
            "the neighbour receives exactly the 56px spare extent",
        );
        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": SPARE_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3, "the converged reprojected state stays quiet with no reassert loop");
        assert.equal(mocks.geometries.length, writesBefore + 1);
    });

    it("a spontaneously changed held size invalidates the cap and the next reconcile carries retained shares", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        void adapter;
        const promotion = driveToPromotion(mocks, refs);
        const correlation = plannerPayload(mocks, promotion)["correlation_id"] as string;
        mocks.callbacks[promotion]?.(
            plannedReply(correlation, [{ window: "win-a", rect: HELD_A }, { window: "win-b", rect: SPARE_B }]),
        );
        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": SPARE_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3, "reprojected state converges first");

        const movedHeld: Rect = { x: 0, y: 0, w: 800, h: 1000 };
        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": movedHeld, "win-b": SPARE_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 4, "the changed held size dispatches one fresh reconcile");
        assert.equal(learnedOf(mocks, 3), undefined, "changed held size expires the learned cap");
        assert.ok(
            mocks.logs.some((line) => line.includes("learned-cap-expired") && line.includes("window=win-a")),
            "expiry is diagnosed",
        );
        const next = plannerPayload(mocks, 3)["correlation_id"] as string;
        mocks.callbacks[3]?.(plannedReply(next, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
    });

    it("a native max-hint clamp stays skip-clamped and never learns", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.constraintsImpl = (target): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: null, maxSize: { w: 800, h: 1036 } };
            }
            return { resizeable: true, minSize: null, maxSize: null };
        };
        const adapter = enableAdapter(mocks);
        void adapter;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                rects: {
                    "win-a": { x: 0, y: 0, w: 800, h: 800 },
                    "win-b": { x: 0, y: 800, w: 800, h: 1384 },
                },
            });
        fire(mocks, "added");
        runTimers(mocks);
        const first = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReply(first, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
        for (let cycle = 0; cycle < 3; cycle += 1) {
            mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + cycle;
            assert.equal(mocks.dbusCalls.length, index + 1);
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            const writesBefore = mocks.geometries.length;
            mocks.callbacks[index]?.(
                plannedReply(correlation, [
                    { window: "win-a", rect: EVEN_A, clientClamped: true },
                    { window: "win-b", rect: EVEN_B },
                ]),
            );
            assert.equal(mocks.geometries.length, writesBefore, "hint-clamped drift is never rewritten");
            assert.ok(
                mocks.logs.some((line) => line.includes("clamp-accepted") && line.includes("window=win-a")),
                "hint clamp stays skip-clamped",
            );
            assert.equal(learnedOf(mocks, index), undefined, "hint-explained clamps never ride learned_max_sizes");
        }
        assert.ok(
            !mocks.logs.some((line) => line.includes("learned-cap-learned")),
            "a native max hint never promotes a learned cap",
        );
    });

    it("position drift never learns", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        void adapter;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                rects: {
                    "win-a": { x: 0, y: 0, w: 800, h: 800 },
                    "win-b": { x: 0, y: 800, w: 800, h: 1384 },
                },
            });
        fire(mocks, "added");
        runTimers(mocks);
        const first = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReply(first, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
        const shifted: Rect = { x: 8, y: 0, w: 800, h: 1092 };
        for (let cycle = 0; cycle < 3; cycle += 1) {
            mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": shifted, "win-b": EVEN_B } });
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + cycle;
            if (mocks.dbusCalls.length !== index + 1) {
                continue;
            }
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(
                plannedReply(correlation, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]),
            );
            assert.equal(learnedOf(mocks, index), undefined, "position-only drift never rides learned_max_sizes");
        }
        assert.ok(
            !mocks.logs.some((line) => line.includes("learned-cap-learned")),
            "position drift never promotes a learned cap",
        );
    });

    it("interactive resizes never learn", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        void adapter;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                rects: {
                    "win-a": { x: 0, y: 0, w: 800, h: 800 },
                    "win-b": { x: 0, y: 800, w: 800, h: 1384 },
                },
            });
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        const first = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReply(first, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
        mocks.interactiveImpl = (): boolean => true;
        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.ok(
            mocks.dbusCalls.length <= 2,
            "interactive drift stays suppressed or at least cap-free",
        );
        for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
            assert.equal(learnedOf(mocks, index), undefined, "interactive evidence never rides learned_max_sizes");
        }
        assert.ok(
            !mocks.logs.some((line) => line.includes("learned-cap-learned")),
            "interactive geometry never promotes a learned cap",
        );
    });

    it("pending pointer-resize frames never learn", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                rects: {
                    "win-a": { x: 0, y: 0, w: 800, h: 800 },
                    "win-b": { x: 0, y: 800, w: 800, h: 1384 },
                },
            });
        assert.equal(adapter.requestPointerResize("win-a", "right", 800), true);
        assert.equal(mocks.dbusCalls.length, 1);
        const first = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReply(first, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
        for (let cycle = 0; cycle < 2; cycle += 1) {
            mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + cycle;
            if (mocks.dbusCalls.length !== index + 1) {
                continue;
            }
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(
                plannedReply(correlation, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]),
            );
            assert.equal(learnedOf(mocks, index), undefined, "pointer-frame evidence never rides learned_max_sizes");
        }
        assert.ok(
            !mocks.logs.some((line) => line.includes("learned-cap-learned")),
            "pending pointer frames never promote a learned cap",
        );
    });

    it("a transient pending frame cannot promote before the second flight terminal", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        void adapter;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                rects: {
                    "win-a": { x: 0, y: 0, w: 800, h: 800 },
                    "win-b": { x: 0, y: 800, w: 800, h: 1384 },
                },
            });
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        const admit = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReply(admit, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));

        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2, "first held drift dispatches one reconcile");
        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2, "transient frame while pending dispatches nothing new");
        assert.ok(
            !mocks.logs.some((line) => line.includes("learned-cap-learned")),
            "transient pending frame promotes nothing",
        );
        const first = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(first, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
        assert.equal(mocks.dbusCalls.length, 3, "the deferred transient converges through one flight");
        assert.equal(learnedOf(mocks, 2), undefined, "deferred transient carries no cap before promotion");
        assert.ok(
            !mocks.logs.some((line) => line.includes("learned-cap-learned")),
            "still no promotion before the second flight terminal",
        );
        const second = plannerPayload(mocks, 2)["correlation_id"] as string;
        mocks.callbacks[2]?.(plannedReply(second, [{ window: "win-a", rect: EVEN_A }, { window: "win-b", rect: EVEN_B }]));
        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": EVEN_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 4, "settled evidence after two terminals promotes");
        assert.deepEqual(learnedOf(mocks, 3), { "win-a": { w: 0, h: 1036 } });
    });

    it("a changed native hint expires the cap and the next reconcile carries no cap", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        void adapter;
        const promotion = driveToPromotion(mocks, refs);
        const correlation = plannerPayload(mocks, promotion)["correlation_id"] as string;
        mocks.callbacks[promotion]?.(
            plannedReply(correlation, [{ window: "win-a", rect: HELD_A }, { window: "win-b", rect: SPARE_B }]),
        );
        mocks.constraintsImpl = (target: object): PlanWindowConstraints | null => {
            if (target === refs.a) {
                return { resizeable: true, minSize: null, maxSize: { w: 800, h: 900 } };
            }
            return null;
        };
        mocks.observeImpl = () => makeObserved(refs, { rects: { "win-a": HELD_A, "win-b": SPARE_B } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 4, "changed hint dispatches one fresh reconcile");
        assert.equal(learnedOf(mocks, 3), undefined, "changed hint expires the learned cap");
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line.includes("learned-cap-expired") &&
                    line.includes("window=win-a") &&
                    line.includes("cause=hints-changed"),
            ),
            "hint change expiry is diagnosed",
        );
    });
});
