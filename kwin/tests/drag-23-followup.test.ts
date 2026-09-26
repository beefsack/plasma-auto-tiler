import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ORACLE_KWIN_THIRDS_MIN_EDGE_PX,
    identifyGrabbedEdges,
    resolveOracleResizeTargets,
} from "../src/drag-oracle-pull";
import { PLAN_DEBOUNCE_MS, PLAN_TIMEOUT_MS, PlanAdapter, PlanAdapterEnv, PlanObserved } from "../src/plan-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

describe("drag-23 kwin-thirds grab identification", () => {
    it("uses the 64px interior gate as the regime boundary", () => {
        assert.equal(ORACLE_KWIN_THIRDS_MIN_EDGE_PX, 64);
        const start = { x: 0, y: 0, w: 600, h: 800 };
        assert.equal(identifyGrabbedEdges(start, { x: 64, y: 400 })?.source, "kwin-thirds");
        assert.equal(identifyGrabbedEdges(start, { x: 63, y: 400 })?.source, "nearest-pointer");
        assert.deepEqual(identifyGrabbedEdges(start, { x: 63, y: 400 })?.grabbed, { horizontal: "left", vertical: null });
    });

    it("classifies the drag-23 interior press as KWin TopLeft", () => {
        const start = { x: 680, y: 538, w: 848, h: 478 };
        const identified = identifyGrabbedEdges(start, { x: 828, y: 647 });
        assert.deepEqual(identified?.grabbed, { horizontal: "left", vertical: "up" });
        assert.equal(identified?.source, "kwin-thirds");
        const resolved = resolveOracleResizeTargets(start, { x: 397, y: 315, w: 1131, h: 701 }, identified?.grabbed ?? { horizontal: null, vertical: null });
        assert.deepEqual(resolved?.targets, [
            { direction: "left", boundary: 397 },
            { direction: "up", boundary: 315 },
        ]);
        assert.deepEqual(resolved?.ignored, []);
    });

    it("covers all 9 thirds zones including the y-center half branch", () => {
        const start = { x: 0, y: 0, w: 900, h: 600 };
        const at = (x: number, y: number) => identifyGrabbedEdges(start, { x, y });
        assert.deepEqual(at(100, 100)?.grabbed, { horizontal: "left", vertical: "up" });
        assert.deepEqual(at(450, 100)?.grabbed, { horizontal: null, vertical: "up" });
        assert.deepEqual(at(800, 100)?.grabbed, { horizontal: "right", vertical: "up" });
        assert.deepEqual(at(100, 300)?.grabbed, { horizontal: "left", vertical: null });
        assert.deepEqual(at(400, 300)?.grabbed, { horizontal: "left", vertical: null });
        assert.deepEqual(at(500, 300)?.grabbed, { horizontal: "right", vertical: null });
        assert.deepEqual(at(800, 300)?.grabbed, { horizontal: "right", vertical: null });
        assert.deepEqual(at(100, 500)?.grabbed, { horizontal: "left", vertical: "down" });
        assert.deepEqual(at(450, 500)?.grabbed, { horizontal: null, vertical: "down" });
        assert.deepEqual(at(800, 500)?.grabbed, { horizontal: "right", vertical: "down" });
        for (const point of [[100, 100], [450, 100], [800, 500], [500, 300]] as const) {
            assert.equal(at(point[0], point[1])?.source, "kwin-thirds");
        }
    });

    it("honours strict boundary ties (x thirds, y thirds, center half)", () => {
        const start = { x: 0, y: 0, w: 900, h: 600 };
        // Float thresholds: thirdW=300, twoThirdW=600, thirdH=200,
        // twoThirdH=400, halfW=450.
        assert.deepEqual(identifyGrabbedEdges(start, { x: 300, y: 100 })?.grabbed, { horizontal: null, vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 600, y: 100 })?.grabbed, { horizontal: "right", vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 100, y: 200 })?.grabbed, { horizontal: "left", vertical: null });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 100, y: 400 })?.grabbed, { horizontal: "left", vertical: "down" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 450, y: 300 })?.grabbed, { horizontal: "right", vertical: null });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 449, y: 300 })?.grabbed, { horizontal: "left", vertical: null });
    });

    it("compares integer offsets against float thirds for non-divisible sizes", () => {
        // w=848: third=282.67, twoThird=565.33, half=424; h=478: third=159.33,
        // twoThird=318.67. Integer-truncated thirds would misclassify lx=282
        // (282 < 282.67 is left) and lx=565 (565 < 565.33 is center).
        const start = { x: 0, y: 0, w: 848, h: 478 };
        assert.deepEqual(identifyGrabbedEdges(start, { x: 282, y: 100 })?.grabbed, { horizontal: "left", vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 565, y: 100 })?.grabbed, { horizontal: null, vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 100, y: 318 })?.grabbed, { horizontal: "left", vertical: null });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 100, y: 319 })?.grabbed, { horizontal: "left", vertical: "down" });
        for (const point of [[282, 100], [565, 100], [100, 318]] as const) {
            assert.equal(identifyGrabbedEdges(start, { x: point[0], y: point[1] })?.source, "kwin-thirds");
        }
    });

    it("never selects thirds for a pointer outside the starting frame", () => {
        const start = { x: 0, y: 0, w: 600, h: 800 };
        // Absolute distances beyond the 64px gate, but outside: nearest edge.
        assert.deepEqual(identifyGrabbedEdges(start, { x: -100, y: 400 })?.grabbed, { horizontal: "left", vertical: null });
        assert.equal(identifyGrabbedEdges(start, { x: -100, y: 400 })?.source, "nearest-pointer");
        assert.deepEqual(identifyGrabbedEdges(start, { x: 700, y: 400 })?.grabbed, { horizontal: "right", vertical: null });
        assert.equal(identifyGrabbedEdges(start, { x: 700, y: 400 })?.source, "nearest-pointer");
        assert.deepEqual(identifyGrabbedEdges(start, { x: 300, y: -100 })?.grabbed, { horizontal: null, vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 300, y: 900 })?.grabbed, { horizontal: null, vertical: "down" });
    });

    it("keeps ordinary near-frame edge and corner grips on nearest-pointer", () => {
        const start = { x: 0, y: 0, w: 600, h: 800 };
        assert.deepEqual(identifyGrabbedEdges(start, { x: 5, y: 400 })?.grabbed, { horizontal: "left", vertical: null });
        assert.equal(identifyGrabbedEdges(start, { x: 5, y: 400 })?.source, "nearest-pointer");
        assert.deepEqual(identifyGrabbedEdges(start, { x: 595, y: 400 })?.grabbed, { horizontal: "right", vertical: null });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 300, y: 5 })?.grabbed, { horizontal: null, vertical: "up" });
        assert.deepEqual(identifyGrabbedEdges(start, { x: 5, y: 5 })?.grabbed, { horizontal: "left", vertical: "up" });
        assert.equal(identifyGrabbedEdges(start, { x: 5, y: 5 })?.source, "nearest-pointer");
    });
});

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

