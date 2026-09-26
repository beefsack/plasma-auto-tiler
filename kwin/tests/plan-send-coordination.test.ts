import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { WORKSPACE_SEND_HAS_OWNER_METHOD, WORKSPACE_SEND_TIMEOUT_MS } from "../src/workspace-send-adapter";

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
    readonly answeredOwners: Set<number>;
}

function startEntry(world: FakeWorld): { handle: ReturnType<typeof startPlanAdapterEntry>; mocks: Mocks } {
    const mocks: Mocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [], answeredOwners: new Set<number>() };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (service, _path, _iface, method, payload, callback): void => {
            if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                callback(true);
                return;
            }
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
    drainOwners(mocks);
}

function parsePayload(payload: string): Record<string, unknown> {
    return JSON.parse(payload) as Record<string, unknown>;
}

function commandOp(payload: Record<string, unknown>): string {
    return ((payload["command"] as Record<string, unknown> | undefined)?.["op"] as string) ?? "?";
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
        if (commandOp(payload) === "send-to-workspace") {
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
        if (commandOp(payload) === "send-to-workspace") {
            out.push({ index, payload });
        }
    });
    return out;
}

function sendOps(mocks: Mocks): string[] {
    const ops: string[] = [];
    mocks.dbusCalls.forEach((call) => {
        if (call.method !== "DescribePlan") {
            return;
        }
        try {
            ops.push(commandOp(parsePayload(call.payload)));
        } catch {
            ops.push("?");
        }
    });
    return ops;
}

function fireSendTimer(mocks: Mocks, which: "first" | "last"): void {
    const active = mocks.timers.filter((timer) => !timer.cancelled && timer.delayMs === WORKSPACE_SEND_TIMEOUT_MS);
    const timer = which === "first" ? active[0] : active[active.length - 1];
    assert.ok(timer, `send ${which} deadline armed`);
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const entry of pending) {
        if (entry !== timer && !entry.cancelled) {
            mocks.timers.push(entry);
        }
    }
    timer.callback();
}

function drainOwners(mocks: Mocks): void {
    for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
        if (mocks.dbusCalls[index]?.method !== "GetNameOwner") {
            continue;
        }
        if (mocks.answeredOwners.has(index)) {
            continue;
        }
        mocks.answeredOwners.add(index);
        mocks.callbacks[index]?.(":1.7");
    }
}

function settleBackgroundPlans(mocks: Mocks): void {
    for (let round = 0; round < 8; round += 1) {
        drainOwners(mocks);
        const before = planCalls(mocks).length;
        for (const call of planCalls(mocks)) {
            const payload = call.payload;
            const command = payload["command"] as Record<string, unknown>;
            const windows = payload["windows"] as Array<Record<string, unknown>>;
            const removed = command["op"] === "remove" ? (command["window"] as string) : null;
            const geometry = windows
                .filter((entry) => entry["floating"] !== true && entry["window"] !== removed)
                .map((entry) => ({
                    window: entry["window"],
                    leaf: `leaf-${entry["window"] as string}`,
                    output: entry["output"],
                    workspace: entry["workspace"],
                    rect: entry["rect"],
                }));
            mocks.callbacks[call.index]?.(
                JSON.stringify({
                    v: 1,
                    correlation_id: payload["correlation_id"],
                    outcome: "planned",
                    desired_geometry: geometry,
                }),
            );
        }
        if (planCalls(mocks).length === before) {
            break;
        }
    }
}

