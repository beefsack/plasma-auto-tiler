import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS, PLAN_TIMEOUT_MS, PlanAdapter, type PlanAdapterEnv, type PlanObserved } from "../src/plan-adapter";
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
interface DropWorld {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly startedA: FireSignal;
    readonly finishedA: FireSignal;
    readonly startedB: FireSignal;
    readonly finishedB: FireSignal;
    readonly geometry: FireSignal;
    readonly topology: FireSignal;
}
function dropWorld(): DropWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const startedA = fireSignal();
    const finishedA = fireSignal();
    const startedB = fireSignal();
    const finishedB = fireSignal();
    const geometry = fireSignal();
    const topology = fireSignal();
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
        desktopsChanged: topology.signal,
        currentDesktopChanged: other.signal,
    };
    return { workspace, wins, startedA, finishedA, startedB, finishedB, geometry, topology };
}
interface DropMocks {
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}
function startDropEntry(world: DropWorld): { stop: () => void; mocks: DropMocks } {
    const mocks: DropMocks = { planCalls: [], oracleCalls: [], timers: [], logs: [] };
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
function runDebounce(mocks: DropMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === PLAN_DEBOUNCE_MS) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
}
function runMoveTimeout(mocks: DropMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === DRAG_MEASURE_VERDICT_TIMEOUT_MS) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
}
function runPlanTimeout(mocks: DropMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === PLAN_TIMEOUT_MS) timer.callback();
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
function payloads(mocks: DropMocks): Array<Record<string, unknown>> {
    return mocks.planCalls.map((call) => JSON.parse(call.payload) as Record<string, unknown>);
}
function planCorrelation(payload: Record<string, unknown>): string {
    return payload["correlation_id"] as string;
}
function retainedReply(correlation: string): string {
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
function dragDropReply(correlation: string): string {
    // Planned edge drop: full geometry plus focus preserved on the moved
    // window, no operation or preconditions (single-domain drag-drop).
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "drag-drop", capability: "place-tiled" },
        desired_geometry: [
            { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 400 } },
            { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 400, w: 1200, h: 400 } },
        ],
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "win-a-leaf" },
    });
}
function rejectedReply(correlation: string, kind: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "rejected",
        kind,
    });
}
function baselineConverge(world: DropWorld, mocks: DropMocks): void {
    // Settle startup admission so later drops start from retained
    // allocation: one ordinary round, replying applied to every request.
    fireAll(world.geometry);
    runDebounce(mocks);
    for (const call of [...mocks.planCalls]) {
        try {
            const payload = JSON.parse(call.payload) as Record<string, unknown>;
            const corr = payload["correlation_id"] as string;
            if (typeof corr === "string" && corr.length > 0) {
                call.callback(retainedReply(corr));
            }
        } catch (error) {
            void error;
        }
    }
    // Drain any chained follow-ups from the baseline apply.
    fireAll(world.geometry);
    runDebounce(mocks);
}
function dropWinA(world: DropWorld, mocks: DropMocks, pointer: { x: number; y: number }, correlation: string): void {
    (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
    fireAll(world.startedA);
    world.workspace["cursorPos"] = { x: pointer.x, y: pointer.y };
    fireAll(world.finishedA);
    (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
    (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
        moveVerdict({ x: pointer.x, y: pointer.y, w: 600, h: 800 }, "win-a", correlation),
    );
}

function staleDirectAdapter(
    observed: PlanObserved,
    hidden: ReadonlyArray<PlanObserved>,
): { adapter: PlanAdapter; planCalls: Array<{ payload: string; callback: (reply: unknown) => void }>; logs: string[] } {
    const planCalls: Array<{ payload: string; callback: (reply: unknown) => void }> = [];
    const logs: string[] = [];
    const env: PlanAdapterEnv = {
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
            planCalls.push({ payload, callback });
        },
        scheduleOnce: (): (() => void) => (): void => {},
        log: (message): void => {
            logs.push(message);
        },
        observe: (): PlanObserved | null => observed,
        observeHidden: (): ReadonlyArray<PlanObserved> => hidden,
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (): boolean => true,
        setActive: (): boolean => true,
        active: () => observed.activeRef,
        subscribe: (): (() => void) => (): void => {},
    };
    const adapter = new PlanAdapter(env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return { adapter, planCalls, logs };
}

function directObserved(
    output: string,
    workspace: string,
    bounds: { x: number; y: number; w: number; h: number },
    winId: string,
    ref: object,
    fp: string,
): PlanObserved {
    return {
        domainOutput: output,
        domainWorkspace: workspace,
        domainBounds: { ...bounds },
        domainGap: 8,
        domainOuterGap: 8,
        focusedId: winId,
        windows: [
            { id: winId, ref, rect: { x: bounds.x, y: bounds.y, w: 60, h: 60 }, output, workspace, fullscreen: false, maximized: false },
        ],
        activeRef: ref,
        fingerprint: fp,
        revalidate: () => true,
    };
}

function plannedReconcileReply(correlation: string, window: string, output: string, workspace: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "reconcile" },
        desired_geometry: [
            { window, leaf: `${window}-leaf`, output, workspace, rect: { x: 0, y: 0, w: 600, h: 800 } },
        ],
    });
}

