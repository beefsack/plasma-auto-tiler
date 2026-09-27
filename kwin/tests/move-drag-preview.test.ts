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
function fireAll(s: FireSignal, payload?: unknown): void {
    for (const h of [...s.handlers]) h(payload);
}

interface PreviewWorld {
    readonly workspace: Record<string, unknown>;
    readonly wins: Record<string, Record<string, unknown>>;
    readonly startedA: FireSignal;
    readonly steppedA: FireSignal;
    readonly finishedA: FireSignal;
    readonly removed: FireSignal;
}
function previewWorld(): PreviewWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const startedA = fireSignal();
    const steppedA = fireSignal();
    const finishedA = fireSignal();
    const other = fireSignal();
    const removed = fireSignal();
    const makeWin = (id: string, rect: { x: number; y: number; w: number; h: number }): Record<string, unknown> => ({
        normalWindow: true,
        internalId: id,
        output,
        desktops: [desktop],
        frameGeometry: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        move: false,
        resize: false,
        moveResizedChanged: other.signal,
        frameGeometryChanged: other.signal,
        interactiveMoveResizeStarted: id === "win-a" ? startedA.signal : other.signal,
        interactiveMoveResizeStepped: id === "win-a" ? steppedA.signal : other.signal,
        interactiveMoveResizeFinished: id === "win-a" ? finishedA.signal : other.signal,
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
        windowAdded: other.signal,
        windowRemoved: removed.signal,
        windowActivated: other.signal,
        screensChanged: other.signal,
        desktopsChanged: other.signal,
        currentDesktopChanged: other.signal,
    };
    return { workspace, wins, startedA, steppedA, finishedA, removed };
}

