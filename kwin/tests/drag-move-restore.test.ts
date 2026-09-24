import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { DRAG_MEASURE_VERDICT_TIMEOUT_MS } from "../src/drag-measure";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

interface FireSignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: { connect: (h: (p?: unknown) => void) => void; disconnect: (h: (p?: unknown) => void) => void };
}
function fireSignal(): FireSignal {
    const handlers: Array<(payload?: unknown) => void> = [];
    return {
        handlers,
        signal: {
            connect: (h): void => {
                handlers.push(h);
            },
            disconnect: (h): void => {
                const i = handlers.indexOf(h);
                if (i >= 0) handlers.splice(i, 1);
            },
        },
    };
}
function fireAll(s: FireSignal): void {
    for (const h of [...s.handlers]) h();
}
interface MoveWorld {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly startedA: FireSignal;
    readonly finishedA: FireSignal;
    readonly startedB: FireSignal;
    readonly finishedB: FireSignal;
    readonly geometry: FireSignal;
}
function moveWorld(): MoveWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const startedA = fireSignal();
    const finishedA = fireSignal();
    const startedB = fireSignal();
    const finishedB = fireSignal();
    const geometry = fireSignal();
    const added = fireSignal();
    const removed = fireSignal();
    const other = fireSignal();
    const makeWin = (
        id: string,
        rect: { x: number; y: number; w: number; h: number },
        started: FireSignal,
        finished: FireSignal,
    ): Record<string, unknown> => ({
        normalWindow: true,
        internalId: id,
        output,
        desktops: [desktop],
        frameGeometry: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        move: false,
        resize: false,
        moveResizedChanged: other.signal,
        frameGeometryChanged: geometry.signal,
        interactiveMoveResizeStarted: started.signal,
        interactiveMoveResizeFinished: finished.signal,
        fullScreenChanged: other.signal,
        fullScreen: false,
        maximizedChanged: other.signal,
        maximizeMode: 0,
    });
    const wins: Record<string, Record<string, unknown>> = {
        "win-a": makeWin("win-a", { x: 0, y: 0, w: 600, h: 800 }, startedA, finishedA),
        "win-b": makeWin("win-b", { x: 600, y: 0, w: 600, h: 800 }, startedB, finishedB),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins["win-a"],
        cursorPos: { x: 100, y: 100 },
        windowList: (): unknown[] => [wins["win-a"], wins["win-b"]],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1600, height: 1000 }),
        windowAdded: added.signal,
        windowRemoved: removed.signal,
        windowActivated: other.signal,
        screensChanged: other.signal,
        currentDesktopChanged: other.signal,
    };
    return { workspace, wins, startedA, finishedA, startedB, finishedB, geometry };
}
interface MoveMocks {
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}
function startMoveEntry(world: MoveWorld): { stop: () => void; mocks: MoveMocks } {
    const mocks: MoveMocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
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
            mocks.planCalls.push({ method, payload, callback });
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
function runDebounce(mocks: MoveMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === PLAN_DEBOUNCE_MS) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
}
function runMoveTimeout(mocks: MoveMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === DRAG_MEASURE_VERDICT_TIMEOUT_MS) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
}
function moveVerdict(finalRect: { x: number; y: number; w: number; h: number }, windowIdentity: string, correlation: string): string {
    return JSON.stringify({
        v: 1,
        cancelled: false,
        finalRect,
        windowIdentity,
        correlation,
        reason: "ok-moved",
    });
}
function payloads(mocks: MoveMocks): Array<Record<string, unknown>> {
    return mocks.planCalls.map((call) => JSON.parse(call.payload) as Record<string, unknown>);
}
function markerReply(correlation: string): string {
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
function planCorrelation(payload: Record<string, unknown>): string {
    return payload["correlation_id"] as string;
}
function baselineConverge(world: MoveWorld, mocks: MoveMocks): void {
    // Settle startup admission so the later hold starts from retained
    // allocation: one ordinary round, replying applied to every request.
    fireAll(world.geometry);
    runDebounce(mocks);
    for (const call of [...mocks.planCalls]) {
        try {
            const payload = JSON.parse(call.payload) as Record<string, unknown>;
            const corr = payload["correlation_id"] as string;
            if (typeof corr === "string" && corr.length > 0) {
                call.callback(markerReply(corr));
            }
        } catch (error) {
            void error;
        }
    }
    // Drain any chained follow-ups from the baseline apply.
    fireAll(world.geometry);
    runDebounce(mocks);
}

describe("tiled move-drop restore (Kate drags 29-31)", () => {
    it("drag 29: no mid-move plan, exactly one drop restore, applied terminal, no focus change", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        baselineConverge(world, mocks);
        const activeBefore = world.workspace["activeWindow"];
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        const callsAtStart = mocks.planCalls.length;
        const logsAtStart = mocks.logs.length;
        const writesAtStart = mocks.planCalls.length;
        // Mid-move Kate trace positions: the live rect actually travels
        // while held, so an unsuppressed adapter would reconcile and park.
        const trace: ReadonlyArray<{ x: number; y: number }> = [
            { x: 422, y: 88 },
            { x: 225, y: 193 },
            { x: 473, y: 115 },
        ];
        for (const pos of trace) {
            (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: pos.x, y: pos.y, width: 600, height: 800 };
            fireAll(world.geometry);
            runDebounce(mocks);
            assert.equal(mocks.planCalls.length, callsAtStart, `held tiled move dispatches no ordinary reconcile at ${pos.x},${pos.y}`);
            const frame = (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] as Record<string, unknown>;
            assert.deepEqual(frame, { x: pos.x, y: pos.y, width: 600, height: 800 }, `no project write fights the live drag at ${pos.x},${pos.y}`);
        }
        assert.ok(!mocks.logs.slice(logsAtStart).some((l) => l === "plasma-auto-tiler:plan:reconcile-parked"), "no parking while held");
        assert.ok(!mocks.logs.slice(logsAtStart).some((l) => l.includes("kind=reconcile") && l.includes("outcome=")), "no reconcile terminal while held");
        assert.equal(writesAtStart, callsAtStart);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        // Drop at the final trace position; retained domain must snap back.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 473, y: 115, w: 600, h: 800 }, "win-a", "drag-29"));
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-restore") && l.includes("correlation=drag-29")));
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-29") && l.includes("reason=move-dropped")));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "exactly one drop restore");
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(markerReply(markerCorr));
        assert.deepEqual(
            (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"],
            { x: 0, y: 0, width: 600, height: 800 },
            "drop restore snaps back to the retained allocation",
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-29") && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`) && l.includes("covered=2/2")),
            "per-drag applied terminal names the satisfying plan with full coverage",
        );
        assert.equal(world.workspace["activeWindow"], activeBefore, "no focus stealing");
        assert.ok(!payloads(mocks).some((p) => (p["command"] as Record<string, unknown>)?.["op"] === "focus"), "no focus op dispatched");
        // No retry: further debounces dispatch nothing more.
        const callsAfterApply = mocks.planCalls.length;
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsAfterApply, "no retry after applied restore");
        assert.equal(mocks.logs.filter((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-29") && l.includes("dispatch=dispatched")).length, 1, "one dispatch, never redispatched");
        stop();
    });

    it("concurrent holds: first drop defers while second held, second drop dispatches once for both", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        (world.wins["win-b"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.startedB);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 40, y: 0, w: 600, h: 800 }, "win-a", "drag-40"));
        assert.equal(mocks.planCalls.length - callsAtStart, 0, "first drop defers while the second hold is active");
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-40") && l.includes("reason=move-dropped")));
        assert.ok(mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-40") && l.includes("dispatch=deferred")));
        fireAll(world.finishedB);
        assert.equal(mocks.oracleCalls.length, 2);
        (world.wins["win-b"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[1] as (reply: unknown) => void)(moveVerdict({ x: 560, y: 0, w: 600, h: 800 }, "win-b", "drag-41"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "exactly one marker reconcile after the last guard release");
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(markerReply(markerCorr));
        for (const drag of ["drag-40", "drag-41"]) {
            assert.ok(
                mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes(`correlation=${drag}`) && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`)),
                `${drag} gets its own terminal naming the shared plan`,
            );
        }
        stop();
    });

    it("deferred marker survives a non-marker guard release: cancelled second drop still pumps the pending restore", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        // No geometry drift: the guard-release resync lands on an
        // already-equal snapshot, which previously stranded the marker.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        (world.wins["win-b"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.startedB);
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 0, y: 0, w: 600, h: 800 }, "win-a", "drag-42"));
        assert.equal(mocks.planCalls.length - callsAtStart, 0, "first drop defers while the second hold is active");
        fireAll(world.finishedB);
        (world.wins["win-b"] as Record<string, unknown>)["move"] = false;
        const cancelled = JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 600, y: 0, w: 600, h: 800 }, windowIdentity: "win-b", correlation: "drag-43", reason: "no-change" });
        (mocks.oracleCalls[1] as (reply: unknown) => void)(cancelled);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "exactly one marker reconcile after the non-marker guard release");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-43")), "cancelled is not a rejected drop");
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(markerReply(markerCorr));
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-42") && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`)),
            "pending drop still converges after the guard release",
        );
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-43")), "no invented terminal for the cancelled drop");
        stop();
    });

    it("tiled-at-start, floating-at-finish: single-use release, mismatch log, no marker, one ordinary resync", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        // Native float takes effect during the drag: tiled at Started,
        // floating (sticky-observed) at drop.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (world.wins["win-a"] as Record<string, unknown>)["onAllDesktops"] = true;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 120, y: 40, w: 600, h: 800 }, "win-a", "drag-50"));
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-move-floating-mismatch correlation=drag-50 start=tiled finish=floating"),
            "bounded start/finish mismatch without ids or coordinates",
        );
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-ignored") && l.includes("correlation=drag-50")));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-50")), "no marker for a floated drop");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-50")), "no restore for a floated drop");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-move-restore") && l.includes("correlation=drag-50")));
        // The branch releases the hold itself (settle finds no guard left):
        // the debounced resync runs but legitimately dispatches nothing on
        // the already-equal snapshot. Later drift then converges ordinarily,
        // proving the hold is gone rather than suppressing.
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length - callsAtStart, 0, "equal-snapshot resync dispatches nothing");
        (world.wins["win-b"] as Record<string, unknown>)["frameGeometry"] = { x: 620, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "later drift converges ordinarily after the single-use release");
        assert.deepEqual((JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"], { op: "reconcile" });
        stop();
    });

    it("floating-at-start, tiled-at-finish: never suppressed, never restored, mismatch logged", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        // Floating at Started: the move never enters the hold.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        (world.wins["win-a"] as Record<string, unknown>)["onAllDesktops"] = true;
        fireAll(world.startedA);
        // Live drift mid-hold still follows the ordinary path (unsuppressed).
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 120, y: 40, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "original float stays on the ordinary path while held");
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        // Native untile before the verdict: tiled at drop, but the move
        // started floating so it must stay native-only.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (world.wins["win-a"] as Record<string, unknown>)["onAllDesktops"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 60, y: 0, w: 600, h: 800 }, "win-a", "drag-51"));
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-move-floating-mismatch correlation=drag-51 start=floating finish=tiled"),
            "bounded start/finish mismatch without ids or coordinates",
        );
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-ignored") && l.includes("correlation=drag-51")));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-51")), "no marker for the original float");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-51")), "no restore for the original float");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-move-restore") && l.includes("correlation=drag-51")));
        stop();
    });

    it("drags 30-31 overlapping: shared marker, one dispatch, per-drag terminals on the same plan", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        // First drop dispatches while the slot is free; the second drop
        // arrives before the first marker is applied and shares it.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 40, y: 0, w: 600, h: 800 }, "win-a", "drag-30"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "first drop dispatches the single marker reconcile");
        (world.wins["win-b"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedB);
        // Starting the overlapping hold re-arms the pending marker (same
        // coalesced domain) instead of fighting it mid-drag.
        assert.ok(mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-30") && l.includes("dispatch=cancelled")), "overlapping hold re-arms the marker");
        fireAll(world.finishedB);
        assert.equal(mocks.oracleCalls.length, 2);
        (world.wins["win-b"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[1] as (reply: unknown) => void)(moveVerdict({ x: 560, y: 0, w: 600, h: 800 }, "win-b", "drag-31"));
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "overlapping drop re-dispatches once with both drags coalesced");
        // Both drags ride the same coalesced domain marker: the second
        // dispatch carries both correlations to one applied plan.
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-31") && l.includes("reason=move-dropped")));
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(markerReply(markerCorr));
        for (const drag of ["drag-30", "drag-31"]) {
            assert.ok(
                mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes(`correlation=${drag}`) && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`)),
                `${drag} gets its own terminal naming the shared plan`,
            );
        }
        stop();
    });

    it("floating move stays native-only: no suppression, no marker, ordinary flow unchanged", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        (world.wins["win-a"] as Record<string, unknown>)["onAllDesktops"] = true;
        fireAll(world.startedA);
        const callsAtStart = mocks.planCalls.length;
        // Floating churn follows the ordinary debounced path (may dispatch);
        // the move hold must not suppress it and must not park for it.
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.ok(mocks.planCalls.length >= callsAtStart, "floating move does not suppress ordinary flow");
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 120, y: 40, w: 600, h: 800 }, "win-a", "drag-32"));
        runDebounce(mocks);
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-ignored") && l.includes("correlation=drag-32")));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-32")), "no marker for floating");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-32")), "no restore for floating");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-move-restore") && l.includes("correlation=drag-32")));
        stop();
    });

    it("cancelled and null verdicts converge without inventing a drag terminal", () => {
        // Cancelled (Esc/no-change) never routes: ordinary resync only.
        {
            const world = moveWorld();
            const { stop, mocks } = startMoveEntry(world);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
            fireAll(world.startedA);
            fireAll(world.finishedA);
            assert.equal(mocks.oracleCalls.length, 1);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
            const cancelled = JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 0, y: 0, w: 600, h: 800 }, windowIdentity: "win-a", correlation: "drag-33", reason: "no-change" });
            (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelled);
            runDebounce(mocks);
            assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-33")), "cancelled is not a rejected drop");
            assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-33")), "no invented terminal");
            stop();
        }
        // Invalid reply (null verdict) releases the hold once via ordinary resync.
        {
            const world = moveWorld();
            const { stop, mocks } = startMoveEntry(world);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
            fireAll(world.startedA);
            fireAll(world.finishedA);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
            (mocks.oracleCalls[0] as (reply: unknown) => void)("not-json");
            runDebounce(mocks);
            assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-34")), "no terminal without a validated correlation");
            stop();
        }
    });

    it("missing verdict cannot hang: bounded timer releases the hold once without a marker", () => {
        const world = moveWorld();
        const { stop, mocks } = startMoveEntry(world);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        // No verdict ever arrives: the per-finish bound must release.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        runMoveTimeout(mocks);
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-timeout")), "bounded release is logged");
        // A late verdict after the timeout cannot route twice.
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 60, y: 0, w: 600, h: 800 }, "win-a", "drag-35"));
        assert.ok(mocks.logs.some((l) => l.includes("drag-start-missing") && l.includes("correlation=drag-35")), "late reply fails closed");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-35")), "no late marker");
        stop();
    });
});
