import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DragOraclePull,
    identifyGrabbedEdges,
    identifyPressGrabbed,
    parseDragOracleVerdict,
    resolveOracleResizeTargets,
} from "../src/drag-oracle-pull";
import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

function verdictBase(finalRect: { x: number; y: number; w: number; h: number }, correlation: string): Record<string, unknown> {
    return {
        v: 1,
        cancelled: false,
        finalRect,
        windowIdentity: "win-a",
        correlation,
        reason: "ok-moved",
    };
}

describe("drag press strict parse", () => {
    it("accepts the legacy six-field verdict with no press", () => {
        const parsed = parseDragOracleVerdict(JSON.stringify(verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-1")));
        assert.ok(parsed !== null);
        assert.equal(parsed.press, undefined);
    });

    it("accepts the seven-field verdict with an exact bounded press", () => {
        for (const binding of ["configured", "default"]) {
            const body = { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-2"), press: { x: 250.5, y: 100.25, binding } };
            const parsed = parseDragOracleVerdict(JSON.stringify(body));
            assert.ok(parsed !== null);
            assert.deepEqual(parsed.press, { x: 250.5, y: 100.25, binding });
        }
    });

    it("rejects unknown top-level keys and malformed press objects", () => {
        const good = { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: { x: 1, y: 2, binding: "configured" } };
        const cases: unknown[] = [
            // Unknown seventh key instead of press.
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), extra: 1 },
            // Eighth key alongside a valid press.
            { ...good, extra: 1 },
            // Press shape violations.
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: { x: 1, y: 2 } },
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: { x: 1, y: 2, binding: "configured", z: 0 } },
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: { x: "1", y: 2, binding: "configured" } },
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: { x: 1, y: 2, binding: "live" } },
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: { x: 16384.5, y: 2, binding: "configured" } },
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: { x: 1, y: -16385, binding: "default" } },
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: null },
            { ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-3"), press: [1, 2] },
            // Overflow literal parses to a non-finite double.
            `{"v":1,"cancelled":false,"finalRect":{"x":5,"y":0,"w":100,"h":100},"windowIdentity":"win-a","correlation":"drag-3","reason":"ok-moved","press":{"x":1e999,"y":2,"binding":"configured"}}`,
        ];
        for (const reply of cases) {
            assert.equal(parseDragOracleVerdict(typeof reply === "string" ? reply : JSON.stringify(reply)), null, JSON.stringify(reply).slice(0, 120));
        }
    });

    it("fails a malformed press closed at the pull with no route call", () => {
        const logs: string[] = [];
        let routed = 0;
        const pull = new DragOraclePull({
            callDbus: (_s, _p, _i, _m, callback): void => {
                callback(JSON.stringify({ ...verdictBase({ x: 5, y: 0, w: 100, h: 100 }, "drag-4"), press: { x: 1, y: 2, binding: "live" } }));
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
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-reply-invalid correlation=none"));
    });
});

describe("drag press thirds classification", () => {
    // Recorded trace values (plasma-auto-tiler-dev log): drag-27 started
    // 558,52,970,315 with pointerStart 727,318, which the 64px Started gate
    // reads as single-axis down while KWin moved left and bottom.
    it("classifies recorded drag-27 by thirds while the Started gate reads single-axis", () => {
        const start = { x: 558, y: 52, w: 970, h: 315 };
        const pointer = { x: 727, y: 318 };
        const started = identifyGrabbedEdges(start, pointer);
        assert.ok(started !== null);
        assert.equal(started.source, "nearest-pointer");
        assert.deepEqual(started.grabbed, { horizontal: null, vertical: "down" });
        const pressed = identifyPressGrabbed(start, { x: 727, y: 318, binding: "configured" });
        assert.ok(pressed !== null);
        assert.equal(pressed.source, "kwin-thirds");
        assert.deepEqual(pressed.grabbed, { horizontal: "left", vertical: "down" });
    });

    // Recorded drag-33 started 558,52,970,716 with pointerStart 604,714,
    // which the gate reads as single-axis left. Outside presses stay null
    // so the caller keeps the Started capture.
    it("classifies recorded drag-33 by thirds and rejects outside presses", () => {
        const start = { x: 558, y: 52, w: 970, h: 716 };
        const started = identifyGrabbedEdges(start, { x: 604, y: 714 });
        assert.ok(started !== null);
        assert.deepEqual(started.grabbed, { horizontal: "left", vertical: null });
        const pressed = identifyPressGrabbed(start, { x: 604, y: 714, binding: "configured" });
        assert.ok(pressed !== null);
        assert.deepEqual(pressed.grabbed, { horizontal: "left", vertical: "down" });
        assert.equal(identifyPressGrabbed(start, { x: 0, y: 0, binding: "configured" }), null);
        assert.equal(identifyPressGrabbed(start, null), null);
    });
});

// Minimal entry harness: one resizable window under test plus a sibling.
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
interface PressWorld {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly startedA: FireSignal;
    readonly finishedA: FireSignal;
}
function pressWorld(start: { x: number; y: number; w: number; h: number }, cursor: { x: number; y: number }): PressWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const startedA = fireSignal();
    const finishedA = fireSignal();
    const startedB = fireSignal();
    const finishedB = fireSignal();
    const added = fireSignal();
    const removed = fireSignal();
    const other = fireSignal();
    const makeWin = (id: string, rect: { x: number; y: number; w: number; h: number }, started: FireSignal, finished: FireSignal): Record<string, unknown> => ({
        normalWindow: true,
        internalId: id,
        output,
        desktops: [desktop],
        frameGeometry: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        move: false,
        resize: true,
        moveResizedChanged: other.signal,
        frameGeometryChanged: other.signal,
        interactiveMoveResizeStarted: started.signal,
        interactiveMoveResizeFinished: finished.signal,
        fullScreenChanged: other.signal,
        fullScreen: false,
        maximizedChanged: other.signal,
        maximizeMode: 0,
    });
    const wins: Record<string, Record<string, unknown>> = {
        "win-a": makeWin("win-a", start, startedA, finishedA),
        "win-b": makeWin("win-b", { x: start.x + start.w, y: start.y, w: 200, h: start.h }, startedB, finishedB),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins["win-a"],
        cursorPos: cursor,
        windowList: (): unknown[] => [wins["win-a"], wins["win-b"]],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        windowAdded: added.signal,
        windowRemoved: removed.signal,
        windowActivated: other.signal,
        screensChanged: other.signal,
        currentDesktopChanged: other.signal,
    };
    return { workspace, wins, startedA, finishedA };
}
interface PressMocks {
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}
function startPressEntry(world: PressWorld): { stop: () => void; mocks: PressMocks } {
    const mocks: PressMocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
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
function runDebounce(mocks: PressMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === PLAN_DEBOUNCE_MS) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
}
function pointerCommands(mocks: PressMocks): Array<Record<string, unknown>> {
    return mocks.planCalls
        .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
        .filter((payload) => (payload["command"] as Record<string, unknown>)?.["op"] === "pointer-resize")
        .map((payload) => payload["command"] as Record<string, unknown>);
}

