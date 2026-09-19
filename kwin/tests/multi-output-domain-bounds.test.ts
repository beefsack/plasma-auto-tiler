import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { observeHiddenDomains, observeSendTarget, startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { readDomainGaps } from "../src/domain-gap";

// Regression for the multi-output domain-bounds correction: the production
// Plan adapter must size each (output, workspace) domain with the per-output
// PlacementArea (option 0), never the shared global WorkArea (option 5).
// The fake workspace models two outputs where option 5 returns one shared
// global rect while option 0 returns distinct output-local usable rects with
// a nonzero second-output origin. Assertions check observed/planned/applied
// bounds values only, never the requested enum literal.

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
}

const OUT1_LOCAL = { x: 0, y: 0, w: 1920, h: 1040 };
const OUT2_LOCAL = { x: 1920, y: 24, w: 1920, h: 1016 };
const GLOBAL_AREA = { x: 0, y: 0, w: 3840, h: 1040 };

function makeWorld(): FakeWorld {
    const outputs: FakeOutput[] = [{ name: "out-1" }, { name: "out-2" }];
    const desktops: FakeDesktop[] = [
        { id: "ws-1", x11DesktopNumber: 1 },
        { id: "ws-2", x11DesktopNumber: 2 },
    ];
    const out1 = outputs[0] as FakeOutput;
    const out2 = outputs[1] as FakeOutput;
    const ws1 = desktops[0] as FakeDesktop;
    const currentByOutput = new Map<FakeOutput, FakeDesktop>();
    currentByOutput.set(out1, ws1);
    currentByOutput.set(out2, ws1);
    const perOutput = new Map<FakeOutput, { x: number; y: number; w: number; h: number }>([
        [out1, OUT1_LOCAL],
        [out2, OUT2_LOCAL],
    ]);
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
    workspace["activeScreen"] = out2;
    workspace["currentDesktopForScreen"] = (output: unknown): unknown => {
        return currentByOutput.get(output as FakeOutput) ?? null;
    };
    workspace["currentDesktop"] = ws1;
    workspace["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        world.desktopSwitches += 1;
        currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        workspace["currentDesktop"] = desktop;
    };
    // Option 0 yields distinct output-local usable rects; any other option
    // (notably the global WorkArea 5) yields one shared global rect.
    workspace["clientArea"] = (option: unknown, output: unknown): unknown => {
        const local = option === 0 ? perOutput.get(output as FakeOutput) : undefined;
        const rect = local ?? GLOBAL_AREA;
        return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
    };
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
    output: FakeOutput,
    desktop: FakeDesktop,
    rect: { x: number; y: number; width: number; height: number },
    opts: { maximizeMode?: number } = {},
): FakeWindow {
    const win = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: opts.maximizeMode ?? 0,
        onAllDesktops: false,
        internalId: id,
        resourceClass: "test-app",
        output,
        desktops: [desktop],
        frameGeometry: { ...rect },
        desktopsChanged: fakeSignal().signal,
        frameGeometryChanged: fakeSignal().signal,
        moveResizedChanged: fakeSignal().signal,
        fullScreenChanged: fakeSignal().signal,
        maximizedChanged: fakeSignal().signal,
    } as unknown as FakeWindow;
    world.wins.push(win);
    return win;
}

function rectWithin(
    rect: { x: number; y: number; w: number; h: number },
    bounds: { x: number; y: number; w: number; h: number },
): boolean {
    return (
        rect.x >= bounds.x &&
        rect.y >= bounds.y &&
        rect.w > 0 &&
        rect.h > 0 &&
        rect.x + rect.w <= bounds.x + bounds.w &&
        rect.y + rect.h <= bounds.y + bounds.h
    );
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
    fit_excluded?: boolean;
}

function tiledRects(
    bounds: { x: number; y: number; w: number; h: number },
    gap: number,
    outer: number,
    count: number,
): Array<{ x: number; y: number; w: number; h: number }> {
    const ix = bounds.x + outer;
    const iy = bounds.y + outer;
    const iw = bounds.w - outer * 2;
    const ih = bounds.h - outer * 2;
    if (count <= 1) {
        return [{ x: ix, y: iy, w: iw, h: ih }];
    }
    const totalInner = gap * (count - 1);
    const base = Math.floor((iw - totalInner) / count);
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    let cursor = ix;
    for (let index = 0; index < count; index += 1) {
        const last = index === count - 1;
        const w = last ? ix + iw - cursor : base;
        out.push({ x: cursor, y: iy, w, h: ih });
        cursor += w + gap;
    }
    return out;
}

