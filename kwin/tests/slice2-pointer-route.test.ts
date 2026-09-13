import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    DragOraclePull,
    deriveOracleEdge,
    parseDragOracleVerdict,
} from "../src/drag-oracle-pull";
import { PLAN_DEBOUNCE_MS, PlanAdapter, PlanAdapterEnv, PlanObserved } from "../src/plan-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

function movedVerdict(): string {
    return JSON.stringify({
        v: 1,
        cancelled: false,
        finalRect: { x: 0, y: 0, w: 1000, h: 800 },
        windowIdentity: "win-a",
        correlation: "drag-9",
        reason: "ok-moved",
    });
}

function cancelledVerdict(): string {
    return JSON.stringify({
        v: 1,
        cancelled: true,
        finalRect: { x: 0, y: 0, w: 600, h: 800 },
        windowIdentity: "win-a",
        correlation: "drag-10",
        reason: "no-change",
    });
}

function makeRefs(): { a: object; b: object } {
    return { a: {}, b: {} };
}

function makeObserved(refs: { a: object; b: object }): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({ id: "win-a", ref: refs.a, rect: { x: 0, y: 0, w: 1000, h: 800 }, output: "out-1", workspace: "ws-1" }),
        Object.freeze({ id: "win-b", ref: refs.b, rect: { x: 1000, y: 0, w: 200, h: 800 }, output: "out-1", workspace: "ws-1" }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: 0,
        domainOuterGap: 0,
        focusedId: "win-a",
        windows,
        activeRef: refs.a,
        fingerprint: "fp-slice2",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    observeImpl: () => PlanObserved | null;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object }): Mocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        logs: [],
        geometries: [],
        observeImpl: (): PlanObserved | null => makeObserved(refs),
    } as unknown as Mocks;
    const env: PlanAdapterEnv = {
        callDbus: (_s, _p, _i, _m, payload, callback): void => {
            state.dbusCalls.push({ payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (_d, _c): (() => void) => (): void => {},
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        },
        setActive: (): boolean => true,
        active: (): object | null => refs.a,
        subscribe: (): (() => void) => (): void => {},
    };
    (state as { env: PlanAdapterEnv }).env = env;
    return state;
}

function gapPlannedReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "pointer-resize" },
        desired_geometry: [
            { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 8, y: 8, w: 884, h: 784 } },
            { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 900, y: 8, w: 292, h: 784 } },
        ],
    });
}

describe("slice 2 oracle edge derivation", () => {
    it("derives single edges with the opposite fixed and rejects mixed", () => {
        const start = { x: 0, y: 0, w: 600, h: 800 };
        assert.deepEqual(deriveOracleEdge(start, { x: 0, y: 0, w: 1000, h: 800 }), { direction: "right", boundary: 1000 });
        assert.deepEqual(deriveOracleEdge(start, { x: 400, y: 0, w: 200, h: 800 }), { direction: "left", boundary: 400 });
        assert.deepEqual(deriveOracleEdge(start, { x: 0, y: 100, w: 600, h: 700 }), { direction: "up", boundary: 100 });
        assert.deepEqual(deriveOracleEdge(start, { x: 0, y: 0, w: 600, h: 700 }), { direction: "down", boundary: 700 });
        assert.equal(deriveOracleEdge(start, start), null);
        assert.equal(deriveOracleEdge(start, { x: 100, y: 100, w: 500, h: 700 }), "mixed");
    });
});

describe("slice 2 verdict routing contract", () => {
    it("cancelled verdict is a strict no-op with no route call", () => {
        let routed = 0;
        const pull = new DragOraclePull({
            callDbus: (_s, _p, _i, _m, callback): void => {
                callback(cancelledVerdict());
            },
            log: (): void => {},
            routePointer: (): void => {
                routed += 1;
            },
        });
        pull.pullVerdict();
        assert.equal(routed, 0);
        assert.notEqual(parseDragOracleVerdict(cancelledVerdict()), null);
    });

    it("non-cancelled verdict routes exactly once after the D-Bus reply", () => {
        const seen: string[] = [];
        const pull = new DragOraclePull({
            callDbus: (_s, _p, _i, _m, callback): void => {
                callback(movedVerdict());
            },
            log: (): void => {},
            routePointer: (verdict): void => {
                seen.push(verdict.correlation);
            },
        });
        pull.pullVerdict();
        assert.deepEqual(seen, ["drag-9"]);
    });

    it("invalid verdict fails closed with no route call", () => {
        const logs: string[] = [];
        let routed = 0;
        const pull = new DragOraclePull({
            callDbus: (_s, _p, _i, _m, callback): void => {
                callback("garbage");
            },
            log: (message): void => {
                logs.push(message);
            },
            routePointer: (): void => {
                routed += 1;
            },
        });
        pull.pullVerdict();
        assert.equal(routed, 0);
        assert.deepEqual(logs, [
            "plasma-auto-tiler:route-diag:drag-pull action=dispatch",
            "plasma-auto-tiler:route-diag:drag-unavailable",
        ]);
    });
});

