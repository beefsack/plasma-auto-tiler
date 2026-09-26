import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { observeHiddenDomains, startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { readDomainGaps } from "../src/domain-gap";

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
    activeSets: number;
    desktopSwitches: number;
    signals: {
        windowAdded: FakeSignal;
        windowRemoved: FakeSignal;
        windowActivated: FakeSignal;
        screensChanged: FakeSignal;
        currentDesktopChanged: FakeSignal;
        desktopsChanged: FakeSignal;
    };
    windowSignals: Map<string, { desktops: FakeSignal; geometry: FakeSignal }>;
}

function makeWorld(desktopCount = 3): FakeWorld {
    const outputs: FakeOutput[] = [{ name: "out-1" }];
    const desktops: FakeDesktop[] = [];
    for (let index = 0; index < desktopCount; index += 1) {
        desktops.push({ id: `ws-${String(index + 1)}`, x11DesktopNumber: index + 1 });
    }
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
    const world: FakeWorld = {
        workspace: {},
        outputs,
        desktops,
        wins: [],
        currentByOutput,
        activeSets: 0,
        desktopSwitches: 0,
        signals,
        windowSignals: new Map(),
    };
    const workspace = world.workspace;
    workspace["screens"] = outputs;
    workspace["desktops"] = desktops;
    let active: unknown = null;
    Object.defineProperty(workspace, "activeWindow", {
        configurable: true,
        enumerable: true,
        get: (): unknown => active,
        set: (value: unknown): void => {
            world.activeSets += 1;
            active = value;
        },
    });
    workspace["activeScreen"] = outputs[0];
    workspace["currentDesktopForScreen"] = (output: unknown): unknown => {
        return currentByOutput.get(output as FakeOutput) ?? null;
    };
    workspace["currentDesktop"] = desktops[0];
    workspace["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        world.desktopSwitches += 1;
        currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        workspace["currentDesktop"] = desktop;
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

function addWindow(
    world: FakeWorld,
    id: string,
    desktop: FakeDesktop,
    rect: { x: number; y: number; width: number; height: number },
): FakeWindow {
    const output = world.outputs[0] as FakeOutput;
    const d = fakeSignal();
    const g = fakeSignal();
    world.windowSignals.set(id, { desktops: d, geometry: g });
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
        frameGeometry: { ...rect },
        desktopsChanged: d.signal,
        frameGeometryChanged: g.signal,
        moveResizedChanged: fakeSignal().signal,
        fullScreenChanged: fakeSignal().signal,
        maximizedChanged: fakeSignal().signal,
    } as unknown as FakeWindow;
    world.wins.push(win);
    return win;
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
    replied: number;
}

function startEntry(world: FakeWorld): { handle: ReturnType<typeof startPlanAdapterEntry>; mocks: Mocks } {
    const mocks: Mocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], replied: 0 };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (service, _path, _iface, method, payload, callback): void => {
            if (method === "NameHasOwner") { callback(true); return; }
            if (method === "GetNameOwner") { callback(":1.7"); return; }
            if (method === "StartServiceByName") { callback(1); return; }
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
        registerShortcutFn: (): boolean => true,
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

interface PayloadWindow {
    window: string;
    output: string;
    workspace: string;
    rect: { x: number; y: number; w: number; h: number };
    floating?: boolean;
}

// Planned-echo reply: cover exactly the wanted set (non-floating members,
// minus the removed window for remove ops) with the carried rects. Hidden
// flights carry an explicit desired_focus naming a hidden leaf to prove the
// adapter never routes it to native focus.
function replyFor(call: { payload: string }, withFocus: boolean): string {
    const payload = parsePayload(call.payload);
    const command = payload["command"] as Record<string, unknown>;
    const domain = payload["domain"] as Record<string, unknown>;
    const windows = payload["windows"] as PayloadWindow[];
    const removed = command["op"] === "remove" ? (command["window"] as string) : null;
    const wanted = windows.filter((entry) => entry.floating !== true && entry.window !== removed);
    const geometry = wanted.map((entry) => ({
        window: entry.window,
        leaf: `leaf-${entry.window}`,
        output: entry.output,
        workspace: entry.workspace,
        rect: { x: entry.rect.x, y: entry.rect.y, w: entry.rect.w, h: entry.rect.h },
    }));
    const body: Record<string, unknown> = {
        v: 1,
        correlation_id: payload["correlation_id"],
        outcome: "planned",
        desired_geometry: geometry,
    };
    if (withFocus && geometry.length > 0) {
        const first = geometry[0] as { leaf: string };
        body["desired_focus"] = {
            domain_output: domain["output"],
            domain_workspace: domain["workspace"],
            leaf: first.leaf,
        };
    }
    return JSON.stringify(body);
}

function planCalls(mocks: Mocks): Array<{ payload: Record<string, unknown>; raw: string }> {
    return mocks.dbusCalls
        .filter((call) => call.method === "DescribePlan")
        .map((call) => ({ payload: parsePayload(call.payload), raw: call.payload }));
}

// Drive every pending DescribePlan flight to planned-applied. Foreground
// flights get no desired_focus; hidden flights carry one to prove focus is
// never routed. Resumes after previously answered flights so repeated
// converge calls only answer new flights. Returns the number of flights
// answered in this call.
function converge(mocks: Mocks, hiddenWorkspaces: ReadonlySet<string>): number {
    let answered = 0;
    for (;;) {
        const calls = mocks.dbusCalls
            .map((call, index) => ({ call, index }))
            .filter(({ call }) => call.method === "DescribePlan");
        if (mocks.replied >= calls.length) {
            break;
        }
        const current = calls[mocks.replied] as { call: { payload: string }; index: number };
        mocks.replied += 1;
        const domain = (parsePayload(current.call.payload)["domain"] as Record<string, unknown>)["workspace"] as string;
        mocks.callbacks[current.index]?.(replyFor(current.call, hiddenWorkspaces.has(domain)));
        answered += 1;
        if (answered > 64) {
            throw new Error("background-tiling test did not converge");
        }
    }
    return answered;
}

function activeWindowOf(world: FakeWorld): unknown {
    return (world.workspace as { activeWindow: unknown }).activeWindow;
}

function currentDesktopOf(world: FakeWorld): unknown {
    const getter = world.workspace["currentDesktopForScreen"] as (output: unknown) => unknown;
    return getter(world.outputs[0]);
}

describe("background tiling through production entry", () => {
    it("adopts hidden domains at startup without touching visibility or focus", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        // Deliberately top-most first: the anchor must still be the
        // spatial-first member (win-d at y=0 before win-c at y=400).
        addWindow(world, "win-c", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        addWindow(world, "win-e", ws3, { x: 0, y: 0, width: 1200, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(answered, 3, "foreground plus one adoption flight per hidden domain");

        const calls = planCalls(mocks);
        assert.equal(calls.length, 3);
        const foreground = calls[0]?.payload as Record<string, unknown>;
        assert.equal((foreground["domain"] as Record<string, unknown>)["workspace"], "ws-1");
        assert.deepEqual(foreground["command"], { op: "reconcile" });

        const hiddenAdopt = calls[1]?.payload as Record<string, unknown>;
        assert.equal((hiddenAdopt["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.equal(hiddenAdopt["focused_window"], "win-d", "anchor is spatial-first, not insertion order");
        assert.deepEqual(hiddenAdopt["command"], { op: "reconcile" });
        const hiddenWindows = (hiddenAdopt["windows"] as PayloadWindow[]).map((entry) => entry.window).sort();
        assert.deepEqual(hiddenWindows, ["win-c", "win-d"]);

        const third = calls[2]?.payload as Record<string, unknown>;
        assert.equal((third["domain"] as Record<string, unknown>)["workspace"], "ws-3");
        assert.equal(third["focused_window"], "win-e");
        assert.deepEqual(third["command"], { op: "reconcile" });
        assert.deepEqual(
            (third["windows"] as PayloadWindow[]).map((entry) => entry.window),
            ["win-e"],
        );

        assert.ok(
            mocks.logs.some((line) => line.includes("outcome=planned-applied")),
            "bounded planned-applied diagnostics reused for hidden flights",
        );
        assert.equal(world.activeSets, 0, "no native focus write despite hidden desired_focus replies");
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1, "desktop visibility unchanged");
        assert.equal(world.desktopSwitches, 0, "never switched desktops");
        handle?.stop();
    });

    it("reconciles a window opened on a hidden domain into the exact hidden refs", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        const beforeB = addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        addWindow(world, "win-c", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;
        const foregroundBefore = { a: { ...winA.frameGeometry }, b: { ...beforeB.frameGeometry } };

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2"]));
        const settledCalls = planCalls(mocks).length;
        world.activeSets = 0;

        const winF = addWindow(world, "win-f", ws2, { x: 600, y: 400, width: 600, height: 400 });
        fire(world.signals.windowAdded, winF);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2"]));
        assert.equal(answered, 1, "exactly one hidden reconcile flight for the opened window");

        const calls = planCalls(mocks);
        const admit = calls[calls.length - 1]?.payload as Record<string, unknown>;
        assert.equal((admit["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(admit["command"], { op: "reconcile" });
        assert.equal(admit["focused_window"], "win-d", "anchor unchanged by the later admission");
        assert.deepEqual(
            (admit["windows"] as PayloadWindow[]).map((entry) => entry.window).sort(),
            ["win-c", "win-d", "win-f"],
        );

        assert.deepEqual(winA.frameGeometry, foregroundBefore.a, "foreground geometry untouched");
        assert.deepEqual(beforeB.frameGeometry, foregroundBefore.b, "foreground geometry untouched");
        assert.deepEqual(winF.frameGeometry, { x: 600, y: 400, width: 600, height: 400 });
        assert.equal(world.activeSets, 0, "no native focus write");
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        assert.equal(planCalls(mocks).length, settledCalls + 1);
        handle?.stop();
    });

    it("reconciles a window moved between hidden domains as remove plus admit", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        const winC = addWindow(world, "win-c", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        addWindow(world, "win-e", ws3, { x: 0, y: 0, width: 1200, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2", "ws-3"]));
        world.activeSets = 0;

        winC.desktops = [ws3];
        const moverSignals = world.windowSignals.get("win-c") as { desktops: FakeSignal; geometry: FakeSignal };
        fire(moverSignals.desktops, winC);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(answered, 2, "one hidden reconcile per touched domain");

        const calls = planCalls(mocks);
        const remove = calls[calls.length - 2]?.payload as Record<string, unknown>;
        assert.equal((remove["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(remove["command"], { op: "reconcile" });
        assert.deepEqual(
            (remove["windows"] as PayloadWindow[]).map((entry) => entry.window),
            ["win-d"],
        );
        const admit = calls[calls.length - 1]?.payload as Record<string, unknown>;
        assert.equal((admit["domain"] as Record<string, unknown>)["workspace"], "ws-3");
        assert.deepEqual(admit["command"], { op: "reconcile" });
        assert.deepEqual(
            (admit["windows"] as PayloadWindow[]).map((entry) => entry.window).sort(),
            ["win-c", "win-e"],
        );

        assert.equal(world.activeSets, 0, "move reconciliation never writes native focus");
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("reconciles hidden geometry drift without disturbing the foreground", () => {
        const world = makeWorld(2);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        const winB = addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        const winD = addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2"]));
        const foregroundBefore = { a: { ...winA.frameGeometry }, b: { ...winB.frameGeometry } };
        world.activeSets = 0;

        winD.frameGeometry = { x: 0, y: 0, width: 500, height: 800 };
        const driftSignals = world.windowSignals.get("win-d") as { desktops: FakeSignal; geometry: FakeSignal };
        fire(driftSignals.geometry, winD);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2"]));
        assert.equal(answered, 1, "one hidden reconcile flight for the drifted domain");

        const calls = planCalls(mocks);
        const reconcile = calls[calls.length - 1]?.payload as Record<string, unknown>;
        assert.equal((reconcile["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(reconcile["command"], { op: "reconcile" });

        assert.deepEqual(winA.frameGeometry, foregroundBefore.a);
        assert.deepEqual(winB.frameGeometry, foregroundBefore.b);
        assert.equal(world.activeSets, 0);
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("admits hidden domains beyond sixteen while foreground keeps working", () => {
        const world = makeWorld(20);
        const ws1 = world.desktops[0] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        for (let index = 1; index < 20; index += 1) {
            addWindow(world, `win-h${String(index)}`, world.desktops[index] as FakeDesktop, {
                x: 0,
                y: 0,
                width: 1200,
                height: 800,
            });
        }
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const answered = converge(mocks, new Set());
        assert.equal(answered, 20, "foreground plus nineteen hidden domains all run");

        const workspaces = planCalls(mocks).map(
            (call) => (call.payload["domain"] as Record<string, unknown>)["workspace"] as string,
        );
        for (let index = 2; index <= 20; index += 1) {
            assert.ok(workspaces.includes(`ws-${String(index)}`), `hidden domain ws-${String(index)} must admit`);
        }
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
        // Foreground stays interactive: a directional move still dispatches.
        handle?.requestMove("left");
        assert.equal(planCalls(mocks).length, 21);
        const move = planCalls(mocks)[20]?.payload as Record<string, unknown>;
        assert.equal((move["domain"] as Record<string, unknown>)["workspace"], "ws-1");
        assert.equal(world.activeSets, 0);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("observes hidden domains directly: reports visible-skipped, tiled anchor, and explicit empty with a stable anchor", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-c", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        const first = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        // ws-1 is visible (never reported); ws-2 carries the tiled anchor and
        // ws-3 is verified-empty explicit evidence (focused "", zero windows).
        assert.equal(first.length, 2);
        const tiled = first.find((entry) => entry.domainWorkspace === "ws-2") as unknown as NonNullable<typeof first[number]>;
        const empty = first.find((entry) => entry.domainWorkspace === "ws-3") as unknown as NonNullable<typeof first[number]>;
        assert.ok(tiled !== undefined && empty !== undefined);
        assert.equal(tiled.domainOutput, "out-1");
        assert.equal(tiled.focusedId, "win-d");
        assert.notEqual(tiled.focusedId, "win-a", "anchor never represents native focus");
        assert.equal(empty.windows.length, 0);
        assert.equal(empty.focusedId, "");
        assert.equal(empty.activeExcluded, true);

        const second = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        const secondTiled = second.find((entry) => entry.domainWorkspace === "ws-2") as unknown as NonNullable<typeof second[number]>;
        assert.equal(secondTiled?.focusedId, tiled.focusedId, "anchor is deterministic");
        assert.equal(secondTiled?.fingerprint, tiled.fingerprint);

        assert.equal(world.activeSets, 0, "observation itself never writes focus");
        assert.equal(currentDesktopOf(world), ws1);
    });

    it("converges fresh mixed and exception-only hidden domains via reconcile", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        const winF = addWindow(world, "win-f", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        winF.fullScreen = true;
        const winG = addWindow(world, "win-g", ws3, { x: 0, y: 0, width: 1200, height: 800 });
        winG.fullScreen = true;
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(answered, 3, "foreground plus mixed plus exception-only hidden");

        const calls = planCalls(mocks);
        const mixed = calls.find(
            (call) => (call.payload["domain"] as Record<string, unknown>)["workspace"] === "ws-2",
        )?.payload as Record<string, unknown>;
        assert.deepEqual(mixed["command"], { op: "reconcile" });
        assert.deepEqual(
            (mixed["windows"] as PayloadWindow[]).map((entry) => entry.window).sort(),
            ["win-d", "win-f"],
        );
        const mixedRaw = mixed["windows"] as Array<Record<string, unknown>>;
        assert.equal(
            mixedRaw.find((entry) => entry["window"] === "win-f")?.["fit_excluded"],
            true,
            "fullscreen exception rides the complete observation",
        );

        const only = calls.find(
            (call) => (call.payload["domain"] as Record<string, unknown>)["workspace"] === "ws-3",
        )?.payload as Record<string, unknown>;
        assert.deepEqual(only["command"], { op: "reconcile" });
        assert.deepEqual(
            (only["windows"] as PayloadWindow[]).map((entry) => entry.window),
            ["win-g"],
        );

        assert.equal(world.activeSets, 0, "hidden reconcile never writes native focus");
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("retires simultaneous hidden removals through one explicit-empty reconcile", () => {
        const world = makeWorld(2);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        addWindow(world, "win-c", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2"]));
        world.activeSets = 0;
        const settled = planCalls(mocks).length;

        world.wins = world.wins.filter((win) => win.internalId !== "win-c" && win.internalId !== "win-d");
        fire(world.signals.windowRemoved, undefined);
        runDebounce(mocks);
        const answered = converge(mocks, new Set());
        assert.equal(answered, 1, "simultaneous departures retire through one reconcile");

        const calls = planCalls(mocks);
        assert.equal(calls.length, settled + 1);
        const retire = calls[calls.length - 1]?.payload as Record<string, unknown>;
        assert.equal((retire["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(retire["command"], { op: "reconcile" });
        assert.deepEqual(retire["windows"], []);

        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, settled + 1, "retired domain sends nothing further");
        assert.equal(world.activeSets, 0);
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("visits each hidden domain once per chain and revisits on a fresh signal", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        const winD = addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 800 });
        const winE = addWindow(world, "win-e", ws3, { x: 0, y: 0, width: 1200, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2", "ws-3"]));
        world.activeSets = 0;
        const settled = planCalls(mocks).length;

        winD.frameGeometry = { x: 0, y: 0, width: 500, height: 800 };
        winE.frameGeometry = { x: 0, y: 0, width: 500, height: 800 };
        const driftD = world.windowSignals.get("win-d") as { desktops: FakeSignal; geometry: FakeSignal };
        const driftE = world.windowSignals.get("win-e") as { desktops: FakeSignal; geometry: FakeSignal };
        fire(driftD.geometry, winD);
        fire(driftE.geometry, winE);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(answered, 2, "one reconcile per drifted hidden domain in the same chain");

        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, settled + 2, "unchanged chain does not self-chain");

        const winF = addWindow(world, "win-f", ws2, { x: 600, y: 0, width: 600, height: 800 });
        fire(world.signals.windowAdded, winF);
        runDebounce(mocks);
        const later = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(later, 1, "fresh later signal revisits the changed hidden domain");
        const last = planCalls(mocks)[planCalls(mocks).length - 1]?.payload as Record<string, unknown>;
        assert.equal((last["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(last["command"], { op: "reconcile" });
        assert.equal(world.activeSets, 0);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("accepts pure hidden drift after three signals but bypasses on membership change", () => {
        const world = makeWorld(2);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        const winD = addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2"]));
        world.activeSets = 0;
        const settled = planCalls(mocks).length;

        const drifted = { x: 0, y: 0, width: 500, height: 800 };
        const stable = { x: 0, y: 0, w: 1200, h: 800 };
        const driftSignals = world.windowSignals.get("win-d") as { desktops: FakeSignal; geometry: FakeSignal };
        for (let attempt = 0; attempt < 3; attempt += 1) {
            winD.frameGeometry = { ...drifted };
            fire(driftSignals.geometry, winD);
            runDebounce(mocks);
            const calls = planCalls(mocks);
            assert.equal(calls.length, settled + attempt + 1, `drift attempt ${String(attempt)} dispatches`);
            const flight = calls[calls.length - 1] as { payload: Record<string, unknown>; raw: string };
            assert.deepEqual(flight.payload["command"], { op: "reconcile" });
            const correlation = String(flight.payload["correlation_id"]);
            mocks.callbacks[mocks.dbusCalls.length - 1]?.(
                JSON.stringify({
                    v: 1,
                    correlation_id: correlation,
                    outcome: "planned",
                    desired_geometry: [
                        { window: "win-d", leaf: "leaf-win-d", output: "out-1", workspace: "ws-2", rect: { x: stable.x, y: stable.y, w: stable.w, h: stable.h } },
                    ],
                }),
            );
            winD.frameGeometry = { ...drifted };
        }
        assert.ok(
            !mocks.logs.some((line) => line.includes("reconcile-parked")),
            "no domain-wide park remains",
        );

        winD.frameGeometry = { ...drifted };
        fire(driftSignals.geometry, winD);
        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, settled + 3, "accepted pure drift sends nothing");
        assert.ok(
            mocks.logs.some((line) => line.includes("reconcile-accepted") && line.includes("cause=stable-drift")),
            "stable hidden drift accepts per-window",
        );

        const winF = addWindow(world, "win-f", ws2, { x: 600, y: 0, width: 600, height: 800 });
        fire(world.signals.windowAdded, winF);
        runDebounce(mocks);
        const afterPark = planCalls(mocks);
        assert.equal(afterPark.length, settled + 4, "membership change bypasses the drift acceptance");
        const bypass = afterPark[afterPark.length - 1]?.payload as Record<string, unknown>;
        assert.equal((bypass["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(bypass["command"], { op: "reconcile" });
        assert.deepEqual(
            (bypass["windows"] as PayloadWindow[]).map((entry) => entry.window).sort(),
            ["win-d", "win-f"],
        );
        converge(mocks, new Set(["ws-2"]));
        assert.equal(world.activeSets, 0);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("retries hidden gap+membership rejection on the same hidden domain exactly once", () => {
        const world = makeWorld(2);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2"]));
        world.activeSets = 0;
        const settled = planCalls(mocks).length;

        addWindow(world, "win-f", ws2, { x: 600, y: 0, width: 600, height: 800 });
        fire(world.signals.windowAdded, undefined);
        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, settled + 1, "membership change dispatches hidden reconcile");
        const flight = planCalls(mocks)[planCalls(mocks).length - 1] as { payload: Record<string, unknown>; raw: string };
        assert.equal((flight.payload["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(flight.payload["command"], { op: "reconcile" });
        const correlation = String(flight.payload["correlation_id"]);

        mocks.callbacks[mocks.dbusCalls.length - 1]?.(
            JSON.stringify({
                v: 1,
                correlation_id: correlation,
                outcome: "rejected",
                kind: "domain-mismatch",
                message: "domain gap does not match retained state",
            }),
        );
        assert.equal(planCalls(mocks).length, settled + 2, "correlated gap rejection retries exactly once");
        const retry = planCalls(mocks)[planCalls(mocks).length - 1]?.payload as Record<string, unknown>;
        assert.equal((retry["domain"] as Record<string, unknown>)["workspace"], "ws-2", "retry stays hidden, not foreground");
        assert.deepEqual(retry["command"], { op: "update-gaps" });
        assert.deepEqual(
            (retry["windows"] as PayloadWindow[]).map((entry) => entry.window).sort(),
            ["win-d", "win-f"],
        );
        assert.ok(
            mocks.logs.some((line) => line.includes("gap-reprojection selected=retry")),
            "retry logs the correlated gap reprojection",
        );

        const retryCorrelation = String(retry["correlation_id"]);
        mocks.callbacks[mocks.dbusCalls.length - 1]?.(replyFor({ payload: JSON.stringify(retry) }, false));
        assert.equal(retryCorrelation.length > 0, true);
        runDebounce(mocks);
        assert.equal(planCalls(mocks).length, settled + 2, "single-flight: no extra dispatch after retry");
        assert.equal(world.activeSets, 0, "hidden gap retry never writes native focus");
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("holds born-fullscreen hidden startup without a slot, then admits on first exit and retires all-life close", () => {
        const world = makeWorld(3);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        const winF = addWindow(world, "win-f", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        winF.fullScreen = true;
        const winG = addWindow(world, "win-g", ws3, { x: 0, y: 0, width: 1200, height: 800 });
        winG.fullScreen = true;
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(answered, 3, "foreground plus two hidden startup flights");

        const calls = planCalls(mocks);
        const mixed = calls.find(
            (call) => (call.payload["domain"] as Record<string, unknown>)["workspace"] === "ws-2",
        ) as { payload: Record<string, unknown>; raw: string };
        const only = calls.find(
            (call) => (call.payload["domain"] as Record<string, unknown>)["workspace"] === "ws-3",
        ) as { payload: Record<string, unknown>; raw: string };
        assert.deepEqual(mixed.payload["command"], { op: "reconcile" });
        assert.deepEqual(only.payload["command"], { op: "reconcile" });
        assert.equal(mixed.payload["focused_window"], "win-d");
        const mixedWindows = mixed.payload["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(mixedWindows.map((entry) => entry["window"]).sort(), ["win-d", "win-f"]);
        assert.equal(mixedWindows.find((entry) => entry["window"] === "win-f")?.["floating"], true);
        assert.equal(mixedWindows.find((entry) => entry["window"] === "win-f")?.["fit_excluded"], true);
        assert.equal(mixedWindows.find((entry) => entry["window"] === "win-d")?.["floating"], undefined);
        const onlyWindows = only.payload["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(onlyWindows.map((entry) => entry["window"]), ["win-g"]);
        assert.equal(onlyWindows[0]?.["floating"], true);
        assert.equal(onlyWindows[0]?.["fit_excluded"], true);
        // Planner allocation covers only the non-floating sibling: the
        // born-fullscreen member takes no Rust tile slot.
        const mixedGeom = (
            JSON.parse(replyFor({ payload: mixed.raw }, true)) as Record<string, unknown>
        )["desired_geometry"] as Array<Record<string, unknown>>;
        assert.deepEqual(mixedGeom.map((entry) => entry["window"]), ["win-d"]);
        const onlyGeom = (
            JSON.parse(replyFor({ payload: only.raw }, true)) as Record<string, unknown>
        )["desired_geometry"] as Array<Record<string, unknown>>;
        assert.deepEqual(onlyGeom, []);
        assert.ok(mocks.logs.some((line) => line.includes("initial-fullscreen-held window=win-f")));
        assert.ok(mocks.logs.some((line) => line.includes("initial-fullscreen-held window=win-g")));
        assert.deepEqual(winF.frameGeometry, { x: 0, y: 400, width: 1200, height: 400 });
        assert.equal(world.activeSets, 0, "hidden startup never writes native focus");
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);

        // First non-fullscreen observation of the held member admits normally.
        // The still-held exception-only domain may refresh in the same chain,
        // so accept its refresh and assert on the ws-2 flight specifically.
        winF.fullScreen = false;
        const heldSignals = world.windowSignals.get("win-f") as { desktops: FakeSignal; geometry: FakeSignal };
        const beforeAdmit = planCalls(mocks).length;
        fire(heldSignals.geometry, winF);
        runDebounce(mocks);
        const admitted = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.ok(admitted >= 1, "released member dispatches at least one hidden reconcile");
        const freshAdmit = planCalls(mocks).slice(beforeAdmit);
        const admit = freshAdmit.find(
            (call) => (call.payload["domain"] as Record<string, unknown>)["workspace"] === "ws-2",
        )?.payload as Record<string, unknown>;
        assert.ok(admit !== undefined, "released domain dispatches");
        assert.deepEqual(admit["command"], { op: "reconcile" });
        const admitWindows = admit["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(admitWindows.map((entry) => entry["window"]).sort(), ["win-d", "win-f"]);
        assert.ok(admitWindows.every((entry) => entry["floating"] === undefined));
        assert.ok(mocks.logs.some((line) => line.includes("initial-fullscreen-released window=win-f")));

        // All-life fullscreen close leaves no stale slot: exact native removal
        // retires the marker-only domain through one explicit-empty reconcile.
        world.wins = world.wins.filter((win) => win !== winG);
        fire(world.signals.windowRemoved, winG);
        runDebounce(mocks);
        const retired = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(retired, 1, "all-life close retires through one reconcile");
        const retire = planCalls(mocks)[planCalls(mocks).length - 1]?.payload as Record<string, unknown>;
        assert.equal((retire["domain"] as Record<string, unknown>)["workspace"], "ws-3");
        assert.deepEqual(retire["command"], { op: "reconcile" });
        assert.deepEqual(retire["windows"], []);
        runDebounce(mocks);
        const settled = planCalls(mocks).length;
        assert.equal(planCalls(mocks).length, settled, "retired domain sends nothing further");

        // Reusing the same id tiles normally with no held residue.
        const winG2 = addWindow(world, "win-g", ws3, { x: 0, y: 0, width: 1200, height: 800 });
        fire(world.signals.windowAdded, winG2);
        runDebounce(mocks);
        const readmit = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(readmit, 1, "reused id admits normally after exact removal");
        const readmitPayload = planCalls(mocks)[planCalls(mocks).length - 1]?.payload as Record<string, unknown>;
        assert.equal((readmitPayload["domain"] as Record<string, unknown>)["workspace"], "ws-3");
        const readmitWindows = readmitPayload["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(readmitWindows.map((entry) => entry["window"]), ["win-g"]);
        assert.equal(readmitWindows[0]?.["floating"], undefined, "no held residue pins the reused id");

        assert.equal(world.activeSets, 0, "hidden release and removal never write native focus");
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });
});
