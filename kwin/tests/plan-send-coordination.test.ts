import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { WORKSPACE_SEND_TIMEOUT_MS } from "../src/workspace-send-adapter";

interface FakeSignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: {
        connect: (handler: (payload?: unknown) => void) => void;
        disconnect: (handler: (payload?: unknown) => void) => void;
    };
}

function fakeSignal(): FakeSignal {
    const handlers: Array<(payload?: unknown) => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: (payload?: unknown) => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: (payload?: unknown) => void): void => {
                const at = handlers.indexOf(handler);
                if (at >= 0) {
                    handlers.splice(at, 1);
                }
            },
        },
    };
}

interface FakeDesktop {
    id: string;
    x11DesktopNumber?: number;
}

interface FakeOutput {
    name: string;
}

interface FakeWindow extends Record<string, unknown> {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    internalId: string;
    resourceClass: string;
    output: FakeOutput;
    desktops: FakeDesktop[];
    frameGeometry: { x: number; y: number; width: number; height: number };
}

interface FakeWorld {
    workspace: Record<string, unknown>;
    outputs: FakeOutput[];
    desktops: FakeDesktop[];
    wins: FakeWindow[];
    currentByOutput: Map<FakeOutput, FakeDesktop>;
    signals: {
        windowAdded: FakeSignal;
        windowRemoved: FakeSignal;
        windowActivated: FakeSignal;
        screensChanged: FakeSignal;
        currentDesktopChanged: FakeSignal;
        desktopsChanged: FakeSignal;
    };
}

function makeWorld(): FakeWorld {
    const outputs: FakeOutput[] = [{ name: "out-1" }];
    const desktops: FakeDesktop[] = [
        { id: "ws-1", x11DesktopNumber: 1 },
        { id: "ws-2", x11DesktopNumber: 2 },
    ];
    const currentByOutput = new Map<FakeOutput, FakeDesktop>();
    currentByOutput.set(outputs[0] as FakeOutput, desktops[0] as FakeDesktop);
    const signals = {
        windowAdded: fakeSignal(),
        windowRemoved: fakeSignal(),
        windowActivated: fakeSignal(),
        screensChanged: fakeSignal(),
        currentDesktopChanged: fakeSignal(),
        desktopsChanged: fakeSignal(),
    };
    const workspace: Record<string, unknown> = {};
    const world: FakeWorld = { workspace, outputs, desktops, wins: [], currentByOutput, signals };
    workspace["screens"] = outputs;
    workspace["desktops"] = desktops;
    workspace["activeWindow"] = null;
    workspace["activeScreen"] = outputs[0];
    workspace["currentDesktopForScreen"] = (output: unknown): unknown => {
        return currentByOutput.get(output as FakeOutput) ?? null;
    };
    workspace["currentDesktop"] = desktops[0];
    workspace["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        workspace["currentDesktop"] = desktop;
    };
    workspace["createDesktop"] = (): void => {
        const maxNum = desktops.reduce((best, entry) => Math.max(best, entry.x11DesktopNumber ?? 0), 0);
        const fresh: FakeDesktop = { id: `ws-new-${String(desktops.length + 1)}`, x11DesktopNumber: maxNum + 1 };
        desktops.push(fresh);
        workspace["desktops"] = desktops;
    };
    workspace["removeDesktop"] = (desktop: unknown): void => {
        const at = desktops.indexOf(desktop as FakeDesktop);
        if (at >= 0) {
            desktops.splice(at, 1);
        }
        workspace["desktops"] = desktops;
    };
    workspace["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    workspace["windowList"] = (): unknown[] => [...world.wins];
    workspace["windowAdded"] = signals.windowAdded.signal;
    workspace["windowRemoved"] = signals.windowRemoved.signal;
    workspace["windowActivated"] = signals.windowActivated.signal;
    workspace["screensChanged"] = signals.screensChanged.signal;
    workspace["currentDesktopChanged"] = signals.currentDesktopChanged.signal;
    workspace["desktopsChanged"] = signals.desktopsChanged.signal;
    return world;
}

function fire(signal: FakeSignal, payload?: unknown): void {
    for (const handler of [...signal.handlers]) {
        handler(payload);
    }
}

interface Mocks {
    readonly dbusCalls: Array<{ service: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; callback: () => void }>;
}

function startEntry(world: FakeWorld): { handle: ReturnType<typeof startPlanAdapterEntry>; mocks: Mocks } {
    const mocks: Mocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [] };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (service, _path, _iface, method, payload, callback): void => {
            mocks.dbusCalls.push({ service, method, payload });
            mocks.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            mocks.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            mocks.logs.push(message);
        },
        owner: "owner-1",
        generation: "gen-1",
        registerShortcutFn: (action, _text, _sequence, callback): boolean => {
            mocks.shortcuts.push({ action, callback });
            return true;
        },
        readProfileFn: (): string => "cosmic",
        readWorkspaceModeFn: (): unknown => "per-output-local",
    });
    return { handle, mocks };
}