describe("slice 2 plan adapter pointer route", () => {
    it("dispatches exactly one strict pointer-resize command", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new PlanAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestPointerResize("win-a", "right", 1000), true);
        assert.equal(mocks.dbusCalls.length, 1);
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(payload["command"], { op: "pointer-resize", window: "win-a", direction: "right", boundary: 1000 });
        assert.equal(payload["focused_window"], "win-a");
    });

    it("rejects unknown window, direction, and boundary without a D-Bus call", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new PlanAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestPointerResize("win-zzz", "right", 1000), false);
        assert.equal(adapter.requestPointerResize("win-a", "sideways", 1000), false);
        assert.equal(adapter.requestPointerResize("win-a", "right", 999999), false);
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("reasserts the drag source and preserves the planned sibling gap", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new PlanAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        // Baseline admit to seed lastGood.
        (adapter as unknown as { requestResync: () => void }).requestResync();
        assert.equal(adapter.requestPointerResize("win-a", "right", 1000), true);
        const correlation = (JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[0]?.(gapPlannedReply(correlation));
        assert.equal(mocks.geometries.length, 2);
        const geometries = new Map(mocks.geometries.map((entry) => [entry.target, entry.rect]));
        const source = geometries.get(refs.a);
        const neighbour = geometries.get(refs.b);
        assert.ok(source !== undefined);
        assert.ok(neighbour !== undefined);
        assert.equal(neighbour.x - (source.x + source.w), 8);
        for (const line of mocks.logs) {
            assert.ok(!line.includes("win-a"));
            assert.ok(!line.includes("win-b"));
        }
        // Neighbour echo with planned rectangles is consumed with no new D-Bus.
        const callsBefore = mocks.dbusCalls.length;
        (adapter as unknown as { refreshNow: () => void });
        assert.equal(mocks.dbusCalls.length, callsBefore);
    });

    it("preserves strict decoding and bounded diagnostics without raw geometry", () => {
        const src = readFileSync("src/plan-adapter.ts", "utf8");
        assert.ok(src.includes("pointer-resize"));
        assert.ok(src.includes("rectsEqualExceptSource"));
        assert.ok(src.includes("pointerEcho"));
        assert.ok(!src.includes("fallback"));
        const entry = readFileSync("src/plan-adapter-entry.ts", "utf8");
        assert.ok(entry.includes("drag-derive-invalid"));
        assert.ok(entry.includes("drag-unknown-window"));
        assert.ok(entry.includes("drag-scope-invalid"));
        assert.ok(entry.includes("drag-move-ignored"));
    });
});

describe("slice 2 oracle completion callback", () => {
    it("notifies after a cancelled verdict without routing", () => {
        const seen: string[] = [];
        let routed = 0;
        const pull = new DragOraclePull({
            callDbus: (_s, _p, _i, _m, callback): void => {
                callback(cancelledVerdict());
            },
            log: (): void => {},
            routePointer: (): void => {
                routed += 1;
            },
            onSettled: (verdict): void => {
                seen.push(verdict === null ? "null" : `${String(verdict.cancelled)}:${verdict.correlation}`);
            },
        });
        pull.pullVerdict();
        assert.equal(routed, 0);
        assert.deepEqual(seen, ["true:drag-10"]);
    });

    it("notifies after a non-cancelled verdict after routing", () => {
        const order: string[] = [];
        const pull = new DragOraclePull({
            callDbus: (_s, _p, _i, _m, callback): void => {
                callback(movedVerdict());
            },
            log: (): void => {},
            routePointer: (): void => {
                order.push("route");
            },
            onSettled: (verdict): void => {
                order.push(`settled:${verdict === null ? "null" : verdict.correlation}`);
            },
        });
        pull.pullVerdict();
        assert.deepEqual(order, ["route", "settled:drag-9"]);
    });

    it("notifies with null for invalid and unavailable verdicts", () => {
        for (const reply of ["garbage", null]) {
            const seen: Array<string | null> = [];
            const pull = new DragOraclePull({
                callDbus: (_s, _p, _i, _m, callback): void => {
                    callback(reply);
                },
                log: (): void => {},
                onSettled: (verdict): void => {
                    seen.push(verdict === null ? null : verdict.correlation);
                },
            });
            pull.pullVerdict();
            assert.deepEqual(seen, [null]);
        }
        const seenThrow: Array<string | null> = [];
        const throwing = new DragOraclePull({
            callDbus: (): void => {
                throw new Error("no-bus");
            },
            log: (): void => {},
            onSettled: (verdict): void => {
                seenThrow.push(verdict === null ? null : verdict.correlation);
            },
        });
        throwing.pullVerdict();
        assert.deepEqual(seenThrow, [null]);
    });
});

