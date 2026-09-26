import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_DEBOUNCE_MS,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
} from "../src/plan-adapter";
import { observeHiddenDomains, startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP, readDomainGaps } from "../src/domain-gap";

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

function makeWorld(desktopCount = 3, outputCount = 1): FakeWorld {
    const outputs: FakeOutput[] = [];
    for (let index = 0; index < outputCount; index += 1) {
        outputs.push({ name: `out-${String(index + 1)}` });
    }
    const desktops: FakeDesktop[] = [];
    for (let index = 0; index < desktopCount; index += 1) {
        desktops.push({ id: `ws-${String(index + 1)}`, x11DesktopNumber: index + 1 });
    }
    const currentByOutput = new Map<FakeOutput, FakeDesktop>();
    for (const output of outputs) {
        currentByOutput.set(output, desktops[0] as FakeDesktop);
    }
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
    output?: FakeOutput,
    extra: Partial<Pick<FakeWindow, "fullScreen" | "maximizeMode" | "onAllDesktops">> = {},
): FakeWindow {
    const targetOutput = output ?? (world.outputs[0] as FakeOutput);
    const d = fakeSignal();
    const g = fakeSignal();
    world.windowSignals.set(id, { desktops: d, geometry: g });
    const win = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: extra.fullScreen ?? false,
        maximizeMode: extra.maximizeMode ?? 0,
        onAllDesktops: extra.onAllDesktops ?? false,
        internalId: id,
        resourceClass: "test-app",
        output: targetOutput,
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
            throw new Error("review-fixes test did not converge");
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

describe("background review fixes", () => {
    it("startup enables with empty foreground but populated hidden, and stays enabled when neither exists", () => {
        const world = makeWorld();
        const ws2 = world.desktops[1] as FakeDesktop;
        addWindow(world, "win-c", ws2, { x: 0, y: 400, width: 1200, height: 400 });
        addWindow(world, "win-d", ws2, { x: 0, y: 0, width: 1200, height: 400 });
        (world.workspace as { activeWindow: unknown }).activeWindow = null;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "startup must enable when foreground is absent but hidden is eligible");
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2"]));
        assert.equal(answered, 1, "exactly one hidden adoption flight, no foreground");
        const calls = planCalls(mocks);
        assert.equal(calls.length, 1);
        assert.equal((calls[0]?.payload["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.equal(world.activeSets, 0);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();

        const emptyWorld = makeWorld(2);
        (emptyWorld.workspace as { activeWindow: unknown }).activeWindow = null;
        emptyWorld.activeSets = 0;
        const second = startEntry(emptyWorld);
        assert.ok(second.handle !== null, "empty startup keeps an enabled observer for the next window");
        assert.ok(
            second.mocks.logs.some((line) => line.includes("plasma-auto-tiler:plan:ready owner=owner-1 generation=gen-1")),
            "empty startup still logs the truthful ready line",
        );
        assert.ok(
            second.mocks.logs.some((line) =>
                line.includes("plasma-auto-tiler:plan:empty-startup") &&
                line.includes("cause=no-eligible-windows") &&
                line.includes("recovery=await-next-window"),
            ),
            "empty startup logs bounded cause/recovery without window ids",
        );
        second.handle?.stop();
    });

    it("empty startup tiles the next added window through the retained observer", () => {
        const world = makeWorld(2);
        (world.workspace as { activeWindow: unknown }).activeWindow = null;
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "empty startup returns a non-null handle");
        runDebounce(mocks);
        const ws1 = world.desktops[0] as FakeDesktop;
        const win = addWindow(world, "win-late", ws1, { x: 0, y: 0, width: 600, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = win;
        fire(world.signals.windowAdded, win);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-1"]));
        const calls = planCalls(mocks);
        assert.ok(calls.length > 0, "late window addition dispatches through the retained observer");
        assert.ok(
            calls.some((call) =>
                (call.payload["windows"] as PayloadWindow[]).some((entry) => entry.window === "win-late"),
            ),
            "late window is carried in a complete observation",
        );
        handle?.stop();
    });

    it("includes non-active output visible domains as background without touching native state", () => {
        const world = makeWorld(2, 2);
        const out1 = world.outputs[0] as FakeOutput;
        const out2 = world.outputs[1] as FakeOutput;
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        world.currentByOutput.set(out1, ws1);
        world.currentByOutput.set(out2, ws1);
        (world.workspace as { activeScreen: unknown }).activeScreen = out1;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 }, out1);
        addWindow(world, "win-b", ws1, { x: 0, y: 0, width: 1200, height: 800 }, out2);
        addWindow(world, "win-c", ws2, { x: 0, y: 0, width: 1200, height: 800 }, out1);
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        const hidden = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        const keys = hidden.map((entry) => `${entry.domainOutput}/${entry.domainWorkspace}`).sort();
        assert.ok(keys.includes("out-2/ws-1"), `non-active output current must be background, got ${keys.join(",")}`);
        assert.ok(keys.includes("out-1/ws-2"), `hidden desktop must be background, got ${keys.join(",")}`);
        assert.ok(!keys.includes("out-1/ws-1"), "active foreground must never be reported as hidden");

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-1", "ws-2"]));
        assert.equal(answered, 3, "foreground plus both background domains");
        const domains = planCalls(mocks).map((call) => {
            const domain = call.payload["domain"] as Record<string, unknown>;
            return `${String(domain["output"])}/${String(domain["workspace"])}`;
        }).sort();
        assert.deepEqual(domains, ["out-1/ws-1", "out-1/ws-2", "out-2/ws-1"]);
        assert.equal(world.activeSets, 0);
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("excludes the active-window domain when activeScreen differs from activeWindow.output", () => {
        const world = makeWorld(2, 2);
        const out1 = world.outputs[0] as FakeOutput;
        const out2 = world.outputs[1] as FakeOutput;
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        world.currentByOutput.set(out1, ws1);
        world.currentByOutput.set(out2, ws2);
        (world.workspace as { activeScreen: unknown }).activeScreen = out1;
        const winA = addWindow(world, "win-a", ws2, { x: 0, y: 0, width: 1200, height: 800 }, out2);
        addWindow(world, "win-b", ws1, { x: 0, y: 0, width: 1200, height: 800 }, out1);
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;
        world.desktopSwitches = 0;

        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        const hidden = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        const keys = hidden.map((entry) => `${entry.domainOutput}/${entry.domainWorkspace}`).sort();
        assert.ok(!keys.includes("out-2/ws-2"), `active-window domain must never be background, got ${keys.join(",")}`);
        assert.ok(keys.includes("out-1/ws-1"), `divergent activeScreen domain must be background, got ${keys.join(",")}`);
        assert.equal(world.activeSets, 0, "boundary read must not write focus");
        assert.equal(world.desktopSwitches, 0, "boundary read must not switch desktop");
        assert.equal(activeWindowOf(world), winA);
        assert.equal((world.workspace["currentDesktopForScreen"] as (output: unknown) => unknown)(out1), ws1);
        assert.equal((world.workspace["currentDesktopForScreen"] as (output: unknown) => unknown)(out2), ws2);
    });

    it("removes an empty source after a hidden move without leaving a stale baseline", () => {
        const world = makeWorld();
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const ws3 = world.desktops[2] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        const winC = addWindow(world, "win-c", ws2, { x: 0, y: 0, width: 1200, height: 800 });
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
        const tail = calls.slice(-2).map((call) => ({
            domain: (call.payload["domain"] as Record<string, unknown>)["workspace"],
            command: call.payload["command"],
            windows: (call.payload["windows"] as PayloadWindow[]).map((entry) => entry.window).sort(),
        }));
        const target = tail.find((entry) => entry.domain === "ws-3");
        assert.deepEqual(target?.command, { op: "reconcile" });
        assert.deepEqual(target?.windows, ["win-c", "win-e"]);
        const source = tail.find((entry) => entry.domain === "ws-2");
        assert.deepEqual(source?.command, { op: "reconcile" });
        assert.deepEqual(source?.windows, []);

        runDebounce(mocks);
        const quiet = converge(mocks, new Set(["ws-2", "ws-3"]));
        assert.equal(quiet, 0, "no stale baseline slot retries after the empty source is removed");
        assert.equal(world.activeSets, 0);
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("removes a hidden domain that becomes empty after close", () => {
        const world = makeWorld(2);
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
        addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
        addWindow(world, "win-c", ws2, { x: 0, y: 0, width: 1200, height: 800 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        converge(mocks, new Set(["ws-2"]));
        world.activeSets = 0;

        world.wins = world.wins.filter((entry) => entry.internalId !== "win-c");
        fire(world.signals.windowRemoved, undefined);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2"]));
        assert.equal(answered, 1, "exactly one background reconcile retiring the emptied domain");
        const calls = planCalls(mocks);
        const last = calls[calls.length - 1]?.payload as Record<string, unknown>;
        assert.equal((last["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(last["command"], { op: "reconcile" });
        assert.deepEqual(last["windows"], []);

        runDebounce(mocks);
        assert.equal(converge(mocks, new Set(["ws-2"])), 0, "no stale retry after empty removal");
        assert.equal(world.activeSets, 0);
        assert.equal(activeWindowOf(world), winA);
        assert.equal(currentDesktopOf(world), ws1);
        assert.equal(world.desktopSwitches, 0);
        handle?.stop();
    });

    it("converges exception-only hidden domains through reconcile without touching native state", () => {
        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        const rect = { x: 0, y: 0, width: 1200, height: 800 };
        // Precise offline coverage for every exception flag: a hidden domain
        // with no eligible tiled member stays observable as complete
        // exception-only evidence for reconcile convergence.
        const offlineVariants: Array<{ name: string; extra?: Partial<Pick<FakeWindow, "fullScreen" | "maximizeMode" | "onAllDesktops">>; floatingIds?: ReadonlySet<string> }> = [
            { name: "floating", floatingIds: new Set(["win-h"]) },
            { name: "sticky", extra: { onAllDesktops: true } },
            { name: "fullscreen", extra: { fullScreen: true } },
            { name: "maximized", extra: { maximizeMode: 3 } },
        ];
        for (const variant of offlineVariants) {
            const world = makeWorld(2);
            const ws1 = world.desktops[0] as FakeDesktop;
            const ws2 = world.desktops[1] as FakeDesktop;
            const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
            addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
            addWindow(world, "win-h", ws2, rect, undefined, variant.extra ?? {});
            (world.workspace as { activeWindow: unknown }).activeWindow = winA;
            const hidden = observeHiddenDomains(world.workspace, new Map(), variant.floatingIds ?? new Set(), gaps);
            assert.equal(hidden.length, 1, `${variant.name}-only hidden domain stays observable to protect baseline`);
            assert.equal(hidden[0]?.domainWorkspace, "ws-2");
            assert.equal(hidden[0]?.windows.length, 1);
        }
        // Production entry coverage for natively expressible exception-only
        // domains (sticky/fullscreen/maximized need no injected floating set).
        const entryVariants: Array<{ name: string; extra: Partial<Pick<FakeWindow, "fullScreen" | "maximizeMode" | "onAllDesktops">> }> = [
            { name: "sticky", extra: { onAllDesktops: true } },
            { name: "fullscreen", extra: { fullScreen: true } },
            { name: "maximized", extra: { maximizeMode: 3 } },
        ];
        for (const variant of entryVariants) {
            const world = makeWorld(2);
            const ws1 = world.desktops[0] as FakeDesktop;
            const ws2 = world.desktops[1] as FakeDesktop;
            const winA = addWindow(world, "win-a", ws1, { x: 0, y: 0, width: 600, height: 800 });
            addWindow(world, "win-b", ws1, { x: 600, y: 0, width: 600, height: 800 });
            addWindow(world, "win-h", ws2, rect, undefined, variant.extra);
            (world.workspace as { activeWindow: unknown }).activeWindow = winA;
            world.activeSets = 0;

            const { handle, mocks } = startEntry(world);
            assert.ok(handle !== null);
            runDebounce(mocks);
            const answered = converge(mocks, new Set());
            assert.equal(answered, 2, `${variant.name}-only hidden domain converges through reconcile`);
            const hiddenCall = planCalls(mocks).find(
                (call) => (call.payload["domain"] as Record<string, unknown>)["workspace"] === "ws-2",
            )?.payload as Record<string, unknown>;
            assert.ok(hiddenCall !== undefined, `${variant.name}-only hidden domain must dispatch`);
            assert.deepEqual(hiddenCall["command"], { op: "reconcile" });
            assert.deepEqual(
                (hiddenCall["windows"] as PayloadWindow[]).map((entry) => entry.window),
                ["win-h"],
            );
            assert.equal(world.activeSets, 0);
            assert.equal(activeWindowOf(world), winA);
            assert.equal(world.desktopSwitches, 0);
            handle?.stop();
        }
    });

    it("background admission beyond sixteen domains retains without parking", () => {
        const fgA: object = {};
        const fgB: object = {};
        const hiddenRefs = new Map<string, object>();
        const dbusCalls: Array<{ payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
        const logs: string[] = [];
        const subscribes: Array<{ kind: string; handler: (target?: object) => void }> = [];
        let fgRect = { x: 0, y: 0, w: 600, h: 800 };
        let hiddenHidden: PlanObserved[] = [];
        const state = {
            observeImpl: null as unknown as () => PlanObserved | null,
            observeHiddenImpl: null as unknown as () => ReadonlyArray<PlanObserved>,
        };
        const fgObserved = (): PlanObserved => {
            const windows = Object.freeze([
                Object.freeze({
                    id: "win-a", ref: fgA, rect: fgRect, output: "out-1", workspace: "ws-1",
                    fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
                }),
                Object.freeze({
                    id: "win-b", ref: fgB, rect: { x: 600, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1",
                    fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
                }),
            ]);
            return {
                domainOutput: "out-1", domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
                focusedId: "win-a", windows, activeRef: fgA, fingerprint: "fp-fg", revalidate: () => true,
            };
        };
        const hiddenObserved = (workspace: string, windowId: string, ref: object): PlanObserved => {
            const windows = Object.freeze([
                Object.freeze({
                    id: windowId, ref, rect: { x: 0, y: 0, w: 1200, h: 800 }, output: "out-1", workspace,
                    fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
                }),
            ]);
            return {
                domainOutput: "out-1", domainWorkspace: workspace,
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
                focusedId: windowId, windows, activeRef: ref, fingerprint: `fp-${workspace}`, revalidate: () => true,
            };
        };
        state.observeImpl = () => fgObserved();
        const hiddenWorkspaces: string[] = [];
        for (let index = 2; index <= 21; index += 1) {
            hiddenWorkspaces.push(`ws-${String(index)}`);
        }
        for (const workspace of hiddenWorkspaces) {
            const ref: object = {};
            hiddenRefs.set(workspace, ref);
        }
        const rebuildHidden = (): void => {
            hiddenHidden = hiddenWorkspaces.map((workspace) =>
                hiddenObserved(workspace, `win-${workspace}`, hiddenRefs.get(workspace) as object),
            );
        };
        rebuildHidden();
        state.observeHiddenImpl = () => [...hiddenHidden];
        const env: PlanAdapterEnv = {
            callDbus: (_service, _path, _iface, _method, payload, callback): void => {
            if (_method === "NameHasOwner") { callback(true); return; }
            if (_method === "GetNameOwner") { callback(":1.7"); return; }
            if (_method === "StartServiceByName") { callback(1); return; }
                dbusCalls.push({ payload });
                callbacks.push(callback);
            },
            scheduleOnce: (delayMs, callback): (() => void) => {
                const entry = { delayMs, callback, cancelled: false };
                timers.push(entry);
                return (): void => {
                    entry.cancelled = true;
                };
            },
            log: (message): void => {
                logs.push(message);
            },
            observe: () => state.observeImpl(),
            observeHidden: () => state.observeHiddenImpl(),
            clearMaximize: (): "invoked" => "invoked",
            setGeometry: (): boolean => true,
            setActive: (): boolean => true,
            active: (): object | null => null,
            subscribe: (kind, handler): (() => void) => {
                subscribes.push({ kind, handler });
                return (): void => {};
            },
        };
        const adapter = new PlanAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const fireKind = (kind: string): void => {
            for (const sub of subscribes) {
                if (sub.kind === kind) {
                    sub.handler();
                }
            }
        };
        const runDebounceLocal = (): void => {
            const pending = [...timers];
            timers.length = 0;
            for (const timer of pending) {
                if (timer.cancelled) {
                    continue;
                }
                if (timer.delayMs === PLAN_DEBOUNCE_MS) {
                    timer.callback();
                } else {
                    timers.push(timer);
                }
            }
        };
        const payloadAt = (index: number): Record<string, unknown> => JSON.parse(dbusCalls[index]?.payload as string) as Record<string, unknown>;
        const plannedFor = (callPayload: Record<string, unknown>): string => {
            const command = callPayload["command"] as Record<string, unknown>;
            const domain = callPayload["domain"] as Record<string, unknown>;
            const windows = callPayload["windows"] as Array<Record<string, unknown>>;
            const removed = command["op"] === "remove" ? (command["window"] as string) : null;
            const wanted = windows.filter((entry) => entry["window"] !== removed);
            return JSON.stringify({
                v: 1,
                correlation_id: callPayload["correlation_id"],
                outcome: "planned",
                desired_geometry: wanted.map((entry) => ({
                    window: entry["window"],
                    leaf: `${String(entry["window"])}-leaf`,
                    output: domain["output"],
                    workspace: domain["workspace"],
                    rect: entry["rect"],
                })),
            });
        };
        fireKind("added");
        runDebounceLocal();
        let answered = 0;
        for (;;) {
            if (answered >= dbusCalls.length) {
                break;
            }
            const index = answered;
            answered += 1;
            callbacks[index]?.(plannedFor(payloadAt(index)));
            if (answered > 64) {
                throw new Error("multi-domain baseline did not converge");
            }
        }
        assert.equal(dbusCalls.length, 21, "foreground plus twenty hidden domains retained");
        const seededWorkspaces = dbusCalls.map(
            (call) => (payloadAt(dbusCalls.indexOf(call))["domain"] as Record<string, unknown>)["workspace"],
        ).sort();
        assert.ok(seededWorkspaces.includes("ws-1"), "foreground domain seeded via complete observation");
        assert.equal(
            seededWorkspaces.filter((workspace) => workspace !== "ws-1").length,
            20,
            "twenty hidden domains seeded via complete observations",
        );

        const raceRef: object = {};
        const raceObserved = hiddenObserved("ws-race", "win-race", raceRef);
        hiddenHidden = [...hiddenHidden, raceObserved];
        fireKind("geometry");
        runDebounceLocal();
        const raceIndex = dbusCalls.length - 1;
        assert.equal(dbusCalls.length, 22, "twenty-second domain retained via dispatch");
        assert.equal((payloadAt(raceIndex)["domain"] as Record<string, unknown>)["workspace"], "ws-race");
        assert.deepEqual((payloadAt(raceIndex)["command"] as Record<string, unknown>), { op: "reconcile" });
        callbacks[raceIndex]?.(plannedFor(payloadAt(raceIndex)));
        // No domain-count gate: the twenty-second domain is retained and the
        // foreground stays usable with no parking.
        assert.ok(
            !logs.some((line) => line === "plasma-auto-tiler:plan:reconcile-parked"),
            "admission beyond sixteen domains must not park",
        );

        fgRect = { x: 0, y: 0, w: 616, h: 800 };
        const beforeDrift = dbusCalls.length;
        fireKind("geometry");
        runDebounceLocal();
        assert.equal(dbusCalls.length, beforeDrift + 1, "foreground stays usable after admission beyond sixteen domains");
        assert.equal((payloadAt(beforeDrift)["domain"] as Record<string, unknown>)["workspace"], "ws-1");
        assert.deepEqual((payloadAt(beforeDrift)["command"] as Record<string, unknown>)["op"], "reconcile");
    });
});