interface World {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly signals: Record<string, FireSignal>;
}

function world(opts: {
    winA?: { x: number; y: number; w: number; h: number };
    winB?: { x: number; y: number; w: number; h: number };
    active?: "win-a" | "win-b";
    cursorPos?: { x: number; y: number };
    clientArea?: { x: number; y: number; width: number; height: number };
    fullscreen?: ReadonlyArray<string>;
} = {}): World {
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
    const rectA = opts.winA ?? { x: 0, y: 0, w: 600, h: 800 };
    const rectB = opts.winB ?? { x: 600, y: 0, w: 600, h: 800 };
    const makeWin = (id: string, rect: { x: number; y: number; w: number; h: number }, started: FireSignal, finished: FireSignal, geo: FireSignal): Record<string, unknown> => ({
        normalWindow: true,
        internalId: id,
        output,
        desktops: [desktop],
        frameGeometry: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        move: false,
        resize: true,
        moveResizedChanged: geo.signal,
        frameGeometryChanged: geo.signal,
        interactiveMoveResizeStarted: started.signal,
        interactiveMoveResizeFinished: finished.signal,
        fullScreenChanged: fireSignal().signal,
        fullScreen: opts.fullscreen?.includes(id) === true,
        maximizedChanged: fireSignal().signal,
        maximizeMode: 0,
    });
    const wins: Record<string, Record<string, unknown>> = {
        "win-a": makeWin("win-a", rectA, signals["startedA"] as FireSignal, signals["finishedA"] as FireSignal, signals["geoA"] as FireSignal),
        "win-b": makeWin("win-b", rectB, signals["startedB"] as FireSignal, signals["finishedB"] as FireSignal, signals["geoB"] as FireSignal),
    };
    const activeId = opts.active ?? "win-a";
    const area = opts.clientArea ?? { x: 0, y: 0, width: 1200, height: 800 };
    const workspace: Record<string, unknown> = {
        activeWindow: wins[activeId],
        cursorPos: opts.cursorPos ?? { x: 600, y: 400 },
        windowList: (): unknown[] => [wins["win-a"], wins["win-b"]],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ ...area }),
        windowAdded: (signals["added"] as FireSignal).signal,
        windowRemoved: (signals["removed"] as FireSignal).signal,
        windowActivated: (signals["activated"] as FireSignal).signal,
        screensChanged: (signals["screensChanged"] as FireSignal).signal,
        currentDesktopChanged: (signals["desktopChanged"] as FireSignal).signal,
    };
    return { workspace, wins, signals };
}

interface Mocks {
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}

function startEntry(live: World): { stop: () => void; mocks: Mocks } {
    const mocks: Mocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
    const handle = startPlanAdapterEntry({
        workspace: live.workspace,
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

function fireAll(signal: FireSignal | undefined): void {
    if (signal === undefined) {
        return;
    }
    for (const handler of [...signal.handlers]) {
        handler();
    }
}

function runDebounce(mocks: Mocks): void {
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

function verdict(finalRect: { x: number; y: number; w: number; h: number }, correlation: string, windowIdentity = "win-a"): string {
    return JSON.stringify({ v: 1, cancelled: false, finalRect, windowIdentity, correlation, reason: "ok-moved" });
}

function cancelled(correlation: string): string {
    return JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 0, y: 0, w: 600, h: 800 }, windowIdentity: "win-a", correlation, reason: "no-change" });
}

function planned(correlation: string, geom: ReadonlyArray<{ window: string; rect: { x: number; y: number; w: number; h: number } }>): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "reconcile" },
        desired_geometry: geom.map((entry) => ({ window: entry.window, leaf: `${entry.window}-leaf`, output: "out-1", workspace: "ws-1", rect: entry.rect })),
    });
}

function rejected(correlation: string): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", kind: "focus-mismatch", detail: null });
}