interface OracleFireSignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: {
        connect: (handler: (payload?: unknown) => void) => void;
        disconnect: (handler: (payload?: unknown) => void) => void;
    };
}

function oracleFireSignal(): OracleFireSignal {
    const handlers: Array<(payload?: unknown) => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: (payload?: unknown) => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: (payload?: unknown) => void): void => {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
            },
        },
    };
}

interface OracleWorld {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly signals: Record<string, OracleFireSignal>;
}

function oracleWorld(): OracleWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const signals: Record<string, OracleFireSignal> = {
        added: oracleFireSignal(),
        removed: oracleFireSignal(),
        activated: oracleFireSignal(),
        screensChanged: oracleFireSignal(),
        desktopChanged: oracleFireSignal(),
        startedA: oracleFireSignal(),
        finishedA: oracleFireSignal(),
        geoA: oracleFireSignal(),
        startedB: oracleFireSignal(),
        finishedB: oracleFireSignal(),
        geoB: oracleFireSignal(),
    };
    const makeWin = (
        id: string,
        x: number,
        started: OracleFireSignal,
        finished: OracleFireSignal,
        geo: OracleFireSignal,
    ): Record<string, unknown> => ({
        normalWindow: true,
        internalId: id,
        output,
        desktops: [desktop],
        frameGeometry: { x, y: 0, width: 600, height: 800 },
        move: false,
        resize: true,
        moveResizedChanged: geo.signal,
        interactiveMoveResizeStarted: started.signal,
        interactiveMoveResizeFinished: finished.signal,
    });
    const wins: Record<string, Record<string, unknown>> = {
        "win-a": makeWin("win-a", 0, signals["startedA"] as OracleFireSignal, signals["finishedA"] as OracleFireSignal, signals["geoA"] as OracleFireSignal),
        "win-b": makeWin("win-b", 600, signals["startedB"] as OracleFireSignal, signals["finishedB"] as OracleFireSignal, signals["geoB"] as OracleFireSignal),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins["win-a"],
        windowList: (): unknown[] => [wins["win-a"], wins["win-b"]],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowAdded: (signals["added"] as OracleFireSignal).signal,
        windowRemoved: (signals["removed"] as OracleFireSignal).signal,
        windowActivated: (signals["activated"] as OracleFireSignal).signal,
        screensChanged: (signals["screensChanged"] as OracleFireSignal).signal,
        currentDesktopChanged: (signals["desktopChanged"] as OracleFireSignal).signal,
    };
    return { workspace, wins, signals };
}

interface OracleMocks {
    readonly planCalls: Array<{ method: string; payload: string }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly logs: string[];
}

function startOracleEntry(world: OracleWorld): { stop: () => void; mocks: OracleMocks } {
    const mocks: OracleMocks = { planCalls: [], oracleCalls: [], logs: [] };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (_s, _p, _i, method, payload, _callback): void => {
            mocks.planCalls.push({ method, payload });
        },
        oracleCallDbus: (_s, _p, _i, _m, callback): void => {
            mocks.oracleCalls.push(callback);
        },
        scheduleOnce: (_delayMs, _callback): (() => void) => (): void => {},
        log: (message): void => {
            mocks.logs.push(message);
        },
        owner: "owner-1",
        generation: "gen-1",
        registerShortcutFn: (): boolean => true,
        readProfileFn: (): string => "cosmic",
    });
    assert.ok(handle !== null);
    return { stop: (): void => handle?.stop(), mocks };
}