describe("tiled drag-drop through the Planner", () => {
    it("accepted edge drop dispatches drag-drop with the finish pointer and applies without marker or focus change", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const activeBefore = world.workspace["activeWindow"];
        const callsAtStart = mocks.planCalls.length;
        // Mid-move the live rect travels while held: no ordinary reconcile
        // may park or fight the drag.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 422, y: 88, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsAtStart, "held tiled move dispatches no ordinary reconcile");
        // Drop on the top edge of the sibling tile.
        world.workspace["cursorPos"] = { x: 900, y: 5 };
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 900, y: 5, w: 600, h: 800 }, "win-a", "drag-60"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-60 accepted=true"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "exactly one drag-drop dispatch");
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const dropPayload = JSON.parse(dropCall.payload) as Record<string, unknown>;
        assert.deepEqual(dropPayload["command"], { op: "drag-drop", window: "win-a", x: 900, y: 5 });
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-60")), "accepted drop arms no marker");
        const dropCorr = planCorrelation(dropPayload);
        dropCall.callback(dragDropReply(dropCorr));
        assert.deepEqual(
            (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"],
            { x: 0, y: 0, width: 1200, height: 400 },
            "planned drop geometry applies to the moved window",
        );
        assert.deepEqual(
            (world.wins["win-b"] as Record<string, unknown>)["frameGeometry"],
            { x: 0, y: 400, width: 1200, height: 400 },
            "planned drop geometry applies to the sibling",
        );
        assert.equal(world.workspace["activeWindow"], activeBefore, "no focus stealing");
        assert.ok(!payloads(mocks).some((p) => (p["command"] as Record<string, unknown>)?.["op"] === "focus"), "no focus op dispatched");
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${dropCorr}`) && l.includes("kind=drag-drop") && l.includes("outcome=planned-applied")),
            "terminal names the satisfying plan correlation",
        );
        // No retry: further debounces dispatch nothing more.
        const callsAfterApply = mocks.planCalls.length;
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsAfterApply, "no retry after applied drop");
        stop();
    });

    it("refused center drop snaps back once through the one-shot marker", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const activeBefore = world.workspace["activeWindow"];
        const callsAtStart = mocks.planCalls.length;
        dropWinA(world, mocks, { x: 900, y: 400 }, "drag-61");
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-61 accepted=true"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "exactly one drag-drop dispatch");
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const dropCorr = planCorrelation(JSON.parse(dropCall.payload) as Record<string, unknown>);
        // Center (stack fact) refuses: the Planner keeps canonical topology
        // with no pending drag, and the adapter restores once.
        dropCall.callback(rejectedReply(dropCorr, "unsupported-capability"));
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-61") && l.includes("reason=unsupported-capability")));
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "refusal dispatches exactly one marker reconcile");
        const markerCommand = (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"];
        assert.deepEqual(markerCommand, { op: "reconcile" });
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(retainedReply(markerCorr));
        assert.deepEqual(
            (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"],
            { x: 0, y: 0, width: 600, height: 800 },
            "refused drop snaps back to the retained allocation",
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-61") && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`) && l.includes("covered=2/2")),
            "per-drag applied terminal names the satisfying plan with full coverage",
        );
        assert.equal(world.workspace["activeWindow"], activeBefore, "no focus stealing on refusal");
        const callsAfterApply = mocks.planCalls.length;
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsAfterApply, "no retry after applied restore");
        assert.equal(mocks.logs.filter((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-61") && l.includes("dispatch=dispatched")).length, 1, "one dispatch, never redispatched");
        stop();
    });

    it("outside-area drop carries a valid snapshot and restores on refusal", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        // Native drop position outside the work area: the carried snapshot
        // must substitute the retained allocation instead of shipping an
        // invalid out-of-bounds member.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 2000, y: 2000, width: 600, height: 800 };
        world.workspace["cursorPos"] = { x: 2000, y: 2000 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 2000, y: 2000, w: 600, h: 800 }, "win-a", "drag-62"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "out-of-area drop still dispatches");
        const dropPayload = JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(dropPayload["command"], { op: "drag-drop", window: "win-a", x: 2000, y: 2000 });
        const bounds = ((dropPayload["domain"] as Record<string, unknown>)["bounds"] as Record<string, number>);
        const bx = Number(bounds["x"]);
        const by = Number(bounds["y"]);
        const bw = Number(bounds["w"]);
        const bh = Number(bounds["h"]);
        for (const entry of dropPayload["windows"] as Array<Record<string, unknown>>) {
            const rect = entry["rect"] as Record<string, number>;
            const rx = Number(rect["x"]);
            const ry = Number(rect["y"]);
            const rw = Number(rect["w"]);
            const rh = Number(rect["h"]);
            assert.ok(
                rx >= bx && ry >= by && rx + rw <= bx + bw && ry + rh <= by + bh,
                `carried member stays in area: ${JSON.stringify(rect)}`,
            );
        }
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const dropCorr = planCorrelation(JSON.parse(dropCall.payload) as Record<string, unknown>);
        dropCall.callback(rejectedReply(dropCorr, "unchanged"));
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "outside refusal restores once through the marker");
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(retainedReply(markerCorr));
        assert.deepEqual(
            (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"],
            { x: 0, y: 0, width: 600, height: 800 },
            "outside drop snaps back to the retained allocation",
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-62") && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`)),
            "per-drag terminal names the restoring plan",
        );
        stop();
    });

    it("unfocused source dispatches mover-bound and applies without forcing native focus", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        // The dragged window is not the active window (Meta+drag without
        // focus): the drop binds the observed mover like the preview, so the
        // Planner sees mover==focused and plans instead of refusing
        // focus-mismatch. Dispatch does not change native focus.
        world.workspace["activeWindow"] = world.wins["win-b"];
        const callsAtStart = mocks.planCalls.length;
        dropWinA(world, mocks, { x: 100, y: 100 }, "drag-63");
        assert.equal(mocks.planCalls.length - callsAtStart, 1);
        const dropPayload = JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(dropPayload["command"], { op: "drag-drop", window: "win-a", x: 100, y: 100 });
        assert.equal(dropPayload["focused_window"], "win-a");
        assert.equal(world.workspace["activeWindow"], world.wins["win-b"], "no focus forced onto the source");
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const dropCorr = planCorrelation(JSON.parse(dropCall.payload) as Record<string, unknown>);
        dropCall.callback(dragDropReply(dropCorr));
        assert.deepEqual(
            (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"],
            { x: 0, y: 0, width: 1200, height: 400 },
            "mover-bound drop geometry applies",
        );
        assert.ok(!mocks.logs.some((l) => l.includes("focus-mismatch")), "mover-bound drop draws no focus-mismatch");
        assert.ok(!payloads(mocks).some((p) => (p["command"] as Record<string, unknown>)?.["op"] === "focus"), "no focus op dispatched");
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${dropCorr}`) && l.includes("kind=drag-drop") && l.includes("outcome=planned-applied")),
            "terminal names the satisfying plan correlation",
        );
        stop();
    });

    it("stale prewrite replans exactly once, then a second stale failure restores through the marker", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        dropWinA(world, mocks, { x: 900, y: 5 }, "drag-64");
        assert.equal(mocks.planCalls.length - callsAtStart, 1);
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const dropCorr = planCorrelation(JSON.parse(dropCall.payload) as Record<string, unknown>);
        // Sibling drift lands before the reply: the reply boundary sees a
        // scope-equal but rect-stale snapshot and replans once with fresh
        // evidence instead of applying or failing.
        (world.wins["win-b"] as Record<string, unknown>)["frameGeometry"] = { x: 610, y: 0, width: 600, height: 800 };
        dropCall.callback(dragDropReply(dropCorr));
        assert.ok(
            mocks.logs.some((l) => l.includes("stale-replan") && l.includes(`correlation=${dropCorr}`) && l.includes("op=drag-drop") && l.includes("recovery=replan-once")),
            "exactly one prewrite replan",
        );
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "replan dispatches once");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-64")), "replan is not a refusal");
        const replanCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const replanCorr = planCorrelation(JSON.parse(replanCall.payload) as Record<string, unknown>);
        assert.notEqual(replanCorr, dropCorr);
        const replanCommand = (JSON.parse(replanCall.payload) as Record<string, unknown>)["command"];
        assert.deepEqual(replanCommand, { op: "drag-drop", window: "win-a", x: 900, y: 5 });
        // Fresh drift again before the second reply: the replacement flight
        // is also stale, so no second replan follows - the drop fails into
        // its marker, which pumps immediately (no learned owner, so no
        // terminal probe) and restores once.
        (world.wins["win-b"] as Record<string, unknown>)["frameGeometry"] = { x: 620, y: 0, width: 600, height: 800 };
        replanCall.callback(dragDropReply(replanCorr));
        assert.equal(
            mocks.logs.filter((l) => l.includes("stale-replan") && l.includes("op=drag-drop")).length,
            1,
            "no second replan",
        );
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-64") && l.includes("reason=stale-scope")));
        assert.equal(mocks.planCalls.length - callsAtStart, 3, "stale failure restores once through the marker");
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(retainedReply(markerCorr));
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-64") && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`)),
            "per-drag terminal names the restoring plan",
        );
        stop();
    });

    it("overlapping drops converge without a second dispatch while one flight is active", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        // First drop dispatches while the slot is free.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        world.workspace["cursorPos"] = { x: 900, y: 5 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 900, y: 5, w: 600, h: 800 }, "win-a", "drag-65"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "first drop dispatches");
        // Second drop arrives before the first reply: it defers through the
        // single slot instead of dispatching alongside.
        (world.wins["win-b"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedB);
        world.workspace["cursorPos"] = { x: 100, y: 100 };
        fireAll(world.finishedB);
        assert.equal(mocks.oracleCalls.length, 2);
        (world.wins["win-b"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[1] as (reply: unknown) => void)(moveVerdict({ x: 100, y: 100, w: 600, h: 800 }, "win-b", "drag-66"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-66 accepted=true"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "overlapping drop defers without dispatching");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-66")), "deferred drop is not a refusal");
        // The first drop is refused: its marker arms, then the deferred drop
        // dispatches and applies, satisfying the marker with one terminal.
        const firstCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const firstCorr = planCorrelation(JSON.parse(firstCall.payload) as Record<string, unknown>);
        firstCall.callback(rejectedReply(firstCorr, "unsupported-capability"));
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "deferred drop dispatches after the refusal");
        const secondPayload = JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(secondPayload["command"], { op: "drag-drop", window: "win-b", x: 100, y: 100 });
        const secondCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const secondCorr = planCorrelation(secondPayload);
        // Planned second drop with focus preserved on the moved window.
        secondCall.callback(
            JSON.stringify({
                v: 1,
                correlation_id: secondCorr,
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "drag-drop", capability: "place-tiled" },
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "win-b-leaf" },
            }),
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-65") && l.includes("outcome=applied") && l.includes(`plan=${secondCorr}`)),
            "first drop settles applied on the superseding plan",
        );
        stop();
    });

    it("tiled-at-start, floating-at-finish: single-use release, mismatch log, no marker, one ordinary resync", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
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
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 120, y: 40, w: 600, h: 800 }, "win-a", "drag-70"));
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-move-floating-mismatch correlation=drag-70 start=tiled finish=floating"),
            "bounded start/finish mismatch without ids or coordinates",
        );
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-ignored") && l.includes("correlation=drag-70")));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-70")), "no marker for a floated drop");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-70")), "no restore for a floated drop");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-drop-dispatched") && l.includes("correlation=drag-70")), "no drag-drop for a floated drop");
        // Convergence: the debounced resync observes the native floating
        // transition (tiled baseline vs floating finish) and dispatches one
        // ordinary floating-skew converge reconcile carrying the current
        // observation. This is never a drag restore: no marker or restore
        // log names drag-70 (asserted above).
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "floating-skew resync converges ordinarily, never as a restore");
        assert.deepEqual((JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"], { op: "reconcile" });
        // Converge the skew through the survivor-only projection; later drift
        // then still converges ordinarily, proving the hold is gone rather
        // than suppressing.
        const skewCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const skewCorr = planCorrelation(JSON.parse(skewCall.payload) as Record<string, unknown>);
        skewCall.callback(
            JSON.stringify({
                v: 1,
                correlation_id: skewCorr,
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "reconcile" },
                desired_geometry: [
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );
        (world.wins["win-b"] as Record<string, unknown>)["frameGeometry"] = { x: 620, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "later drift converges ordinarily after the single-use release");
        assert.deepEqual((JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"], { op: "reconcile" });
        stop();
    });

    it("floating-at-start, tiled-at-finish: never suppressed, never restored, mismatch logged", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
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
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 60, y: 0, w: 600, h: 800 }, "win-a", "drag-71"));
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-move-floating-mismatch correlation=drag-71 start=floating finish=tiled"),
            "bounded start/finish mismatch without ids or coordinates",
        );
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-ignored") && l.includes("correlation=drag-71")));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-71")), "no marker for the original float");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-71")), "no restore for the original float");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-drop-dispatched") && l.includes("correlation=drag-71")), "no drag-drop for the original float");
        stop();
    });

    it("floating move stays native-only: no suppression, no marker, ordinary flow unchanged", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
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
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 120, y: 40, w: 600, h: 800 }, "win-a", "drag-72"));
        runDebounce(mocks);
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-ignored") && l.includes("correlation=drag-72")));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-72")), "no marker for floating");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-72")), "no restore for floating");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-drop-dispatched") && l.includes("correlation=drag-72")), "no drag-drop for floating");
        stop();
    });

    it("cancelled and null verdicts converge without inventing a drag terminal", () => {
        // Cancelled (Esc/no-change) never routes: ordinary resync only.
        {
            const world = dropWorld();
            const { stop, mocks } = startDropEntry(world);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
            fireAll(world.startedA);
            fireAll(world.finishedA);
            assert.equal(mocks.oracleCalls.length, 1);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
            const cancelled = JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 0, y: 0, w: 600, h: 800 }, windowIdentity: "win-a", correlation: "drag-73", reason: "no-change" });
            (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelled);
            runDebounce(mocks);
            assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-73")), "cancelled is not a rejected drop");
            assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-73")), "no invented terminal");
            stop();
        }
        // Invalid reply (null verdict) releases the hold once via ordinary resync.
        {
            const world = dropWorld();
            const { stop, mocks } = startDropEntry(world);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
            fireAll(world.startedA);
            fireAll(world.finishedA);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
            (mocks.oracleCalls[0] as (reply: unknown) => void)("not-json");
            runDebounce(mocks);
            assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-74")), "no terminal without a validated correlation");
            stop();
        }
    });

    it("missing verdict cannot hang: bounded timer releases the hold once without a marker", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        // No verdict ever arrives: the per-finish bound must release.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        runMoveTimeout(mocks);
        assert.ok(mocks.logs.some((l) => l.includes("drag-move-timeout")), "bounded release is logged");
        // A late verdict after the timeout cannot route twice.
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 60, y: 0, w: 600, h: 800 }, "win-a", "drag-75"));
        assert.ok(mocks.logs.some((l) => l.includes("drag-start-missing") && l.includes("correlation=drag-75")), "late reply fails closed");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-75")), "no late marker");
        stop();
    });

    it("resize-edge route still dispatches pointer-resize, never drag-drop", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["resize"] = true;
        // Started pointer on the right edge grips single-axis right.
        world.workspace["cursorPos"] = { x: 590, y: 400 };
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 0, y: 0, width: 1000, height: 800 };
        fireAll(world.finishedA);
        (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict({ x: 0, y: 0, w: 1000, h: 800 }, "win-a", "drag-76"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1);
        const command = (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"];
        assert.deepEqual(command, { op: "pointer-resize", window: "win-a", direction: "right", boundary: 1000 });
        assert.ok(!payloads(mocks).some((p) => (p["command"] as Record<string, unknown>)?.["op"] === "drag-drop"), "resize never dispatches drag-drop");
        stop();
    });

    it("held tiled move survives past the old timeout while observed moving; observed exit/finish allows reconcile", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const moveStartTimeouts = (): number =>
            mocks.logs.filter(
                (l) =>
                    l.includes("drag-move-timeout") &&
                    l.includes("correlation=move-start-") &&
                    l.includes("cause=missing-finished") &&
                    l.includes("recovery=move-hold-released"),
            ).length;

        // Normal Finish converges through the verdict path with no
        // missing-Finished line: no Started timer exists to cancel.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        assert.equal(
            mocks.timers.filter((t) => !t.cancelled && t.delayMs === DRAG_MEASURE_VERDICT_TIMEOUT_MS).length,
            0,
            "no Started-keyed move expiry armed",
        );
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        const cancelled80 = JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 0, y: 0, w: 600, h: 800 }, windowIdentity: "win-a", correlation: "drag-80", reason: "no-change" });
        (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelled80);
        runMoveTimeout(mocks);
        assert.equal(moveStartTimeouts(), 0, "finished move emits no missing-Finished timeout");
        assert.ok(
            !mocks.logs.some((l) => l.includes("drag-move-timeout") && /win-a|internalId/.test(l)),
            "no native identity in move logs",
        );

        // Paused mid-drag past the old bound: Started with no Finished, no
        // steps, while KWin still reports move===true. The hold persists:
        // time advancing past DRAG_MEASURE_VERDICT_TIMEOUT_MS retires
        // nothing and dispatches no ordinary reconcile.
        const callsBeforeHold = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 10, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBeforeHold, "held move dispatches no ordinary reconcile");
        runMoveTimeout(mocks);
        assert.equal(moveStartTimeouts(), 0, "no missing-Finished expiry while still observed moving");
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 20, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBeforeHold, "paused move past the old bound still dispatches nothing");

        // Observed exit without Finished: KWin reports move===false, so the
        // next ordinary observation reconciles with no drag terminal.
        // (Regression: the removed missing-Finished timer retiled here
        // mid-drag while the window was still observed moving.)
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 30, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBeforeHold + 1, "observed exit releases the hold ordinarily");
        assert.deepEqual(
            (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"],
            { op: "reconcile" },
            "observed exit invents no drag terminal",
        );

        // Settle the exit reconcile, then a fresh move ending with a normal
        // Finished + cancelled verdict converges ordinarily too.
        {
            const exitCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
            const exitPayload = JSON.parse(exitCall.payload) as Record<string, unknown>;
            exitCall.callback(retainedReply(planCorrelation(exitPayload)));
            fireAll(world.geometry);
            runDebounce(mocks);
        }
        const callsBeforeFinish = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        const cancelled81 = JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 30, y: 0, w: 600, h: 800 }, windowIdentity: "win-a", correlation: "drag-81", reason: "no-change" });
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(cancelled81);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 40, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBeforeFinish + 1, "finish releases the hold ordinarily");
        assert.deepEqual(
            (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"],
            { op: "reconcile" },
            "finish invents no drag terminal",
        );
        stop();
    });

    it("finish/verdict while still observed moving keeps the hold until delayed idle", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        // Anomalous finish: Finished fires and the verdict settles while
        // KWin still reports move===true. Neither may release the hold.
        const callsBefore = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.finishedA);
        assert.equal(mocks.oracleCalls.length, 1);
        const cancelledAnomaly = JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 0, y: 0, w: 600, h: 800 }, windowIdentity: "win-a", correlation: "drag-82", reason: "no-change" });
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(cancelledAnomaly);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 10, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBefore, "verdict while still moving dispatches no ordinary reconcile");
        // The bounded per-finish timer must not release a still-moving hold
        // either: a finish with no verdict yet, then expiry while move is
        // still true, keeps suppression.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        fireAll(world.finishedA);
        runMoveTimeout(mocks);
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 20, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBefore, "per-finish expiry while still moving releases nothing");
        // Even an ok-moved verdict for a premature Finished cannot bypass
        // the hold and dispatch a geometry-writing drag-drop.
        fireAll(world.startedA);
        fireAll(world.finishedA);
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 40, y: 0, w: 600, h: 800 }, "win-a", "drag-83"),
        );
        assert.equal(mocks.planCalls.length, callsBefore, "premature moved verdict writes no drop while KWin still moves");
        // Delayed idle: once KWin reports move===false the next ordinary
        // observation reconciles with no drag terminal.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 30, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsBefore + 1, "delayed idle releases the hold ordinarily");
        assert.deepEqual(
            (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"],
            { op: "reconcile" },
            "delayed idle invents no drag terminal",
        );
        stop();
    });

    it("entry desktopsChanged prunes a rejected drag once; malformed reads prune nothing", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const settled = (drag: string): number =>
            mocks.logs.filter((l) => l.includes("drag-reconcile-settled") && l.includes(`correlation=${drag}`)).length;
        const callsAtDrop = mocks.planCalls.length;
        dropWinA(world, mocks, { x: 900, y: 400 }, "drag-90");
        assert.equal(mocks.planCalls.length - callsAtDrop, 1, "drop dispatches before any refusal");
        const dropCall = mocks.planCalls[callsAtDrop] as { payload: string; callback: (reply: unknown) => void };
        const dropCorr = planCorrelation(JSON.parse(dropCall.payload) as Record<string, unknown>);
        // Refuse the drop so the marker is live before pruning.
        dropCall.callback(rejectedReply(dropCorr, "unsupported-capability"));
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-90")));
        assert.equal(mocks.planCalls.length - callsAtDrop, 2, "refused drop dispatches its marker");
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        // Successful desktop list without the marker workspace; failing
        // screens axis proves nothing on its own. The same entry
        // desktopsChanged handler also runs workspaceNative.handleTopologySignal.
        world.workspace["desktops"] = [{ id: "ws-2" }];
        Object.defineProperty(world.workspace, "screens", {
            get(): unknown {
                throw new Error("screens-unreadable");
            },
            configurable: true,
        });
        fireAll(world.topology);
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-90") && l.includes("outcome=unavailable") && l.includes("plan=none")),
            "absent workspace settles honestly with a failed screens axis",
        );
        assert.equal(settled("drag-90"), 1, "exactly one terminal");
        assert.equal(mocks.planCalls.length - callsAtDrop, 2, "prune dispatches nothing");
        markerCall.callback(retainedReply(markerCorr));
        assert.equal(settled("drag-90"), 1, "late old plan reply does not re-settle");
        assert.equal(mocks.planCalls.length - callsAtDrop, 2, "no follow-up for a pruned marker");
        stop();
    });

    it("cross-output tiled drag joins destination at pointer; source forcing without source-marker fight", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        // Tiled move starts on the retained source (out-1/ws-1); native
        // assignment leaves the source mid-drag before FINISH. The Started
        // source binding (identity enforced in the entry) authorizes the
        // destination dispatch through the same core drag-drop resolver.
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["output"] = { name: "out-2" };
        world.workspace["cursorPos"] = { x: 900, y: 5 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 900, y: 5, w: 600, h: 800 }, "win-a", "drag-91"),
        );
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-91 accepted=true"),
            "cross-output drop dispatches accepted through the destination",
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-drop-cross-output") && l.includes("correlation=drag-91") && l.includes("source=cross-output") && l.includes("dest=destination")),
            "correlated cross-output diagnostic names generic source and destination kinds only",
        );
        assert.ok(mocks.logs.every((l) => !l.includes("drag-drop-cross-output") || (!l.includes("out-1") && !l.includes("out-2") && !l.includes("ws-1"))), "no raw source or destination ids in normal logs");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-drop-refused-cross-domain")), "authorized cross-output refuses nothing");
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "exactly one destination drag-drop dispatch");
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const dropPayload = JSON.parse(dropCall.payload) as Record<string, unknown>;
        assert.deepEqual(dropPayload["command"], { op: "drag-drop", window: "win-a", x: 900, y: 5, source_output: "out-1", source_workspace: "ws-1" });
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-91")), "no source-scoped marker fights the authorized placement");
        const dropCorr = planCorrelation(dropPayload);
        // Destination plan: the moved window joins out-2/ws-1 at the pointer
        // through the same resolver. Single-member destination covers wanted.
        dropCall.callback(
            JSON.stringify({
                v: 1,
                correlation_id: dropCorr,
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "drag-drop", capability: "place-tiled" },
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-2", workspace: "ws-1", rect: { x: 800, y: 0, w: 800, h: 1000 } },
                ],
                desired_focus: { domain_output: "out-2", domain_workspace: "ws-1", leaf: "win-a-leaf" },
            }),
        );
        assert.deepEqual(
            (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"],
            { x: 800, y: 0, width: 800, height: 1000 },
            "destination geometry applies to the moved window",
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-drop-cross-applied") && l.includes("correlation=drag-91") && l.includes(`plan=${dropCorr}`)),
            "correlated cross-output applied names the satisfying plan",
        );
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${dropCorr}`) && l.includes("kind=drag-drop") && l.includes("outcome=planned-applied")),
            "terminal names the satisfying plan correlation",
        );
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-91")), "applied destination satisfies no marker");
        // No retry: further debounces dispatch nothing more.
        const callsAfterApply = mocks.planCalls.length;
        fireAll(world.geometry);
        runDebounce(mocks);
        assert.equal(mocks.planCalls.length, callsAfterApply, "no retry after applied cross-output drop");
        // Source membership removed: the next Started-bound same-domain drop
        // in the destination dispatches ordinarily (stale source evidence
        // refuses nothing).
        const callsBeforeSecond = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        world.workspace["cursorPos"] = { x: 850, y: 10 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 850, y: 10, w: 800, h: 1000 }, "win-a", "drag-95"),
        );
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-95 accepted=true"));
        assert.equal(mocks.planCalls.length - callsBeforeSecond, 1, "destination same-domain drop dispatches after source removal");
        stop();
    });

    it("cross-output refusal converges through the destination marker; ordinary observation stays usable", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        // No baseline converge: appliedById holds no evidence for win-a, so
        // only the Started source binding authorizes the destination dispatch.
        const callsAtStart = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["output"] = { name: "out-2" };
        world.workspace["cursorPos"] = { x: 900, y: 5 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 900, y: 5, w: 600, h: 800 }, "win-a", "drag-92"),
        );
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-92 accepted=true"),
            "cross-output drop without retained evidence still dispatches the destination",
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-drop-cross-output") && l.includes("correlation=drag-92") && l.includes("source=cross-output") && l.includes("dest=destination")),
            "Started source binding authorizes without retained evidence and logs generic kinds only",
        );
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "destination dispatches before any refusal");
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const dropCorr = planCorrelation(JSON.parse(dropCall.payload) as Record<string, unknown>);
        // Planner refuses the destination (center/unsupported): the failure
        // converges through the destination-scoped marker, never a
        // source-scoped restore that would fight.
        dropCall.callback(rejectedReply(dropCorr, "unsupported-capability"));
        assert.ok(mocks.logs.some((l) => l.includes("drag-drop-cross-refused") && l.includes("correlation=drag-92") && l.includes("reason=unsupported-capability")));
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-92") && l.includes("reason=unsupported-capability")));
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "refusal dispatches exactly one destination marker reconcile");
        const markerCommand = (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"];
        assert.deepEqual(markerCommand, { op: "reconcile" });
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(
            JSON.stringify({
                v: 1,
                correlation_id: markerCorr,
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "reconcile" },
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-2", workspace: "ws-1", rect: { x: 900, y: 5, w: 600, h: 800 } },
                ],
            }),
        );
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-92") && l.includes("outcome=applied") && l.includes(`plan=${markerCorr}`) && l.includes("covered=1/1")),
            "per-drag applied terminal names the destination restoring plan with full coverage",
        );
        (world.wins["win-a"] as Record<string, unknown>)["frameGeometry"] = { x: 10, y: 0, width: 600, height: 800 };
        fireAll(world.geometry);
        runDebounce(mocks);
        const lastCommand = (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"];
        assert.deepEqual(lastCommand, { op: "reconcile" }, "follow-up is ordinary, never a second drag restore");
        stop();
    });

    it("same-domain without retained evidence still dispatches normally", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        const callsAtStart = mocks.planCalls.length;
        dropWinA(world, mocks, { x: 900, y: 5 }, "drag-93");
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-93 accepted=true"));
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "same-domain drop without retained evidence dispatches");
        assert.deepEqual(
            (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"],
            { op: "drag-drop", window: "win-a", x: 900, y: 5 },
        );
        stop();
    });

    it("stale retained evidence does not refuse a Started-bound same-domain drop", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        // Retained evidence homes win-a to out-1/ws-1; the window natively
        // lives in out-2/ws-2 before Started, so the Started binding is out-2.
        const output2 = { name: "out-2" };
        const desktop2 = { id: "ws-2" };
        world.workspace["currentDesktopForScreen"] = (): unknown => desktop2;
        for (const id of ["win-a", "win-b"]) {
            (world.wins[id] as Record<string, unknown>)["output"] = output2;
            (world.wins[id] as Record<string, unknown>)["desktops"] = [desktop2];
        }
        const callsAtStart = mocks.planCalls.length;
        dropWinA(world, mocks, { x: 900, y: 5 }, "drag-94");
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-94 accepted=true"));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-drop-refused-cross-domain")), "stale evidence refuses nothing");
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "Started-bound same-domain drop dispatches");
        assert.deepEqual(
            (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"],
            { op: "drag-drop", window: "win-a", x: 900, y: 5 },
        );
        stop();
    });

    it("timed-out cross-output drop refuses through the destination marker", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        const callsAtStart = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["output"] = { name: "out-2" };
        world.workspace["cursorPos"] = { x: 900, y: 5 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 900, y: 5, w: 600, h: 800 }, "win-a", "drag-96"),
        );
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "destination dispatches before the timeout");
        runPlanTimeout(mocks);
        assert.ok(mocks.logs.some((l) => l.includes("drag-drop-cross-refused") && l.includes("correlation=drag-96") && l.includes("reason=timeout")));
        assert.ok(mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-96") && l.includes("reason=timeout")));
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "timeout dispatches exactly one destination marker");
        assert.deepEqual(
            (JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"],
            { op: "reconcile" },
        );
        stop();
    });

    it("held drag with mid-gesture workspace send refuses the stale source drop", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const desktop1 = (world.workspace["currentDesktopForScreen"] as () => unknown)() as object;
        const desktop2 = { id: "ws-2" };
        const callsAtStart = mocks.planCalls.length;
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        // Shift+2 mid-drag: the native window joins ws-2 while the gesture is held.
        (world.wins["win-a"] as Record<string, unknown>)["desktops"] = [desktop2];
        world.workspace["currentDesktopForScreen"] = (): unknown => desktop2;
        world.workspace["cursorPos"] = { x: 400, y: 400 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 400, y: 400, w: 600, h: 800 }, "win-a", "drag-80"),
        );
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-80 accepted=false"),
            "stale workspace-1 drop ignored",
        );
        assert.equal(mocks.planCalls.length - callsAtStart, 0, "no stale workspace-1 drop dispatched");
        assert.ok(mocks.logs.some((l) => l.includes("drag-drop-refused-stale-workspace")), "stale refusal logged");
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-80") && l.includes("reason=stale-workspace")),
            "stale drop feeds the source marker",
        );
        assert.ok(
            !mocks.logs.some((l) => l.includes("drag-drop-cross-output") && l.includes("correlation=drag-80")),
            "workspace send never claims cross-output",
        );
        // Destination admission on ws-2 through the ordinary refresh.
        fireAll(world.geometry);
        runDebounce(mocks);
        const destCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        assert.deepEqual(
            (JSON.parse(destCall.payload) as Record<string, unknown>)["command"],
            { op: "reconcile" },
            "destination converges through reconcile, not a stale drop",
        );
        const destCorr = planCorrelation(JSON.parse(destCall.payload) as Record<string, unknown>);
        destCall.callback(plannedReconcileReply(destCorr, "win-a", "out-1", "ws-2"));
        // Source reflow on ws-1 once it is observed again.
        world.workspace["currentDesktopForScreen"] = (): unknown => desktop1;
        world.workspace["activeWindow"] = world.wins["win-b"];
        fireAll(world.geometry);
        runDebounce(mocks);
        const srcCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        assert.deepEqual(
            (JSON.parse(srcCall.payload) as Record<string, unknown>)["command"],
            { op: "reconcile" },
            "source reflows once observed",
        );
        const srcCorr = planCorrelation(JSON.parse(srcCall.payload) as Record<string, unknown>);
        srcCall.callback(plannedReconcileReply(srcCorr, "win-b", "out-1", "ws-1"));
        // The deferred source marker pumps once its domain is observed again.
        fireAll(world.geometry);
        runDebounce(mocks);
        const markerCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        assert.deepEqual(
            (JSON.parse(markerCall.payload) as Record<string, unknown>)["command"],
            { op: "reconcile" },
            "deferred source marker dispatches on ws-1",
        );
        const markerCorr = planCorrelation(JSON.parse(markerCall.payload) as Record<string, unknown>);
        markerCall.callback(plannedReconcileReply(markerCorr, "win-b", "out-1", "ws-1"));
        assert.ok(
            mocks.logs.some((l) => l.includes("drag-reconcile-settled") && l.includes("correlation=drag-80")),
            "stale drop settles through the source reconcile",
        );
        // Legitimate cross-output pointer drags still join the destination.
        const callsBeforeCross = mocks.planCalls.length;
        world.workspace["currentDesktopForScreen"] = (): unknown => desktop1;
        (world.wins["win-b"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedB);
        (world.wins["win-b"] as Record<string, unknown>)["output"] = { name: "out-2" };
        world.workspace["cursorPos"] = { x: 900, y: 5 };
        fireAll(world.finishedB);
        (world.wins["win-b"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 900, y: 5, w: 600, h: 800 }, "win-b", "drag-81"),
        );
        assert.ok(
            mocks.logs.some((l) => l === "plasma-auto-tiler:route-diag:drag-drop-dispatched correlation=drag-81 accepted=true"),
            "cross-output drop still dispatches",
        );
        assert.equal(mocks.planCalls.length - callsBeforeCross, 1, "exactly one cross-output dispatch");
        assert.deepEqual(
            ((JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>),
            { op: "drag-drop", window: "win-b", x: 900, y: 5, source_output: "out-1", source_workspace: "ws-1" },
        );
        stop();
    });

    it("stale native drift refuses even when the pointer projects back to Started", () => {
        // Native sent ws-1 -> ws-2 mid-drag; the release pointer resolves to
        // hidden ws-1, so effective == Started. The native domain drifted, so
        // the drop stays refused instead of dispatching the old workspace.
        const refA = {};
        const refB = {};
        const observed = directObserved("out-1", "ws-2", { x: 0, y: 0, w: 100, h: 100 }, "win-a", refA, "fp-native-ws2");
        const started = directObserved("out-1", "ws-1", { x: 400, y: 400, w: 200, h: 200 }, "win-b", refB, "fp-started-ws1");
        const { adapter, planCalls, logs } = staleDirectAdapter(observed, [started]);
        assert.equal(adapter.requestDragDrop("win-a", 500, 500, "drag-70", { output: "out-1", workspace: "ws-1" }), false);
        assert.equal(planCalls.length, 0, "projected-back stale drop dispatches nothing");
        assert.ok(logs.some((l) => l.includes("drag-drop-refused-stale-workspace")), "native drift refusal logged");
        assert.ok(logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-70") && l.includes("reason=stale-workspace")));
        assert.ok(!logs.some((l) => l.includes("drag-drop-cross-output") && l.includes("correlation=drag-70")));
    });

    it("unchanged native with pointer in another workspace still dispatches", () => {
        // Native never left ws-1; the pointer sits in hidden ws-2. The native
        // domain matches Started, so the drop joins the pointer destination.
        const refA = {};
        const refB = {};
        const observed = directObserved("out-1", "ws-1", { x: 0, y: 0, w: 100, h: 100 }, "win-a", refA, "fp-native-ws1");
        const other = directObserved("out-1", "ws-2", { x: 400, y: 400, w: 200, h: 200 }, "win-b", refB, "fp-other-ws2");
        const { adapter, planCalls, logs } = staleDirectAdapter(observed, [other]);
        assert.equal(adapter.requestDragDrop("win-a", 500, 500, "drag-71", { output: "out-1", workspace: "ws-1" }), true);
        assert.equal(planCalls.length, 1, "pointer-destination drop dispatches once");
        const directCall = planCalls[0] as { payload: string; callback: (reply: unknown) => void };
        assert.deepEqual((JSON.parse(directCall.payload) as Record<string, unknown>)["command"], {
            op: "drag-drop",
            window: "win-a",
            x: 500,
            y: 500,
            source_output: "out-1",
            source_workspace: "ws-1",
        });
        assert.ok(logs.some((l) => l.includes("drag-drop-cross-output") && l.includes("correlation=drag-71")));
        assert.ok(!logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-71")));
    });

    it("deferred cross-output drop keeps source binding and applies after the busy flight", () => {
        const world = dropWorld();
        const { stop, mocks } = startDropEntry(world);
        baselineConverge(world, mocks);
        const callsAtStart = mocks.planCalls.length;
        (world.wins["win-b"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedB);
        world.workspace["cursorPos"] = { x: 100, y: 100 };
        fireAll(world.finishedB);
        (world.wins["win-b"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 100, y: 100, w: 600, h: 800 }, "win-b", "drag-97"),
        );
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "first same-domain drop dispatches");
        (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
        fireAll(world.startedA);
        (world.wins["win-a"] as Record<string, unknown>)["output"] = { name: "out-2" };
        world.workspace["cursorPos"] = { x: 900, y: 5 };
        fireAll(world.finishedA);
        (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
        (mocks.oracleCalls[mocks.oracleCalls.length - 1] as (reply: unknown) => void)(
            moveVerdict({ x: 900, y: 5, w: 600, h: 800 }, "win-a", "drag-98"),
        );
        assert.equal(mocks.planCalls.length - callsAtStart, 1, "overlapping cross drop defers without dispatching");
        assert.ok(!mocks.logs.some((l) => l.includes("drag-rejected") && l.includes("correlation=drag-98")), "deferred drop is not a refusal");
        const firstCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        const firstCorr = planCorrelation(JSON.parse(firstCall.payload) as Record<string, unknown>);
        firstCall.callback(rejectedReply(firstCorr, "unsupported-capability"));
        assert.equal(mocks.planCalls.length - callsAtStart, 2, "deferred cross drop dispatches after the refusal");
        const dropPayload = JSON.parse(mocks.planCalls[mocks.planCalls.length - 1]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(dropPayload["command"], { op: "drag-drop", window: "win-a", x: 900, y: 5, source_output: "out-1", source_workspace: "ws-1" });
        const dropCorr = planCorrelation(dropPayload);
        const dropCall = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
        dropCall.callback(
            JSON.stringify({
                v: 1,
                correlation_id: dropCorr,
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "drag-drop", capability: "place-tiled" },
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-2", workspace: "ws-1", rect: { x: 800, y: 0, w: 800, h: 1000 } },
                ],
                desired_focus: { domain_output: "out-2", domain_workspace: "ws-1", leaf: "win-a-leaf" },
            }),
        );
        assert.ok(mocks.logs.some((l) => l.includes("drag-drop-cross-applied") && l.includes("correlation=drag-98") && l.includes(`plan=${dropCorr}`)));
        assert.ok(!mocks.logs.some((l) => l.includes("drag-reconcile") && l.includes("correlation=drag-98")), "applied destination satisfies no marker");
        stop();
    });
});