function pointerPlanned(correlation: string): string {
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

describe("drag-23 terminal-class converge", () => {
    it("timed-out drop converges once with no replay", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-40"));
        assert.equal(mocks.planCalls.length, 1);
        // The reply-wait timer is the last 2000ms timer: the trace-only
        // measure verdict timer shares the delay but is armed earlier.
        const timeout = [...mocks.timers].reverse().find((timer) => !timer.cancelled && timer.delayMs === PLAN_TIMEOUT_MS);
        assert.ok(timeout !== undefined, "reply-wait timeout armed");
        timeout?.callback();
        assert.equal(mocks.planCalls.length, 2, "exactly one follow-up after the timeout");
        assert.deepEqual(commandOf(mocks.planCalls[1]), { op: "reconcile" });
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-40") && line.includes("reason=timeout")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-40") && line.includes("dispatch=dispatched")));
        const follow = correlationOf(mocks.planCalls[1]);
        mocks.planCalls[1]?.callback(planned(follow, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-40") && line.includes("outcome=applied") && line.includes(`plan=${follow}`)));
        // No replay: later signals and debounce leave the settled layout alone.
        runDebounce(mocks);
        fireAll(live.signals["geoA"]);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, 2);
        stop();
    });

    it("stale drop is satisfied by the queued reconcile with no extra dispatch", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-41"));
        assert.equal(mocks.planCalls.length, 1);
        // A newer observation arrives before the Planner reply: the reply
        // lands stale and the drop joins its domain marker while the queued
        // admit holds the single slot.
        fireAll(live.signals["geoA"]);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, 1, "reconcile deferred behind the pointer flight");
        const pointer = correlationOf(mocks.planCalls[0]);
        mocks.planCalls[0]?.callback(pointerPlanned(pointer));
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-41") && line.includes("reason=stale-dropped")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-41") && line.includes("dispatch=deferred")));
        // The superseding reconcile dispatches as the single follow-up and its
        // application satisfies the marker: no second reconcile is sent.
        assert.equal(mocks.planCalls.length, 2, "exactly one follow-up after the stale drop");
        assert.deepEqual(commandOf(mocks.planCalls[1])["op"], "reconcile");
        const follow = correlationOf(mocks.planCalls[1]);
        mocks.planCalls[1]?.callback(planned(follow, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-41") && line.includes("outcome=applied") && line.includes(`plan=${follow}`)), "superseding plan correlation satisfies the drop");
        assert.ok(!mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-41") && line.includes("dispatch=dispatched")), "no marker dispatch once satisfied");
        runDebounce(mocks);
        fireAll(live.signals["geoA"]);
        runDebounce(mocks);
        assert.ok(mocks.planCalls.every((call) => !String(call.payload).includes("pointer-resize")) || mocks.planCalls.length <= 3, "no pointer replay");
        stop();
    });

    it("deferred drag pointer superseded by drift joins the marker it satisfies", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        runDebounce(mocks);
        const baseline = correlationOf(mocks.planCalls[0]);
        mocks.planCalls[0]?.callback(planned(baseline, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        // First drop dispatches its pointer and stays unsettled.
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-42"));
        assert.equal(mocks.planCalls.length, 2);
        assert.deepEqual(commandOf(mocks.planCalls[1])["op"], "pointer-resize");
        // A second overlapping drop must defer its pointer behind the live
        // pointer flight (a Started only discards in-flight reconciles).
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[1] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1100, h: 800 }, "drag-43"));
        assert.ok(mocks.logs.some((line) => line.includes("drag-dispatched") && line.includes("correlation=drag-43") && line.includes("accepted=true")), "pointer deferred");
        // Ordinary drift supersedes the deferred pointer: the drop joins its
        // domain marker instead of vanishing, and the drift reconcile owns
        // the single slot.
        const winA = live.wins["win-a"] as Record<string, unknown>;
        winA["frameGeometry"] = { x: 0, y: 0, width: 750, height: 800 };
        fireAll(live.signals["geoA"]);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, 2, "superseded pointer never sent");
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-43") && line.includes("reason=superseded")));
        // Settling the first pointer lands stale after the drift: it joins
        // the same marker, and the queued drift dispatches once for both.
        const first = correlationOf(mocks.planCalls[1]);
        mocks.planCalls[1]?.callback(pointerPlanned(first));
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-42") && line.includes("reason=stale-dropped")));
        assert.equal(mocks.planCalls.length, 3, "one follow-up dispatches for the shared marker");
        assert.deepEqual(commandOf(mocks.planCalls[2]), { op: "reconcile" });
        const pointers = mocks.planCalls.filter((call) => String(call.payload).includes("pointer-resize"));
        assert.equal(pointers.length, 1, "superseded pointer never sent");
        const follow = correlationOf(mocks.planCalls[2]);
        mocks.planCalls[2]?.callback(planned(follow, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.deepEqual(winA["frameGeometry"], { x: 0, y: 0, width: 600, height: 800 }, "retained geometry restored");
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-42") && line.includes("outcome=applied") && line.includes(`plan=${follow}`)));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-43") && line.includes("outcome=applied") && line.includes(`plan=${follow}`)), "both drops share the satisfying plan");
        assert.equal(mocks.planCalls.length, 3, "no replay");
        stop();
    });
});
function commandOf(call: { payload: string } | undefined): Record<string, unknown> {
    return (JSON.parse(call?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>;
}

function correlationOf(call: { payload: string } | undefined): string {
    return (JSON.parse(call?.payload as string) as Record<string, unknown>)["correlation_id"] as string;
}

describe("drag-23 inactive kwin-thirds drop", () => {
    it("routes one dual-axis left:397 up:315 with source kwin-thirds and keeps the active identity", () => {
        const live = world({
            winA: { x: 680, y: 538, w: 848, h: 478 },
            winB: { x: 0, y: 0, w: 300, h: 300 },
            active: "win-b",
            cursorPos: { x: 828, y: 647 },
            clientArea: { x: 0, y: 0, width: 1600, height: 1100 },
        });
        const activeBefore = live.workspace["activeWindow"];
        const { stop, mocks } = startEntry(live);
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        assert.equal(mocks.oracleCalls.length, 1);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 397, y: 315, w: 1131, h: 701 }, "drag-23"));
        assert.equal(mocks.planCalls.length, 1);
        assert.deepEqual(commandOf(mocks.planCalls[0]), {
            op: "pointer-resize",
            window: "win-a",
            direction: "left",
            boundary: 397,
            direction2: "up",
            boundary2: 315,
        });
        const payload = JSON.parse(mocks.planCalls[0]?.payload as string) as Record<string, unknown>;
        assert.equal(payload["focused_window"], "win-b", "active identity unchanged by an inactive drag");
        assert.equal(live.workspace["activeWindow"], activeBefore, "no forced focus");
        assert.ok(
            mocks.logs.some((line) => line.includes("drag-route") && line.includes("correlation=drag-23") && line.includes("grabbed=left+up") && line.includes("source=kwin-thirds") && line.includes("targets=left:397,up:315")),
            "both targets logged with the kwin-thirds source",
        );
        assert.ok(
            mocks.logs.some((line) => line.includes("drag-dispatched") && line.includes("correlation=drag-23") && line.includes("accepted=true")),
        );
        stop();
    });
});

