import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";
import {
    DRAG_MEASURE_LATER_TIMEOUT_MS,
    DRAG_MEASURE_VERDICT_TIMEOUT_MS,
    describeMeasureEdge,
    formatDragMeasureLine,
    readMeasurePointer,
    readMeasureRect,
} from "../src/drag-measure";

interface FireSignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: {
        connect: (handler: (payload?: unknown) => void) => void;
        disconnect: (handler: (payload?: unknown) => void) => void;
    };
}

function fireSignal(): FireSignal {
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

interface MeasureWorld {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly signals: Record<string, FireSignal>;
    readonly desktop: Record<string, unknown>;
}

function measureWorld(): MeasureWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const signals: Record<string, FireSignal> = {
        added: fireSignal(),
        removed: fireSignal(),
        activated: fireSignal(),
        screensChanged: fireSignal(),
        desktopChanged: fireSignal(),
        startedA: fireSignal(),
        finishedA: fireSignal(),
        geoA: fireSignal(),
        startedB: fireSignal(),
        finishedB: fireSignal(),
        geoB: fireSignal(),
    };
    const makeWin = (
        id: string,
        x: number,
        started: FireSignal,
        finished: FireSignal,
        geo: FireSignal,
    ): Record<string, unknown> => ({
        normalWindow: true,
        internalId: id,
        caption: `${id} title must never be logged`,
        output,
        desktops: [desktop],
        frameGeometry: { x, y: 0, width: 600, height: 800 },
        move: false,
        resize: true,
        moveResizedChanged: geo.signal,
        frameGeometryChanged: geo.signal,
        interactiveMoveResizeStarted: started.signal,
        interactiveMoveResizeFinished: finished.signal,
        fullScreenChanged: fireSignal().signal,
        fullScreen: false,
        maximizedChanged: fireSignal().signal,
        maximizeMode: 0,
    });
    const wins: Record<string, Record<string, unknown>> = {
        "win-a": makeWin("win-a", 0, signals["startedA"] as FireSignal, signals["finishedA"] as FireSignal, signals["geoA"] as FireSignal),
        "win-b": makeWin("win-b", 600, signals["startedB"] as FireSignal, signals["finishedB"] as FireSignal, signals["geoB"] as FireSignal),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins["win-a"],
        cursorPos: { x: 10, y: 10 },
        windowList: (): unknown[] => [wins["win-a"], wins["win-b"]],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowAdded: (signals["added"] as FireSignal).signal,
        windowRemoved: (signals["removed"] as FireSignal).signal,
        windowActivated: (signals["activated"] as FireSignal).signal,
        screensChanged: (signals["screensChanged"] as FireSignal).signal,
        currentDesktopChanged: (signals["desktopChanged"] as FireSignal).signal,
    };
    return { workspace, wins, signals, desktop };
}

interface MeasureMocks {
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}