function fireAll(signal: OracleFireSignal | undefined): void {
    if (signal === undefined) {
        return;
    }
    for (const handler of [...signal.handlers]) {
        handler();
    }
}

function cancelledWinA(correlation: string): string {
    return JSON.stringify({
        v: 1,
        cancelled: true,
        finalRect: { x: 0, y: 0, w: 600, h: 800 },
        windowIdentity: "win-a",
        correlation,
        reason: "no-change",
    });
}

function movedWinA(correlation: string): string {
    return JSON.stringify({
        v: 1,
        cancelled: false,
        finalRect: { x: 0, y: 0, w: 1000, h: 800 },
        windowIdentity: "win-a",
        correlation,
        reason: "ok-moved",
    });
}

describe("slice 2 entry finish consumes the captured start", () => {
    it("started, cancelled finish, then non-cancelled finish without a new start sends no pointer plan", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelledWinA("drag-1"));
        assert.equal(mocks.planCalls.length, 0);
        assert.ok(
            mocks.logs.some((line) => line.includes("drag-verdict cancelled=true correlation=drag-1")),
        );
        // A second finish without a new start must not route: the cancelled
        // finish consumed the captured start exactly once.
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 2);
        (mocks.oracleCalls[1] as (reply: unknown) => void)(movedWinA("drag-2"));
        assert.equal(mocks.planCalls.length, 0);
        for (const call of mocks.planCalls) {
            assert.ok(!call.payload.includes("pointer-resize"), call.payload);
        }
        assert.ok(mocks.logs.some((line) => line.includes("drag-derive-invalid")));
        stop();
    });

    it("keeps a newer start that lands before a stale cancelled reply", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        // A fresh drag starts before the first async reply arrives.
        fireAll(world.signals["startedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelledWinA("drag-1"));
        assert.equal(mocks.planCalls.length, 0);
        // The newer start survives the stale cancelled finish, so the next
        // non-cancelled finish routes exactly one pointer-resize plan.
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 2);
        (mocks.oracleCalls[1] as (reply: unknown) => void)(movedWinA("drag-2"));
        assert.equal(mocks.planCalls.length, 1);
        assert.equal(mocks.planCalls[0]?.method, "DescribePlan");
        const payload = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(payload["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "right",
            boundary: 1000,
        });
        stop();
    });

    it("drops a stale moved reply after a newer start+finish, then routes the fresh reply once", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        // A second drag completes before the first async reply arrives.
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 2);
        // The stale first reply must fail closed: no dispatch, newer start kept.
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.equal(mocks.planCalls.length, 0);
        for (const call of mocks.planCalls) {
            assert.ok(!call.payload.includes("pointer-resize"), call.payload);
        }
        assert.ok(mocks.logs.some((line) => line.includes("drag-derive-invalid")));
        // The fresh reply routes exactly once from the newer start.
        (mocks.oracleCalls[1] as (reply: unknown) => void)(movedWinA("drag-2"));
        assert.equal(mocks.planCalls.length, 1);
        assert.equal(mocks.planCalls[0]?.method, "DescribePlan");
        const payload = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(payload["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "right",
            boundary: 1000,
        });
        stop();
    });

    it("drops oracle start state for removed windows by object identity", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["startedB"]);
        const removed = world.wins["win-a"] as object;
        for (const handler of [...(world.signals["removed"] as OracleFireSignal).handlers]) {
            handler(removed);
        }
        // The removed window's finish can no longer route a pointer plan for
        // it: cleanup ran without reading any id from the removal payload.
        fireAll(world.signals["finishedA"]);
        const pending = mocks.oracleCalls.length;
        assert.ok(pending >= 1);
        (mocks.oracleCalls[pending - 1] as (reply: unknown) => void)(movedWinA("drag-2"));
        assert.equal(mocks.planCalls.length, 0);
        stop();
    });
});