function plannedSendReply(correlation: string): string {
    return JSON.stringify({
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
}

interface Fixture {
    world: FakeWorld;
    ws1: FakeDesktop;
    ws2: FakeDesktop;
    handle: ReturnType<typeof startPlanAdapterEntry>;
    mocks: Mocks;
    winSignals: Map<string, { desktops: FakeSignal; geometry: FakeSignal }>;
    mover: FakeWindow;
}

function setupSendFixture(): Fixture {
    const world = makeWorld();
    const ws1 = world.desktops[0] as FakeDesktop;
    const ws2 = world.desktops[1] as FakeDesktop;
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
    runDebounce(mocks);
    drainOwners(mocks);
    const initialPlan = planCalls(mocks);
    assert.equal(initialPlan.length, 1, "initial Plan admit expected");
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
    settleBackgroundPlans(mocks);
    return { world, ws1, ws2, handle, mocks, winSignals, mover: winA };
}

function startOneSend(fixture: Fixture): { correlation: string; index: number } {
    const { handle, mocks } = fixture;
    handle?.requestWorkspaceMove(2);
    drainOwners(mocks);
    const requests = sendCalls(mocks).filter((c) => commandOp(c.payload) === "send-to-workspace");
    assert.equal(requests.length, 1, "exactly one send request");
    const correlation = (requests[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
    assert.ok(correlation.length > 0);
    assert.equal(((requests[0]?.payload as Record<string, unknown>)["command"] as Record<string, unknown>)["window"], "win-a");
    return { correlation, index: requests[0]?.index as number };
}

function assertRefreshedBothDomains(fixture: Fixture, planBefore: number): void {
    const { mocks } = fixture;
    runDebounce(mocks);
    settleBackgroundPlans(mocks);
    runDebounce(mocks);
    const after = planCalls(mocks).length;
    assert.ok(after > planBefore, `settlement must force source+target refresh, got ${after - planBefore} new Plan calls`);
    const domains = planCalls(mocks).slice(planBefore).map((c) => ((c.payload["domain"] as Record<string, unknown> | undefined)?.["workspace"] as string | undefined) ?? "?");
    assert.ok(domains.includes("ws-1"), `refresh must cover source ws-1, got ${JSON.stringify(domains)}`);
    assert.ok(domains.includes("ws-2"), `refresh must cover target ws-2, got ${JSON.stringify(domains)}`);
    for (const call of planCalls(mocks).slice(planBefore)) {
        assert.ok(commandOp(call.payload) === "admit" || commandOp(call.payload) === "reconcile", `refresh op admit/reconcile, got ${commandOp(call.payload)}`);
    }
}

function assertNoTransactionProtocol(mocks: Mocks): void {
    for (const op of sendOps(mocks)) {
        assert.ok(op === "send-to-workspace" || op === "admit" || op === "reconcile" || op === "remove" || op === "move", `no ack/verify/abandon/status protocol, got ${op}`);
    }
    assert.ok(!sendOps(mocks).includes("send-to-workspace-ack"), "no ack");
    assert.ok(!sendOps(mocks).includes("send-to-workspace-verify"), "no verify");
    assert.ok(!mocks.dbusCalls.some((call) => call.payload.includes("send-to-workspace-abandon")), "no abandon");
}

describe("plan/send immediate-commit coordination through production wiring", () => {
    it("send lands, follows once, then refreshes source and target", () => {
        const fixture = setupSendFixture();
        const { world, ws1, ws2, mocks, mover } = fixture;
        void ws1;
        const planBefore = planCalls(mocks).length;
        const { correlation, index } = startOneSend(fixture);
        mocks.callbacks[index]?.(plannedSendReply(correlation));
        assert.ok((mover.desktops as FakeDesktop[]).some((d) => d.id === "ws-2"), "mover membership written to target");
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput), ws2, "follow switches to target");
        assert.equal(world.workspace["activeWindow"], mover, "follow focuses mover");
        assert.ok(mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), "never claims native commit");
        assertNoTransactionProtocol(mocks);
        assertRefreshedBothDomains(fixture, planBefore);
        const follows = mocks.logs.filter((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed"));
        assert.equal(follows.length, 1, "exactly one follow");
        fixture.handle?.stop();
    });

    it("delayed arrival follows via the mover signal, then refreshes", () => {
        const fixture = setupSendFixture();
        const { ws2, mocks, mover, winSignals } = fixture;
        const sourceDesktops = mover.desktops;
        Object.defineProperty(mover, "desktops", {
            get: () => sourceDesktops,
            set: () => {},
            enumerable: true,
            configurable: true,
        });
        const planBefore = planCalls(mocks).length;
        const { correlation, index } = startOneSend(fixture);
        mocks.callbacks[index]?.(plannedSendReply(correlation));
        assert.deepEqual(mover.desktops, [fixture.ws1], "mover not yet arrived");
        assert.ok(!mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")), "no follow before proof");
        Object.defineProperty(mover, "desktops", {
            value: [ws2],
            writable: true,
            enumerable: true,
            configurable: true,
        });
        winSignals.get("win-a")?.desktops && fire(winSignals.get("win-a")!.desktops);
        assert.ok((mover.desktops as FakeDesktop[]).some((d) => d.id === "ws-2"), "delayed arrival observed");
        assert.equal(mocks.logs.filter((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 1, "one follow after delayed proof");
        assertNoTransactionProtocol(mocks);
        assertRefreshedBothDomains(fixture, planBefore);
        fixture.handle?.stop();
    });

    it("failed native write releases with no follow and refreshes both domains", () => {
        const fixture = setupSendFixture();
        const { mocks, mover } = fixture;
        const sourceDesktops = mover.desktops;
        Object.defineProperty(mover, "desktops", {
            get: () => sourceDesktops,
            set: () => {},
            enumerable: true,
            configurable: true,
        });
        const planBefore = planCalls(mocks).length;
        const { correlation, index } = startOneSend(fixture);
        mocks.callbacks[index]?.(plannedSendReply(correlation));
        assert.deepEqual(mover.desktops, [fixture.ws1], "mover never left source");
        assert.ok(!mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")), "no follow without proof");
        fireSendTimer(mocks, "last");
        assert.ok(mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("stage=release")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), "no commit claim");
        assertNoTransactionProtocol(mocks);
        assertRefreshedBothDomains(fixture, planBefore);
        const dbusBefore = mocks.dbusCalls.length;
        fixture.handle?.requestWorkspaceMove(1);
        assert.ok(mocks.logs.some((l) => l.includes("busy-refused kind=workspace-move") || l.includes("event=refuse")), "reusable or cleanly refused after failure");
        assert.ok(mocks.dbusCalls.length >= dbusBefore, "no unexpected D-Bus storm");
        fixture.handle?.stop();
    });

    it("closed mid-send releases with no follow and refreshes", () => {
        const fixture = setupSendFixture();
        const { mocks, mover } = fixture;
        const planBefore = planCalls(mocks).length;
        handleRequestAndClose(fixture);
        function handleRequestAndClose(fx: Fixture): void {
            fx.handle?.requestWorkspaceMove(2);
            drainOwners(fx.mocks);
            const requests = sendCalls(fx.mocks).filter((c) => commandOp(c.payload) === "send-to-workspace");
            assert.equal(requests.length, 1);
            const correlation = (requests[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
            (mover.desktops as FakeDesktop[]).length = 0;
            mover.desktops = [];
            fx.mocks.callbacks[requests[0]?.index as number]?.(plannedSendReply(correlation));
            assert.ok(!fx.mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")), "close never follows");
            assert.ok(!fx.mocks.logs.some((l) => l.includes("outcome=committed")), "no commit claim");
        }
        assertNoTransactionProtocol(mocks);
        runDebounce(mocks);
        settleBackgroundPlans(mocks);
        runDebounce(mocks);
        assert.ok(planCalls(mocks).length > planBefore, "closed flight still forces a refresh");
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), "no commit claim");
        fixture.handle?.stop();
    });

    it("rapid second send refuses while outstanding, then succeeds with a fresh correlation", () => {
        const fixture = setupSendFixture();
        const { mocks, world, ws2 } = fixture;
        fixture.handle?.requestWorkspaceMove(2);
        drainOwners(mocks);
        assert.equal(sendCalls(mocks).filter((c) => commandOp(c.payload) === "send-to-workspace").length, 1);
        const dbusBefore = mocks.dbusCalls.length;
        fixture.handle?.requestWorkspaceMove(1);
        assert.ok(mocks.logs.some((l) => l.includes("busy-refused kind=workspace-move")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.length, dbusBefore, "refused send must not touch D-Bus");
        const first = sendCalls(mocks)[0];
        const firstCorrelation = (first?.payload as Record<string, unknown>)["correlation_id"] as string;
        mocks.callbacks[first?.index as number]?.(plannedSendReply(firstCorrelation));
        assert.equal(world.currentByOutput.get(world.outputs[0] as FakeOutput), ws2, "first send lands");
        for (let round = 0; round < 6; round += 1) {
            runDebounce(mocks);
            settleBackgroundPlans(mocks);
        }
        runDebounce(mocks);
        const sendBefore = sendCalls(mocks).length;
        fixture.handle?.requestWorkspaceMove(1);
        drainOwners(mocks);
        const all = sendCalls(mocks).filter((c) => commandOp(c.payload) === "send-to-workspace");
        assert.equal(all.length, sendBefore + 1, "second distinct send starts after release");
        const secondCorrelation = (all[all.length - 1]?.payload as Record<string, unknown>)["correlation_id"] as string;
        assert.notEqual(secondCorrelation, firstCorrelation, "distinct correlation");
        assertNoTransactionProtocol(mocks);
        fixture.handle?.stop();
    });

    it("stale reply invalidates before any setter and refreshes", () => {
        const fixture = setupSendFixture();
        const { mocks, mover, world } = fixture;
        const planBefore = planCalls(mocks).length;
        fixture.handle?.requestWorkspaceMove(2);
        drainOwners(mocks);
        const requests = sendCalls(mocks).filter((c) => commandOp(c.payload) === "send-to-workspace");
        assert.equal(requests.length, 1);
        const correlation = (requests[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        const target = world.wins.find((w) => w.internalId === "win-t") as FakeWindow;
        const frame = target.frameGeometry;
        target.frameGeometry = { x: frame.x + 1, y: frame.y, width: frame.width, height: frame.height };
        mocks.callbacks[requests[0]?.index as number]?.(plannedSendReply(correlation));
        assert.ok((mover.desktops as FakeDesktop[]).some((d) => d.id === "ws-1"), "stale reply moves nothing");
        assert.ok(!mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")), "stale reply never follows");
        assert.ok(mocks.logs.some((l) => l.includes("stale-revision") || l.includes("stale-scope")), mocks.logs.join("\n"));
        assertNoTransactionProtocol(mocks);
        assertRefreshedBothDomains(fixture, planBefore);
        fixture.handle?.stop();
    });

    it("unanswered request releases on its deadline, ignores the late reply, and refreshes", () => {
        const fixture = setupSendFixture();
        const { mocks, mover } = fixture;
        const planBefore = planCalls(mocks).length;
        fixture.handle?.requestWorkspaceMove(2);
        drainOwners(mocks);
        const requests = sendCalls(mocks).filter((c) => commandOp(c.payload) === "send-to-workspace");
        assert.equal(requests.length, 1);
        const correlation = (requests[0]?.payload as Record<string, unknown>)["correlation_id"] as string;
        const index = requests[0]?.index as number;
        fireSendTimer(mocks, "first");
        assert.ok(mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("stage=release") && l.includes("outcome=timeout")), mocks.logs.join("\n"));
        mocks.callbacks[index]?.(plannedSendReply(correlation));
        assert.ok(mocks.logs.some((l) => l.includes("event=late-reply") && l.includes("outcome=ignored")), mocks.logs.join("\n"));
        assert.ok((mover.desktops as FakeDesktop[]).some((d) => d.id === "ws-1"), "late reply never actuates");
        assert.ok(!mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")), "late reply never follows");
        assertNoTransactionProtocol(mocks);
        assertRefreshedBothDomains(fixture, planBefore);
        const dbusBefore = mocks.dbusCalls.length;
        fixture.handle?.requestWorkspaceMove(1);
        drainOwners(mocks);
        assert.ok(sendCalls(mocks).length >= 1, "reusable after unanswered release");
        assert.ok(mocks.dbusCalls.length >= dbusBefore);
        fixture.handle?.stop();
    });
});
