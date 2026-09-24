import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_DEBOUNCE_MS,
    PLAN_METHOD,
    PlanAdapter,
    type PlanAdapterEnv,
    type PlanObserved,
} from "../src/plan-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

interface Refs {
    readonly a: object;
    readonly b: object;
}

interface GapState {
    inner: number;
    outer: number;
    bounds: { x: number; y: number; w: number; h: number };
    rects: Record<string, { x: number; y: number; w: number; h: number }>;
}

function makeObserved(refs: Refs, state: GapState): PlanObserved {
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: state.rects["win-a"] ?? { x: 0, y: 0, w: 100, h: 100 },
            output: "out-1",
            workspace: "ws-1",
            fullscreen: false,
            maximized: false,
            floating: false,
            sticky: false,
            resourceClass: "unknown",
        }),
        Object.freeze({
            id: "win-b",
            ref: refs.b,
            rect: state.rects["win-b"] ?? { x: 0, y: 0, w: 100, h: 100 },
            output: "out-1",
            workspace: "ws-1",
            fullscreen: false,
            maximized: false,
            floating: false,
            sticky: false,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { ...state.bounds },
        domainGap: state.inner,
        domainOuterGap: state.outer,
        focusedId: "win-a",
        windows,
        activeRef: refs.a,
        fingerprint: "fp-1",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    readonly actives: object[];
    readonly state: GapState;
    env: PlanAdapterEnv;
}

function mockEnv(refs: Refs): Mocks {
    const state: GapState = {
        inner: 8,
        outer: 8,
        bounds: { x: 0, y: 0, w: 1200, h: 800 },
        rects: {},
    };
    const mocks: Mocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        geometries: [],
        actives: [],
        state,
        env: null as unknown as PlanAdapterEnv,
    };
    mocks.env = {
        callDbus: (
            _service: string,
            _path: string,
            _iface: string,
            method: string,
            payload: string,
            callback: (reply: unknown) => void,
        ): void => {
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
            mocks.dbusCalls.push({ method, payload });
            mocks.callbacks.push(callback);
        },
        scheduleOnce: (delayMs: number, callback: () => void): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            mocks.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message: string): void => {
            mocks.logs.push(message);
        },
        observe: (): PlanObserved | null => makeObserved(refs, mocks.state),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target: object, rect: { x: number; y: number; w: number; h: number }): boolean => {
            mocks.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        },
        setActive: (target: object): boolean => {
            mocks.actives.push(target);
            return true;
        },
        active: (): object | null => refs.a,
        subscribe: (): (() => void) => (): void => {},
    };
    return mocks;
}

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function payloadOf(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function commandOf(mocks: Mocks, index: number): Record<string, unknown> {
    return payloadOf(mocks, index)["command"] as Record<string, unknown>;
}

function domainOf(mocks: Mocks, index: number): Record<string, unknown> {
    return payloadOf(mocks, index)["domain"] as Record<string, unknown>;
}

function correlationOf(mocks: Mocks, index: number): string {
    return String(payloadOf(mocks, index)["correlation_id"]);
}

function replyTo(mocks: Mocks, index: number, reply: string): void {
    mocks.callbacks[index]?.(reply);
}

function plannedReply(
    correlation: string,
    geom: ReadonlyArray<{ window: string; rect: { x: number; y: number; w: number; h: number } }>,
): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "update-gaps" },
        desired_geometry: geom.map((entry) => ({
            window: entry.window,
            leaf: `${entry.window}-leaf`,
            output: "out-1",
            workspace: "ws-1",
            rect: entry.rect,
        })),
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "win-a-leaf" },
    });
}

function rejectedReply(correlation: string, kind: string): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", kind, message: "no" });
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

// Establish a converged (8, 8) baseline through one applied auto-admit
// flight so later gap resyncs have retained state to reproject. Interactive
// focus flights never write geometry, so only the auto path seeds baselines.
function seedBaseline(mocks: Mocks, adapter: PlanAdapter): void {
    adapter.requestResync();
    runDebounce(mocks);
    assert.equal(mocks.dbusCalls.length, 1);
    assert.equal(mocks.dbusCalls[0]?.method, PLAN_METHOD);
    assert.equal(commandOf(mocks, 0)["op"], "admit");
    replyTo(
        mocks,
        0,
        plannedReply(correlationOf(mocks, 0), [
            { window: "win-a", rect: { x: 8, y: 8, w: 588, h: 784 } },
            { window: "win-b", rect: { x: 604, y: 8, w: 588, h: 784 } },
        ]),
    );
    assert.equal(mocks.geometries.length, 2);
    mocks.geometries.length = 0;
    // Native observation converges to the applied allocation so later
    // fences compare against settled frames, as in production.
    mocks.state.rects = {
        "win-a": { x: 8, y: 8, w: 588, h: 784 },
        "win-b": { x: 604, y: 8, w: 588, h: 784 },
    };
}