function replyFor(call: { payload: string }, withFocus: boolean): string {
    const payload = parsePayload(call.payload);
    const command = payload["command"] as Record<string, unknown>;
    const domain = payload["domain"] as Record<string, unknown>;
    const boundsRaw = domain["bounds"] as { x: number; y: number; w: number; h: number };
    const bounds = { x: boundsRaw.x, y: boundsRaw.y, w: boundsRaw.w, h: boundsRaw.h };
    const gapRaw = domain["gap"] as unknown;
    const outerRaw = domain["outer_gap"] as unknown;
    const gap = typeof gapRaw === "number" && Number.isInteger(gapRaw) ? (gapRaw as number) : 8;
    const outer = typeof outerRaw === "number" && Number.isInteger(outerRaw) ? (outerRaw as number) : 8;
    const windows = payload["windows"] as PayloadWindow[];
    const removed = command["op"] === "remove" ? (command["window"] as string) : null;
    // Complete-reply binding: the adapter rejects partial coverage, so every
    // non-floating member (including fit_excluded maximized members, which the
    // adapter skips without writing) needs a planned rectangle.
    const wanted = windows.filter((entry) => entry.floating !== true && entry.window !== removed);
    const rects = tiledRects(bounds, gap, outer, wanted.length);
    const geometry = wanted.map((entry, index) => ({
        window: entry.window,
        leaf: `leaf-${entry.window}`,
        output: entry.output,
        workspace: entry.workspace,
        rect: { ...(rects[index] as { x: number; y: number; w: number; h: number }) },
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
            throw new Error("multi-output-domain-bounds test did not converge");
        }
    }
    return answered;
}

describe("multi-output domain bounds use per-output usable rects", () => {
    it("starts up the foreground domain against its own output usable bounds", () => {
        const world = makeWorld();
        const out1 = world.outputs[0] as FakeOutput;
        const out2 = world.outputs[1] as FakeOutput;
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", out2, ws1, { x: 1920, y: 24, width: 960, height: 1016 });
        const winB = addWindow(world, "win-b", out2, ws1, { x: 2880, y: 24, width: 960, height: 1016 });
        const winC = addWindow(world, "win-c", out1, ws2, { x: 0, y: 0, width: 960, height: 1040 });
        const maximizedBefore = { x: 0, y: 520, width: 1200, height: 520 };
        const winM = addWindow(world, "win-m", out1, ws2, maximizedBefore, { maximizeMode: 3 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;
        const winABefore = { ...winA.frameGeometry };
        const winBBefore = { ...winB.frameGeometry };
        const winCBefore = { ...winC.frameGeometry };
        assert.ok(
            rectWithin({ x: winABefore.x, y: winABefore.y, w: winABefore.width, h: winABefore.height }, OUT2_LOCAL),
            "foreground initial geometry starts inside its own output usable bounds",
        );
        assert.ok(
            rectWithin({ x: winBBefore.x, y: winBBefore.y, w: winBBefore.width, h: winBBefore.height }, OUT2_LOCAL),
            "foreground sibling initial geometry starts inside its own output usable bounds",
        );
        assert.ok(
            rectWithin({ x: winCBefore.x, y: winCBefore.y, w: winCBefore.width, h: winCBefore.height }, OUT1_LOCAL),
            "background initial geometry starts inside its own output usable bounds",
        );
        assert.notDeepEqual(winABefore, winBBefore, "foreground initials start at different rectangles");
        assert.notDeepEqual(winABefore, winCBefore, "foreground and background initials start at different rectangles");

        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        runDebounce(mocks);
        const answered = converge(mocks, new Set(["ws-2"]));
        assert.equal(answered, 2, "foreground plus one hidden adoption flight");

        const calls = planCalls(mocks);
        assert.equal(calls.length, 2);
        const foreground = calls.find(
            (call) => (call.payload["domain"] as Record<string, unknown>)["output"] === "out-2",
        )?.payload as Record<string, unknown>;
        assert.ok(foreground !== undefined, "foreground flight plans the active output domain");
        assert.equal((foreground["domain"] as Record<string, unknown>)["workspace"], "ws-1");
        assert.deepEqual((foreground["domain"] as Record<string, unknown>)["bounds"], OUT2_LOCAL);
        assert.equal((foreground["domain"] as Record<string, unknown>)["gap"], 8, "configured inner gap carried");
        assert.equal((foreground["domain"] as Record<string, unknown>)["outer_gap"], 8, "configured outer gap carried");
        assert.equal(foreground["focused_window"], "win-a", "native focus preserved");

        const hidden = calls.find(
            (call) => (call.payload["domain"] as Record<string, unknown>)["output"] === "out-1",
        )?.payload as Record<string, unknown>;
        assert.ok(hidden !== undefined, "background flight plans the idle output domain");
        assert.equal((hidden["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual((hidden["domain"] as Record<string, unknown>)["bounds"], OUT1_LOCAL);
        assert.equal((hidden["domain"] as Record<string, unknown>)["gap"], 8, "configured inner gap carried");
        assert.equal((hidden["domain"] as Record<string, unknown>)["outer_gap"], 8, "configured outer gap carried");
        assert.equal(hidden["focused_window"], "win-c", "anchor is spatial-first, not native focus");
        const hiddenWindows = hidden["windows"] as PayloadWindow[];
        const maximizedEntry = hiddenWindows.find((entry) => entry.window === "win-m");
        assert.equal(maximizedEntry?.fit_excluded, true, "maximized member stays an exception");

        const fgDomain = foreground["domain"] as { bounds: { x: number; y: number; w: number; h: number }; gap: number; outer_gap: number };
        const fgWanted = (foreground["windows"] as PayloadWindow[]).filter(
            (entry) => entry.floating !== true,
        );
        const fgPlanned = tiledRects(
            { x: fgDomain.bounds.x, y: fgDomain.bounds.y, w: fgDomain.bounds.w, h: fgDomain.bounds.h },
            fgDomain.gap,
            fgDomain.outer_gap,
            fgWanted.length,
        );
        const fgIndexA = fgWanted.findIndex((entry) => entry.window === "win-a");
        const fgIndexB = fgWanted.findIndex((entry) => entry.window === "win-b");
        assert.ok(fgIndexA >= 0 && fgIndexB >= 0, "both foreground members are planned");
        const fgRectA = fgPlanned[fgIndexA] as { x: number; y: number; w: number; h: number };
        const fgRectB = fgPlanned[fgIndexB] as { x: number; y: number; w: number; h: number };
        assert.notDeepEqual(
            { x: winABefore.x, y: winABefore.y, width: winABefore.width, height: winABefore.height },
            { x: fgRectA.x, y: fgRectA.y, width: fgRectA.w, height: fgRectA.h },
            "foreground plan differs from its initial geometry",
        );
        const hiddenDomain = hidden["domain"] as { bounds: { x: number; y: number; w: number; h: number }; gap: number; outer_gap: number };
        const hiddenWanted = (hidden["windows"] as PayloadWindow[]).filter(
            (entry) => entry.floating !== true,
        );
        const hiddenPlanned = tiledRects(
            { x: hiddenDomain.bounds.x, y: hiddenDomain.bounds.y, w: hiddenDomain.bounds.w, h: hiddenDomain.bounds.h },
            hiddenDomain.gap,
            hiddenDomain.outer_gap,
            hiddenWanted.length,
        );
        const hiddenIndexC = hiddenWanted.findIndex((entry) => entry.window === "win-c");
        const hiddenIndexM = hiddenWanted.findIndex((entry) => entry.window === "win-m");
        assert.ok(hiddenIndexC >= 0, "background member is planned");
        assert.ok(hiddenIndexM >= 0, "maximized member still receives a planned rectangle");
        const hiddenRectC = hiddenPlanned[hiddenIndexC] as { x: number; y: number; w: number; h: number };
        const hiddenRectM = hiddenPlanned[hiddenIndexM] as { x: number; y: number; w: number; h: number };
        assert.ok(
            rectWithin(hiddenRectC, OUT1_LOCAL),
            "background plan stays inside its own output usable bounds",
        );
        assert.ok(
            rectWithin(hiddenRectM, OUT1_LOCAL),
            "maximized plan stays inside its own output usable bounds",
        );
        assert.notDeepEqual(
            { x: winCBefore.x, y: winCBefore.y, width: winCBefore.width, height: winCBefore.height },
            { x: hiddenRectC.x, y: hiddenRectC.y, width: hiddenRectC.w, height: hiddenRectC.h },
            "background plan differs from its initial geometry",
        );
        assert.notDeepEqual(
            { ...maximizedBefore },
            { x: hiddenRectM.x, y: hiddenRectM.y, width: hiddenRectM.w, height: hiddenRectM.h },
            "maximized plan differs yet stays unwritten",
        );
        assert.deepEqual(
            { x: winA.frameGeometry.x, y: winA.frameGeometry.y, width: winA.frameGeometry.width, height: winA.frameGeometry.height },
            { x: fgRectA.x, y: fgRectA.y, width: fgRectA.w, height: fgRectA.h },
            "foreground geometry was written to its planned rectangle",
        );
        assert.deepEqual(
            { x: winB.frameGeometry.x, y: winB.frameGeometry.y, width: winB.frameGeometry.width, height: winB.frameGeometry.height },
            { x: fgRectB.x, y: fgRectB.y, width: fgRectB.w, height: fgRectB.h },
            "foreground sibling geometry was written to its planned rectangle",
        );
        assert.deepEqual(
            { x: winC.frameGeometry.x, y: winC.frameGeometry.y, width: winC.frameGeometry.width, height: winC.frameGeometry.height },
            { x: hiddenRectC.x, y: hiddenRectC.y, width: hiddenRectC.w, height: hiddenRectC.h },
            "background geometry was written to its planned rectangle",
        );
        assert.ok(
            rectWithin({ x: winA.frameGeometry.x, y: winA.frameGeometry.y, w: winA.frameGeometry.width, h: winA.frameGeometry.height }, OUT2_LOCAL),
            "applied foreground geometry stays inside its own output usable bounds",
        );
        assert.ok(
            rectWithin({ x: winB.frameGeometry.x, y: winB.frameGeometry.y, w: winB.frameGeometry.width, h: winB.frameGeometry.height }, OUT2_LOCAL),
            "applied foreground sibling geometry stays inside its own output usable bounds",
        );
        assert.ok(
            rectWithin({ x: winC.frameGeometry.x, y: winC.frameGeometry.y, w: winC.frameGeometry.width, h: winC.frameGeometry.height }, OUT1_LOCAL),
            "applied background geometry stays inside its own output usable bounds",
        );
        assert.deepEqual(winM.frameGeometry, maximizedBefore, "maximized member never actuated");
        assert.equal((world.workspace as { activeWindow: unknown }).activeWindow, winA);
        assert.equal(world.activeSets, 0, "no native focus write despite hidden desired_focus reply");
        assert.equal(world.currentByOutput.get(out1), ws1, "desktop visibility unchanged");
        assert.equal(world.currentByOutput.get(out2), ws1, "desktop visibility unchanged");
        assert.equal(world.desktopSwitches, 0, "never switched desktops");
        handle?.stop();
    });

    it("observes hidden domains against their own output usable bounds", () => {
        const world = makeWorld();
        const out1 = world.outputs[0] as FakeOutput;
        const out2 = world.outputs[1] as FakeOutput;
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", out2, ws1, { x: 1920, y: 24, width: 960, height: 1016 });
        addWindow(world, "win-c", out1, ws2, { x: 0, y: 0, width: 960, height: 1040 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        const observed = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        const tiled = observed.find((entry) => entry.domainOutput === "out-1" && entry.domainWorkspace === "ws-2");
        assert.ok(tiled !== undefined, "idle output domain is observed");
        assert.deepEqual({ ...tiled.domainBounds }, OUT1_LOCAL);
        assert.notDeepEqual({ ...tiled.domainBounds }, GLOBAL_AREA, "never the shared global rect");
        assert.equal(tiled.focusedId, "win-c");
        for (const entry of observed) {
            assert.notDeepEqual({ ...entry.domainBounds }, GLOBAL_AREA, "no domain uses the shared global rect");
        }
        assert.equal(world.activeSets, 0, "observation itself never writes focus");
        assert.equal(world.currentByOutput.get(out2), ws1);
    });

    it("observes the workspace-change route against its own output usable bounds", () => {
        const world = makeWorld();
        const out2 = world.outputs[1] as FakeOutput;
        const ws1 = world.desktops[0] as FakeDesktop;
        const ws2 = world.desktops[1] as FakeDesktop;
        const winA = addWindow(world, "win-a", out2, ws1, { x: 1920, y: 24, width: 960, height: 1016 });
        addWindow(world, "win-b", out2, ws1, { x: 2880, y: 24, width: 960, height: 1016 });
        addWindow(world, "win-t", out2, ws2, { x: 1920, y: 24, width: 1920, height: 1016 });
        (world.workspace as { activeWindow: unknown }).activeWindow = winA;
        world.activeSets = 0;

        const observed = observeSendTarget(world.workspace, new Map(), "ws-2", new Set());
        assert.ok(observed !== null);
        assert.equal(observed.sourceOutput, "out-2");
        assert.deepEqual({ ...observed.sourceBounds }, OUT2_LOCAL);
        assert.deepEqual({ ...observed.targetBounds }, OUT2_LOCAL);
        assert.notDeepEqual({ ...observed.sourceBounds }, GLOBAL_AREA, "never the shared global rect");
        assert.equal(observed.focusedId, "win-a", "focus membership preserved");
        assert.deepEqual(observed.sourceWindows.map((entry) => entry.id).sort(), ["win-a", "win-b"]);
        assert.deepEqual(observed.targetWindows.map((entry) => entry.id), ["win-t"]);
        for (const entry of [...observed.sourceWindows, ...observed.targetWindows]) {
            assert.ok(rectWithin(entry.rect, OUT2_LOCAL), "member rect inside its output usable bounds");
        }
        assert.equal(world.activeSets, 0, "observation itself never writes focus");
    });
});
