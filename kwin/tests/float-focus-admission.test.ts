import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
} from "../src/plan-adapter";
import type {
    MaximizeClearOutcome,
    KeepAboveWriteOutcome,
} from "../src/plan-adapter";

const DOMAIN_GAP = 4;
const OUTER_DOMAIN_GAP = 8;

function makeRefs(): { a: object; b: object; f: object; c: object } {
    return { a: {}, b: {}, f: {}, c: {} };
}

interface TestWindow {
    readonly id: string;
    readonly ref: object;
    readonly floating: boolean;
}

// R-INS-05 PlanAdapter wire route (mocked observation at the PlanAdapter
// boundary; observeNative itself is NOT under test here). H[A,B] plus
// ordinary float F natively focused, then newcomer C opens. The adapter must
// route the float focus transparently (focused_window names F, C carried
// tiled) so the shared Engine convergence route keeps the retained tiled
// focus B (a float never takes tile focus). Rewriting
// focused_window to B or blanking it would hide the float-focus condition
// from the shared route.
function makeObserved(
    refs: { a: object; b: object; f: object; c: object },
    opts: { newcomer: boolean; fingerprint: string },
): PlanObserved {
    const windows: TestWindow[] = [
        { id: "win-a", ref: refs.a, floating: false },
        { id: "win-b", ref: refs.b, floating: false },
        { id: "win-f", ref: refs.f, floating: true },
    ];
    if (opts.newcomer) {
        windows.push({ id: "win-c", ref: refs.c, floating: false });
    }
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "win-f",
        activeExcluded: true,
        windows: Object.freeze(
            windows.map((entry) =>
                Object.freeze({
                    id: entry.id,
                    ref: entry.ref,
                    rect: Object.freeze({ x: 0, y: 0, w: 100, h: 100 }),
                    output: "out-1",
                    workspace: "ws-1",
                    fullscreen: false,
                    maximized: false,
                    floating: entry.floating,
                    sticky: false,
                    resourceClass: "unknown",
                }),
            ),
        ),
        activeRef: refs.f,
        fingerprint: opts.fingerprint,
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ service: string; path: string; iface: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly subscribes: Array<{ kind: string; handler: (target?: object) => void }>;
    observeImpl: () => PlanObserved | null;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object; f: object; c: object }): Mocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        subscribes: [],
        observeImpl: (): PlanObserved | null => makeObserved(refs, { newcomer: false, fingerprint: "fp-base" }),
        env: null as unknown as PlanAdapterEnv,
    } as Mocks;
    const env: PlanAdapterEnv = {
        callDbus: (service, path, iface, method, payload, callback): void => {
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
        clearMaximize: (_target): MaximizeClearOutcome => "invoked",
        setMaximize: (_target, _maximized): MaximizeClearOutcome => "invoked",
        setFullscreen: (_target, _fullscreen): MaximizeClearOutcome => "invoked",
        setAllDesktops: (_target, _allDesktops): MaximizeClearOutcome => "invoked",
        readKeepAbove: (_target): boolean | null => false,
        readKeepBelow: (_target): boolean | null => false,
        setKeepAbove: (_target, _keepAbove): KeepAboveWriteOutcome => "invoked",
        setKeepBelow: (_target, _keepBelow): KeepAboveWriteOutcome => "invoked",
        setGeometry: (_target, _rect): boolean => true,
        setFloating: (_id, _floating): void => {},
        setActive: (_target): boolean => true,
        setDesktops: (_mover, _desktops): boolean => true,
        active: (): object | null => refs.f,
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
    };
    (state as { env: PlanAdapterEnv }).env = env;
    return state;
}

function plannerPayload(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
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

describe("float-focus admission PlanAdapter wire route (R-INS-05 / D05)", () => {
    it("reconciles a newcomer with the float focus intact on the wire payload for shared-core anchoring", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new PlanAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);

        // Baseline A/B/F observed first so the newcomer is a membership change.
        mocks.observeImpl = () => makeObserved(refs, { newcomer: false, fingerprint: "fp-base" });
        fire(mocks, "added");
        runTimers(mocks);
        const baselineCalls = mocks.dbusCalls.length;

        // Newcomer C opens while float F holds native focus.
        mocks.observeImpl = () => makeObserved(refs, { newcomer: true, fingerprint: "fp-newcomer" });
        fire(mocks, "added");
        runTimers(mocks);
        assert.ok(
            mocks.dbusCalls.length > baselineCalls,
            `expected a reconcile dispatch for the newcomer (calls ${mocks.dbusCalls.length})`,
        );
        const payload = plannerPayload(mocks, mocks.dbusCalls.length - 1);
        assert.deepEqual(
            (payload["command"] as Record<string, unknown>)["op"],
            "reconcile",
            "newcomer admission travels as reconcile",
        );
        assert.equal(
            payload["focused_window"],
            "win-f",
            "float focus routes intact so shared core anchors at prior tiled B, not a rewritten blank/B",
        );
        const carried = (payload["windows"] as Array<Record<string, unknown>>).map(
            (entry) => entry["window"],
        );
        assert.ok(carried.includes("win-c"), "reconcile carries the newcomer");
        const newcomer = (payload["windows"] as Array<Record<string, unknown>>).find(
            (entry) => entry["window"] === "win-c",
        );
        assert.ok(newcomer?.["floating"] !== true, "newcomer carries tiled (no floating flag)");
        const floatEntry = (payload["windows"] as Array<Record<string, unknown>>).find(
            (entry) => entry["window"] === "win-f",
        );
        assert.equal(
            floatEntry?.["floating"],
            true,
            "float rides the wire as floating so the Engine keeps the exception while reading the focus signal",
        );
        assert.equal(adapter.isEnabled, true);
    });
});
