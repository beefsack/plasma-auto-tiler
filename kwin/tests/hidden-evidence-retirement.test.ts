import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_DEBOUNCE_MS,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
    planFingerprint,
} from "../src/plan-adapter";
import { observeHiddenDomains } from "../src/plan-adapter-entry";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP, readDomainGaps } from "../src/domain-gap";

interface Sub {
    readonly kind: string;
    readonly handler: (target?: object) => void;
}

function makeEnv(
    fg: () => PlanObserved,
    hidden: () => ReadonlyArray<PlanObserved>,
    calls: Array<{ payload: string }>,
    callbacks: Array<(reply: unknown) => void>,
    timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>,
    subs: Sub[],
): PlanAdapterEnv {
    return {
        callDbus: (_s, _p, _i, _m, payload, callback): void => {
            if (_m === "NameHasOwner") { callback(true); return; }
            if (_m === "GetNameOwner") { callback(":1.7"); return; }
            if (_m === "StartServiceByName") { callback(1); return; }
            calls.push({ payload });
            callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (): void => {},
        observe: fg,
        observeHidden: hidden,
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (): boolean => true,
        setActive: (): boolean => true,
        active: (): object | null => null,
        subscribe: (kind, handler): (() => void) => {
            subs.push({ kind, handler });
            return (): void => {};
        },
    };
}

function fgObserved(winA: object, winB: object): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a", ref: winA, rect: { x: 0, y: 0, w: 600, h: 800 },
            output: "out-1", workspace: "ws-1",
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
        Object.freeze({
            id: "win-b", ref: winB, rect: { x: 600, y: 0, w: 600, h: 800 },
            output: "out-1", workspace: "ws-1",
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1", domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "win-a", windows, activeRef: winA, fingerprint: "fp-fg", revalidate: () => true,
    };
}

function hiddenTiled(workspace: string, windowId: string, ref: object): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: windowId, ref, rect: { x: 0, y: 0, w: 1200, h: 800 },
            output: "out-1", workspace,
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1", domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: windowId, windows, activeRef: ref, fingerprint: `fp-${workspace}`, revalidate: () => true,
    };
}

function hiddenException(
    workspace: string,
    windowId: string,
    ref: object,
    flags: { fullscreen?: boolean; maximized?: boolean; floating?: boolean; sticky?: boolean },
): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: windowId, ref, rect: { x: 0, y: 0, w: 1200, h: 800 },
            output: "out-1", workspace,
            fullscreen: flags.fullscreen ?? false,
            maximized: flags.maximized ?? false,
            floating: flags.floating ?? false,
            sticky: flags.sticky ?? false,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1", domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: windowId, windows, activeRef: ref, fingerprint: `fp-${workspace}-exc`, revalidate: () => true,
    };
}

function hiddenEmpty(workspace: string, activeRef: object): PlanObserved {
    return {
        domainOutput: "out-1", domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: "", activeExcluded: true, windows: Object.freeze([]),
        activeRef, fingerprint: String(planFingerprint("out-1", workspace, "", [])),
        revalidate: () => true,
    };
}

function hiddenPair(workspace: string, first: string, firstRef: object, second: string, secondRef: object): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: first, ref: firstRef, rect: { x: 0, y: 0, w: 600, h: 800 },
            output: "out-1", workspace,
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
        Object.freeze({
            id: second, ref: secondRef, rect: { x: 600, y: 0, w: 600, h: 800 },
            output: "out-1", workspace,
            fullscreen: false, maximized: false, floating: false, sticky: false, resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1", domainWorkspace: workspace,
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP, domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: first, windows, activeRef: firstRef, fingerprint: `fp-${workspace}`, revalidate: () => true,
    };
}

function runDebounce(timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>): void {
    const pending = [...timers];
    timers.length = 0;
    for (const timer of pending) {
        if (timer.cancelled) continue;
        if (timer.delayMs === PLAN_DEBOUNCE_MS) timer.callback();
        else timers.push(timer);
    }
}