describe("drag press end-to-end trace corners", () => {
    // Exact recorded trace values (plasma-auto-tiler-dev log lines
    // 273/330/754/802/932): start rect, pointerStart, and finalRect per
    // drag. Without press the Started gate reproduced the logged
    // single-axis miss; the synthetic press reuses the Started pointer.
    const drags = [
        { n: 27, start: { x: 558, y: 52, w: 970, h: 315 }, pointer: { x: 727, y: 318 }, final: { x: 388, y: 52, w: 1141, h: 504 }, missed: { horizontal: null, vertical: "down" }, left: 388, down: 556 },
        { n: 28, start: { x: 558, y: 52, w: 970, h: 504 }, pointer: { x: 688, y: 516 }, final: { x: 326, y: 52, w: 1202, h: 648 }, missed: { horizontal: null, vertical: "down" }, left: 326, down: 700 },
        { n: 32, start: { x: 558, y: 52, w: 970, h: 648 }, pointer: { x: 629, y: 657 }, final: { x: 416, y: 52, w: 1113, h: 752 }, missed: { horizontal: null, vertical: "down" }, left: 416, down: 804 },
        { n: 33, start: { x: 558, y: 52, w: 970, h: 716 }, pointer: { x: 604, y: 714 }, final: { x: 404, y: 52, w: 1125, h: 835 }, missed: { horizontal: "left", vertical: null }, left: 404, down: 887 },
        { n: 35, start: { x: 412, y: 52, w: 1116, h: 716 }, pointer: { x: 463, y: 723 }, final: { x: 259, y: 52, w: 1269, h: 792 }, missed: { horizontal: null, vertical: "down" }, left: 259, down: 844 },
    ] as const;
    for (const drag of drags) {
        it(`trace drag ${drag.n} with press routes one left+down dual-axis intent`, () => {
            const world = pressWorld(drag.start, drag.pointer);
            const { stop, mocks } = startPressEntry(world);
            // The Started capture alone reproduces the logged gate miss.
            const startedOnly = identifyGrabbedEdges(drag.start, drag.pointer);
            assert.ok(startedOnly !== null && startedOnly.source === "nearest-pointer");
            assert.deepEqual(startedOnly.grabbed, drag.missed);
            fireAll(world.startedA);
            fireAll(world.finishedA);
            assert.equal(mocks.oracleCalls.length, 1);
            const reply = JSON.stringify({
                ...verdictBase(drag.final, `drag-${drag.n}`),
                press: { x: drag.pointer.x, y: drag.pointer.y, binding: "configured" },
            });
            (mocks.oracleCalls[0] as (reply: unknown) => void)(reply);
            runDebounce(mocks);
            const commands = pointerCommands(mocks);
            assert.equal(commands.length, 1);
            assert.deepEqual(commands[0], {
                op: "pointer-resize",
                window: "win-a",
                direction: "left",
                boundary: drag.left,
                direction2: "down",
                boundary2: drag.down,
            });
            // Targets resolve from the authoritative final rect.
            const resolved = resolveOracleResizeTargets(drag.start, drag.final, { horizontal: "left", vertical: "down" });
            assert.ok(resolved !== null);
            assert.deepEqual(resolved.targets, [
                { direction: "left", boundary: drag.left },
                { direction: "down", boundary: drag.down },
            ]);
            assert.ok(
                mocks.logs.some((line) => line.includes(`correlation=drag-${drag.n}`) && line.includes("grabbed=left+down") && line.includes("source=kwin-thirds")),
                "press route logs the dual-axis thirds classification",
            );
            assert.ok(!mocks.logs.some((line) => line.includes("drag-press-fallback") && line.includes(`correlation=drag-${drag.n}`)), "no fallback when the press is used");
            stop();
        });
    }

    // Exact recorded physical corners (log lines 153/189): both classify
    // left+down without press and still route one dual-axis request. The
    // 1px right jitter on drag-25 is carried as ignored, never a rejection.
    it("physical corners 24/25 without press route one left+down dual-axis intent", () => {
        const corners = [
            { n: 24, start: { x: 772, y: 52, w: 756, h: 478 }, pointer: { x: 774, y: 538 }, final: { x: 594, y: 52, w: 934, h: 704 }, left: 594, down: 756, ignored: "none" },
            { n: 25, start: { x: 602, y: 52, w: 926, h: 704 }, pointer: { x: 603, y: 744 }, final: { x: 708, y: 52, w: 821, h: 315 }, left: 708, down: 367, ignored: "right:1528->1529" },
        ] as const;
        for (const corner of corners) {
            const world = pressWorld(corner.start, corner.pointer);
            const { stop, mocks } = startPressEntry(world);
            fireAll(world.startedA);
            fireAll(world.finishedA);
            assert.equal(mocks.oracleCalls.length, 1);
            (mocks.oracleCalls[0] as (reply: unknown) => void)(JSON.stringify(verdictBase(corner.final, `drag-${corner.n}`)));
            runDebounce(mocks);
            const commands = pointerCommands(mocks);
            assert.equal(commands.length, 1);
            assert.deepEqual(commands[0], {
                op: "pointer-resize",
                window: "win-a",
                direction: "left",
                boundary: corner.left,
                direction2: "down",
                boundary2: corner.down,
            });
            assert.ok(
                mocks.logs.some((line) => line.includes(`correlation=drag-${corner.n}`) && line.includes("grabbed=left+down") && line.includes("source=nearest-pointer") && line.includes(`targets=left:${corner.left},down:${corner.down}`) && line.includes(`ignored=${corner.ignored}`)),
                `corner ${corner.n} keeps its recorded physical classification`,
            );
            assert.ok(mocks.logs.some((line) => line.includes("drag-press-fallback") && line.includes(`correlation=drag-${corner.n}`)), "absent press logs one correlated fallback");
            stop();
        }
    });

    // Recorded drag-27 without press reproduces the logged single-axis
    // fallback exactly (log line 250: down:556, left ignored). Stale,
    // other-window, and unknown presses all arrive as absent native
    // evidence: the verdict carries no press key.
    it("absent press on recorded drag-27 falls back to the logged single axis with a log", () => {
        const start = { x: 558, y: 52, w: 970, h: 315 };
        const world = pressWorld(start, { x: 727, y: 318 });
        const { stop, mocks } = startPressEntry(world);
        fireAll(world.startedA);
        fireAll(world.finishedA);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(
            JSON.stringify(verdictBase({ x: 388, y: 52, w: 1141, h: 504 }, "drag-40")),
        );
        runDebounce(mocks);
        const commands = pointerCommands(mocks);
        assert.equal(commands.length, 1);
        assert.deepEqual(commands[0], { op: "pointer-resize", window: "win-a", direction: "down", boundary: 556 });
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-press-fallback correlation=drag-40 source=nearest-pointer"));
        assert.ok(
            mocks.logs.some((line) => line.includes("correlation=drag-40") && line.includes("grabbed=-+down") && line.includes("source=nearest-pointer") && line.includes("targets=down:556")),
        );
        for (const line of mocks.logs) {
            assert.ok(!line.includes("win-a-"), "no raw native ids at normal level");
        }
        stop();
    });

    it("never uses a press before the entry verifies ref, identity, and resize", () => {
        // Recorded drag-27 geometry throughout; only the verification
        // dimension under test varies.
        const start = { x: 558, y: 52, w: 970, h: 315 };
        const cursor = { x: 727, y: 318 };
        const final = { x: 388, y: 52, w: 1141, h: 504 };
        const press = { x: 727, y: 318, binding: "configured" };
        // Wrong-window identity: no route despite a well-formed press.
        {
            const world = pressWorld(start, cursor);
            const { stop, mocks } = startPressEntry(world);
            fireAll(world.startedA);
            fireAll(world.finishedA);
            (mocks.oracleCalls[0] as (reply: unknown) => void)(
                JSON.stringify({ ...verdictBase(final, "drag-41"), windowIdentity: "win-b", press }),
            );
            runDebounce(mocks);
            assert.equal(pointerCommands(mocks).length, 0);
            stop();
        }
        // Move gesture start: the press never classifies thirds. A tiled
        // move restores its retained domain once through the coalesced
        // marker; a floating move stays native-only and ignored.
        {
            const world = pressWorld(start, cursor);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
            (world.wins["win-a"] as Record<string, unknown>)["resize"] = false;
            const { stop, mocks } = startPressEntry(world);
            fireAll(world.startedA);
            fireAll(world.finishedA);
            (mocks.oracleCalls[0] as (reply: unknown) => void)(
                JSON.stringify({ ...verdictBase(final, "drag-42"), press }),
            );
            runDebounce(mocks);
            assert.equal(pointerCommands(mocks).length, 0);
            assert.ok(mocks.logs.some((line) => line.includes("drag-move-restore") && line.includes("correlation=drag-42")));
            assert.ok(mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-42") && line.includes("reason=move-dropped")));
            assert.ok(mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-42") && line.includes("dispatch=dispatched")));
            assert.ok(!mocks.logs.some((line) => line.includes("correlation=drag-42") && line.includes("grabbed=")), "press never classifies a move");
            assert.ok(!mocks.logs.some((line) => line.includes("drag-move-ignored") && line.includes("correlation=drag-42")));
            stop();
        }
        // Floating move: native-only, never suppressed and never marked.
        {
            const world = pressWorld(start, cursor);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
            (world.wins["win-a"] as Record<string, unknown>)["resize"] = false;
            (world.wins["win-a"] as Record<string, unknown>)["onAllDesktops"] = true;
            const { stop, mocks } = startPressEntry(world);
            fireAll(world.startedA);
            fireAll(world.finishedA);
            (mocks.oracleCalls[0] as (reply: unknown) => void)(
                JSON.stringify({ ...verdictBase(final, "drag-45"), press }),
            );
            runDebounce(mocks);
            assert.equal(pointerCommands(mocks).length, 0);
            assert.ok(mocks.logs.some((line) => line.includes("drag-move-ignored") && line.includes("correlation=drag-45")));
            assert.ok(!mocks.logs.some((line) => line.includes("drag-rejected") && line.includes("correlation=drag-45")));
            assert.ok(!mocks.logs.some((line) => line.includes("drag-reconcile") && line.includes("correlation=drag-45")));
            stop();
        }
    });

    it("drops a stale async reply without routing and serves the fresh finish once", () => {
        // Recorded drag-27 geometry: the fresh finish routes left:388 down:556.
        const start = { x: 558, y: 52, w: 970, h: 315 };
        const cursor = { x: 727, y: 318 };
        const final = { x: 388, y: 52, w: 1141, h: 504 };
        const world = pressWorld(start, cursor);
        const { stop, mocks } = startPressEntry(world);
        fireAll(world.startedA);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        // A newer start lands before the first async reply.
        fireAll(world.startedA);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 2);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(
            JSON.stringify({ ...verdictBase(final, "drag-43"), press: { x: 727, y: 318, binding: "configured" } }),
        );
        assert.equal(pointerCommands(mocks).length, 0);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:route-diag:drag-start-missing correlation=drag-43"));
        (mocks.oracleCalls[1] as (reply: unknown) => void)(
            JSON.stringify({ ...verdictBase(final, "drag-44"), press: { x: 727, y: 318, binding: "configured" } }),
        );
        const commands = pointerCommands(mocks);
        assert.equal(commands.length, 1);
        assert.deepEqual(commands[0], { op: "pointer-resize", window: "win-a", direction: "left", boundary: 388, direction2: "down", boundary2: 556 });
        stop();
    });
});