function runDebounce(mocks: Mocks): void {
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

function parsePayload(payload: string): Record<string, unknown> {
    return JSON.parse(payload) as Record<string, unknown>;
}

function planCalls(mocks: Mocks): Array<{ index: number; payload: Record<string, unknown> }> {
    const out: Array<{ index: number; payload: Record<string, unknown> }> = [];
    mocks.dbusCalls.forEach((call, index) => {
        if (call.method !== "DescribePlan") {
            return;
        }
        let payload: Record<string, unknown> | null = null;
        try {
            payload = parsePayload(call.payload);
        } catch {
            return;
        }
        const command = payload["command"] as Record<string, unknown> | undefined;
        const op = command?.["op"];
        if (op === "send-to-workspace" || op === "send-to-workspace-ack" || op === "send-to-workspace-verify") {
            return;
        }
        out.push({ index, payload });
    });
    return out;
}

function sendCalls(mocks: Mocks): Array<{ index: number; payload: Record<string, unknown> }> {
    const out: Array<{ index: number; payload: Record<string, unknown> }> = [];
    mocks.dbusCalls.forEach((call, index) => {
        if (call.method !== "DescribePlan") {
            return;
        }
        let payload: Record<string, unknown> | null = null;
        try {
            payload = parsePayload(call.payload);
        } catch {
            return;
        }
        const command = payload["command"] as Record<string, unknown> | undefined;
        const op = command?.["op"];
        if (op === "send-to-workspace" || op === "send-to-workspace-ack" || op === "send-to-workspace-verify") {
            out.push({ index, payload });
        }
    });
    return out;
}

function findOwnerCall(mocks: Mocks, fromIndex: number): number {
    for (let index = fromIndex; index < mocks.dbusCalls.length; index += 1) {
        if (mocks.dbusCalls[index]?.method === "GetNameOwner") {
            return index;
        }
    }
    return -1;
}

function fireSendTimeout(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    let fired = false;
    for (const timer of pending) {
        if (timer.cancelled) {
            continue;
        }
        if (!fired && timer.delayMs === WORKSPACE_SEND_TIMEOUT_MS) {
            fired = true;
            timer.callback();
        } else {
            mocks.timers.push(timer);
        }
    }
    assert.ok(fired, "send timeout timer expected");
}

describe("plan/send P0 coordination through production wiring", () => {
    it("blocks Plan admission during send, retains source, resyncs once, then allows distinct send", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        // Keep explicit signal handles per window for echo control.
        const winSignals = new Map<string, { desktops: FakeSignal; geometry: FakeSignal }>();
        const mkWin = (id: string, desktop: FakeDesktop, x: number): FakeWindow => {
            const output = world.outputs[0] as FakeOutput;
            const d = fakeSignal();
            const g = fakeSignal();
            winSignals.set(id, { desktops: d, geometry: g });
            const win = {
                normalWindow: true,
                managed: true,
                minimized: false,
                fullScreen: false,
                maximizeMode: 0,
                onAllDesktops: false,
                internalId: id,
                resourceClass: "test-app",
                output,
                desktops: [desktop],
                frameGeometry: { x, y: 0, width: 100, height: 100 },
                desktopsChanged: d.signal,
                frameGeometryChanged: g.signal,
                moveResizedChanged: fakeSignal().signal,
                fullScreenChanged: fakeSignal().signal,
                maximizedChanged: fakeSignal().signal,
            } as unknown as FakeWindow;
            world.wins.push(win);
            return win;
        };
        const winA = mkWin("win-a", ws1, 0);
        mkWin("win-b", ws1, 100);
        mkWin("win-t", ws2, 0);
        world.workspace["activeWindow"] = winA;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);

        // Settle the initial Plan admission so send starts from idle.
        runDebounce(mocks);
        const initialPlan = planCalls(mocks);
        assert.equal(initialPlan.length, 1, `initial Plan admit expected, got ${JSON.stringify(planCalls(mocks).map((c) => (c.payload["command"] as Record<string, unknown>)["op"]))}`);
        const initialCorrelation = (initialPlan[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        // Reply with geometry covering the two source windows.
        mocks.callbacks[initialPlan[0]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: initialCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );
        const planCallsAfterInit = planCalls(mocks).length;

        // Start the first distinct send to ws-2 through production routing.
        handle?.requestWorkspaceMove(2);
        const ownerIndex = mocks.dbusCalls.findIndex((call) => call.method === "GetNameOwner");
        assert.ok(ownerIndex >= 0, "send activation must resolve owner");
        mocks.callbacks[ownerIndex]?.(":1.7");
        const requests = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace");
        assert.equal(requests.length, 1, "exactly one send request");
        const sendPayload = requests[0]?.payload as Record<string, unknown>;
        const correlation = sendPayload["correlation_id"] as string;
        assert.ok(correlation.length > 0);
        const moverId = (sendPayload["command"] as Record<string, unknown>)["window"] as string;
        assert.equal(moverId, "win-a");

        // Craft a valid planned send covering source (win-a, win-b) + target (win-t).
        const planned = JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-a",
                leaf: "leaf-win-a",
                source_output: "out-1",
                source_workspace: "ws-1",
                target_output: "out-1",
                target_workspace: "ws-2",
            },
        });
        mocks.callbacks[requests[0]?.index as number]?.(planned);

        // Native writes applied, ack held for echoes.
        const mover = world.wins.find((w) => w.internalId === "win-a") as FakeWindow;
        assert.ok((mover.desktops as FakeDesktop[]).some((d) => d.id === "ws-2"), "mover membership write applied");
        const ackBefore = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace-ack").length;
        assert.equal(ackBefore, 0, "accepted ack must wait for echoes");

        // Source-current switch during held send: live current becomes target.
        world.currentByOutput.set(world.outputs[0] as FakeOutput, ws2);
        world.workspace["currentDesktop"] = ws2;
        // Fire Plan lifecycle without firing send echoes.
        fire(world.signals.currentDesktopChanged);
        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, planCallsAfterInit, "no Plan admission dispatch while send active");

        // Foreground Plan command while send active must busy-refuse.
        const planBeforeBusy = planCalls(mocks).length;
        handle?.requestMove("left");
        assert.equal(planCalls(mocks).length, planBeforeBusy, "foreground Plan move blocked during send");
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:busy-refused kind=move"), mocks.logs.join("\n"));

        // Send must not start while Plan in flight is covered separately; here
        // Plan is idle but send active, so a second send must busy-refuse.
        const dbusBeforeSecond = mocks.dbusCalls.length;
        handle?.requestWorkspaceMove(1);
        assert.ok(mocks.logs.some((l) => l.includes("busy-refused kind=workspace-move")), "second send while send active busy-refuses");
        assert.equal(mocks.dbusCalls.length, dbusBeforeSecond, "blocked send must not touch D-Bus");

        // Complete echoes: mover + all changed geometry.
        for (const [, sigs] of winSignals) {
            fire(sigs.desktops);
        }
        for (const [, sigs] of winSignals) {
            fire(sigs.geometry);
        }
        const ackCalls = sendCalls(mocks).filter((c) => {
            const cmd = c.payload["command"] as Record<string, unknown>;
            return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted";
        });
        assert.equal(ackCalls.length, 1, `accepted ack after echoes, got ${JSON.stringify(sendCalls(mocks).map((c) => c.payload["command"]))}`);
        const ackPayload = ackCalls[0]?.payload as Record<string, unknown>;
        const ackDomain = ackPayload["domain"] as Record<string, unknown>;
        assert.equal(ackDomain["workspace"], "ws-1", `held-send ack must retain original source ws-1, got ${JSON.stringify(ackDomain)}`);
        assert.equal(ackDomain["output"], "out-1");
        const ackTarget = ackPayload["target_domain"] as Record<string, unknown>;
        assert.equal(ackTarget["workspace"], "ws-2");
        mocks.callbacks[ackCalls[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 0 }),
        );
        const verifyCalls = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace-verify");
        assert.equal(verifyCalls.length, 1, "verify after ack");
        const verifyCallbackIndex = verifyCalls[0]?.index as number;
        mocks.callbacks[verifyCallbackIndex]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", kind: "send-to-workspace", base_revision: 1 }),
        );

        // Follow happened before resync: current is target, mover focused.
        // Native state only: immediate current-map confirmation plus mover
        // focus reports state-confirmed, never completed (no visible-switch
        // completion exists).
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput), ws2);
        assert.equal(world.workspace["activeWindow"], mover);
        assert.ok(
            mocks.logs.some(
                (l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed"),
            ),
            mocks.logs.join("\n"),
        );
        assert.ok(
            !mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")),
            mocks.logs.join("\n"),
        );

        // Exactly one Plan resync after settlement.
        const planBeforeResync = planCalls(mocks).length;
        runDebounce(mocks);
        const planAfterResync = planCalls(mocks).length;
        assert.equal(planAfterResync, planBeforeResync + 1, `exactly one resync after commit, got ${planAfterResync - planBeforeResync}`);
        const lastPlan = planCalls(mocks)[planCalls(mocks).length - 1]?.payload as Record<string, unknown>;
        const lastOp = (lastPlan["command"] as Record<string, unknown>)["op"] as string;
        assert.ok(lastOp === "admit" || lastOp === "reconcile", `resync op admit/reconcile, got ${lastOp}`);
        const resyncCorrelation = lastPlan["correlation_id"] as string;
        // Complete the resync admission (target now holds win-a + win-t).
        mocks.callbacks[planCalls(mocks)[planCalls(mocks).length - 1]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: resyncCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-t", leaf: "win-t-leaf", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );
        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, planAfterResync, "no further Plan dispatch after resync completes");

        // Late callback isolation: duplicate committed reply ignored.
        const switchesBefore = JSON.stringify(world.workspace["currentDesktop"]);
        mocks.callbacks[verifyCallbackIndex]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", kind: "send-to-workspace", base_revision: 1 }),
        );
        assert.equal(JSON.stringify(world.workspace["currentDesktop"]), switchesBefore, "late duplicate must not refollow");
        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, planAfterResync, "late duplicate must not resync");

        // Subsequent distinct send can complete (move win-a back to ws-1).
        const dbusBeforeSecondSend = mocks.dbusCalls.length;
        handle?.requestWorkspaceMove(1);
        const secondOwner = findOwnerCall(mocks, dbusBeforeSecondSend);
        assert.ok(secondOwner >= 0, "second send activation must resolve owner");
        mocks.callbacks[secondOwner]?.(":1.7");
        const secondRequests = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace");
        assert.equal(secondRequests.length, 2, "second distinct send starts");
        const secondPayload = secondRequests[1]?.payload as Record<string, unknown>;
        const secondCorrelation = secondPayload["correlation_id"] as string;
        assert.notEqual(secondCorrelation, correlation, "distinct correlation");
        const secondPlanned = JSON.stringify({
            v: 1,
            correlation_id: secondCorrelation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 1,
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 1200, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-win-a" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-a",
                leaf: "leaf-win-a",
                source_output: "out-1",
                source_workspace: "ws-2",
                target_output: "out-1",
                target_workspace: "ws-1",
            },
        });
        mocks.callbacks[secondRequests[1]?.index as number]?.(secondPlanned);
        for (const [, sigs] of winSignals) {
            fire(sigs.desktops);
        }
        for (const [, sigs] of winSignals) {
            fire(sigs.geometry);
        }
        // Ack payload correlation is inside JSON, not top-level; find by parsing.
        const ackForSecond = mocks.dbusCalls
            .map((call, index) => ({ call, index }))
            .filter(({ call }) => {
                if (call.method !== "DescribePlan") {
                    return false;
                }
                try {
                    const p = parsePayload(call.payload) as Record<string, unknown>;
                    const cmd = p["command"] as Record<string, unknown>;
                    return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted" && p["correlation_id"] === secondCorrelation;
                } catch {
                    return false;
                }
            });
        assert.ok(ackForSecond.length === 1, `second ack, got ${ackForSecond.length}`);
        mocks.callbacks[ackForSecond[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: secondCorrelation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 1 }),
        );
        const verifyForSecond = mocks.dbusCalls
            .map((call, index) => ({ call, index }))
            .filter(({ call }) => {
                try {
                    const p = parsePayload(call.payload) as Record<string, unknown>;
                    const cmd = p["command"] as Record<string, unknown>;
                    return cmd["op"] === "send-to-workspace-verify" && p["correlation_id"] === secondCorrelation;
                } catch {
                    return false;
                }
            });
        assert.equal(verifyForSecond.length, 1, "second verify");
        mocks.callbacks[verifyForSecond[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: secondCorrelation, outcome: "committed", kind: "send-to-workspace", base_revision: 2 }),
        );
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput)?.id, "ws-1", "second follow returns to ws-1");

        // Same-target protection stays without busy-refused.
        const logsBeforeSame = mocks.logs.length;
        const dbusBeforeSame = mocks.dbusCalls.length;
        handle?.requestWorkspaceMove(1);
        assert.ok(
            mocks.logs.slice(logsBeforeSame).some((l) => l.includes("event=refuse") && l.includes("outcome=same-workspace")),
            mocks.logs.slice(logsBeforeSame).join("\n"),
        );
        assert.equal(mocks.dbusCalls.length, dbusBeforeSame, "same-target must not touch D-Bus");
        assert.ok(
            !mocks.logs.slice(logsBeforeSame).some((l) => l.includes("busy-refused") && l.includes("workspace-move")),
            "same-target must not busy-refuse",
        );

        handle?.stop();
    });

    it("F2A19Z first-send follow reports truthfully when the native switch does not take effect", () => {
        const world = makeWorld();
        const wsBoot = world.desktops[0] as FakeDesktop;
        const wsNew = world.desktops[1] as FakeDesktop;
        const winSignals = new Map<string, { desktops: FakeSignal; geometry: FakeSignal }>();
        const mkWin = (id: string, desktop: FakeDesktop, x: number): FakeWindow => {
            const output = world.outputs[0] as FakeOutput;
            const d = fakeSignal();
            const g = fakeSignal();
            winSignals.set(id, { desktops: d, geometry: g });
            const win = {
                normalWindow: true,
                managed: true,
                minimized: false,
                fullScreen: false,
                maximizeMode: 0,
                onAllDesktops: false,
                internalId: id,
                resourceClass: "test-app",
                output,
                desktops: [desktop],
                frameGeometry: { x, y: 0, width: 100, height: 100 },
                desktopsChanged: d.signal,
                frameGeometryChanged: g.signal,
                moveResizedChanged: fakeSignal().signal,
                fullScreenChanged: fakeSignal().signal,
                maximizedChanged: fakeSignal().signal,
            } as unknown as FakeWindow;
            world.wins.push(win);
            return win;
        };
        // Boot domain ws-1 holds two tiled windows; ws-2 holds the new window.
        const winA = mkWin("win-a", wsBoot, 0);
        mkWin("win-b", wsBoot, 100);
        const winNew = mkWin("win-t", wsNew, 0);
        world.workspace["activeWindow"] = winA;
        world.currentByOutput.set(world.outputs[0] as FakeOutput, wsBoot);
        world.workspace["currentDesktop"] = wsBoot;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);

        // Settle the boot Plan admission.
        runDebounce(mocks);
        const bootPlan = planCalls(mocks);
        assert.equal(bootPlan.length, 1);
        const bootCorrelation = (bootPlan[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[bootPlan[0]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: bootCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );

        // New-window domain becomes current with the new window focused.
        // F2A19Z equivalent: source is the new desktop, target is the boot desktop.
        world.currentByOutput.set(world.outputs[0] as FakeOutput, wsNew);
        world.workspace["currentDesktop"] = wsNew;
        world.workspace["activeWindow"] = winNew;

        // Sabotage the native switch so the setter never takes effect while the
        // current-desktop getter keeps reporting the source. Production
        // switchToTarget must confirm the postcondition instead of reporting
        // success after assignment.
        const workingSetter = world.workspace["setCurrentDesktopForScreen"] as (desktop: unknown, output: unknown) => void;
        let switchAttempts = 0;
        world.workspace["setCurrentDesktopForScreen"] = (): void => {
            switchAttempts += 1;
        };

        // Send 3->2 equivalent: new desktop ws-2 back to boot desktop ws-1.
        handle?.requestWorkspaceMove(1);
        const ownerIndex = mocks.dbusCalls.findIndex((call) => call.method === "GetNameOwner");
        assert.ok(ownerIndex >= 0, "send activation must resolve owner");
        mocks.callbacks[ownerIndex]?.(":1.7");
        const requests = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace");
        assert.equal(requests.length, 1, "exactly one send request");
        const sendPayload = requests[0]?.payload as Record<string, unknown>;
        const correlation = sendPayload["correlation_id"] as string;
        assert.ok(correlation.length > 0);
        assert.equal((sendPayload["command"] as Record<string, unknown>)["window"], "win-t");
        assert.equal((sendPayload["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.equal((sendPayload["target_domain"] as Record<string, unknown>)["workspace"], "ws-1");

        const planned = JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-win-t" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-t",
                leaf: "leaf-win-t",
                source_output: "out-1",
                source_workspace: "ws-2",
                target_output: "out-1",
                target_workspace: "ws-1",
            },
        });
        mocks.callbacks[requests[0]?.index as number]?.(planned);
        const mover = world.wins.find((w) => w.internalId === "win-t") as FakeWindow;
        assert.ok((mover.desktops as FakeDesktop[]).some((d) => d.id === "ws-1"), "mover membership write applied");
        assert.equal(
            sendCalls(mocks).filter((c) => {
                const cmd = c.payload["command"] as Record<string, unknown>;
                return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted";
            }).length,
            0,
            "accepted ack must wait for echoes",
        );
        for (const [, sigs] of winSignals) {
            fire(sigs.desktops);
        }
        for (const [, sigs] of winSignals) {
            fire(sigs.geometry);
        }
        const ackCalls = sendCalls(mocks).filter((c) => {
            const cmd = c.payload["command"] as Record<string, unknown>;
            return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted";
        });
        assert.equal(ackCalls.length, 1, "accepted ack after echoes");
        mocks.callbacks[ackCalls[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 0 }),
        );
        const verifyCalls = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace-verify");
        assert.equal(verifyCalls.length, 1, "verify after ack");
        mocks.callbacks[verifyCalls[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", kind: "send-to-workspace", base_revision: 1 }),
        );

        // Transaction committed, but the native switch never took effect.
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.equal(switchAttempts, 1, "follow must attempt exactly one native switch");
        assert.equal(
            world.currentByOutput.get(world.outputs[0] as FakeOutput),
            wsNew,
            "immediate observed current desktop stays on the source when the switch does not take effect",
        );
        assert.ok(
            !mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")),
            `failed switch must never report follow completed:\n${mocks.logs.join("\n")}`,
        );
        assert.ok(
            !mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")),
            `failed switch must never report follow state-confirmed:\n${mocks.logs.join("\n")}`,
        );

        // Commit is preserved and the instance stays usable: consume any
        // onCommitted resync, restore the native switch, move to where the
        // window now lives, then complete a later valid same-instance send.
        runDebounce(mocks);
        const pendingPlans = planCalls(mocks);
        const lastPending = pendingPlans[pendingPlans.length - 1];
        if (lastPending !== undefined && (lastPending.payload["correlation_id"] as string) !== bootCorrelation) {
            const pendingCorrelation = lastPending.payload["correlation_id"] as string;
            const pendingCommand = (lastPending.payload["command"] as Record<string, unknown>)["op"] as string;
            if (pendingCommand === "admit" || pendingCommand === "reconcile") {
                mocks.callbacks[lastPending.index]?.(
                    JSON.stringify({
                        v: 1,
                        correlation_id: pendingCorrelation,
                        outcome: "planned",
                        desired_geometry: [
                            { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                            { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                            { window: "win-t", leaf: "win-t-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                        ],
                    }),
                );
                runDebounce(mocks);
            }
        }
        world.workspace["setCurrentDesktopForScreen"] = workingSetter;
        world.currentByOutput.set(world.outputs[0] as FakeOutput, wsBoot);
        world.workspace["currentDesktop"] = wsBoot;
        world.workspace["activeWindow"] = mover;

        const dbusBeforeSecond = mocks.dbusCalls.length;
        handle?.requestWorkspaceMove(2);
        const secondOwner = findOwnerCall(mocks, dbusBeforeSecond);
        assert.ok(secondOwner >= 0, "later valid same-instance send must activate");
        mocks.callbacks[secondOwner]?.(":1.7");
        const secondRequests = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace");
        assert.equal(secondRequests.length, 2, "second distinct send starts");
        const secondPayload = secondRequests[1]?.payload as Record<string, unknown>;
        const secondCorrelation = secondPayload["correlation_id"] as string;
        assert.notEqual(secondCorrelation, correlation);
        mocks.callbacks[secondRequests[1]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: secondCorrelation,
                outcome: "planned",
                kind: "send-to-workspace",
                base_revision: 1,
                desired_geometry: [
                    { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                    { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-t" },
                preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
                operation: {
                    op: "move-tiled",
                    window: "win-t",
                    leaf: "leaf-win-t",
                    source_output: "out-1",
                    source_workspace: "ws-1",
                    target_output: "out-1",
                    target_workspace: "ws-2",
                },
            }),
        );
        for (const [, sigs] of winSignals) {
            fire(sigs.desktops);
        }
        for (const [, sigs] of winSignals) {
            fire(sigs.geometry);
        }
        const secondAck = sendCalls(mocks).filter((c) => {
            const p = c.payload as Record<string, unknown>;
            const cmd = p["command"] as Record<string, unknown>;
            return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted" && p["correlation_id"] === secondCorrelation;
        });
        assert.equal(secondAck.length, 1, "second accepted ack");
        mocks.callbacks[secondAck[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: secondCorrelation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 1 }),
        );
        const secondVerify = mocks.dbusCalls
            .map((call, index) => ({ call, index }))
            .filter(({ call }) => {
                try {
                    const p = parsePayload(call.payload) as Record<string, unknown>;
                    const cmd = p["command"] as Record<string, unknown>;
                    return cmd["op"] === "send-to-workspace-verify" && p["correlation_id"] === secondCorrelation;
                } catch {
                    return false;
                }
            });
        assert.equal(secondVerify.length, 1, "second verify");
        mocks.callbacks[secondVerify[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: secondCorrelation, outcome: "committed", kind: "send-to-workspace", base_revision: 2 }),
        );
        assert.ok(
            mocks.logs.some((l) => l.includes(`correlation=${secondCorrelation}`) && l.includes("outcome=committed")),
            mocks.logs.join("\n"),
        );
        assert.ok(
            mocks.logs.some((l) => l.includes(`correlation=${secondCorrelation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.ok(
            !mocks.logs.some((l) => l.includes(`correlation=${secondCorrelation}`) && l.includes("event=follow") && l.includes("outcome=completed")),
            mocks.logs.join("\n"),
        );
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput), wsNew, "second follow reaches its target");
        assert.equal(world.workspace["activeWindow"], mover, "second follow focuses the moved window");

        handle?.stop();
    });

    it("follow confirms by stable desktop id when the getter returns a fresh wrapper", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        // KWin scripting may return a fresh wrapper object per
        // currentDesktopForScreen read. Model a successful native switch that
        // reports the same desktop id through a distinct object, which fails
        // a JS wrapper-identity (`===`) check.
        world.workspace["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
            const source = desktop as FakeDesktop;
            const fresh: FakeDesktop = { id: source.id, x11DesktopNumber: source.x11DesktopNumber as number };
            world.currentByOutput.set(output as never, fresh as never);
            world.workspace["currentDesktop"] = fresh;
        };
        const winSignals = new Map<string, { desktops: FakeSignal; geometry: FakeSignal }>();
        const mkWin = (id: string, desktop: FakeDesktop, x: number): FakeWindow => {
            const d = fakeSignal();
            const g = fakeSignal();
            winSignals.set(id, { desktops: d, geometry: g });
            const win = {
                normalWindow: true,
                managed: true,
                minimized: false,
                fullScreen: false,
                maximizeMode: 0,
                onAllDesktops: false,
                internalId: id,
                resourceClass: "test-app",
                output: world.outputs[0] as FakeOutput,
                desktops: [desktop],
                frameGeometry: { x, y: 0, width: 100, height: 100 },
                desktopsChanged: d.signal,
                frameGeometryChanged: g.signal,
                moveResizedChanged: fakeSignal().signal,
                fullScreenChanged: fakeSignal().signal,
                maximizedChanged: fakeSignal().signal,
            } as unknown as FakeWindow;
            world.wins.push(win);
            return win;
        };
        const winA = mkWin("win-a", ws1, 0);
        const winB = mkWin("win-b", ws1, 100);
        mkWin("win-t", ws2, 0);
        world.workspace["activeWindow"] = winA;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const initialPlan = planCalls(mocks);
        assert.equal(initialPlan.length, 1);
        const initialCorrelation = (initialPlan[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[initialPlan[0]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: initialCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );

        handle?.requestWorkspaceMove(2);
        const ownerIndex = mocks.dbusCalls.findIndex((call) => call.method === "GetNameOwner");
        assert.ok(ownerIndex >= 0);
        mocks.callbacks[ownerIndex]?.(":1.7");
        const requests = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace");
        assert.equal(requests.length, 1);
        const correlation = (requests[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[requests[0]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: correlation,
                outcome: "planned",
                kind: "send-to-workspace",
                base_revision: 0,
                desired_geometry: [
                    { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                    { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
                preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
                operation: {
                    op: "move-tiled",
                    window: "win-a",
                    leaf: "leaf-win-a",
                    source_output: "out-1",
                    source_workspace: "ws-1",
                    target_output: "out-1",
                    target_workspace: "ws-2",
                },
            }),
        );
        for (const [, sigs] of winSignals) {
            fire(sigs.desktops);
        }
        for (const [, sigs] of winSignals) {
            fire(sigs.geometry);
        }
        const ackCalls = sendCalls(mocks).filter((c) => {
            const cmd = c.payload["command"] as Record<string, unknown>;
            return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted";
        });
        assert.equal(ackCalls.length, 1);
        mocks.callbacks[ackCalls[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", kind: "send-to-workspace", base_revision: 0 }),
        );
        const verifyCalls = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace-verify");
        assert.equal(verifyCalls.length, 1);
        // Distinguish follow focus: move focus away before the verified commit.
        world.workspace["activeWindow"] = winB;
        mocks.callbacks[verifyCalls[0]?.index as number]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", kind: "send-to-workspace", base_revision: 1 }),
        );

        const mover = world.wins.find((w) => w.internalId === "win-a") as FakeWindow;
        const current = world.currentByOutput.get(world.outputs[0] as FakeOutput) as FakeDesktop;
        assert.equal(current?.id, "ws-2");
        assert.notEqual(current as unknown, ws2, "getter models a fresh wrapper object");
        assert.ok(
            mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")),
            `fresh-wrapper follow must state-confirm:\n${mocks.logs.join("\n")}`,
        );
        assert.ok(
            !mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=completed")),
            `fresh-wrapper follow must never report completed:\n${mocks.logs.join("\n")}`,
        );
        assert.equal(world.workspace["activeWindow"], mover, "follow must focus the mover");

        handle?.stop();
    });

    it("send request while a real Plan flight is active busy-refuses without D-Bus or native send", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const mkWin = (id: string, desktop: FakeDesktop, x: number): FakeWindow => {
            const win = {
                normalWindow: true,
                managed: true,
                minimized: false,
                fullScreen: false,
                maximizeMode: 0,
                onAllDesktops: false,
                internalId: id,
                resourceClass: "test-app",
                output: world.outputs[0] as FakeOutput,
                desktops: [desktop],
                frameGeometry: { x, y: 0, width: 100, height: 100 },
                desktopsChanged: fakeSignal().signal,
                frameGeometryChanged: fakeSignal().signal,
                moveResizedChanged: fakeSignal().signal,
                fullScreenChanged: fakeSignal().signal,
                maximizedChanged: fakeSignal().signal,
            } as unknown as FakeWindow;
            world.wins.push(win);
            return win;
        };
        const winA = mkWin("win-a", ws1, 0);
        mkWin("win-b", ws1, 100);
        mkWin("win-t", ws2, 0);
        world.workspace["activeWindow"] = winA;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const initialPlan = planCalls(mocks);
        assert.equal(initialPlan.length, 1);
        const initialCorrelation = (initialPlan[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[initialPlan[0]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: initialCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );
        const planAfterSettle = planCalls(mocks).length;
        const sendAfterSettle = sendCalls(mocks).length;

        // Real Plan entry flight: foreground move dispatches and stays in flight.
        handle?.requestMove("left");
        assert.equal(planCalls(mocks).length, planAfterSettle + 1, "plan move must dispatch a real flight");
        const moverBefore = world.wins.find((w) => w.internalId === "win-a") as FakeWindow;
        const desktopsBefore = JSON.stringify((moverBefore.desktops as FakeDesktop[]).map((d) => d.id));
        const geometryBefore = JSON.stringify(moverBefore.frameGeometry);
        const dbusBefore = mocks.dbusCalls.length;
        const logsBefore = mocks.logs.length;

        // Send while Plan is in flight must busy-refuse with no D-Bus or native send.
        handle?.requestWorkspaceMove(2);
        assert.ok(
            mocks.logs.slice(logsBefore).some((l) => l.includes("busy-refused kind=workspace-move")),
            mocks.logs.slice(logsBefore).join("\n"),
        );
        assert.equal(mocks.dbusCalls.length, dbusBefore, "blocked send must not touch D-Bus");
        assert.equal(sendCalls(mocks).length, sendAfterSettle, "no send request while Plan in flight");
        const moverAfter = world.wins.find((w) => w.internalId === "win-a") as FakeWindow;
        assert.equal(JSON.stringify((moverAfter.desktops as FakeDesktop[]).map((d) => d.id)), desktopsBefore, "no native membership write");
        assert.equal(JSON.stringify(moverAfter.frameGeometry), geometryBefore, "no native geometry write");

        // Settle the Plan flight so the harness stops clean.
        const flightCorrelation = (planCalls(mocks)[planCalls(mocks).length - 1]?.payload as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[planCalls(mocks)[planCalls(mocks).length - 1]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: flightCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );
        handle?.stop();
    });

    it("terminal pre-ack timeout disables send with no resync, retry, or follow", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winSignals = new Map<string, { desktops: FakeSignal; geometry: FakeSignal }>();
        const mkWin = (id: string, desktop: FakeDesktop, x: number): FakeWindow => {
            const d = fakeSignal();
            const g = fakeSignal();
            winSignals.set(id, { desktops: d, geometry: g });
            const win = {
                normalWindow: true,
                managed: true,
                minimized: false,
                fullScreen: false,
                maximizeMode: 0,
                onAllDesktops: false,
                internalId: id,
                resourceClass: "test-app",
                output: world.outputs[0] as FakeOutput,
                desktops: [desktop],
                frameGeometry: { x, y: 0, width: 100, height: 100 },
                desktopsChanged: d.signal,
                frameGeometryChanged: g.signal,
                moveResizedChanged: fakeSignal().signal,
                fullScreenChanged: fakeSignal().signal,
                maximizedChanged: fakeSignal().signal,
            } as unknown as FakeWindow;
            world.wins.push(win);
            return win;
        };
        const winA = mkWin("win-a", ws1, 0);
        mkWin("win-b", ws1, 100);
        const winT = mkWin("win-t", ws2, 0);
        world.workspace["activeWindow"] = winA;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const initialPlan = planCalls(mocks);
        assert.equal(initialPlan.length, 1);
        const initialCorrelation = (initialPlan[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[initialPlan[0]?.index as number]?.(
            JSON.stringify({
                v: 1,
                correlation_id: initialCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
            }),
        );
        const planAfterSettle = planCalls(mocks).length;

        const dbusBeforeSend = mocks.dbusCalls.length;
        handle?.requestWorkspaceMove(2);
        const ownerIndex = findOwnerCall(mocks, dbusBeforeSend);
        assert.ok(ownerIndex >= 0, "send activation must resolve owner");
        mocks.callbacks[ownerIndex]?.(":1.7");
        const requests = sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace");
        assert.equal(requests.length, 1);
        const correlation = (requests[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        const planned = JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
            preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
            operation: {
                op: "move-tiled",
                window: "win-a",
                leaf: "leaf-win-a",
                source_output: "out-1",
                source_workspace: "ws-1",
                target_output: "out-1",
                target_workspace: "ws-2",
            },
        });
        mocks.callbacks[requests[0]?.index as number]?.(planned);
        assert.equal(
            sendCalls(mocks).filter((c) => {
                const cmd = c.payload["command"] as Record<string, unknown>;
                return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted";
            }).length,
            0,
            "ack held for echoes",
        );

        // Diverge the post-observation so the pre-ack timeout cannot settle exactly.
        (winT as FakeWindow).frameGeometry = { x: 0, y: 0, width: 100, height: 100 };
        const currentBefore = world.currentByOutput.get(world.outputs[0] as FakeOutput);
        const activeBefore = world.workspace["activeWindow"];

        fireSendTimeout(mocks);

        const acceptedAfter = sendCalls(mocks).filter((c) => {
            const cmd = c.payload["command"] as Record<string, unknown>;
            return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "accepted";
        });
        assert.equal(acceptedAfter.length, 0, "diverged pre-ack timeout must not ack");
        const lostAfter = sendCalls(mocks).filter((c) => {
            const cmd = c.payload["command"] as Record<string, unknown>;
            return cmd["op"] === "send-to-workspace-ack" && cmd["ack_outcome"] === "adapter-lost";
        });
        assert.equal(lostAfter.length, 1, `exactly one adapter-lost, got ${JSON.stringify(sendCalls(mocks).map((c) => c.payload["command"]))}`);
        assert.equal(
            sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace-verify").length,
            0,
            "no verify after terminal timeout",
        );
        assert.ok(mocks.logs.some((l) => l.includes("outcome=timeout")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput), currentBefore, "no false follow");
        assert.equal(world.workspace["activeWindow"], activeBefore, "no false focus");

        // No onCommitted resync and no Plan lifecycle dispatch from the terminal path.
        assert.equal(planCalls(mocks).length, planAfterSettle, "terminal timeout must not resync Plan");
        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, planAfterSettle, "no Plan dispatch after terminal timeout");

        // No retry/replay: late echoes and duplicate planned reply stay inert.
        const dbusAfterTerminal = mocks.dbusCalls.length;
        for (const [, sigs] of winSignals) {
            fire(sigs.desktops);
        }
        for (const [, sigs] of winSignals) {
            fire(sigs.geometry);
        }
        mocks.callbacks[requests[0]?.index as number]?.(planned);
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, dbusAfterTerminal, "late duplicates must not retry or replay");
        assert.equal(planCalls(mocks).length, planAfterSettle, "late duplicates must not dispatch Plan");
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput), currentBefore, "late duplicates must not follow");

        // Send stays disabled fail-closed.
        const dbusBeforeRetry = mocks.dbusCalls.length;
        const logsBeforeRetry = mocks.logs.length;
        handle?.requestWorkspaceMove(2);
        assert.ok(
            mocks.logs.slice(logsBeforeRetry).some((l) => l.includes("busy-refused kind=workspace-move")),
            mocks.logs.slice(logsBeforeRetry).join("\n"),
        );
        assert.equal(mocks.dbusCalls.length, dbusBeforeRetry, "disabled send must not touch D-Bus");
        assert.equal(sendCalls(mocks).filter((c) => (c.payload["command"] as Record<string, unknown>)["op"] === "send-to-workspace").length, 1, "no retried send request");

        handle?.stop();
    });
});