function payloadAt(calls: Array<{ payload: string }>, index: number): Record<string, unknown> {
    return JSON.parse(calls[index]?.payload as string) as Record<string, unknown>;
}

function plannedFor(callPayload: Record<string, unknown>): string {
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
}

function answerAll(calls: Array<{ payload: string }>, callbacks: Array<(reply: unknown) => void>, from: number): number {
    let answered = from;
    for (;;) {
        if (answered >= calls.length) break;
        const payload = payloadAt(calls, answered);
        callbacks[answered]?.(plannedFor(payload));
        answered += 1;
        if (answered - from > 24) throw new Error("test did not converge");
    }
    return answered;
}

function innerState(adapter: PlanAdapter): { lastGoodByDomain: Map<string, { windows: ReadonlyArray<{ id: string }> }> } {
    return adapter as unknown as { lastGoodByDomain: Map<string, { windows: ReadonlyArray<{ id: string }> }> };
}

function setupBaseline(): {
    adapter: PlanAdapter;
    calls: Array<{ payload: string }>;
    callbacks: Array<(reply: unknown) => void>;
    timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    subs: Sub[];
    hiddenRef: object;
    setHidden: (value: ReadonlyArray<PlanObserved>) => void;
    fire: (kind: string) => void;
    answered: number;
} {
    const fgA: object = {};
    const fgB: object = {};
    const hiddenRef: object = {};
    let hidden: ReadonlyArray<PlanObserved> = [hiddenTiled("ws-2", "win-h", hiddenRef)];
    const calls: Array<{ payload: string }> = [];
    const callbacks: Array<(reply: unknown) => void> = [];
    const timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
    const subs: Sub[] = [];
    const env = makeEnv(() => fgObserved(fgA, fgB), () => [...hidden], calls, callbacks, timers, subs);
    const adapter = new PlanAdapter(env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    const fire = (kind: string): void => {
        for (const sub of subs) if (sub.kind === kind) sub.handler();
    };
    fire("added");
    runDebounce(timers);
    const answered = answerAll(calls, callbacks, 0);
    assert.equal(innerState(adapter).lastGoodByDomain.size, 2);
    return {
        adapter, calls, callbacks, timers, subs, hiddenRef,
        setHidden: (value) => {
            hidden = value;
        },
        fire, answered,
    };
}

describe("hidden evidence-correct retirement", () => {
    it("retained tiled -> fullscreen stays protected without removal", () => {
        const ctx = setupBaseline();
        ctx.setHidden([hiddenException("ws-2", "win-h", ctx.hiddenRef, { fullscreen: true })]);
        const before = ctx.calls.length;
        ctx.fire("geometry");
        runDebounce(ctx.timers);
        assert.equal(ctx.calls.length, before, "exception-only fullscreen must not dispatch removal");
        assert.equal(innerState(ctx.adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 1);
    });

    it("retained tiled -> floating stays protected without removal", () => {
        const ctx = setupBaseline();
        ctx.setHidden([hiddenException("ws-2", "win-h", ctx.hiddenRef, { floating: true })]);
        const before = ctx.calls.length;
        ctx.fire("geometry");
        runDebounce(ctx.timers);
        assert.equal(ctx.calls.length, before, "exception-only floating must not dispatch removal");
        assert.equal(innerState(ctx.adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 1);
    });

    it("retained tiled -> sticky stays protected without removal", () => {
        const ctx = setupBaseline();
        ctx.setHidden([hiddenException("ws-2", "win-h", ctx.hiddenRef, { sticky: true, floating: true })]);
        const before = ctx.calls.length;
        ctx.fire("geometry");
        runDebounce(ctx.timers);
        assert.equal(ctx.calls.length, before, "exception-only sticky must not dispatch removal");
        assert.equal(innerState(ctx.adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 1);
    });

    it("retained tiled -> maximized stays protected without removal", () => {
        const ctx = setupBaseline();
        ctx.setHidden([hiddenException("ws-2", "win-h", ctx.hiddenRef, { maximized: true })]);
        const before = ctx.calls.length;
        ctx.fire("geometry");
        runDebounce(ctx.timers);
        assert.equal(ctx.calls.length, before, "exception-only maximized must not dispatch removal");
        assert.equal(innerState(ctx.adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 1);
    });

    it("omitted (tainted/unreadable) domain stays untouched without removal", () => {
        const ctx = setupBaseline();
        ctx.setHidden([]);
        const before = ctx.calls.length;
        ctx.fire("geometry");
        runDebounce(ctx.timers);
        assert.equal(ctx.calls.length, before, "absence is unknown and must not synthesize removal");
        assert.equal(innerState(ctx.adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 1);
    });

    it("explicit empty final close retires baseline and frees capacity", () => {
        const ctx = setupBaseline();
        const emptyAnchor: object = {};
        ctx.setHidden([hiddenEmpty("ws-2", emptyAnchor)]);
        ctx.fire("geometry");
        runDebounce(ctx.timers);
        assert.equal(ctx.calls.length, ctx.answered + 1);
        const cleanup = payloadAt(ctx.calls, ctx.answered);
        assert.equal((cleanup["domain"] as Record<string, unknown>)["workspace"], "ws-2");
        assert.deepEqual(cleanup["command"], { op: "remove", window: "win-h" });
        ctx.callbacks[ctx.answered]?.(plannedFor(cleanup));
        assert.equal(innerState(ctx.adapter).lastGoodByDomain.size, 1);
        assert.ok(!innerState(ctx.adapter).lastGoodByDomain.has("out-1\u0000ws-2"));
    });

    it("explicit empty multi-member collapse stays fail-closed", () => {
        const fgA: object = {};
        const fgB: object = {};
        const firstRef: object = {};
        const secondRef: object = {};
        let hidden: ReadonlyArray<PlanObserved> = [hiddenPair("ws-2", "win-h1", firstRef, "win-h2", secondRef)];
        const calls: Array<{ payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
        const subs: Sub[] = [];
        const env = makeEnv(() => fgObserved(fgA, fgB), () => [...hidden], calls, callbacks, timers, subs);
        const adapter = new PlanAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const fire = (kind: string): void => {
            for (const sub of subs) if (sub.kind === kind) sub.handler();
        };
        fire("added");
        runDebounce(timers);
        answerAll(calls, callbacks, 0);
        assert.equal(innerState(adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 2);
        const emptyAnchor: object = {};
        hidden = [hiddenEmpty("ws-2", emptyAnchor)];
        const before = calls.length;
        fire("geometry");
        runDebounce(timers);
        assert.equal(calls.length, before, "explicit empty multi-member must stay fail-closed");
        assert.equal(innerState(adapter).lastGoodByDomain.get("out-1\u0000ws-2")?.windows.length, 2);
    });
});

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
                if (at >= 0) handlers.splice(at, 1);
            },
        },
    };
}

interface FakeDesktop {
    id: string;
}

interface FakeOutput {
    name: string;
}

function makeObserverWorld(): {
    workspace: Record<string, unknown>;
    outputs: FakeOutput[];
    desktops: FakeDesktop[];
    wins: Array<Record<string, unknown>>;
    currentByOutput: Map<FakeOutput, FakeDesktop>;
} {
    const outputs: FakeOutput[] = [{ name: "out-1" }];
    const desktops: FakeDesktop[] = [{ id: "ws-1" }, { id: "ws-2" }, { id: "ws-3" }];
    const currentByOutput = new Map<FakeOutput, FakeDesktop>([[outputs[0] as FakeOutput, desktops[0] as FakeDesktop]]);
    const wins: Array<Record<string, unknown>> = [];
    const workspace: Record<string, unknown> = {};
    workspace["screens"] = outputs;
    workspace["desktops"] = desktops;
    workspace["activeScreen"] = outputs[0];
    workspace["currentDesktopForScreen"] = (output: unknown): unknown => currentByOutput.get(output as FakeOutput) ?? null;
    workspace["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    workspace["windowList"] = (): unknown[] => [...wins];
    const added = fakeSignal();
    const removed = fakeSignal();
    workspace["windowAdded"] = added.signal;
    workspace["windowRemoved"] = removed.signal;
    return { workspace, outputs, desktops, wins, currentByOutput };
}

function addObserverWindow(
    world: ReturnType<typeof makeObserverWorld>,
    id: string,
    desktop: FakeDesktop,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    const win: Record<string, unknown> = {
        normalWindow: true,
        internalId: id,
        resourceClass: "test-app",
        output: world.outputs[0],
        desktops: [desktop],
        onAllDesktops: false,
        fullScreen: false,
        maximizeMode: 0,
        frameGeometry: { x: 0, y: 0, width: 1200, height: 800 },
        ...extra,
    };
    world.wins.push(win);
    return win;
}

describe("hidden observer evidence", () => {
    it("tainted native id omits the output without empty evidence", () => {
        const world = makeObserverWorld();
        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        addObserverWindow(world, "win-a", world.desktops[0] as FakeDesktop);
        addObserverWindow(world, "bad id with spaces!", world.desktops[1] as FakeDesktop);
        const hidden = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        assert.ok(
            hidden.every((entry) => entry.domainOutput !== "out-1" || entry.windows.length > 0),
            "tainted output must not yield explicit empty",
        );
        assert.ok(
            hidden.every((entry) => !(entry.domainOutput === "out-1" && entry.domainWorkspace === "ws-2")),
            "tainted ws-2 must be omitted as unknown",
        );
    });

    it("unreadable frame omits the domain without empty evidence", () => {
        const world = makeObserverWorld();
        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        addObserverWindow(world, "win-a", world.desktops[0] as FakeDesktop);
        addObserverWindow(world, "win-h", world.desktops[1] as FakeDesktop, {
            frameGeometry: { x: 0, y: 0, width: 0, height: 0 },
        });
        const hidden = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        assert.ok(
            hidden.every((entry) => !(entry.domainOutput === "out-1" && entry.domainWorkspace === "ws-2")),
            "unreadable ws-2 must be omitted, never empty",
        );
    });

    it("verified empty domain yields explicit empty evidence", () => {
        const world = makeObserverWorld();
        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        addObserverWindow(world, "win-a", world.desktops[0] as FakeDesktop);
        addObserverWindow(world, "win-h", world.desktops[1] as FakeDesktop);
        const hidden = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        const empty = hidden.find((entry) => entry.domainWorkspace === "ws-3");
        assert.ok(empty !== undefined, "verified-empty ws-3 must be explicitly reported");
        assert.equal(empty?.windows.length, 0);
        assert.equal(empty?.focusedId, "");
        assert.equal(empty?.activeExcluded, true);
    });

    it("fullscreen transition stays observable as exception-only", () => {
        const world = makeObserverWorld();
        const gaps = readDomainGaps({ readInnerGapFn: () => 8, readOuterGapFn: () => 8 });
        addObserverWindow(world, "win-a", world.desktops[0] as FakeDesktop);
        const hiddenWin = addObserverWindow(world, "win-h", world.desktops[1] as FakeDesktop);
        hiddenWin["fullScreen"] = true;
        const hidden = observeHiddenDomains(world.workspace, new Map(), new Set(), gaps);
        const entry = hidden.find((entry) => entry.domainWorkspace === "ws-2");
        assert.ok(entry !== undefined, "exception-only ws-2 must stay observable to protect baseline");
        assert.equal(entry?.windows.length, 1);
        assert.equal(entry?.windows[0]?.fullscreen, true);
    });
});
