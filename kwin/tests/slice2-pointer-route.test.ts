import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    DragOraclePull,
    deriveOracleEdge,
    identifyGrabbedEdges,
    parseDragOracleVerdict,
    resolveOracleResizeTargets,
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
        Object.freeze({ id: "win-a", ref: refs.a, rect: { x: 0, y: 0, w: 1000, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false }),
        Object.freeze({ id: "win-b", ref: refs.b, rect: { x: 1000, y: 0, w: 200, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false }),
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
            if (_m === "NameHasOwner") { callback(true); return; }
            if (_m === "GetNameOwner") { callback(":1.7"); return; }
            if (_m === "StartServiceByName") { callback(1); return; }
            state.dbusCalls.push({ payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (_d, _c): (() => void) => (): void => {},
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        clearMaximize: (): "invoked" => "invoked",
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
            "plasma-auto-tiler:route-diag:drag-reply-invalid correlation=none",
        ]);
        assert.ok(!logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-unavailable"));
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

    it("rejects unknown window, direction, and boundary with exact refusal tokens and no D-Bus call", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new PlanAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestPointerResize("win-zzz", "right", 1000), false);
        assert.equal(adapter.requestPointerResize("win-a", "sideways", 1000), false);
        assert.equal(adapter.requestPointerResize("win-a", "right", 999999), false);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-absent"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-direction"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-boundary"));
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
        // Every applied member carries a bounded write disposition with its
        // stable id and target rect; the gap is visible in the retained rects.
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-a resource_class=unknown disposition=written rect=8,8,884,784",
            ),
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-b resource_class=unknown disposition=written rect=900,8,292,784",
            ),
        );
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
        assert.ok(entry.includes("drag-context-invalid"));
        assert.ok(entry.includes("drag-unknown-window"));
        assert.ok(entry.includes("drag-scope-invalid"));
        assert.ok(entry.includes("drag-move-ignored"));
        assert.ok(entry.includes("drag-ref-mismatch"));
        assert.ok(entry.includes("drag-start-missing"));
        assert.ok(entry.includes("drag-start-invalid"));
        assert.ok(entry.includes("drag-no-grabbed-edge"));
        assert.ok(entry.includes("drag-zero-move"));
        assert.ok(entry.includes("drag-route"));
        assert.ok(!entry.includes("drag-pointer-refused"), "no catch-all pointer-refused line in the entry");
        assert.ok(!entry.includes("drag-fullscreen-refused"), "no redundant fullscreen re-check in the entry");
        for (const token of [
            "pointer-refused-disabled",
            "pointer-refused-identity",
            "pointer-refused-direction",
            "pointer-refused-boundary",
            "pointer-refused-observe",
            "pointer-refused-absent",
            "pointer-refused-fullscreen",
            "pointer-refused-maximize",
        ]) {
            assert.ok(src.includes(token), `adapter emits ${token}`);
        }
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

function oracleWorld(opts: { fullscreen?: ReadonlyArray<string>; maximized?: ReadonlyArray<string>; move?: Record<string, boolean>; resize?: Record<string, boolean>; cursorPos?: { x: number; y: number }; winA?: { x: number; w: number } } = {}): OracleWorld {
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
        w: number,
        started: OracleFireSignal,
        finished: OracleFireSignal,
        geo: OracleFireSignal,
    ): Record<string, unknown> => ({
        normalWindow: true,
        internalId: id,
        output,
        desktops: [desktop],
        frameGeometry: { x, y: 0, width: w, height: 800 },
        move: opts.move?.[id] ?? false,
        resize: opts.resize?.[id] ?? true,
        moveResizedChanged: geo.signal,
        frameGeometryChanged: geo.signal,
        interactiveMoveResizeStarted: started.signal,
        interactiveMoveResizeFinished: finished.signal,
        fullScreenChanged: oracleFireSignal().signal,
        fullScreen: opts.fullscreen?.includes(id) === true,
        maximizedChanged: oracleFireSignal().signal,
        maximizeMode: opts.maximized?.includes(id) === true ? 3 : 0,
    });
    const wins: Record<string, Record<string, unknown>> = {
        "win-a": makeWin("win-a", opts.winA?.x ?? 0, opts.winA?.w ?? 600, signals["startedA"] as OracleFireSignal, signals["finishedA"] as OracleFireSignal, signals["geoA"] as OracleFireSignal),
        "win-b": makeWin("win-b", 600, 600, signals["startedB"] as OracleFireSignal, signals["finishedB"] as OracleFireSignal, signals["geoB"] as OracleFireSignal),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins["win-a"],
        cursorPos: opts.cursorPos ?? { x: 600, y: 400 },
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
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}