function startMeasureEntry(world: MeasureWorld, opts: { throwOnMeasureLog?: boolean } = {}): { stop: () => void; mocks: MeasureMocks } {
    const mocks: MeasureMocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
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
            if (opts.throwOnMeasureLog === true && message.startsWith("plasma-auto-tiler:route-diag:drag-measure")) {
                throw new Error("injected measurement log failure");
            }
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

function fireAll(signal: FireSignal | undefined, payload?: unknown): void {
    if (signal === undefined) {
        return;
    }
    for (const handler of [...signal.handlers]) {
        handler(payload);
    }
}

function startSyncMeasureEntry(world: MeasureWorld, replyFor: (correlation: string) => string): { stop: () => void; mocks: MeasureMocks } {
    const mocks: MeasureMocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
    let n = 0;
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (_s, _p, _i, method, payload, _callback): void => {
            if (method === "NameHasOwner") { _callback(true); return; }
            if (method === "GetNameOwner") { _callback(":1.7"); return; }
            if (method === "StartServiceByName") { _callback(1); return; }
            mocks.planCalls.push({ method, payload, callback: _callback });
        },
        oracleCallDbus: (_s, _p, _i, _m, callback): void => {
            n += 1;
            mocks.oracleCalls.push(callback);
            callback(replyFor(`drag-${String(n)}`));
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

function startMeasureEntryNoOracle(world: MeasureWorld): { stop: () => void; mocks: MeasureMocks } {
    const mocks: MeasureMocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (_s, _p, _i, method, payload, _callback): void => {
            if (method === "NameHasOwner") { _callback(true); return; }
            if (method === "GetNameOwner") { _callback(":1.7"); return; }
            if (method === "StartServiceByName") { _callback(1); return; }
            mocks.planCalls.push({ method, payload, callback: _callback });
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

function runTimers(mocks: MeasureMocks, delayMs: number): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === delayMs) {
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

function measureLines(mocks: MeasureMocks): string[] {
    return mocks.logs.filter((line) => line.startsWith("plasma-auto-tiler:route-diag:drag-measure"));
}

function settleBaseline(mocks: MeasureMocks): void {
    runTimers(mocks, PLAN_DEBOUNCE_MS);
    assert.equal(mocks.planCalls.length, 1);
    const baseline = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
    mocks.planCalls[0]?.callback(retainedSplitReply(baseline["correlation_id"] as string));
}

describe("ar8 drag measurement record shape", () => {
    it("emits one bounded correlated record with finish, later, verdict, edge and pointers", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 50, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        runTimers(mocks, PLAN_DEBOUNCE_MS);
        const finishCall = mocks.planCalls.length;

        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.equal(measureLines(mocks).length, 0, "no record before the first later geometry");
        winA["frameGeometry"] = { x: 0, y: 0, width: 1002, height: 800 };
        fireAll(world.signals["geoA"]);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const line = lines[0] as string;
        assert.ok(line.includes("correlation=drag-1"), line);
        assert.ok(line.includes("start=0,0,600,800"), line);
        assert.ok(line.includes("finish=0,0,1000,800"), line);
        assert.ok(line.includes("later=0,0,1002,800"), line);
        assert.ok(line.includes("verdict=false"), line);
        assert.ok(line.includes("reason=ok-moved"), line);
        assert.ok(line.includes("final=0,0,1000,800"), line);
        assert.ok(line.includes("edge=right:1000"), line);
        assert.ok(line.includes("pointerStart=10,10"), line);
        assert.ok(line.includes("pointerFinish=50,10"), line);
        assert.ok(!line.includes("win-a"), "no window identity in the record");
        assert.ok(!line.includes("title"), "no caption in the record");
        assert.ok(!line.includes("internalId"), line);

        fireAll(world.signals["geoA"]);
        assert.equal(measureLines(mocks).length, 1, "later subscription is one-shot");
        assert.equal(mocks.planCalls.length, finishCall + 1, "measurement dispatches no planner call of its own");
        stop();
    });

    it("marks later=timeout when no geometry follows before the timer", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        fireAll(world.signals["finishedA"]);
        runTimers(mocks, PLAN_DEBOUNCE_MS);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-7"));
        assert.equal(measureLines(mocks).length, 0);
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const timeoutLine = lines[0] as string;
        assert.ok(timeoutLine.includes("later=timeout"), timeoutLine);
        assert.ok(timeoutLine.includes("correlation=drag-7"), timeoutLine);
        stop();
    });

    it("records cancelled verdicts without changing existing drag behavior", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        world.workspace["cursorPos"] = { x: 12, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelledWinA("drag-3"));
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const cancelledLine = lines[0] as string;
        assert.ok(cancelledLine.includes("verdict=true"), cancelledLine);
        assert.ok(cancelledLine.includes("reason=no-change"), cancelledLine);
        assert.ok(cancelledLine.includes("start=0,0,600,800"), cancelledLine);
        assert.ok(cancelledLine.includes("finish=0,0,600,800"), cancelledLine);
        assert.ok(cancelledLine.includes("later=timeout"), cancelledLine);
        assert.ok(cancelledLine.includes("edge=none"), cancelledLine);
        assert.ok(cancelledLine.includes("pointerStart=10,10"), cancelledLine);
        assert.ok(cancelledLine.includes("pointerFinish=12,10"), cancelledLine);
        for (const call of mocks.planCalls) {
            assert.ok(!call.payload.includes("pointer-resize"), call.payload);
        }
        stop();
    });

    it("keeps the measurement read-only and trace-gated in source", () => {
        const measure = readFileSync("src/drag-measure.ts", "utf8");
        assert.ok(!measure.includes("requestPointerResize"));
        assert.ok(!measure.includes("DescribePlan"));
        assert.ok(!measure.includes("callDbus"));
        assert.ok(!measure.includes("setGeometry"));
        assert.ok(!measure.includes("caption"));
        assert.ok(!measure.includes("internalId"));
        assert.ok(!measure.includes("windowIdentity"));
        const entry = readFileSync("src/plan-adapter-entry.ts", "utf8");
        assert.ok(entry.includes("captureMeasureStart"));
        assert.ok(entry.includes("createMeasurePending"));
        assert.ok(entry.includes("measureMakeFinishContext"));
        assert.ok(entry.includes("feedMeasureVerdict"));
        assert.ok(entry.includes("formatDragMeasureLine"));
        assert.ok(entry.includes("peekMeasureStartRect"), "start comes from the route capture");
        assert.ok(entry.includes("completeMeasureRemoval"), "removal completes rather than drops");
        assert.ok(entry.includes("createMeasureStandaloneFinish"), "pull-unavailable finishes still record");
        assert.ok(entry.includes("measurePullAvailable"));
        assert.ok(!entry.includes("beginMeasureFinish"), "no window-keyed finish replaces a pending");
        assert.ok(!entry.includes("dropMeasurePending"), "pending release is per finish context");
        assert.ok(!entry.includes("drag-measure action="), "single record shape only");
    });

    it("keeps a synchronous oracle reply with its own finish", () => {
        const world = measureWorld();
        const { stop, mocks } = startSyncMeasureEntry(world, (correlation) => movedWinA(correlation));
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 50, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        assert.equal(measureLines(mocks).length, 0, "later geometry still pending after a sync verdict");
        winA["frameGeometry"] = { x: 0, y: 0, width: 1002, height: 800 };
        fireAll(world.signals["geoA"]);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const line = lines[0] as string;
        assert.ok(line.includes("correlation=drag-1"), line);
        assert.ok(line.includes("verdict=false"), line);
        assert.ok(line.includes("reason=ok-moved"), line);
        assert.ok(line.includes("finish=0,0,1000,800"), line);
        stop();
    });

    it("keeps separate records for two overlapping finishes and their late replies", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 50, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        // A second drag completes before the first async reply arrives.
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1100, height: 800 };
        world.workspace["cursorPos"] = { x: 60, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 2);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        (mocks.oracleCalls[1] as (reply: unknown) => void)(movedWinA("drag-2"));
        assert.equal(measureLines(mocks).length, 0);
        fireAll(world.signals["geoA"]);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 2, "no finish replaced the other and no reply misassociated");
        const first = lines[0] as string;
        const second = lines[1] as string;
        assert.ok(first.includes("correlation=drag-1"), first);
        assert.ok(first.includes("start=0,0,600,800"), first);
        assert.ok(first.includes("finish=0,0,1000,800"), first);
        assert.ok(first.includes("edge=right:1000"), first);
        assert.ok(first.includes("pointerStart=10,10"), first);
        assert.ok(first.includes("pointerFinish=50,10"), first);
        assert.ok(second.includes("correlation=drag-2"), second);
        assert.ok(second.includes("start=0,0,1000,800"), second);
        assert.ok(second.includes("finish=0,0,1100,800"), second);
        assert.ok(second.includes("edge=right:1100"), second);
        assert.ok(second.includes("pointerStart=50,10"), second);
        assert.ok(second.includes("pointerFinish=60,10"), second);
        stop();
    });

    it("completes an unreadable first change as missing instead of timeout", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-4"));
        winA["frameGeometry"] = {};
        fireAll(world.signals["geoA"]);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1, "a fired change completes even when unreadable");
        assert.ok((lines[0] as string).includes("later=missing"), lines[0] as string);
        assert.ok(!(lines[0] as string).includes("later=timeout"), lines[0] as string);
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        assert.equal(measureLines(mocks).length, 1, "completed record emits exactly once");
        stop();
    });

    it("bounds a finish whose oracle reply never arrives", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        assert.equal(measureLines(mocks).length, 0, "no record before the verdict side resolves");
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const line = lines[0] as string;
        assert.ok(line.includes("correlation=none"), line);
        assert.ok(line.includes("verdict=missing"), line);
        assert.ok(line.includes("reason=missing"), line);
        assert.ok(line.includes("final=none"), line);
        assert.ok(line.includes("later=timeout"), line);
        fireAll(world.signals["geoA"]);
        assert.equal(measureLines(mocks).length, 1, "timed-out pending is released");
        stop();
    });

    it("records the route's captured start rect (missing when the route holds none)", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        const winB = world.wins["win-b"];
        assert.ok(winA !== undefined && winB !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        // A second start while win-a sits outside the observed domain clears
        // the route capture; the record must carry the route's missing start
        // rather than a stale independent read.
        world.workspace["activeWindow"] = winB;
        winA["desktops"] = [{ id: "ws-9" }];
        world.workspace["cursorPos"] = { x: 20, y: 20 };
        fireAll(world.signals["startedA"]);
        world.workspace["activeWindow"] = winA;
        winA["desktops"] = [world.desktop];
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 30, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        fireAll(world.signals["geoA"]);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const line = lines[0] as string;
        assert.ok(line.includes("correlation=drag-1"), line);
        assert.ok(line.includes("start=missing"), line);
        assert.ok(line.includes("finish=0,0,1000,800"), line);
        assert.ok(line.includes("edge=none"), line);
        assert.ok(line.includes("pointerStart=20,20"), line);
        assert.ok(line.includes("pointerFinish=30,10"), line);
        assert.ok(
            mocks.logs.some((entry) => entry === "plasma-auto-tiler:route-diag:drag-start-missing"),
            "route agrees it holds no start for this finish",
        );
        for (const call of mocks.planCalls) {
            assert.ok(!call.payload.includes("pointer-resize"), call.payload);
        }
        stop();
    });

    it("emits one partial record when the window is removed before verdict and later", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 50, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        fireAll(world.signals["removed"], winA);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const line = lines[0] as string;
        assert.ok(line.includes("correlation=none"), line);
        assert.ok(line.includes("start=0,0,600,800"), line);
        assert.ok(line.includes("finish=0,0,1000,800"), line);
        assert.ok(line.includes("later=missing"), line);
        assert.ok(!line.includes("later=timeout"), line);
        assert.ok(line.includes("verdict=missing"), line);
        assert.ok(line.includes("reason=missing"), line);
        assert.ok(line.includes("final=none"), line);
        assert.ok(line.includes("edge=right:1000"), line);
        assert.ok(line.includes("pointerStart=10,10"), line);
        assert.ok(line.includes("pointerFinish=50,10"), line);
        assert.ok(!line.includes("win-a"), "no window identity in the partial record");
        assert.ok(!line.includes("title"), "no caption in the partial record");
        // A late reply and both timers change nothing: exactly one record.
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-9"));
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        assert.equal(measureLines(mocks).length, 1);
        stop();
    });

    it("keeps the arrived verdict when removal precedes only the later geometry", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        fireAll(world.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-5"));
        assert.equal(measureLines(mocks).length, 0);
        fireAll(world.signals["removed"], winA);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const line = lines[0] as string;
        assert.ok(line.includes("correlation=drag-5"), line);
        assert.ok(line.includes("verdict=false"), line);
        assert.ok(line.includes("reason=ok-moved"), line);
        assert.ok(line.includes("final=0,0,1000,800"), line);
        assert.ok(line.includes("later=missing"), line);
        assert.ok(!line.includes("later=timeout"), line);
        fireAll(world.signals["geoA"]);
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        assert.equal(measureLines(mocks).length, 1, "released pending emits exactly once");
        stop();
    });

    it("records a finish with a missing verdict when the oracle pull never attached", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntryNoOracle(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 50, y: 10 };
        fireAll(world.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 0, "no pull exists to reply");
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        assert.equal(measureLines(mocks).length, 0, "no record before the verdict side resolves");
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 1);
        const line = lines[0] as string;
        assert.ok(line.includes("correlation=none"), line);
        assert.ok(line.includes("start=0,0,600,800"), line);
        assert.ok(line.includes("finish=0,0,1000,800"), line);
        assert.ok(line.includes("later=timeout"), line);
        assert.ok(line.includes("verdict=missing"), line);
        assert.ok(line.includes("reason=missing"), line);
        assert.ok(line.includes("final=none"), line);
        assert.ok(line.includes("edge=right:1000"), line);
        assert.ok(line.includes("pointerStart=10,10"), line);
        assert.ok(line.includes("pointerFinish=50,10"), line);
        stop();
    });

    it("reports start=missing on a repeat standalone finish without a new Started", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntryNoOracle(world);
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 50, y: 10 };
        fireAll(world.signals["finishedA"]);
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        assert.equal(measureLines(mocks).length, 1);
        assert.ok((measureLines(mocks)[0] as string).includes("start=0,0,600,800"));
        // A second finish without an intervening Started must not reuse the
        // already-claimed route capture, without mutating route state.
        fireAll(world.signals["finishedA"]);
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        const lines = measureLines(mocks);
        assert.equal(lines.length, 2);
        const second = lines[1] as string;
        assert.ok(second.includes("correlation=none"), second);
        assert.ok(second.includes("start=missing"), second);
        assert.ok(second.includes("edge=none"), second);
        assert.ok(second.includes("finish=0,0,1000,800"), second);
        stop();
    });

    it("keeps the oracle route identical when the measurement log throws", () => {
        const world = measureWorld();
        const { stop, mocks } = startMeasureEntry(world, { throwOnMeasureLog: true });
        const winA = world.wins["win-a"];
        assert.ok(winA !== undefined);
        settleBaseline(mocks);

        world.workspace["cursorPos"] = { x: 10, y: 10 };
        fireAll(world.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        world.workspace["cursorPos"] = { x: 50, y: 10 };
        assert.doesNotThrow(() => fireAll(world.signals["finishedA"]));
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(movedWinA("drag-1"));
        assert.doesNotThrow(() => fireAll(world.signals["geoA"]));
        const pointerCalls = mocks.planCalls.filter((call) => call.payload.includes("pointer-resize"));
        assert.equal(pointerCalls.length, 1, "exactly one route dispatch");
        const command = (JSON.parse(pointerCalls[0]?.payload as string) as Record<string, unknown>)["command"];
        assert.deepEqual(command, { op: "pointer-resize", window: "win-a", direction: "right", boundary: 1000 });
        // The measurement attempt failed closed: no line kept, and later
        // activity plus both timers dispatch nothing further.
        assert.equal(measureLines(mocks).length, 0);
        fireAll(world.signals["geoA"]);
        runTimers(mocks, DRAG_MEASURE_LATER_TIMEOUT_MS);
        runTimers(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
        assert.equal(mocks.planCalls.filter((call) => call.payload.includes("pointer-resize")).length, 1);
        assert.equal(measureLines(mocks).length, 0);
        assert.ok(
            mocks.logs.some((entry) => entry.includes("drag-verdict cancelled=false")),
            "route logging itself is unaffected",
        );
        stop();
    });
});