describe("drag-23 rejected-drop converge", () => {
    it("adapter-refused drop converges once via a correlated reconcile with no retry", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        runDebounce(mocks);
        const baseline = correlationOf(mocks.planCalls[0]);
        mocks.planCalls[0]?.callback(planned(baseline, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        const winA = live.wins["win-a"] as Record<string, unknown>;
        winA["fullScreen"] = true;
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-31"));
        assert.equal(mocks.planCalls.length, 2, "refused pointer still converges once");
        assert.deepEqual(commandOf(mocks.planCalls[1]), { op: "reconcile" });
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-fullscreen"));
        assert.ok(mocks.logs.some((line) => line.includes("drag-dispatched") && line.includes("correlation=drag-31") && line.includes("accepted=false")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-31") && line.includes("reason=fullscreen")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-31") && line.includes("dispatch=dispatched")));
        const follow = correlationOf(mocks.planCalls[1]);
        mocks.planCalls[1]?.callback(planned(follow, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.equal(mocks.planCalls.length, 2, "no retry after the follow-up settles");
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-31") && line.includes("outcome=partial") && line.includes(`plan=${follow}`) && line.includes("covered=1/2")), "skipped fullscreen member settles partial, never a false applied restore");
        assert.ok(!mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-31") && line.includes("outcome=applied")), "no applied restoring claim while a member stays skipped");
        stop();
    });

    it("planner-rejected drop converges once and a rejected follow-up never loops", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-32"));
        assert.equal(mocks.planCalls.length, 1);
        assert.deepEqual(commandOf(mocks.planCalls[0]), { op: "pointer-resize", window: "win-a", direction: "right", boundary: 1000 });
        const pointer = correlationOf(mocks.planCalls[0]);
        mocks.planCalls[0]?.callback(rejected(pointer));
        assert.equal(mocks.planCalls.length, 2, "exactly one follow-up after the Planner refusal");
        assert.deepEqual(commandOf(mocks.planCalls[1]), { op: "reconcile" });
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-32")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-32") && line.includes("dispatch=dispatched")));
        const follow = correlationOf(mocks.planCalls[1]);
        mocks.planCalls[1]?.callback(rejected(follow));
        assert.equal(mocks.planCalls.length, 2, "one attempt only even when the follow-up itself rejects");
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-32") && line.includes("outcome=rejected") && line.includes(`plan=${follow}`)), "failed plan correlation names the terminal");
        stop();
    });

    it("overlapping rejected drops share one marker dispatch with one terminal each", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        runDebounce(mocks);
        const baseline = correlationOf(mocks.planCalls[0]);
        mocks.planCalls[0]?.callback(planned(baseline, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        // First drop dispatches its pointer and stays unsettled.
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-90"));
        assert.equal(mocks.planCalls.length, 2);
        // Two further drops refuse while the pointer holds the slot: both
        // join the same domain marker with no dispatch of their own.
        const winA = live.wins["win-a"] as Record<string, unknown>;
        winA["fullScreen"] = true;
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[1] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-91"));
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[2] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1100, h: 800 }, "drag-92"));
        assert.equal(mocks.planCalls.length, 2, "refusals dispatch nothing while busy");
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-91")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-92")));
        // Native drift while the drops pile up, then the pointer rejects:
        // one marker reconcile dispatches for all three drops.
        winA["frameGeometry"] = { x: 0, y: 0, width: 750, height: 800 };
        winA["fullScreen"] = false;
        const pointer = correlationOf(mocks.planCalls[1]);
        mocks.planCalls[1]?.callback(rejected(pointer));
        assert.equal(mocks.planCalls.length, 3, "exactly one marker reconcile for the shared marker");
        assert.deepEqual(commandOf(mocks.planCalls[2]), { op: "reconcile" });
        // The baseline seed reconcile plus exactly one marker reconcile: no
        // retries, no per-drag queue.
        const reconciles = mocks.planCalls
            .slice(1)
            .filter((call) => (commandOf(call) as Record<string, unknown>)["op"] === "reconcile");
        assert.equal(reconciles.length, 1, "no retries, no per-drag queue");
        // Its application satisfies every drop with the same plan
        // correlation and restores the retained geometry.
        const follow = correlationOf(mocks.planCalls[2]);
        mocks.planCalls[2]?.callback(planned(follow, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.deepEqual(winA["frameGeometry"], { x: 0, y: 0, width: 600, height: 800 }, "retained geometry restored");
        for (const drag of ["drag-90", "drag-91", "drag-92"]) {
            assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes(`correlation=${drag}`) && line.includes("outcome=applied") && line.includes(`plan=${follow}`)), `${drag} gets its own terminal with the shared plan`);
        }
        assert.equal(mocks.planCalls.length, 3, "no replay after the shared settle");
        stop();
    });

    it("cancelled and zero-move verdicts stay a strict no-op with no reconcile", () => {        const live = world();
        const { stop, mocks } = startEntry(live);
        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelled("drag-33"));
        assert.equal(mocks.planCalls.length, 0);
        assert.ok(!mocks.logs.some((line) => line.includes("drag-reconcile")), "cancelled is not a rejected drop");

        fireAll(live.signals["startedA"]);
        fireAll(live.signals["finishedA"]);
        (mocks.oracleCalls[1] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 600, h: 800 }, "drag-34"));
        assert.equal(mocks.planCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("drag-zero-move") && line.includes("correlation=drag-34")));
        assert.ok(!mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-34")), "zero-move is not a rejected drop");
        stop();
    });

    it("a deferred finish resync satisfies the marker with no second dispatch", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        runDebounce(mocks);
        const baseline = correlationOf(mocks.planCalls[0]);
        mocks.planCalls[0]?.callback(planned(baseline, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        // Drift then finish with an idle single-flight: the finish reconcile
        // dispatches and stays in flight; further drift defers a second
        // reconcile behind it.
        const winA = live.wins["win-a"] as Record<string, unknown>;
        fireAll(live.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 700, height: 800 };
        fireAll(live.signals["geoA"]);
        fireAll(live.signals["finishedA"]);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, 2, "finish reconcile in flight");
        winA["frameGeometry"] = { x: 0, y: 0, width: 750, height: 800 };
        fireAll(live.signals["geoA"]);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, 2, "second reconcile deferred, not dispatched");
        // The drop now refuses (fullscreen toggled after the drag): it joins
        // its domain marker while the slot stays owned by the resync.
        winA["fullScreen"] = true;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-35"));
        assert.equal(mocks.planCalls.length, 2, "no second reconcile while one is deferred");
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-35")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-35") && line.includes("dispatch=deferred")));
        // Settling the in-flight reconcile after a further drift lands stale
        // (epoch fence): the superseding deferred reconcile then dispatches
        // once and its application satisfies the marker with its own plan.
        winA["fullScreen"] = false;
        winA["frameGeometry"] = { x: 0, y: 0, width: 750, height: 800 };
        const flying = correlationOf(mocks.planCalls[1]);
        mocks.planCalls[1]?.callback(planned(flying, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.equal(mocks.planCalls.length, 3, "superseding deferred follow-up dispatches once");
        assert.deepEqual(commandOf(mocks.planCalls[2]), { op: "reconcile" });
        const follow = correlationOf(mocks.planCalls[2]);
        mocks.planCalls[2]?.callback(planned(follow, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.equal(mocks.planCalls.length, 3, "no marker dispatch once satisfied");
        assert.deepEqual(winA["frameGeometry"], { x: 0, y: 0, width: 600, height: 800 }, "retained geometry restored");
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-35") && line.includes("outcome=applied") && line.includes(`plan=${follow}`)), "superseding plan satisfies the drop");
        assert.ok(!mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-35") && line.includes("dispatch=dispatched")), "marker never dispatched its own reconcile");
        stop();
    });

    it("an in-flight finish reconcile satisfies the marker with no second dispatch", () => {
        const live = world();
        const { stop, mocks } = startEntry(live);
        runDebounce(mocks);
        const baseline = correlationOf(mocks.planCalls[0]);
        mocks.planCalls[0]?.callback(planned(baseline, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        // Drift then finish with an idle single-flight: the finish reconcile
        // dispatches and stays in flight before the verdict arrives.
        const winA = live.wins["win-a"] as Record<string, unknown>;
        fireAll(live.signals["startedA"]);
        winA["frameGeometry"] = { x: 0, y: 0, width: 700, height: 800 };
        fireAll(live.signals["geoA"]);
        fireAll(live.signals["finishedA"]);
        runDebounce(mocks);
        const before = mocks.planCalls.length;
        assert.equal(before, 2, "finish reconcile in flight");
        assert.deepEqual(commandOf(mocks.planCalls[before - 1]), { op: "reconcile" });
        winA["fullScreen"] = true;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(verdict({ x: 0, y: 0, w: 1000, h: 800 }, "drag-36"));
        assert.equal(mocks.planCalls.length, before, "no second reconcile while one is in flight");
        assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-36")));
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-36") && line.includes("dispatch=deferred")));
        // Settling the in-flight reconcile restores the retained
        // geometry and satisfies the marker with its own plan correlation.
        winA["fullScreen"] = false;
        winA["frameGeometry"] = { x: 0, y: 0, width: 700, height: 800 };
        const flying = correlationOf(mocks.planCalls[before - 1]);
        mocks.planCalls[before - 1]?.callback(planned(flying, [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ]));
        assert.equal(mocks.planCalls.length, before, "satisfied in place adds no call");
        assert.deepEqual(winA["frameGeometry"], { x: 0, y: 0, width: 600, height: 800 }, "retained geometry restored");
        assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-36") && line.includes("outcome=applied") && line.includes(`plan=${flying}`)), "in-flight plan satisfies the drop");
        assert.ok(!mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-36") && line.includes("dispatch=dispatched")), "marker never dispatched its own reconcile");
        stop();
    });
});

describe("drag restore marker scope", () => {
    interface RestoreSent {
        readonly payload: string;
        readonly callback: (reply: unknown) => void;
    }

    interface RestoreRect {
        x: number;
        y: number;
        w: number;
        h: number;
    }

    function restoreWorld(opts: {
        observeThrows?: boolean;
        scheduleThrows?: boolean;
        dbusThrows?: boolean;
        ownerBroken?: boolean;
    } = {}): {
        adapter: PlanAdapter;
        logs: string[];
        sent: RestoreSent[];
        setDomain: (output: string, workspace: string) => void;
        setRect: (id: string, rect: RestoreRect) => void;
        rectOf: (id: string) => RestoreRect;
    } {
        const logs: string[] = [];
        const sent: RestoreSent[] = [];
        let output = "out-1";
        let workspace = "ws-1";
        const refs = new Map<string, object>([
            ["win-a", {}],
            ["win-b", {}],
        ]);
        const rects = new Map<string, RestoreRect>([
            ["win-a", { x: 0, y: 0, w: 600, h: 800 }],
            ["win-b", { x: 600, y: 0, w: 600, h: 800 }],
        ]);
        const floating = new Set<string>();
        let activeId = "win-a";
        const env: PlanAdapterEnv = {
            callDbus: (_s, _p, _i, method, payload, callback): void => {
                if (opts.dbusThrows === true) {
                    throw new Error("boom");
                }
                if (method === "NameHasOwner") { callback(true); return; }
                if (method === "GetNameOwner") { callback(opts.ownerBroken === true ? "bogus" : ":1.7"); return; }
                if (method === "StartServiceByName") { callback(1); return; }
                sent.push({ payload, callback });
                // Leave the DescribePlan reply pending: the flight stays live.
            },
            scheduleOnce: (): (() => void) => {
                if (opts.scheduleThrows === true) {
                    throw new Error("boom");
                }
                return (): void => {};
            },
            log: (message): void => {
                logs.push(message);
            },
            observe: (): PlanObserved | null => {
                if (opts.observeThrows === true) {
                    throw new Error("boom");
                }
                return {
                    domainOutput: output,
                    domainWorkspace: workspace,
                    domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                    domainGap: 0,
                    domainOuterGap: 0,
                    focusedId: "win-a",
                    windows: ["win-a", "win-b"].map((id) => ({
                        id,
                        ref: refs.get(id) as object,
                        rect: { ...(rects.get(id) as RestoreRect) },
                        output,
                        workspace,
                        fullscreen: false,
                        maximized: false,
                        ...(floating.has(id) ? { floating: true } : {}),
                    })),
                    activeRef: refs.get(activeId) as object,
                    fingerprint: `fp-${output}-${workspace}`,
                    revalidate: () => true,
                };
            },
            clearMaximize: (): "invoked" => "invoked",
            setGeometry: (target, rect): boolean => {
                for (const [id, ref] of refs) {
                    if (ref === target) {
                        rects.set(id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
                        return true;
                    }
                }
                return false;
            },
            setFloating: (id, isFloating): void => {
                if (isFloating) {
                    floating.add(id);
                } else {
                    floating.delete(id);
                }
            },
            readKeepAbove: (): boolean => false,
            readKeepBelow: (): boolean => false,
            setKeepAbove: (): "invoked" => "invoked",
            setKeepBelow: (): "invoked" => "invoked",
            setActive: (target): boolean => {
                for (const [id, ref] of refs) {
                    if (ref === target) {
                        activeId = id;
                        return true;
                    }
                }
                return false;
            },
            active: (): object | null => refs.get(activeId) ?? null,
            subscribe: (): (() => void) => (): void => {},
        };
        const adapter = new PlanAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        return {
            adapter,
            logs,
            sent,
            setDomain: (nextOutput: string, nextWorkspace: string): void => {
                output = nextOutput;
                workspace = nextWorkspace;
            },
            setRect: (id: string, rect: RestoreRect): void => {
                rects.set(id, { ...rect });
            },
            rectOf: (id: string): RestoreRect => ({ ...(rects.get(id) as RestoreRect) }),
        };
    }

    it("a truly unscoped drop fails closed with an unavailable terminal", () => {
        const w = restoreWorld({ observeThrows: true });
        // No observation, no retained baseline, no exact id: no domain
        // evidence at all, so no plan may ever claim this drop.
        assert.equal(w.adapter.requestPointerResize("win-a", "right", 1000, undefined, undefined, "drag-85"), false);
        assert.ok(w.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-observe"));
        assert.ok(w.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-85") && line.includes("reason=observe")));
        assert.ok(w.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-85") && line.includes("outcome=unavailable") && line.includes("plan=none")), "truthful terminal, never fabricated success");
        assert.equal(w.sent.length, 0, "nothing dispatched without a scope");
        const markers = (w.adapter as unknown as { dragRestore: Map<string, unknown> }).dragRestore;
        assert.equal(markers.size, 0, "no unscoped marker lingers for unrelated plans");
    });

    it("a timer-failed marker dispatch binds its terminal with the allocated plan", () => {
        const w = restoreWorld({ scheduleThrows: true });
        assert.equal(w.adapter.requestPointerResize("win-a", "sideways", 1000, undefined, undefined, "drag-86"), false);
        assert.ok(w.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-86") && line.includes("reason=direction")));
        assert.equal(w.sent.length, 0, "the flight never left the adapter");
        assert.ok(w.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-86") && line.includes("outcome=timer-failed") && line.includes("plan=gen-1-p0")), "exact failure names the allocated plan correlation");
        const markers = (w.adapter as unknown as { dragRestore: Map<string, unknown> }).dragRestore;
        assert.equal(markers.size, 0, "failed attempt clears with no retry");
        (w.adapter as unknown as { finishFlight: () => void }).finishFlight();
        assert.equal(w.sent.length, 0, "no retry after the bound terminal");
    });

    it("a transport-failed marker dispatch binds its terminal with the allocated plan", () => {
        const w = restoreWorld({ dbusThrows: true });
        assert.equal(w.adapter.requestPointerResize("win-a", "sideways", 1000, undefined, undefined, "drag-87"), false);
        assert.equal(w.sent.length, 0, "the flight never left the adapter");
        assert.ok(w.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-87") && line.includes("outcome=dbus-failed") && line.includes("plan=gen-1-p0")), "exact failure names the allocated plan correlation");
        const markers = (w.adapter as unknown as { dragRestore: Map<string, unknown> }).dragRestore;
        assert.equal(markers.size, 0, "failed attempt clears with no retry");
        (w.adapter as unknown as { finishFlight: () => void }).finishFlight();
        assert.equal(w.sent.length, 0, "no retry after the bound terminal");
    });

    it("markers retain beyond sixteen domains without eviction", () => {
        const w = restoreWorld();
        for (let i = 1; i <= 20; i += 1) {
            w.setDomain(`out-${i}`, "ws-1");
            assert.equal(w.adapter.requestPointerResize("win-a", "sideways", 1000, undefined, undefined, `drag-${90 + i}`), false);
        }
        const markers = (w.adapter as unknown as { dragRestore: Map<string, { drags: string[] }> }).dragRestore;
        assert.equal(markers.size, 20, "no domain-count gate on drag markers");
        // A 21st domain is retained as well: no overflow terminal and no
        // eviction of the existing markers.
        w.setDomain("out-21", "ws-1");
        assert.equal(w.adapter.requestPointerResize("win-a", "sideways", 1000, undefined, undefined, "drag-99"), false);
        assert.equal(markers.size, 21, "new domains never evict a retained marker");
        assert.ok(!w.logs.some((line) => line.includes("correlation=drag-99") && line.includes("outcome=unavailable")), "no overflow terminal");
    });
});

describe("drag restore marker interactive-suppression race", () => {
    interface RaceSent {
        readonly payload: string;
        readonly callback: (reply: unknown) => void;
    }

    interface RaceRect {
        x: number;
        y: number;
        w: number;
        h: number;
    }

    function raceWorld(): {
        adapter: PlanAdapter;
        logs: string[];
        sent: RaceSent[];
        setInteractive: (active: boolean) => void;
        setDomain: (output: string, workspace: string) => void;
        setRect: (id: string, rect: RaceRect) => void;
        setFullscreen: (id: string, on: boolean) => void;
        setMaximized: (id: string, on: boolean) => void;
        setScheduleThrows: (times: number) => void;
        rectOf: (id: string) => RaceRect;
        activeId: () => string;
    } {
        const logs: string[] = [];
        const sent: RaceSent[] = [];
        let interactive = false;
        let scheduleThrows = 0;
        let output = "out-1";
        let workspace = "ws-1";
        const refs = new Map<string, object>([
            ["win-a", {}],
            ["win-b", {}],
        ]);
        const rects = new Map<string, RaceRect>([
            ["win-a", { x: 0, y: 0, w: 600, h: 800 }],
            ["win-b", { x: 600, y: 0, w: 600, h: 800 }],
        ]);
        const fullscreen = new Set<string>();
        const maximized = new Set<string>();
        let activeId = "win-a";
        const env: PlanAdapterEnv = {
            callDbus: (_s, _p, _i, method, payload, callback): void => {
                if (method === "NameHasOwner") { callback(true); return; }
                if (method === "GetNameOwner") { callback(":1.7"); return; }
                if (method === "StartServiceByName") { callback(1); return; }
                sent.push({ payload, callback });
            },
            scheduleOnce: (): (() => void) => {
                if (scheduleThrows > 0) {
                    scheduleThrows -= 1;
                    throw new Error("boom");
                }
                return (): void => {};
            },
            log: (message): void => {
                logs.push(message);
            },
            observe: (): PlanObserved | null => ({
                domainOutput: output,
                domainWorkspace: workspace,
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-a",
                windows: ["win-a", "win-b"].map((id) => ({
                    id,
                    ref: refs.get(id) as object,
                    rect: { ...(rects.get(id) as RaceRect) },
                    output,
                    workspace,
                    fullscreen: fullscreen.has(id),
                    maximized: maximized.has(id),
                })),
                activeRef: refs.get(activeId) as object,
                fingerprint: `fp-${output}-${workspace}`,
                revalidate: () => true,
            }),
            clearMaximize: (): "invoked" => "invoked",
            setGeometry: (target, rect): boolean => {
                for (const [id, ref] of refs) {
                    if (ref === target) {
                        rects.set(id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
                        return true;
                    }
                }
                return false;
            },
            setActive: (target): boolean => {
                for (const [id, ref] of refs) {
                    if (ref === target) {
                        activeId = id;
                        return true;
                    }
                }
                return false;
            },
            active: (): object | null => refs.get(activeId) ?? null,
            subscribe: (): (() => void) => (): void => {},
            isInteractiveResizeActive: (): boolean => interactive,
        };
        const adapter = new PlanAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        return {
            adapter,
            logs,
            sent,
            setInteractive: (active: boolean): void => {
                interactive = active;
            },
            setDomain: (nextOutput: string, nextWorkspace: string): void => {
                output = nextOutput;
                workspace = nextWorkspace;
            },
            setRect: (id: string, rect: RaceRect): void => {
                rects.set(id, { ...rect });
            },
            setFullscreen: (id: string, on: boolean): void => {
                if (on) {
                    fullscreen.add(id);
                } else {
                    fullscreen.delete(id);
                }
            },
            setMaximized: (id: string, on: boolean): void => {
                if (on) {
                    maximized.add(id);
                } else {
                    maximized.delete(id);
                }
            },
            setScheduleThrows: (times: number): void => {
                scheduleThrows = times;
            },
            rectOf: (id: string): RaceRect => ({ ...(rects.get(id) as RaceRect) }),
            activeId: (): string => activeId,
        };
    }

    function racePlanned(
        correlation: string,
        output: string,
        workspace: string,
        geom: ReadonlyArray<{ window: string; rect: RaceRect }>,
    ): string {
        return JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            base_revision: 2,
            detail: { kind: "reconcile" },
            desired_geometry: geom.map((entry) => ({
                window: entry.window,
                leaf: `${entry.window}-leaf`,
                output,
                workspace,
                rect: entry.rect,
            })),
        });
    }

    function raceRetained(): ReadonlyArray<{ window: string; rect: RaceRect }> {
        return [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ];
    }

    function raceCommand(call: RaceSent | undefined): Record<string, unknown> {
        return (JSON.parse(call?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>;
    }

    function raceCorrelation(call: RaceSent | undefined): string {
        return (JSON.parse(call?.payload as string) as Record<string, unknown>)["correlation_id"] as string;
    }

    function markersOf(w: { adapter: PlanAdapter }): Map<string, { drags: string[]; dispatched: boolean }> {
        return (w.adapter as unknown as { dragRestore: Map<string, { drags: string[]; dispatched: boolean }> }).dragRestore;
    }

    it("synchronous dispatch failure reports refusal and never accepted", () => {
        const w = raceWorld();
        // The reply-wait timer throws synchronously: the pointer never sends,
        // its drop joins the marker, and the marker dispatches on the freed
        // slot. The tail must compare pointer flight identity, not bare
        // inFlight, so it reports refusal despite the marker now flying.
        w.setScheduleThrows(1);
        assert.equal(w.adapter.requestPointerResize("win-a", "right", 1000, undefined, undefined, "drag-400"), false);
        assert.equal(w.sent.length, 1, "exactly the marker follow-up dispatches");
        assert.deepEqual(raceCommand(w.sent[0]), { op: "reconcile" });
        assert.equal(w.logs.filter((line) => line.includes("drag-rejected") && line.includes("correlation=drag-400")).length, 1, "one rejection, no duplicate dispatch-failed");
        assert.ok(w.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-400") && line.includes("reason=timer-failed")));
        assert.ok(w.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-400") && line.includes("dispatch=dispatched")));
        const markerCorr = raceCorrelation(w.sent[0]);
        w.sent[0]?.callback(racePlanned(markerCorr, "out-1", "ws-1", raceRetained()));
        assert.deepEqual(w.rectOf("win-a"), { x: 0, y: 0, w: 600, h: 800 }, "retained geometry restored");
        assert.ok(w.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-400") && line.includes("outcome=applied") && line.includes(`plan=${markerCorr}`) && line.includes("covered=2/2")));
        assert.equal(w.sent.length, 1, "no retry after the marker settles");
        assert.equal(markersOf(w).size, 0);
    });

    it("invalid and unknown windows fail closed with no unrelated marker", () => {
        const w = raceWorld();
        // Unknown but well-formed window with a pre-observation refusal: no
        // retained anchor and absent from the fresh observation, so no domain
        // may claim it.
        assert.equal(w.adapter.requestPointerResize("win-ghost", "sideways", 1000, undefined, undefined, "drag-440"), false);
        assert.ok(w.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-440")));
        assert.ok(w.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-440") && line.includes("outcome=unavailable") && line.includes("plan=none")));
        // Invalid (non-opaque) window identity: never a marker either.
        assert.equal(w.adapter.requestPointerResize(123, "right", 1000, undefined, undefined, "drag-442"), false);
        assert.ok(w.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-identity"));
        assert.ok(w.logs.some((line) => line.includes("drag-reconcile-settled") && line.includes("correlation=drag-442") && line.includes("outcome=unavailable") && line.includes("plan=none")));
        assert.equal(markersOf(w).size, 0, "no unrelated marker lingers");
        assert.equal(w.sent.length, 0, "nothing dispatched without a scope");
        // A later valid drop still converges normally in its own domain.
        assert.equal(w.adapter.requestPointerResize("win-a", "right", 1000, undefined, undefined, "drag-443"), true);
    });
});