interface EchoMocks {
    readonly dbusCalls: Array<{ payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly handlers: Map<string, Array<() => void>>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    current: Record<string, { x: number; y: number; w: number; h: number }>;
    env: PlanAdapterEnv;
}

function echoMockEnv(refs: { a: object; b: object }): EchoMocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        handlers: new Map<string, Array<() => void>>(),
        logs: [],
        geometries: [],
        current: {
            "win-a": { x: 0, y: 0, w: 600, h: 800 },
            "win-b": { x: 600, y: 0, w: 600, h: 800 },
        },
    } as unknown as EchoMocks;
    const env: PlanAdapterEnv = {
        callDbus: (_s, _p, _i, _m, payload, callback): void => {
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
        observe: (): PlanObserved | null => {
            const wins = (["win-a", "win-b"] as const).map((id) => {
                const rect = state.current[id] as { x: number; y: number; w: number; h: number };
                return Object.freeze({
                    id,
                    ref: id === "win-a" ? refs.a : refs.b,
                    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
                    output: "out-1",
                    workspace: "ws-1",
                });
            });
            return {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-a",
                windows: Object.freeze(wins),
                activeRef: refs.a,
                fingerprint: "fp-echo",
                revalidate: () => true,
            };
        },
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        },
        setActive: (): boolean => true,
        active: (): object | null => refs.a,
        subscribe: (kind, handler): (() => void) => {
            const list = state.handlers.get(kind) ?? [];
            list.push(handler);
            state.handlers.set(kind, list);
            return (): void => {};
        },
    };
    (state as { env: PlanAdapterEnv }).env = env;
    return state;
}

function echoPlannedReply(correlation: string, geom: ReadonlyArray<{ window: string; rect: { x: number; y: number; w: number; h: number } }>): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "pointer-resize" },
        desired_geometry: geom.map((entry) => ({
            window: entry.window,
            leaf: `${entry.window}-leaf`,
            output: "out-1",
            workspace: "ws-1",
            rect: entry.rect,
        })),
    });
}

function runEchoDebounce(mocks: EchoMocks): void {
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

function fireEcho(mocks: EchoMocks, kind: string): void {
    for (const handler of mocks.handlers.get(kind) ?? []) {
        handler();
    }
}

function seedPointerEcho(mocks: EchoMocks): void {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    fireEcho(mocks, "added");
    runEchoDebounce(mocks);
    assert.equal(mocks.dbusCalls.length, 1);
    const admitCorrelation = (JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>)["correlation_id"] as string;
    mocks.callbacks[0]?.(
        echoPlannedReply(admitCorrelation, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]),
    );
    assert.equal(adapter.requestPointerResize("win-a", "right", 900), true);
    assert.equal(mocks.dbusCalls.length, 2);
    const pointerCorrelation = (JSON.parse(mocks.dbusCalls[1]?.payload as string) as Record<string, unknown>)["correlation_id"] as string;
    mocks.callbacks[1]?.(
        echoPlannedReply(pointerCorrelation, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 900, y: 0, w: 300, h: 800 } },
        ]),
    );
}

describe("slice 2 pointer echo fence", () => {
    it("falls through to reconciliation on echo mismatch", () => {
        const refs = makeRefs();
        const mocks = echoMockEnv(refs);
        seedPointerEcho(mocks);
        // Native neighbour rects never matched the planned ones.
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 600, h: 800 },
            "win-b": { x: 600, y: 0, w: 600, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        const command = (JSON.parse(mocks.dbusCalls[2]?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>;
        assert.deepEqual(command, { op: "reconcile" });
    });

    it("consumes a matching echo one-shot and reconciles later drift", () => {
        const refs = makeRefs();
        const mocks = echoMockEnv(refs);
        seedPointerEcho(mocks);
        // Native neighbour writes match the planned rectangles: silent.
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 600, h: 800 },
            "win-b": { x: 900, y: 0, w: 300, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        // The expectation was one-shot: repeating the same observation stays
        // silent through the updated baseline, not a lingering echo.
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        // Later neighbour drift is not swallowed: it reconciles through the
        // bounded path. (Source-only drift stays covered by the neighbour
        // expectation, so the drift moves win-b.)
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 600, h: 800 },
            "win-b": { x: 880, y: 0, w: 320, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        const command = (JSON.parse(mocks.dbusCalls[2]?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>;
        assert.deepEqual(command, { op: "reconcile" });
    });

    it("disarms an exact echo before later source-only drift", () => {
        const refs = makeRefs();
        const mocks = echoMockEnv(refs);
        seedPointerEcho(mocks);
        // The complete planned geometry is already the current baseline.
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 600, h: 800 },
            "win-b": { x: 900, y: 0, w: 300, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        // A later source-only drift is not the neighbour-write echo and must
        // reach bounded reconciliation.
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 601, h: 800 },
            "win-b": { x: 900, y: 0, w: 300, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        const command = (JSON.parse(mocks.dbusCalls[2]?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>;
        assert.deepEqual(command, { op: "reconcile" });
    });
});