describe("ar8 drag measurement pure helpers", () => {
    it("derives the script edge from script rects", () => {
        const start = { x: 0, y: 0, w: 600, h: 800 };
        assert.deepEqual(describeMeasureEdge(start, { x: 0, y: 0, w: 1000, h: 800 }), { direction: "right", boundary: 1000 });
        assert.equal(describeMeasureEdge(start, start), null);
        assert.equal(describeMeasureEdge(start, { x: 100, y: 100, w: 500, h: 700 }), "mixed");
        assert.equal(describeMeasureEdge(null, start), null);
    });

    it("reads script rects and pointers fail-closed", () => {
        assert.deepEqual(readMeasureRect({ frameGeometry: { x: 1, y: 2, width: 3, height: 4 } }), { x: 1, y: 2, w: 3, h: 4 });
        assert.equal(readMeasureRect({}), null);
        assert.equal(readMeasureRect({ frameGeometry: { x: 0, y: 0, width: 0, height: 8 } }), null);
        assert.deepEqual(readMeasurePointer({ cursorPos: { x: 5, y: 6 } }), { x: 5, y: 6 });
        assert.equal(readMeasurePointer({}), null);
        assert.equal(readMeasurePointer(null), null);
    });

    it("bounds the record and never leaks identity", () => {
        const line = formatDragMeasureLine({
            seq: 2,
            correlation: "drag-9",
            start: { x: 0, y: 0, w: 600, h: 800 },
            finish: { x: 0, y: 0, w: 1000, h: 800 },
            later: null,
            laterTimeout: true,
            verdict: { cancelled: false, finalRect: { x: 0, y: 0, w: 1000, h: 800 }, windowIdentity: "win-a", correlation: "drag-9", reason: "ok-moved" },
            verdictMissing: false,
            edge: { direction: "right", boundary: 1000 },
            pointerStart: { x: 1, y: 2 },
            pointerFinish: { x: 3, y: 4 },
        });
        assert.ok(line.startsWith("plasma-auto-tiler:route-diag:drag-measure"), line);
        assert.ok(!line.includes("win-a"), line);
        const untrusted = formatDragMeasureLine({
            seq: -1,
            correlation: "drag-9'evil",
            start: null,
            finish: null,
            later: null,
            laterTimeout: false,
            verdict: null,
            verdictMissing: true,
            edge: "mixed",
            pointerStart: null,
            pointerFinish: null,
        });
        assert.ok(untrusted.includes("correlation=none"), untrusted);
        assert.ok(untrusted.includes("later=missing"), untrusted);
        assert.ok(untrusted.includes("edge=mixed"), untrusted);
    });
});
