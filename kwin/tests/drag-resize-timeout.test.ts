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
interface ResizeWorld {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly startedA: FireSignal;
    readonly finishedA: FireSignal;
    readonly geometry: FireSignal;
}
function resizeWorld(): ResizeWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const startedA = fireSignal();
    const finishedA = fireSignal();
    const geometry = fireSignal();
    const added = fireSignal();
    const removed = fireSignal();
    const other = fireSignal();
    const makeWin = (
        id: string,
        rect: { x: number; y: number; w: number; h: number },
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
        interactiveMoveResizeStarted: startedA.signal,
        interactiveMoveResizeFinished: finishedA.signal,
        fullScreenChanged: other.signal,
        fullScreen: false,
        maximizedChanged: other.signal,
        maximizeMode: 0,
    });
    const wins: Record<string, Record<string, unknown>> = {
        "win-a": makeWin("win-a", { x: 0, y: 0, w: 600, h: 800 }),
        "win-b": makeWin("win-b", { x: 600, y: 0, w: 600, h: 800 }),
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
    return { workspace, wins, startedA, finishedA, geometry };
}
interface ResizeMocks {
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}
function startResizeEntry(world: ResizeWorld): { stop: () => void; mocks: ResizeMocks } {
    const mocks: ResizeMocks = { planCalls: [], timers: [], logs: [] };
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
        oracleCallDbus: (_s, _p, _i, _m, _callback): void => {},
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
function runDebounce(mocks: ResizeMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === PLAN_DEBOUNCE_MS) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
}
function runResizeTimeout(mocks: ResizeMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === DRAG_MEASURE_VERDICT_TIMEOUT_MS) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
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
function baselineConverge(world: ResizeWorld, mocks: ResizeMocks): void {
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
    fireAll(world.geometry);
    runDebounce(mocks);
}
function resizeTimeouts(mocks: ResizeMocks): number {
    return mocks.logs.filter((l) => l.includes("drag-resize-timeout") && l.includes("correlation=resize-start-") && l.includes("cause=missing-finished") && l.includes("recovery=resize-hold-released")).length;
}

describe("resize hold expiry (row B)", () => {
    it("held resize survives past the old timeout while observed resizing; observed exit releases ordinarily", () => {
        const world = resizeWorld();
        const { stop, mocks } = startResizeEntry(world);
        baselineConverge(world, mocks);

        // Normal Finish converges with no timeout line: no Started timer exists.
        (world.wins["win-a"] as Record<string, unknown>)["resize"] = true;
        fireAll(world.startedA);
        assert.equal(
            mocks.timers.filter((t) => !t.cancelled && t.delayMs === DRAG_MEASURE_VERDICT_TIMEOUT_MS).length,
            0,
            "no Started-keyed resize expiry armed",
        );
        (world.wins["win-a"] as Record<string, unknown>)["resize"] = false;
        fireAll(world.finishedA);
        runDebounce(mocks);
        runResizeTimeout(mocks);
        assert.equal(resizeTimeouts(mocks), 0, "finished hold emits no timeout");
        assert.ok(
            !mocks.logs.some((l) => l.includes("drag-resize-timeout") && /win-a|internalId/.test(l)),
            "no native identity in resize logs",
        );

        // Paused mid-resize past the old bound: Started with no Finished, no
        // steps, while KWin still reports resize===true. The hold persists:
        // time advancing past DRAG_MEASURE_VERDICT_TIMEOUT_MS retires
        // nothing and dispatches no ordinary reconcile.
        const callsBeforeHold = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["resize"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 10, y: 0, width: 590, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBeforeHold, "held resize dispatches no ordinary reconcile");
        runResizeTimeout(mocks);
        assert.equal(resizeTimeouts(mocks), 0, "no missing-Finished expiry while still observed resizing");
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 20, y: 0, width: 580, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBeforeHold, "paused resize past the old bound still dispatches nothing");

        // Observed exit without Finished: KWin reports resize===false, so the
        // next ordinary observation reconciles with no drag terminal.
        // (Regression: the removed missing-Finished timer retiled here
        // mid-gesture while the window was still observed resizing.)
        (world.wins["win-a"] as Record<string, unknown>)["resize"] = false;
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 30, y: 0, width: 570, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBeforeHold + 1, "observed exit releases the hold ordinarily");
        assert.deepEqual(
            (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"],
            { op: "reconcile" },
            "observed exit invents no drag terminal",
        );

        // A newer move Start keeps its own hold. Releasing the resize hold
        // via observed exit must not consume that move Start.
        (world.wins["win-a"] as Record<string, unknown>)["resize"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["resize"] = false;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        const beforeMoveFinish = resizeTimeouts(mocks);
        runResizeTimeout(mocks);
        assert.equal(resizeTimeouts(mocks), beforeMoveFinish, "new move Start introduces no resize terminal");
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        fireAll(world.finishedA);
        assert.equal(resizeTimeouts(mocks), beforeMoveFinish, "move Finish does not fabricate another resize terminal");
        stop();
    });
});