describe("deliberate gap reprojection dispatch", () => {
    it("dispatches retained update-gaps with a changed inner gap on resync", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        mocks.state.inner = 16;
        adapter.requestResync();
        runDebounce(mocks);

        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual(commandOf(mocks, 1), { op: "update-gaps" });
        const domain = domainOf(mocks, 1);
        assert.equal(domain["gap"], 16);
        assert.equal(domain["outer_gap"], 8);
        assert.ok(
            mocks.logs.some((line) => line.includes("gap-reprojection selected=retained")),
            `expected gap-reprojection log, got ${JSON.stringify(mocks.logs)}`,
        );
        adapter.disable();
    });

    it("dispatches retained update-gaps with a changed outer gap on resync", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        mocks.state.outer = 0;
        adapter.requestResync();
        runDebounce(mocks);

        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual(commandOf(mocks, 1), { op: "update-gaps" });
        const domain = domainOf(mocks, 1);
        assert.equal(domain["gap"], 8);
        assert.equal(domain["outer_gap"], 0);
        adapter.disable();
    });

    it("dispatches one update-gaps for a combined bounds and gap change", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        mocks.state.inner = 4;
        mocks.state.outer = 12;
        mocks.state.bounds = { x: 0, y: 0, w: 1600, h: 900 };
        adapter.requestResync();
        runDebounce(mocks);

        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual(commandOf(mocks, 1), { op: "update-gaps" });
        const domain = domainOf(mocks, 1);
        assert.equal(domain["gap"], 4);
        assert.equal(domain["outer_gap"], 12);
        assert.deepEqual(domain["bounds"], { x: 0, y: 0, w: 1600, h: 900 });
        adapter.disable();
    });

    it("sends nothing when gaps are unchanged", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        adapter.requestResync();
        runDebounce(mocks);

        assert.equal(mocks.dbusCalls.length, 1);
        adapter.disable();
    });
});

describe("deliberate gap reprojection application", () => {
    it("writes the reprojected reply natively, keeps focus, and converges the baseline", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        mocks.state.inner = 16;
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);

        replyTo(
            mocks,
            1,
            plannedReply(correlationOf(mocks, 1), [
                { window: "win-a", rect: { x: 8, y: 8, w: 584, h: 784 } },
                { window: "win-b", rect: { x: 608, y: 8, w: 584, h: 784 } },
            ]),
        );
        assert.deepEqual(
            mocks.geometries.map((entry) => entry.rect),
            [
                { x: 8, y: 8, w: 584, h: 784 },
                { x: 608, y: 8, w: 584, h: 784 },
            ],
        );
        // Focus is preserved without a native focus steal: the reply focus
        // already matches the active window.
        assert.equal(mocks.actives.length, 0);

        // The applied reply advanced the baseline: once native frames
        // converge, a further resync is quiet.
        mocks.state.rects = {
            "win-a": { x: 8, y: 8, w: 584, h: 784 },
            "win-b": { x: 608, y: 8, w: 584, h: 784 },
        };
        mocks.geometries.length = 0;
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        adapter.disable();
    });

    it("defers a gap resync across an in-flight command without replay or reset", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        // The deliberate gap change lands, then a new interactive command
        // leaves one flight in the air carrying the new gaps.
        mocks.state.inner = 16;
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual(commandOf(mocks, 1), { op: "focus", window: "win-a", direction: "right" });
        assert.equal(domainOf(mocks, 1)["gap"], 16);
        const oldCorrelation = correlationOf(mocks, 1);

        // The gap resync must defer behind it, never reset the in-flight
        // command or dispatch a second flight.
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);

        // Completing the old flight converges it, then the deferred gap
        // reprojection dispatches exactly once with a fresh correlation.
        replyTo(
            mocks,
            1,
            plannedReply(oldCorrelation, [
                { window: "win-a", rect: { x: 8, y: 8, w: 588, h: 784 } },
                { window: "win-b", rect: { x: 604, y: 8, w: 588, h: 784 } },
            ]),
        );
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(commandOf(mocks, 2), { op: "update-gaps" });
        assert.notEqual(correlationOf(mocks, 2), oldCorrelation);
        assert.equal(domainOf(mocks, 2)["gap"], 16);
        adapter.disable();
    });

    it("drops a stale-correlated gap reply without writes or baseline motion", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        mocks.state.inner = 16;
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);

        replyTo(
            mocks,
            1,
            plannedReply("gen-1-p999", [
                { window: "win-a", rect: { x: 8, y: 8, w: 584, h: 784 } },
                { window: "win-b", rect: { x: 608, y: 8, w: 584, h: 784 } },
            ]),
        );
        assert.equal(mocks.geometries.length, 0);

        // The baseline never moved: the next resync retries the same gap
        // reprojection instead of converging or reseeding.
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(commandOf(mocks, 2), { op: "update-gaps" });
        assert.equal(domainOf(mocks, 2)["gap"], 16);
        adapter.disable();
    });

    it("keeps the old baseline when the retained route refuses the gap update", () => {
        const refs: Refs = { a: {}, b: {} };
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        seedBaseline(mocks, adapter);

        mocks.state.inner = 16;
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);

        // The retained route refuses while a plan is pending server-side: no
        // native write, no baseline clobber.
        replyTo(mocks, 1, rejectedReply(correlationOf(mocks, 1), "pending-exists"));
        assert.equal(mocks.geometries.length, 0);
        assert.ok(
            mocks.logs.some((line) => line.includes("kind=pending-exists")),
            `expected pending-exists rejection log, got ${JSON.stringify(mocks.logs)}`,
        );

        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(commandOf(mocks, 2), { op: "update-gaps" });
        assert.equal(domainOf(mocks, 2)["gap"], 16);
        adapter.disable();
    });
});