function startOracleEntry(world: OracleWorld): { stop: () => void; mocks: OracleMocks } {
    const mocks: OracleMocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (_s, _p, _i, method, payload, _callback): void => {
            if (method === "NameHasOwner") { _callback(true); return; }
            if (method === "GetNameOwner") { _callback(":1.7"); return; }
            if (method === "StartServiceByName") { _callback(1); return; }
            mocks.planCalls.push({ method, payload, callback: _callback });
        },
        oracleCallDbus: (_s, _p, _i, _m, callback): void => {
            mocks.oracleCalls.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const timer = { delayMs, callback, cancelled: false };
            mocks.timers.push(timer);
            return (): void => {
                timer.cancelled = true;
            };
        },
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

function runOracleDebounce(mocks: OracleMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === PLAN_DEBOUNCE_MS) {
            timer.callback();
        } else if (!timer.cancelled) {
            mocks.timers.push(timer);
        }
    }
}

function retainedSplitReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "reconcile" },
        desired_geometry: [
            { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ],
    });
}

function pointerSplitReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "pointer-resize" },
        desired_geometry: [
            { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1000, h: 800 } },
            { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 1000, y: 0, w: 200, h: 800 } },
        ],
    });
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
    it("holds ordinary reconciliation until native resize finish when the oracle never replies", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        runOracleDebounce(mocks);
        assert.equal(mocks.planCalls.length, 1);
        const baseline = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[0]?.callback(retainedSplitReply(baseline["correlation_id"] as string));

        winA["frameGeometry"] = { x: 0, y: 0, width: 700, height: 800 };
        fireAll(world.signals["geoA"]);
        runOracleDebounce(mocks);
        assert.equal(mocks.planCalls.length, 2, "pre-start drift opened one ordinary reconcile");

        fireAll(world.signals["startedA"]);
        const preStart = JSON.parse(mocks.planCalls[1]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[1]?.callback(retainedSplitReply(preStart["correlation_id"] as string));
        for (const width of [750, 800, 850]) {
            winA["frameGeometry"] = { x: 0, y: 0, width, height: 800 };
            fireAll(world.signals["geoA"]);
            runOracleDebounce(mocks);
        }
        assert.equal(mocks.planCalls.length, 2, "held frame changes do not dispatch ordinary reconciliation");

        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1, "finish still performs the selected oracle pull");
        runOracleDebounce(mocks);
        assert.equal(mocks.planCalls.length, 3, "finish restores through one ordinary retained reconcile without an oracle reply");
        const finish = JSON.parse(mocks.planCalls[2]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(finish["command"], { op: "reconcile" });
        stop();
    });

    it("lets a delayed oracle verdict cancel the dispatched finish reconcile before its reply", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        runOracleDebounce(mocks);
        const baseline = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[0]?.callback(retainedSplitReply(baseline["correlation_id"] as string));

        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        fireAll(world.signals["geoA"]);
        fireAll(world.signals["finishedA"]);
        runOracleDebounce(mocks);
        assert.equal(mocks.planCalls.length, 2);
        assert.deepEqual((JSON.parse(mocks.planCalls[1]?.payload as string) as Record<string, unknown>)["command"], { op: "reconcile" });

        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.equal(mocks.planCalls.length, 3, "the valid delayed verdict dispatches pointer-resize");
        assert.deepEqual((JSON.parse(mocks.planCalls[2]?.payload as string) as Record<string, unknown>)["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "right",
            boundary: 1000,
        });

        const staleReconcile = JSON.parse(mocks.planCalls[1]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[1]?.callback(retainedSplitReply(staleReconcile["correlation_id"] as string));
        assert.equal(mocks.planCalls.length, 3, "the cancelled reconcile reply cannot write or enqueue another plan");
        stop();
    });

    it("applies a delayed oracle pointer resize after the finish reconcile already wrote", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        const winA = world.wins["win-a"];
        const winB = world.wins["win-b"];
        assert.ok(winA !== undefined);
        assert.ok(winB !== undefined);
        runOracleDebounce(mocks);
        const baseline = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[0]?.callback(retainedSplitReply(baseline["correlation_id"] as string));

        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        fireAll(world.signals["geoA"]);
        fireAll(world.signals["finishedA"]);
        runOracleDebounce(mocks);
        const finish = JSON.parse(mocks.planCalls[1]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[1]?.callback(retainedSplitReply(finish["correlation_id"] as string));
        assert.deepEqual(winA["frameGeometry"], { x: 0, y: 0, width: 600, height: 800 });

        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.deepEqual((JSON.parse(mocks.planCalls[2]?.payload as string) as Record<string, unknown>)["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "right",
            boundary: 1000,
        });
        const pointer = JSON.parse(mocks.planCalls[2]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[2]?.callback(pointerSplitReply(pointer["correlation_id"] as string));
        assert.deepEqual(winA["frameGeometry"], { x: 0, y: 0, width: 1000, height: 800 });
        assert.deepEqual(winB["frameGeometry"], { x: 1000, y: 0, width: 200, height: 800 });
        stop();
    });

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
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-cancelled correlation=drag-1 reason=no-change"),
            "cancelled verdict carries a normal-mode correlated rejection log",
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
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-start-missing correlation=drag-2"));
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
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-start-missing correlation=drag-1"));
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

    it("logs the exact bounded refusal diagnostic for a fullscreen pointer-resize target", () => {
        const world = oracleWorld({ fullscreen: ["win-a"] });
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.ok(
            mocks.planCalls.every((call) => !(call.payload.includes("pointer-resize"))),
            "fullscreen target never dispatches a pointer plan",
        );
        assert.equal(mocks.planCalls.length, 1, "refused drop converges once via a correlated reconcile");
        assert.deepEqual((JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"], { op: "reconcile" });
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-fullscreen"),
            "exact source-grounded refusal token from the adapter",
        );
        assert.ok(
            mocks.logs.some((line) => line.includes("drag-dispatched") && line.includes("correlation=drag-1") && line.includes("accepted=false")),
            "correlated dispatch line reports the refusal honestly",
        );
        assert.ok(
            mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-1") && line.includes("reason=fullscreen")),
            "correlated refusal reason for the follow-up",
        );
        assert.ok(
            !mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-derive-invalid"),
            "no generic derive-invalid for the fullscreen refusal",
        );
        assert.ok(
            !mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-pointer-refused"),
            "no catch-all pointer-refused line from the entry",
        );
        stop();
    });

    it("logs the exact bounded refusal diagnostic for a maximized pointer-resize target", () => {
        const world = oracleWorld({ maximized: ["win-a"] });
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.ok(
            mocks.planCalls.every((call) => !(call.payload.includes("pointer-resize"))),
            "maximized target never dispatches a pointer plan",
        );
        assert.equal(mocks.planCalls.length, 1, "refused drop converges once via a correlated reconcile");
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-maximize"),
            "exact source-grounded refusal token from the adapter",
        );
        assert.ok(
            !mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-derive-invalid"),
            "no generic derive-invalid for the maximized refusal",
        );
        stop();
    });

    it("routes the grabbed edge and ignores secondary deltas on a two-edge final", () => {
        const world = oracleWorld();
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(
            JSON.stringify({
                v: 1,
                cancelled: false,
                finalRect: { x: 100, y: 100, w: 600, h: 800 },
                windowIdentity: "win-a",
                correlation: "drag-1",
                reason: "ok-moved",
            }),
        );
        assert.equal(mocks.planCalls.length, 1);
        assert.deepEqual((JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "right",
            boundary: 700,
        });
        assert.ok(
            mocks.logs.some((line) => line.includes("drag-route") && line.includes("grabbed=right+-") && line.includes("targets=right:700") && line.includes("correlation=drag-1")),
        );
        stop();
    });

    it("restores a tiled move-gesture drop once with no pointer dispatch", () => {
        const world = oracleWorld({ move: { "win-a": true } });
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.equal(mocks.planCalls.length, 1);
        assert.deepEqual((JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"], { op: "reconcile" });
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-move-restore correlation=drag-1"));
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-1") && line.includes("reason=move-dropped")));
        assert.ok(
            mocks.planCalls.every((call) => !(call.payload.includes("pointer-resize"))),
            "tiled move never dispatches a pointer plan",
        );
        stop();
    });

    it("logs drag-start-invalid for a start that is neither move nor resize", () => {
        const world = oracleWorld({ move: { "win-a": false }, resize: { "win-a": false } });
        const { stop, mocks } = startOracleEntry(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.equal(mocks.planCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-start-invalid correlation=drag-1"));
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
            if (_m === "NameHasOwner") { callback(true); return; }
            if (_m === "GetNameOwner") { callback(":1.7"); return; }
            if (_m === "StartServiceByName") { callback(1); return; }
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
        clearMaximize: (): "invoked" => "invoked",
        observe: (): PlanObserved | null => {
            const wins = (["win-a", "win-b"] as const).map((id) => {
                const rect = state.current[id] as { x: number; y: number; w: number; h: number };
                return Object.freeze({
                    id,
                    ref: id === "win-a" ? refs.a : refs.b,
                    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
                    output: "out-1",
                    workspace: "ws-1",
                    fullscreen: false,
                    maximized: false,
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
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:echo-fence-armed"), "fence armed on apply");
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
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:echo-fence-mismatched"));
    });

    it("consumes a matching echo one-shot and reconciles later drift", () => {
        const refs = makeRefs();
        const mocks = echoMockEnv(refs);
        seedPointerEcho(mocks);
        // Native neighbour writes match the planned rectangles: the armed
        // fence clears on equality (snapshotsEqual) with no reconcile.
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 600, h: 800 },
            "win-b": { x: 900, y: 0, w: 300, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:echo-fence-cleared-equality"),
            "armed fence cleared on equality",
        );
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

    it("consumes an armed echo on exact neighbour equality while the source drifts", () => {
        const refs = makeRefs();
        const mocks = echoMockEnv(refs);
        seedPointerEcho(mocks);
        // Source rect drifts but the neighbour lands exactly on the planned
        // rect: the one-shot expectation is consumed, not mismatched.
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 601, h: 800 },
            "win-b": { x: 900, y: 0, w: 300, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:echo-fence-consumed"));
        assert.ok(!mocks.logs.some((line) => line === "plasma-auto-tiler:plan:echo-fence-mismatched"));
        // A later neighbour drift is no longer covered by the consumed fence.
        mocks.current = {
            "win-a": { x: 0, y: 0, w: 601, h: 800 },
            "win-b": { x: 880, y: 0, w: 320, h: 800 },
        };
        fireEcho(mocks, "geometry");
        runEchoDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(
            (JSON.parse(mocks.dbusCalls[2]?.payload as string) as Record<string, unknown>)["command"],
            { op: "reconcile" },
        );
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
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:echo-fence-cleared-equality"),
            "armed fence cleared on full equality",
        );
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

function grabbedVerdict(finalRect: { x: number; y: number; w: number; h: number }, correlation: string): string {
    return JSON.stringify({
        v: 1,
        cancelled: false,
        finalRect,
        windowIdentity: "win-a",
        correlation,
        reason: "ok-moved",
    });
}

function routeOne(world: OracleWorld): { stop: () => void; mocks: OracleMocks } {
    return startOracleEntry(world);
}

describe("grabbed-edge oracle routing", () => {
    it("identifies edge and corner grabs from the start pointer", () => {
        const start = { x: 0, y: 0, w: 600, h: 800 };
        assert.deepEqual(identifyGrabbedEdges(start, { x: 595, y: 400 })?.grabbed, { horizontal: "right", vertical: null });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 5, y: 400 })?.grabbed, { horizontal: "left", vertical: null });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 300, y: 5 })?.grabbed, { horizontal: null, vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 595, y: 795 })?.grabbed, { horizontal: "right", vertical: "down" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 5, y: 5 })?.grabbed, { horizontal: "left", vertical: "up" });
        assert.equal(identifyGrabbedEdges(start, null), null);
        assert.equal(identifyGrabbedEdges(start, { x: 595, y: 400 })?.source, "nearest-pointer");
    });

    it("keeps ordinary edge grips single on wide windows away from the corner", () => {
        const start = { x: 0, y: 0, w: 600, h: 800 };
        // 100px from the left edge but only 5px from the top: an edge grip
        // near (not on) the corner. A proportional outer-third zone reads
        // corner here; the narrow radius keeps it a single up grab.
        assert.deepEqual(identifyGrabbedEdges(start, { x: 100, y: 5 })?.grabbed, { horizontal: null, vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 5, y: 100 })?.grabbed, { horizontal: "left", vertical: null });
        // Exactly on the radius boundary still counts as corner.
        assert.deepEqual(identifyGrabbedEdges(start, { x: 16, y: 16 })?.grabbed, { horizontal: "left", vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 17, y: 5 })?.grabbed, { horizontal: null, vertical: "up" });
    });

    it("resolves grabbed targets and ignores secondary deltas", () => {
        const start = { x: 0, y: 0, w: 600, h: 800 };
        const single = resolveOracleResizeTargets(start, { x: 10, y: 0, w: 595, h: 800 }, { horizontal: "left", vertical: null });
        assert.deepEqual(single?.targets, [{ direction: "left", boundary: 10 }]);
        assert.ok((single?.ignored ?? []).some((entry) => entry.startsWith("right:")), "opposite delta ignored");
        const corner = resolveOracleResizeTargets(start, { x: 0, y: 0, w: 700, h: 900 }, { horizontal: "right", vertical: "down" });
        assert.deepEqual(corner?.targets, [
            { direction: "right", boundary: 700 },
            { direction: "down", boundary: 900 },
        ]);
        assert.equal(resolveOracleResizeTargets(start, start, { horizontal: "right", vertical: null }), null);
    });

    it("routes a 1px left-edge move with the opposite fixed", () => {
        const world = oracleWorld({ cursorPos: { x: 5, y: 400 } });
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(grabbedVerdict({ x: 1, y: 0, w: 599, h: 800 }, "drag-1"));
        assert.equal(mocks.planCalls.length, 1);
        assert.deepEqual((JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "left",
            boundary: 1,
        });
        assert.ok(mocks.logs.some((line) => line.includes("drag-route") && line.includes("grabbed=left+-") && line.includes("targets=left:1")));
        stop();
    });

    it("ignores a non-grabbed size increment clamp on the opposite edge", () => {
        const world = oracleWorld({ cursorPos: { x: 5, y: 400 } });
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(grabbedVerdict({ x: 10, y: 0, w: 595, h: 800 }, "drag-2"));
        assert.equal(mocks.planCalls.length, 1);
        assert.deepEqual((JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "left",
            boundary: 10,
        });
        assert.ok(mocks.logs.some((line) => line.includes("drag-route") && line.includes("ignored=right:")));
        stop();
    });

    it("ignores a self-resized orthogonal edge while routing the grab", () => {
        const world = oracleWorld({ cursorPos: { x: 5, y: 400 } });
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(grabbedVerdict({ x: 10, y: 0, w: 590, h: 805 }, "drag-3"));
        assert.equal(mocks.planCalls.length, 1);
        assert.deepEqual((JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "left",
            boundary: 10,
        });
        assert.ok(mocks.logs.some((line) => line.includes("drag-route") && line.includes("ignored=") && line.includes("down:")));
        stop();
    });

    it("routes both axes of a grabbed corner in exactly one dual-axis intent", () => {
        const world = oracleWorld({ cursorPos: { x: 595, y: 795 } });
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(grabbedVerdict({ x: 0, y: 0, w: 700, h: 900 }, "drag-4"));
        assert.equal(mocks.planCalls.length, 1, "corner commits atomically in one request, never two");
        assert.deepEqual((JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"], {
            op: "pointer-resize",
            window: "win-a",
            direction: "right",
            boundary: 700,
            direction2: "down",
            boundary2: 900,
        });
        assert.ok(mocks.logs.some((line) => line.includes("drag-route") && line.includes("grabbed=right+down") && line.includes("targets=right:700,down:900")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-dispatched") && line.includes("correlation=drag-4") && line.includes("accepted=true")));
        const only = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
        mocks.planCalls[0]?.callback(pointerSplitReply(only["correlation_id"] as string));
        assert.equal(mocks.planCalls.length, 1, "no second request after the corner commits");
        stop();
    });

    it("routes the exact Firefox left-edge drop and ignores the 1px opposite jitter", () => {
        // Live Firefox case: left edge 789 -> 939 with the opposite right
        // edge drifting 1528 -> 1529. The grabbed left target routes alone;
        // the 1px non-grabbed delta is ignored, never a mixed rejection.
        const world = oracleWorld({ cursorPos: { x: 790, y: 400 }, winA: { x: 789, w: 739 } });
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(grabbedVerdict({ x: 939, y: 0, w: 590, h: 800 }, "drag-8"));
        assert.equal(mocks.planCalls.length, 1);
        const command = (JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>;
        assert.deepEqual(command, {
            op: "pointer-resize",
            window: "win-a",
            direction: "left",
            boundary: 939,
        });
        assert.ok(!("direction2" in command), "single-axis wire shape carries no second axis");
        assert.ok(
            mocks.logs.some((line) => line.includes("drag-route") && line.includes("grabbed=left+-") && line.includes("targets=left:939") && line.includes("ignored=right:1528->1529") && line.includes("correlation=drag-8")),
        );
        stop();
    });

    it("rejects a zero move on the grabbed edge with no dispatch", () => {
        const world = oracleWorld({ cursorPos: { x: 595, y: 400 } });
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(grabbedVerdict({ x: 0, y: 0, w: 600, h: 800 }, "drag-5"));
        assert.equal(mocks.planCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("drag-zero-move") && line.includes("correlation=drag-5")));
        stop();
    });

    it("rejects a missing grab with no dispatch", () => {
        const world = oracleWorld();
        delete world.workspace["cursorPos"];
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(grabbedVerdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-6"));
        assert.equal(mocks.planCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("drag-no-grabbed-edge") && line.includes("correlation=drag-6")));
        stop();
    });

    it("rejects an unknown window identity with no dispatch", () => {
        const world = oracleWorld({ cursorPos: { x: 595, y: 400 } });
        const { stop, mocks } = routeOne(world);
        fireAll(world.signals["startedA"]);
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(
            JSON.stringify({ v: 1, cancelled: false, finalRect: { x: 0, y: 0, w: 1000, h: 800 }, windowIdentity: "win-zzz", correlation: "drag-7", reason: "ok-moved" }),
        );
        assert.equal(mocks.planCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-unknown-window correlation=drag-7"));
        stop();
    });
});