interface PreviewMocks {
    readonly planCalls: Array<{ method: string; payload: string; callback: (reply: unknown) => void }>;
    readonly previewCalls: Array<{ payload: string; callback: (reply: unknown) => void }>;
    readonly oracleCalls: Array<(reply: unknown) => void>;
    readonly overlayCalls: Array<{ method: string; args: ReadonlyArray<unknown> }>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
}
function startPreviewEntry(world: PreviewWorld): { stop: () => void; mocks: PreviewMocks } {
    const mocks: PreviewMocks = { planCalls: [], previewCalls: [], oracleCalls: [], overlayCalls: [], timers: [], logs: [] };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (_s, _p, _i, method, payload, callback): void => {
            if (method === "NameHasOwner") return callback(true);
            if (method === "GetNameOwner") return callback(":1.7");
            if (method === "StartServiceByName") return callback(1);
            const text = payload as string;
            try {
                const command = (JSON.parse(text) as Record<string, unknown>)["command"] as Record<string, unknown>;
                if (command?.["op"] === "drag-preview") {
                    mocks.previewCalls.push({ payload: text, callback });
                    return;
                }
            } catch (error) {
                void error;
            }
            mocks.planCalls.push({ method, payload: text, callback });
        },
        highlightCallDbus: (_s, _p, _i, method, ...args): void => {
            mocks.overlayCalls.push({ method, args });
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
function runTimer(mocks: PreviewMocks, delayMs: number): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled && timer.delayMs === delayMs) timer.callback();
        else if (!timer.cancelled) mocks.timers.push(timer);
    }
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
function baselineConverge(mocks: PreviewMocks): void {
    runTimer(mocks, PLAN_DEBOUNCE_MS);
    for (const call of [...mocks.planCalls]) {
        try {
            const payload = JSON.parse(call.payload) as Record<string, unknown>;
            const corr = payload["correlation_id"] as string;
            if (typeof corr !== "string" || corr.length === 0) continue;
            // Leave the group-highlight bridge unanswered so overlay
            // independence assertions stay clean.
            if ((payload["command"] as Record<string, unknown> | undefined)?.["op"] === "active-group") continue;
            call.callback(retainedReply(corr));
        } catch (error) {
            void error;
        }
    }
    runTimer(mocks, PLAN_DEBOUNCE_MS);
}
const FINISH_PRIOR = {
    domain_output: "out-1",
    domain_workspace: "ws-1",
    source_leaf: "win-a-leaf",
    source_window: "win-a",
    revision: 2,
    prior: null,
};
function previewReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "preview",
        kind: "drag-preview",
        base_revision: 2,
        detail: { kind: "drag-preview", capability: "place-tiled" },
        preview_rect: { x: 600, y: 0, w: 600, h: 800 },
        hover_prior: FINISH_PRIOR,
    });
}
function moveVerdict(windowIdentity: string, correlation: string): string {
    return JSON.stringify({ v: 1, cancelled: false, finalRect: { x: 900, y: 5, w: 600, h: 800 }, windowIdentity, correlation, reason: "ok-moved" });
}
function cancelledVerdict(correlation: string): string {
    return JSON.stringify({ v: 1, cancelled: true, finalRect: { x: 0, y: 0, w: 1, h: 1 }, windowIdentity: "", correlation, reason: "no-change" });
}
function dragDropReply(correlation: string): string {
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
function previewCommand(call: { payload: string }): Record<string, unknown> {
    return (JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>;
}
function previewCorr(call: { payload: string }): string {
    return (JSON.parse(call.payload) as Record<string, unknown>)["correlation_id"] as string;
}
function overlayMethods(mocks: PreviewMocks): string[] {
    return mocks.overlayCalls.map((call) => call.method);
}
function clearCount(mocks: PreviewMocks): number {
    return overlayMethods(mocks).filter((m) => m === "ClearDragTargetPreview").length;
}
function beginMove(world: PreviewWorld, mocks: PreviewMocks, x: number, y: number): void {
    void mocks;
    (world.wins["win-a"] as Record<string, unknown>)["move"] = true;
    fireAll(world.startedA);
    world.workspace["cursorPos"] = { x, y };
    fireAll(world.steppedA);
}
function dropCommand(mocks: PreviewMocks): Record<string, unknown> {
    const call = mocks.planCalls[mocks.planCalls.length - 1] as { payload: string; callback: (reply: unknown) => void };
    return { ...(JSON.parse(call.payload) as Record<string, unknown>), call };
}
describe("move-drag preview routing and native overlay", () => {
    it("stepped tiled move samples cursorPos into one preview and renders the native overlay", () => {
        const world = previewWorld();
        const { stop, mocks } = startPreviewEntry(world);
        try {
            baselineConverge(mocks);
            const previewAtStart = mocks.previewCalls.length;
            beginMove(world, mocks, 900, 5);
            assert.equal(mocks.previewCalls.length, previewAtStart + 1, "one preview per stepped sample");
            const call = mocks.previewCalls[mocks.previewCalls.length - 1] as { payload: string; callback: (r: unknown) => void };
            const command = previewCommand(call);
            assert.equal(command["op"], "drag-preview");
            assert.equal(command["window"], "win-a");
            assert.equal(command["x"], 900);
            assert.equal(command["y"], 5);
            assert.equal(command["source_output"], "out-1");
            assert.ok(!("hover_prior" in command), "no prior before the first preview");
            call.callback(previewReply(previewCorr(call)));
            assert.ok(
                mocks.overlayCalls.some((c) => c.method === "SetDragTargetPreview" && c.args.length === 4 && c.args[0] === 600 && c.args[1] === 0 && c.args[2] === 600 && c.args[3] === 800),
                "native overlay shows the preview rect",
            );
            assert.ok(!overlayMethods(mocks).includes("SetGroupHighlight"), "preview never touches group highlight");
            assert.ok(!overlayMethods(mocks).includes("ClearGroupHighlight"), "preview never touches group highlight");
        } finally {
            stop();
        }
    });

    it("coalesces the latest pointer while busy and permits the next sample after each reply", () => {
        const world = previewWorld();
        const { stop, mocks } = startPreviewEntry(world);
        try {
            baselineConverge(mocks);
            beginMove(world, mocks, 800, 5);
            const first = mocks.previewCalls.length;
            world.workspace["cursorPos"] = { x: 801, y: 6 };
            fireAll(world.steppedA);
            world.workspace["cursorPos"] = { x: 900, y: 5 };
            fireAll(world.steppedA);
            assert.equal(mocks.previewCalls.length, first, "busy preview coalesces instead of flooding");
            const firstCall = mocks.previewCalls[first - 1] as { payload: string; callback: (r: unknown) => void };
            firstCall.callback(previewReply(previewCorr(firstCall)));
            assert.equal(mocks.previewCalls.length, first + 1, "reply permits exactly one next sample");
            const second = previewCommand(mocks.previewCalls[first] as { payload: string });
            assert.equal(second["x"], 900, "coalesced sample carries the latest pointer");
            assert.equal(second["y"], 5);
            assert.ok("hover_prior" in second, "validated prior rides the next preview");
        } finally {
            stop();
        }
    });

    it("finish clears before the verdict, transfers the captured prior, and fences late replies", () => {
        const world = previewWorld();
        const { stop, mocks } = startPreviewEntry(world);
        try {
            baselineConverge(mocks);
            beginMove(world, mocks, 900, 5);
            const firstCall = mocks.previewCalls[mocks.previewCalls.length - 1] as { payload: string; callback: (r: unknown) => void };
            firstCall.callback(previewReply(previewCorr(firstCall)));
            assert.ok(overlayMethods(mocks).includes("SetDragTargetPreview"));
            world.workspace["cursorPos"] = { x: 901, y: 6 };
            fireAll(world.steppedA);
            const secondCall = mocks.previewCalls[mocks.previewCalls.length - 1] as { payload: string; callback: (r: unknown) => void };
            assert.notEqual(secondCall.payload, firstCall.payload, "second preview dispatched");
            assert.ok("hover_prior" in previewCommand(secondCall), "outstanding preview carries the completed prior");
            const overlayAtFinish = mocks.overlayCalls.length;
            world.workspace["cursorPos"] = { x: 900, y: 5 };
            fireAll(world.finishedA);
            assert.equal(mocks.oracleCalls.length, 1, "finish still pulls the oracle verdict");
            assert.deepEqual(mocks.overlayCalls[overlayAtFinish], { method: "ClearDragTargetPreview", args: [] }, "finish clears before the oracle pull");
            // Late planner reply before the verdict carries a distinct prior and rect.
            const lateReply = JSON.stringify({
                v: 1,
                correlation_id: previewCorr(secondCall),
                outcome: "preview",
                kind: "drag-preview",
                base_revision: 2,
                detail: { kind: "drag-preview", capability: "place-tiled" },
                preview_rect: { x: 0, y: 400, w: 1200, h: 400 },
                hover_prior: { ...FINISH_PRIOR, source_leaf: "win-b-leaf", revision: 99 },
            });
            const overlayAtVerdict = mocks.overlayCalls.length;
            secondCall.callback(lateReply);
            assert.equal(mocks.overlayCalls.length, overlayAtVerdict, "late preview reply before verdict never re-renders");
            (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
            (mocks.oracleCalls[0] as (reply: unknown) => void)(moveVerdict("win-a", "drag-60"));
            const drop = dropCommand(mocks) as Record<string, unknown> & { call: { payload: string; callback: (r: unknown) => void } };
            assert.equal((drop["command"] as Record<string, unknown>)["op"], "drag-drop");
            assert.deepEqual((drop["command"] as Record<string, unknown>)["hover_prior"], FINISH_PRIOR, "drop keeps the Finish-captured prior, not the late reply");
            assert.ok(!("source_output" in ((drop["command"] as Record<string, unknown>))), "same-output drop carries no source binding");
            assert.ok(mocks.logs.some((l) => l.includes("drag-drop-dispatched") && l.includes("correlation=drag-60")));
            const overlayAfterDrop = mocks.overlayCalls.length;
            firstCall.callback(previewReply(previewCorr(firstCall)));
            assert.equal(mocks.overlayCalls.length, overlayAfterDrop, "late preview reply after finish is fenced");
            drop.call.callback(dragDropReply(drop["correlation_id"] as string));
        } finally {
            stop();
        }
    });

    it("cancellation clears the overlay and the preview carry without a drop", () => {
        const world = previewWorld();
        const { stop, mocks } = startPreviewEntry(world);
        try {
            baselineConverge(mocks);
            beginMove(world, mocks, 900, 5);
            const planAtStart = mocks.planCalls.length;
            fireAll(world.finishedA);
            assert.equal(mocks.oracleCalls.length, 1);
            (world.wins["win-a"] as Record<string, unknown>)["move"] = false;
            (mocks.oracleCalls[0] as (reply: unknown) => void)(cancelledVerdict("drag-61"));
            assert.equal(mocks.planCalls.length, planAtStart, "cancelled verdict dispatches no drop");
            assert.ok(overlayMethods(mocks).includes("ClearDragTargetPreview"), "cancellation clears the overlay");
            assert.ok(!overlayMethods(mocks).includes("ClearGroupHighlight"), "preview lifetime stays independent of group highlight");
        } finally {
            stop();
        }
    });

    it("resize-only gestures never preview", () => {
        const world = previewWorld();
        const { stop, mocks } = startPreviewEntry(world);
        try {
            baselineConverge(mocks);
            const previewAtStart = mocks.previewCalls.length;
            (world.wins["win-a"] as Record<string, unknown>)["resize"] = true;
            fireAll(world.startedA);
            world.workspace["cursorPos"] = { x: 900, y: 5 };
            fireAll(world.steppedA);
            fireAll(world.finishedA);
            (world.wins["win-a"] as Record<string, unknown>)["resize"] = false;
            assert.equal(mocks.previewCalls.length, previewAtStart, "resize steps never request drag-preview");
            assert.ok(!overlayMethods(mocks).includes("SetDragTargetPreview"), "resize never renders the drag overlay");
        } finally {
            stop();
        }
    });

    it("missing Finished timeout, removal, and stop clear the overlay", () => {
        const world = previewWorld();
        const { stop, mocks } = startPreviewEntry(world);
        try {
            baselineConverge(mocks);
            beginMove(world, mocks, 900, 5);
            runTimer(mocks, DRAG_MEASURE_VERDICT_TIMEOUT_MS);
            assert.ok(overlayMethods(mocks).includes("ClearDragTargetPreview"), "missing Finished timeout clears the overlay");
            beginMove(world, mocks, 901, 6);
            const clearsBefore = clearCount(mocks);
            fireAll(world.removed, world.wins["win-a"]);
            assert.ok(clearCount(mocks) > clearsBefore, "removal clears the overlay");
        } finally {
            const clearsBeforeStop = clearCount(mocks);
            stop();
            assert.ok(clearCount(mocks) >= clearsBeforeStop, "stop releases the overlay");
        }
    });
});