interface FakeSignal {
    readonly handlers: Array<() => void>;
    readonly signal: { connect: (handler: () => void) => void; disconnect: (handler: () => void) => void };
}

function fakeSignal(): FakeSignal {
    const handlers: Array<() => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: () => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: () => void): void => {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
            },
        },
    };
}

function fakeWorkspace(): Record<string, unknown> {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const added = fakeSignal();
    const removed = fakeSignal();
    const activated = fakeSignal();
    const screensChanged = fakeSignal();
    const desktopChanged = fakeSignal();
    const makeWin = (id: string, x: number): Record<string, unknown> => {
        const geo = fakeSignal();
        const full = fakeSignal();
        const max = fakeSignal();
        const desktopsChanged = fakeSignal();
        const win: Record<string, unknown> = {
            normalWindow: true,
            internalId: id,
            resourceClass: "test-app",
            output,
            desktops: [desktop],
            frameGeometry: { x, y: 0, width: 600, height: 800 },
            frameGeometryChanged: geo.signal,
            fullScreenChanged: full.signal,
            fullScreen: false,
            maximizedChanged: max.signal,
            maximizeMode: 0,
            desktopsChanged: desktopsChanged.signal,
            onAllDesktops: false,
        };
        win["setMaximize"] = (): void => {};
        return win;
    };
    const winA = makeWin("win-a", 0);
    const winB = makeWin("win-b", 600);
    return {
        activeWindow: winA,
        windowList: (): unknown[] => [winA, winB],
        screens: [output],
        desktops: [desktop],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowAdded: added.signal,
        windowRemoved: removed.signal,
        windowActivated: activated.signal,
        screensChanged: screensChanged.signal,
        currentDesktopChanged: desktopChanged.signal,
    };
}

describe("deliberate gap reload production route", () => {
    it("sends retained update-gaps on Options configChanged after a converged baseline", () => {
        let innerGap = 8;
        let outerGap = 8;
        const optionsChanged = fakeSignal();
        const dbusCalls: Array<{ method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
        const logs: string[] = [];
        const shortcuts: Array<{ action: string; sequence: string }> = [];
        const fireDebounce = (): void => {
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
        const handle = startPlanAdapterEntry({
            workspace: fakeWorkspace(),
            options: { configChanged: optionsChanged.signal },
            callDbus: (_service, _path, _iface, method, payload, callback): void => {
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
                dbusCalls.push({ method, payload });
                callbacks.push(callback);
            },
        scheduleOnce: (delayMs: number, callback: () => void): (() => void) => {
                const timer = { delayMs, callback, cancelled: false };
                timers.push(timer);
                return (): void => {
                    timer.cancelled = true;
                };
            },
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            registerShortcutFn: (action, _text, sequence): boolean => {
                shortcuts.push({ action, sequence });
                return true;
            },
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): string => "per-output-local",
            readInnerGapFn: (): number => innerGap,
            readOuterGapFn: (): number => outerGap,
        });
        assert.ok(handle !== null);
        const shortcutCount = shortcuts.length;
        assert.ok(shortcutCount > 0);

        // Converge the startup baseline through the automatic admit flight.
        fireDebounce();
        assert.equal(dbusCalls.length, 1);
        assert.deepEqual(
            (JSON.parse(dbusCalls[0]?.payload as string) as { command: unknown }).command as Record<string, unknown>,
            { op: "admit", window: "win-a", output: "out-1", workspace: "ws-1" },
        );
        const admitCorrelation = (JSON.parse(dbusCalls[0]?.payload as string) as { correlation_id: string })
            .correlation_id;
        callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: admitCorrelation,
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "admit" },
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 8, y: 8, w: 584, h: 784 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 8, w: 584, h: 784 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "win-a-leaf" },
            }),
        );

        // The deliberate reload: Options configChanged re-reads gaps and the
        // resync dispatches the retained gap reprojection, not silent adopt.
        innerGap = 16;
        for (const fire of [...optionsChanged.handlers]) {
            fire();
        }
        assert.ok(
            logs.some((line) => line === "plasma-auto-tiler:plan:config-reloaded stage=re-read-queued innerGap=16 outerGap=8 applied-unconfirmed"),
        );
        fireDebounce();
        assert.equal(dbusCalls.length, 2);
        const second = JSON.parse(dbusCalls[1]?.payload as string) as {
            command: Record<string, unknown>;
            domain: Record<string, unknown>;
        };
        assert.deepEqual(second.command, { op: "update-gaps" });
        assert.equal(second.domain["gap"], 16);
        assert.equal(second.domain["outer_gap"], 8);
        // No shortcut re-registration on the reload path.
        assert.equal(shortcuts.length, shortcutCount);
        handle?.stop();
    });
});
