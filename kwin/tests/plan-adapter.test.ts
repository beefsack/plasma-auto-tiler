import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    MaximizeClearOutcome,
    PLAN_CONTRACT_VERSION,
    PLAN_DEBOUNCE_MS,
    PLAN_INTERFACE,
    PLAN_METHOD,
    PLAN_OBJECT,
    PLAN_SERVICE,
    PlanAdapter,
    PlanAdapterEnv,
    PlanObserved,
    planFingerprint,
} from "../src/plan-adapter";
import { planShortcutCatalog, startPlanAdapterEntry } from "../src/plan-adapter-entry";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";
import type { PlanEntryOverrides } from "../src/plan-adapter-entry";

function kwinSrcDir(): string {
    const override = process.env["KWIN_SRC_DIR"];
    if (typeof override === "string" && override.length > 0) {
        try {
            if (existsSync(join(override, "entry.ts"))) {
                return override;
            }
        } catch (error) {
            void error;
        }
    }
    const candidates: string[] = [];
    try {
        const here: unknown = typeof __dirname === "string" ? __dirname : process.cwd();
        if (typeof here === "string") {
            candidates.push(resolve(here, "..", "..", "src"));
            candidates.push(resolve(here, "..", "src"));
            candidates.push(resolve(here, "src"));
        }
    } catch (error) {
        void error;
    }
    candidates.push(resolve(process.cwd(), "src"));
    candidates.push(resolve(process.cwd(), "kwin", "src"));
    for (const dir of candidates) {
        try {
            if (existsSync(join(dir, "entry.ts"))) {
                return dir;
            }
        } catch (error) {
            void error;
        }
    }
    return resolve(process.cwd(), "src");
}

declare const __dirname: string | undefined;

function makeRefs(): { a: object; b: object; c: object } {
    return { a: {}, b: {}, c: {} };
}

function makeObserved(
    refs: { a: object; b: object; c: object },
    opts: {
        focused?: object;
        rects?: Record<string, { x: number; y: number; w: number; h: number }>;
        fullscreen?: Record<string, boolean>;
        maximized?: Record<string, boolean>;
        floating?: Record<string, boolean>;
        sticky?: Record<string, boolean>;
        resourceClasses?: Record<string, string>;
        fingerprint?: string;
        revalidate?: () => boolean;
        bounds?: { x: number; y: number; w: number; h: number };
        domainGap?: number;
        domainOuterGap?: number;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const rect = (id: string): { x: number; y: number; w: number; h: number } =>
        opts.rects?.[id] ?? { x: 0, y: 0, w: 100, h: 100 };
    const isFullscreen = (id: string): boolean => opts.fullscreen?.[id] === true;
    const isMaximized = (id: string): boolean => opts.maximized?.[id] === true;
    const isFloating = (id: string): boolean => opts.floating?.[id] === true;
    const isSticky = (id: string): boolean => opts.sticky?.[id] === true;
    const resourceClass = (id: string): string => opts.resourceClasses?.[id] ?? "unknown";
    const windows = Object.freeze([
        Object.freeze({ id: "win-a", ref: refs.a, rect: rect("win-a"), output: "out-1", workspace: "ws-1", fullscreen: isFullscreen("win-a"), maximized: isMaximized("win-a"), floating: isFloating("win-a"), sticky: isSticky("win-a"), resourceClass: resourceClass("win-a") }),
        Object.freeze({ id: "win-b", ref: refs.b, rect: rect("win-b"), output: "out-1", workspace: "ws-1", fullscreen: isFullscreen("win-b"), maximized: isMaximized("win-b"), floating: isFloating("win-b"), sticky: isSticky("win-b"), resourceClass: resourceClass("win-b") }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: opts.bounds ?? { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: opts.domainGap ?? DOMAIN_GAP,
        domainOuterGap: opts.domainOuterGap ?? OUTER_DOMAIN_GAP,
        focusedId: focused === refs.a ? "win-a" : "win-b",
        windows,
        activeRef: focused,
        fingerprint: opts.fingerprint ?? "fp-1",
        revalidate: opts.revalidate ?? (() => true),
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ service: string; path: string; iface: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly subscribes: Array<{ kind: string; handler: (target?: object) => void }>;
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    readonly actives: object[];
    readonly maximizeClears: object[];
    readonly maximizeToggles: Array<{ target: object; maximized: boolean }>;
    readonly desktopToggles: Array<{ target: object; allDesktops: boolean }>;
    readonly floatingCalls: Array<{ id: string; floating: boolean }>;
    observeImpl: () => PlanObserved | null;
    activeImpl: () => object | null;
    geometryImpl: (target: object, rect: { x: number; y: number; w: number; h: number }) => boolean;
    maximizeClearImpl: (target: object) => MaximizeClearOutcome;
    maximizeToggleImpl: (target: object, maximized: boolean) => MaximizeClearOutcome;
    desktopToggleImpl: (target: object, allDesktops: boolean) => MaximizeClearOutcome;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object; c: object }): Mocks {
    const state: Mocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        subscribes: [],
        geometries: [],
        actives: [],
        maximizeClears: [],
        maximizeToggles: [],
        desktopToggles: [],
        floatingCalls: [],
        observeImpl: () => makeObserved(refs, { focused: refs.a }),
        activeImpl: () => refs.a,
        geometryImpl: (_target: object, _rect: { x: number; y: number; w: number; h: number }): boolean => true,
        maximizeClearImpl: (_target: object): MaximizeClearOutcome => "invoked",
        maximizeToggleImpl: (_target: object, _maximized: boolean): MaximizeClearOutcome => "invoked",
        desktopToggleImpl: (_target: object, _allDesktops: boolean): MaximizeClearOutcome => "invoked",
        env: null as unknown as PlanAdapterEnv,
    };
    const env: PlanAdapterEnv = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            state.dbusCalls.push({ service, path, iface, method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            state.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        clearMaximize: (target): MaximizeClearOutcome => {
            state.maximizeClears.push(target);
            return state.maximizeClearImpl(target);
        },
        setMaximize: (target, maximized): MaximizeClearOutcome => {
            state.maximizeToggles.push({ target, maximized });
            return state.maximizeToggleImpl(target, maximized);
        },
        setAllDesktops: (target, allDesktops): MaximizeClearOutcome => {
            state.desktopToggles.push({ target, allDesktops });
            return state.desktopToggleImpl(target, allDesktops);
        },
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return state.geometryImpl(target, rect);
        },
        setFloating: (id, floating): void => {
            state.floatingCalls.push({ id, floating });
        },
        setActive: (target): boolean => {
            state.actives.push(target);
            return true;
        },
        active: (): object | null => state.activeImpl(),
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
    };
    state.env = env;
    return state;
}

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function plannerPayload(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function plannedReply(
    correlation: string,
    geom: ReadonlyArray<{ window: string; rect: { x: number; y: number; w: number; h: number } }>,
    focusLeaf: string | null,
): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "focus" },
        desired_geometry: geom.map((entry) => ({
            window: entry.window,
            leaf: `${entry.window}-leaf`,
            output: "out-1",
            workspace: "ws-1",
            rect: entry.rect,
        })),
        desired_focus:
            focusLeaf === null
                ? undefined
                : { domain_output: "out-1", domain_workspace: "ws-1", leaf: focusLeaf },
    });
}

function rejectedReply(correlation: string, kind: string): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", kind, message: "no" });
}

function fire(mocks: Mocks, kind: string, target?: object): void {
    for (const sub of mocks.subscribes) {
        if (sub.kind === kind) {
            sub.handler(target);
        }
    }
}

function runTimers(mocks: Mocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (!timer.cancelled) {
            timer.callback();
        }
    }
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

describe("plan adapter route identity and request shape", () => {
    it("invokes only DescribePlan with a single JSON string payload", () => {
        assert.equal(PLAN_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(PLAN_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(PLAN_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(PLAN_METHOD, "DescribePlan");
        assert.equal(PLAN_CONTRACT_VERSION, 1);
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        const call = mocks.dbusCalls[0] as { service: string; path: string; iface: string; method: string };
        assert.equal(call.service, PLAN_SERVICE);
        assert.equal(call.path, PLAN_OBJECT);
        assert.equal(call.iface, PLAN_INTERFACE);
        assert.equal(call.method, PLAN_METHOD);
        const payload = plannerPayload(mocks, 0);
        assert.equal(payload["v"], 1);
        assert.equal(payload["owner"], "owner-1");
        assert.equal(payload["generation"], "gen-1");
        assert.equal(payload["revision"], 0);
        assert.equal(typeof payload["fingerprint"], "number");
        assert.deepEqual(payload["domain"], {
            output: "out-1",
            workspace: "ws-1",
            bounds: { x: 0, y: 0, w: 1200, h: 800 },
            gap: DOMAIN_GAP,
            outer_gap: OUTER_DOMAIN_GAP,
        });
        assert.equal(payload["focused_window"], "win-a");
        const windows = payload["windows"] as Array<Record<string, unknown>>;
        assert.equal(windows.length, 2);
        assert.deepEqual(windows[0], {
            window: "win-a",
            output: "out-1",
            workspace: "ws-1",
            rect: { x: 0, y: 0, w: 100, h: 100 },
        });
        assert.deepEqual(payload["command"], { op: "focus", window: "win-a", direction: "left" });
    });

    it("sends the deterministic numeric fingerprint binding", () => {
        const expected = planFingerprint("out-1", "ws-1", "win-a", ["win-a", "win-b"]);
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(plannerPayload(mocks, 0)["fingerprint"], expected);
        assert.deepEqual(plannerPayload(mocks, 0)["command"], { op: "move", window: "win-a", direction: "right" });
    });

    it("parameterizes resize with direction, mode, and repeat press index", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestResize("left", "outwards");
        assert.deepEqual(plannerPayload(mocks, 0)["command"], {
            op: "resize",
            window: "win-a",
            direction: "left",
            mode: "outwards",
            press_index: 0,
        });
        mocks.callbacks[0]?.(rejectedReply(plannerPayload(mocks, 0)["correlation_id"] as string, "snapshot-invalid"));
        adapter.requestResize("left", "outwards");
        assert.equal((plannerPayload(mocks, 1)["command"] as Record<string, unknown>)["press_index"], 1);
        mocks.callbacks[1]?.(rejectedReply(plannerPayload(mocks, 1)["correlation_id"] as string, "snapshot-invalid"));
        adapter.requestResize("left", "inwards");
        assert.equal((plannerPayload(mocks, 2)["command"] as Record<string, unknown>)["press_index"], 0);
    });
});

describe("plan adapter geometry application", () => {
    it("applies complete reply geometries in grow-before-shrink order with move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 100, h: 100 },
                    "win-b": { x: 100, y: 0, w: 500, h: 500 },
                },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 500, h: 500 } },
                    { window: "win-b", rect: { x: 500, y: 0, w: 100, h: 100 } },
                ],
                "win-b-leaf",
            ),
        );
        assert.equal(mocks.geometries.length, 2);
        assert.equal(mocks.geometries[0]?.target, refs.a);
        assert.equal(mocks.geometries[1]?.target, refs.b);
        assert.deepEqual(mocks.actives, [refs.b]);
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
    });

    it("focus never rewrites geometry and only moves the active window", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 100, h: 100 },
                    "win-b": { x: 100, y: 0, w: 500, h: 500 },
                },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 500, h: 500 } },
                    { window: "win-b", rect: { x: 500, y: 0, w: 100, h: 100 } },
                ],
                "win-b-leaf",
            ),
        );
        assert.equal(mocks.geometries.length, 0);
        assert.deepEqual(mocks.actives, [refs.b]);
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
    });

    it("skips unchanged windows and skips redundant focus writes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.b,
                rects: {
                    "win-a": { x: 0, y: 0, w: 100, h: 100 },
                    "win-b": { x: 100, y: 0, w: 500, h: 500 },
                },
            });
        mocks.activeImpl = () => refs.b;
        const adapter = enableAdapter(mocks);
        adapter.requestMove("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 100, h: 100 } },
                    { window: "win-b", rect: { x: 100, y: 0, w: 400, h: 500 } },
                ],
                "win-b-leaf",
            ),
        );
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.geometries[0]?.target, refs.b);
        assert.equal(mocks.actives.length, 0);
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-a resource_class=unknown disposition=skip-already-equal rect=0,0,100,100",
            ),
            "unchanged member carries skip-already-equal disposition",
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-b resource_class=unknown disposition=written rect=100,0,400,500",
            ),
            "changed member carries written disposition with the target rect",
        );
    });

    it("rejects partial or unknown reply windows without native writes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(correlation, [{ window: "win-a", rect: { x: 0, y: 0, w: 200, h: 200 } }], null),
        );
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("outcome=precondition-mismatch")));
        assert.equal(adapter.isEnabled, true);
    });

    it("records a write-failed disposition with the attempted rect on setGeometry failure", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.geometryImpl = () => false;
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                null,
            ),
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-a resource_class=unknown disposition=write-failed rect=0,0,600,800",
            ),
            "failed member carries write-failed disposition",
        );
        assert.ok(mocks.logs.some((line) => line.includes("outcome=write-failed")));
    });
});

describe("plan adapter recovery and fencing", () => {
    it("keeps rejections recoverable with a bounded rejection-kind line", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const first = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(rejectedReply(first, "snapshot-invalid"));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.ok(
            mocks.logs.some((line) => line.includes("outcome=rejected") && line.includes(`cmd=${first}`)),
        );
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:rejected kind=snapshot-invalid"));
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("identifies the offending carried rectangle on an out-of-bounds rejection", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                bounds: { x: 0, y: 24, w: 1200, h: 776 },
                rects: {
                    "win-a": { x: -8, y: 24, w: 600, h: 776 },
                    "win-b": { x: 600, y: 24, w: 600, h: 776 },
                },
                resourceClasses: { "win-a": "firefox" },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: correlation,
                outcome: "rejected",
                kind: "snapshot-invalid",
                detail: "window-out-of-bounds",
                message: "no",
            }),
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line ===
                    "plasma-auto-tiler:plan:rejected kind=snapshot-invalid detail=window-out-of-bounds window=win-a resource_class=firefox rect=-8,24,600,776 bounds=0,24,1200,776",
            ),
        );
    });

    it("keeps a rejected admission out of the committed baseline so a reopened window is admitted", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let ids = ["win-a", "win-b"];
        const byId: Record<string, object> = {
            "win-a": refs.a,
            "win-b": refs.b,
            "win-c": refs.c,
            "win-c-reopened": refs.c,
        };
        mocks.observeImpl = (): PlanObserved => {
            const windows = ids.map((id) =>
                Object.freeze({
                    id,
                    ref: byId[id] as object,
                    rect:
                        id === "win-a"
                            ? { x: 0, y: 0, w: 600, h: 800 }
                            : id === "win-b"
                              ? { x: 600, y: 0, w: 600, h: 800 }
                              : id === "win-c"
                                ? { x: 0, y: 0, w: 1200, h: 800 }
                                : { x: 800, y: 0, w: 400, h: 800 },
                    output: "out-1",
                    workspace: "ws-1",
                    fullscreen: false,
                    maximized: false,
                }),
            );
            return {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-a",
                windows: Object.freeze(windows),
                activeRef: refs.a,
                fingerprint: `fp-${ids.join(",")}`,
                revalidate: () => true,
            };
        };
        const adapter = enableAdapter(mocks);

        fire(mocks, "added");
        runTimers(mocks);
        let correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );

        ids = ["win-a", "win-b", "win-c"];
        fire(mocks, "added");
        runTimers(mocks);
        assert.deepEqual((plannerPayload(mocks, 1)["command"] as Record<string, unknown>)["window"], "win-c");
        correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            JSON.stringify({
                v: 1,
                correlation_id: correlation,
                outcome: "rejected",
                kind: "snapshot-invalid",
                detail: "window-out-of-bounds",
                message: "no",
            }),
        );
        assert.ok(
            mocks.logs.some(
                (line) => line === "plasma-auto-tiler:plan:rejected kind=snapshot-invalid detail=window-out-of-bounds",
            ),
        );

        ids = ["win-a", "win-b"];
        fire(mocks, "removed");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 2, "the rejected window was never treated as committed");

        ids = ["win-a", "win-b", "win-c-reopened"];
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(plannerPayload(mocks, 2)["command"], {
            op: "admit",
            window: "win-c-reopened",
            output: "out-1",
            workspace: "ws-1",
        });
        correlation = plannerPayload(mocks, 2)["correlation_id"] as string;
        mocks.callbacks[2]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c-reopened", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-c-reopened-leaf",
            ),
        );
        assert.ok(
            mocks.logs.some((line) => line.includes("cmd=gen-1-p2") && line.includes("outcome=planned-applied")),
            mocks.logs.join("\n"),
        );
        assert.equal(adapter.isEnabled, true);
    });

    it("fences stale replies against a newer debounced observation", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let version = 0;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                fingerprint: version === 0 ? "fp-1" : "fp-2",
                rects:
                    version === 0
                        ? { "win-a": { x: 0, y: 0, w: 100, h: 100 }, "win-b": { x: 100, y: 0, w: 100, h: 100 } }
                        : { "win-a": { x: 5, y: 5, w: 100, h: 100 }, "win-b": { x: 100, y: 0, w: 100, h: 100 } },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        version = 1;
        fire(mocks, "geometry");
        runDebounce(mocks);
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 200, h: 200 } },
                    { window: "win-b", rect: { x: 200, y: 0, w: 100, h: 100 } },
                ],
                null,
            ),
        );
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("outcome=stale-dropped")));
        assert.equal(adapter.isEnabled, true);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("refuses busy shortcut commands with one bounded refusal line per kind", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const logsBefore = mocks.logs.length;
        adapter.requestMove("right");
        adapter.requestResize("left", "outwards");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.logs.length, logsBefore + 2);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:busy-refused kind=move"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:busy-refused kind=resize"));
        assert.ok(!mocks.logs.some((line) => line === "plasma-auto-tiler:plan:busy-refused kind=focus"));
    });

    it("drives admit and remove from debounced membership diffs", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let ids: string[] = ["win-a", "win-b"];
        const byId: Record<string, object> = { "win-a": refs.a, "win-b": refs.b, "win-c": refs.c };
        mocks.observeImpl = (): PlanObserved | null => {
            const wins = ids.map((id) =>
                Object.freeze({ id, ref: byId[id] as object, rect: { x: 0, y: 0, w: 100, h: 100 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false }),
            );
            return {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-a",
                windows: Object.freeze(wins),
                activeRef: refs.a,
                fingerprint: `fp-${ids.join(",")}`,
                revalidate: () => true,
            };
        };
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.isInFlight, false);
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual((plannerPayload(mocks, 0)["command"] as Record<string, unknown>)["op"], "admit");
        const initialCorrelation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                initialCorrelation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        ids = ["win-a", "win-b", "win-c"];
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual((plannerPayload(mocks, 1)["command"] as Record<string, unknown>)["op"], "admit");
        assert.equal((plannerPayload(mocks, 1)["command"] as Record<string, unknown>)["window"], "win-c");
        const admitCorr = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReply(
                admitCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-c-leaf",
            ),
        );
        assert.equal(mocks.geometries.length, 5);
        ids = ["win-a", "win-b"];
        fire(mocks, "removed");
        runTimers(mocks);
        assert.ok(mocks.dbusCalls.length >= 3);
        const removeIndex = mocks.dbusCalls.length - 1;
        const removeCmd = plannerPayload(mocks, removeIndex)["command"] as Record<string, unknown>;
        assert.deepEqual(removeCmd, { op: "remove", window: "win-c" });
        const removeWindows = plannerPayload(mocks, removeIndex)["windows"] as Array<Record<string, unknown>>;
        assert.ok(removeWindows.some((entry) => entry["window"] === "win-c"));
    });

    it("retains per-workspace baselines across a rejected admission without duplicate probes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let workspace = "ws-a";
        let ids = ["win-a"];
        const byId: Record<string, object> = { "win-a": refs.a, "win-b": refs.b, "win-c": refs.c };
        mocks.observeImpl = (): PlanObserved | null => {
            const windows = ids.map((id) =>
                Object.freeze({
                    id,
                    ref: byId[id] as object,
                    rect: { x: 0, y: 0, w: 1200, h: 800 },
                    output: "out-1",
                    workspace,
                    fullscreen: false,
                    maximized: false,
                }),
            );
            return {
                domainOutput: "out-1",
                domainWorkspace: workspace,
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: ids[0] as string,
                windows: Object.freeze(windows),
                activeRef: byId[ids[0] as string] as object,
                fingerprint: `${workspace}-${ids.join(",")}`,
                revalidate: () => true,
            };
        };
        const adapter = enableAdapter(mocks);

        fire(mocks, "added");
        runTimers(mocks);
        let correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReply(correlation, [{ window: "win-a", rect: { x: 0, y: 0, w: 1200, h: 800 } }], null));

        workspace = "ws-b";
        ids = ["win-c"];
        fire(mocks, "scope");
        runTimers(mocks);
        correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, [{ window: "win-c", rect: { x: 0, y: 0, w: 1200, h: 800 } }], null));

        workspace = "ws-a";
        ids = ["win-a"];
        fire(mocks, "scope");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 2, "returning to an applied workspace does not re-admit known membership");

        workspace = "ws-b";
        ids = ["win-b", "win-c"];
        fire(mocks, "scope");
        runTimers(mocks);
        assert.deepEqual(plannerPayload(mocks, 2)["command"], { op: "admit", window: "win-b", output: "out-1", workspace: "ws-b" });
        mocks.callbacks[2]?.(rejectedReply(plannerPayload(mocks, 2)["correlation_id"] as string, "snapshot-invalid"));

        workspace = "ws-a";
        ids = ["win-a"];
        fire(mocks, "scope");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 3, "a rejected admission in another workspace cannot discard this baseline");
        assert.ok(!mocks.logs.some((line) => line === "plasma-auto-tiler:plan:rejected kind=duplicate-window"));
        assert.equal(adapter.isEnabled, true);
    });
});

describe("plan adapter explicit-only floating", () => {
    it("never calls setFloating or emits toggle-float from automatic, admission, reconcile, or directional routes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        const allocations = [
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ];

        // Automatic admission from a signal-driven membership diff.
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual((plannerPayload(mocks, 0)["command"] as Record<string, unknown>)["op"], "admit");
        mocks.callbacks[0]?.(
            plannedReply(plannerPayload(mocks, 0)["correlation_id"] as string, allocations, "win-a-leaf"),
        );

        // Directional focus, move, resize, and pointer-resize all complete
        // their flights through writeGeometries without any float transition.
        const directional = [
            () => adapter.requestFocus("right"),
            () => adapter.requestMove("right"),
            () => adapter.requestResize("left", "outwards"),
        ];
        for (const request of directional) {
            const before: number = mocks.dbusCalls.length;
            request();
            assert.equal(mocks.dbusCalls.length, before + 1);
            const index = mocks.dbusCalls.length - 1;
            assert.notEqual((plannerPayload(mocks, index)["command"] as Record<string, unknown>)["op"], "toggle-float");
            mocks.callbacks[index]?.(
                plannedReply(plannerPayload(mocks, index)["correlation_id"] as string, allocations, "win-a-leaf"),
            );
        }

        // Automatic reconcile after client geometry drift.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 200, h: 200 },
                    "win-b": { x: 600, y: 0, w: 600, h: 800 },
                },
            });
        fire(mocks, "geometry");
        runDebounce(mocks);
        const reconcileIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual((plannerPayload(mocks, reconcileIndex)["command"] as Record<string, unknown>), { op: "reconcile" });
        mocks.callbacks[reconcileIndex]?.(
            plannedReply(plannerPayload(mocks, reconcileIndex)["correlation_id"] as string, allocations, "win-a-leaf"),
        );

        // Automatic admission again after a fresh window appears, completing
        // through writeGeometries rather than any float transition.
        mocks.observeImpl = () => {
            const wins = [
                Object.freeze({ id: "win-a", ref: refs.a, rect: { x: 0, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false }),
                Object.freeze({ id: "win-b", ref: refs.b, rect: { x: 600, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false }),
                Object.freeze({ id: "win-c", ref: refs.c, rect: { x: 0, y: 800, w: 600, h: 400 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false }),
            ];
            return {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-a",
                windows: Object.freeze(wins),
                activeRef: refs.a,
                fingerprint: "fp-a,b,c",
                revalidate: () => true,
            };
        };
        fire(mocks, "added");
        runDebounce(mocks);
        const admitIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual((plannerPayload(mocks, admitIndex)["command"] as Record<string, unknown>), { op: "admit", window: "win-c", output: "out-1", workspace: "ws-1" });
        mocks.callbacks[admitIndex]?.(
            plannedReply(
                plannerPayload(mocks, admitIndex)["correlation_id"] as string,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-c-leaf",
            ),
        );

        // Directional pointer-resize completes its flight too.
        const pointerBefore = mocks.dbusCalls.length;
        adapter.requestPointerResize("win-a", "left", 0);
        assert.equal(mocks.dbusCalls.length, pointerBefore + 1);
        const pointerIndex = mocks.dbusCalls.length - 1;
        assert.notEqual((plannerPayload(mocks, pointerIndex)["command"] as Record<string, unknown>)["op"], "toggle-float");
        mocks.callbacks[pointerIndex]?.(
            plannedReply(
                plannerPayload(mocks, pointerIndex)["correlation_id"] as string,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );

        // None of the automatic, admission, reconcile, or directional routes
        // may call or set floating state, nor dispatch a toggle-float command.
        assert.deepEqual(mocks.floatingCalls, []);
        for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
            assert.notEqual(
                (plannerPayload(mocks, index)["command"] as Record<string, unknown>)["op"],
                "toggle-float",
                `dbus call ${index} must not be a float transition`,
            );
        }
        assert.ok(!mocks.logs.some((line) => line.includes("float-written")));

        // Only the explicit requestFloat route calls setFloating, and only
        // after the validated planned reply carries the float geometry.
        adapter.requestFloat();
        const floatIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual((plannerPayload(mocks, floatIndex)["command"] as Record<string, unknown>), { op: "toggle-float", window: "win-a" });
        mocks.callbacks[floatIndex]?.(
            JSON.stringify({
                v: 1,
                correlation_id: plannerPayload(mocks, floatIndex)["correlation_id"],
                outcome: "planned",
                desired_geometry: [
                    { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", leaf: "leaf-c", output: "out-1", workspace: "ws-1", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                float_geometry: { window: "win-a", rect: { x: 240, y: 160, w: 720, h: 480 } },
            }),
        );
        assert.deepEqual(mocks.floatingCalls, [{ id: "win-a", floating: true }]);
        assert.ok(mocks.logs.some((line) => line.includes("float-written")));
    });
});

describe("plan adapter client self-resize reconcile", () => {
    const allocA = { x: 0, y: 0, w: 600, h: 800 };
    const allocB = { x: 600, y: 0, w: 600, h: 800 };
    function baseline(mocks: Mocks, refs: { a: object; b: object; c: object }): PlanAdapter {
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const corr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(plannedReply(corr, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }], "win-a-leaf"));
        return adapter;
    }
    function driftRects(kind: string): Record<string, { x: number; y: number; w: number; h: number }> {
        return kind === "increment"
            ? { "win-a": { x: 0, y: 0, w: 616, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } }
            : { "win-a": { x: 0, y: 0, w: 200, h: 200 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } };
    }
    function reconcileOnce(mocks: Mocks, index: number, drift: Record<string, { x: number; y: number; w: number; h: number }>): void {
        const corr = plannerPayload(mocks, index)["correlation_id"] as string;
        mocks.callbacks[index]?.(plannedReply(corr, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }], "win-a-leaf"));
        void drift;
    }
    it("reprojects a scale-style work-area change through retained projection with selected gaps", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        baseline(mocks, refs);
        const writesBeforeScale = mocks.geometries.length;
        const scaled = { x: 0, y: 0, w: 1800, h: 1200 };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, bounds: scaled, rects: { "win-a": allocA, "win-b": allocB } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual((plannerPayload(mocks, 1)["command"] as Record<string, unknown>), { op: "reconcile" });
        assert.deepEqual(plannerPayload(mocks, 1)["domain"], {
            output: "out-1",
            workspace: "ws-1",
            bounds: scaled,
            gap: DOMAIN_GAP,
            outer_gap: OUTER_DOMAIN_GAP,
        });
        const scaledCorrelation = plannerPayload(mocks, 1)["correlation_id"] as string;
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:scope-transition old=0,0,1200,800 new=0,0,1800,1200",
            ),
            "dedicated old-bounds to new-bounds scope transition",
        );
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:work-area-reprojection selected=retained"),
            "distinct retained reprojection event, not the generic reconcile line",
        );
        mocks.callbacks[1]?.(
            plannedReply(
                scaledCorrelation,
                [
                    { window: "win-a", rect: { x: 8, y: 8, w: 888, h: 1184 } },
                    { window: "win-b", rect: { x: 904, y: 8, w: 888, h: 1184 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.deepEqual(mocks.geometries.slice(writesBeforeScale), [
            { target: refs.a, rect: { x: 8, y: 8, w: 888, h: 1184 } },
            { target: refs.b, rect: { x: 904, y: 8, w: 888, h: 1184 } },
        ]);
        assert.ok(mocks.logs.some((line) => line.includes(`cmd=${scaledCorrelation}`) && line.includes("kind=reconcile") && line.includes("outcome=planned-applied")));

        const shrunk = { x: 0, y: 0, w: 800, h: 600 };
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, bounds: shrunk, rects: { "win-a": { x: 0, y: 0, w: 800, h: 900 }, "win-b": { x: 800, y: 0, w: 800, h: 900 } } });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 3);
        const shrinkCorrelation = plannerPayload(mocks, 2)["correlation_id"] as string;
        const carried = plannerPayload(mocks, 2)["windows"] as Array<Record<string, unknown>>;
        for (const entry of carried) {
            const rect = entry["rect"] as { x: number; y: number; w: number; h: number };
            assert.ok(rect.x >= shrunk.x && rect.y >= shrunk.y);
            assert.ok(rect.x + rect.w <= shrunk.x + shrunk.w);
            assert.ok(rect.y + rect.h <= shrunk.y + shrunk.h);
        }
        assert.notDeepEqual(
            carried.map((entry) => entry["rect"]),
            [{ x: 0, y: 0, w: 800, h: 900 }, { x: 800, y: 0, w: 800, h: 900 }],
            "reprojection must not send drifted client rectangles",
        );
        mocks.callbacks[2]?.(rejectedReply(shrinkCorrelation, "snapshot-invalid"));
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 4, "a rejected work-area reprojection does not park");
        const retryCorrelation = plannerPayload(mocks, 3)["correlation_id"] as string;
        const writesBeforeRetry = mocks.geometries.length;
        mocks.callbacks[3]?.(
            plannedReply(
                retryCorrelation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 600 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 600 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.deepEqual(mocks.geometries.slice(writesBeforeRetry), [
            { target: refs.a, rect: { x: 0, y: 0, w: 400, h: 600 } },
            { target: refs.b, rect: { x: 400, y: 0, w: 400, h: 600 } },
        ]);
        assert.ok(mocks.logs.some((line) => line.includes(`cmd=${retryCorrelation}`) && line.includes("outcome=planned-applied")));
    });
    it("does not classify an outer-gap change as work-area reprojection", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        baseline(mocks, refs);
        const callsBefore = mocks.dbusCalls.length;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                domainOuterGap: 0,
                rects: { "win-a": allocA, "win-b": allocB },
            });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(mocks.geometries.length, 0);
    });
    it("retains allocation on self-resize and resets on matching geometry", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = baseline(mocks, refs);
        const writesAfterBaseline = mocks.geometries.length;
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: driftRects("increment") });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        const cmd = plannerPayload(mocks, 1)["command"] as Record<string, unknown>;
        assert.deepEqual(cmd, { op: "reconcile" });
        const wins = plannerPayload(mocks, 1)["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual((wins.find((w) => w["window"] === "win-a") as Record<string, unknown>)["rect"], { x: 0, y: 0, w: 616, h: 800 });
        reconcileOnce(mocks, 1, driftRects("increment"));
        assert.ok(mocks.geometries.length > writesAfterBaseline);
        assert.ok(mocks.logs.some((l) => l.includes("kind=reconcile") && l.includes("outcome=planned-applied")));
        assert.ok(!mocks.logs.some((l) => l.includes("stale-dropped")));
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
        const callsBefore = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(adapter.isEnabled, true);
    });
    it("reasserts allocation across a focus-only change while geometry has drifted", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = baseline(mocks, refs);
        const writesAfterBaseline = mocks.geometries.length;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.b,
                fingerprint: "fp-2",
                rects: driftRects("increment"),
            });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        const cmd = plannerPayload(mocks, 1)["command"] as Record<string, unknown>;
        assert.deepEqual(cmd, { op: "reconcile" });
        const wins = plannerPayload(mocks, 1)["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual((wins.find((w) => w["window"] === "win-a") as Record<string, unknown>)["rect"], { x: 0, y: 0, w: 616, h: 800 });
        reconcileOnce(mocks, 1, driftRects("increment"));
        assert.ok(mocks.geometries.length > writesAfterBaseline);
        assert.ok(mocks.logs.some((l) => l.includes("kind=reconcile") && l.includes("outcome=planned-applied")));
        assert.ok(!mocks.logs.some((l) => l.includes("stale-dropped")));
        assert.equal(adapter.isEnabled, true);
    });
    it("reasserts allocation across a fingerprint-only change while geometry has drifted", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = baseline(mocks, refs);
        const writesAfterBaseline = mocks.geometries.length;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                fingerprint: "fp-2",
                rects: driftRects("increment"),
            });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual((plannerPayload(mocks, 1)["command"] as Record<string, unknown>)["op"], "reconcile");
        reconcileOnce(mocks, 1, driftRects("increment"));
        assert.ok(mocks.geometries.length > writesAfterBaseline);
        assert.ok(mocks.logs.some((l) => l.includes("kind=reconcile") && l.includes("outcome=planned-applied")));
        assert.equal(adapter.isEnabled, true);
    });
    it("constrained drifts hit three writes then park without oscillation", () => {
        for (const kind of ["increment", "minimum"]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            baseline(mocks, refs);
            mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: driftRects(kind) });
            for (let attempt = 0; attempt < 3; attempt += 1) {
                fire(mocks, "geometry");
                runDebounce(mocks);
                const index = 1 + attempt;
                assert.equal(mocks.dbusCalls.length, index + 1);
                assert.deepEqual((plannerPayload(mocks, index)["command"] as Record<string, unknown>)["op"], "reconcile");
                reconcileOnce(mocks, index, driftRects(kind));
                assert.ok(mocks.logs.some((l) => l.includes(`cmd=gen-1-p${String(index)}`) && l.includes("outcome=planned-applied")));
            }
            assert.ok(
                mocks.logs.some((line) => line === "plasma-auto-tiler:plan:reconcile-parked"),
                "bounded parking transition token",
            );
            const parkedCalls = mocks.dbusCalls.length;
            const parkedWrites = mocks.geometries.length;
            const parkedLogs = mocks.logs.length;
            fire(mocks, "geometry");
            runDebounce(mocks);
            fire(mocks, "geometry");
            runDebounce(mocks);
            assert.equal(mocks.dbusCalls.length, parkedCalls);
            assert.equal(mocks.geometries.length, parkedWrites);
            assert.equal(mocks.logs.length, parkedLogs);
            mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: { "win-a": allocA, "win-b": allocB } });
            fire(mocks, "geometry");
            runDebounce(mocks);
            assert.equal(mocks.dbusCalls.length, parkedCalls);
            mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: driftRects(kind) });
            fire(mocks, "geometry");
            runDebounce(mocks);
            assert.equal(mocks.dbusCalls.length, parkedCalls + 1);
            assert.deepEqual((plannerPayload(mocks, parkedCalls)["command"] as Record<string, unknown>)["op"], "reconcile");
        }
    });
    it("reconcile rejected and planned paths emit one precise reason", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        baseline(mocks, refs);
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: driftRects("increment") });
        fire(mocks, "geometry");
        runDebounce(mocks);
        const corr = plannerPayload(mocks, 1)["correlation_id"] as string;
        const logsBefore = mocks.logs.length;
        mocks.callbacks[1]?.(rejectedReply(corr, "snapshot-invalid"));
        const freshLogs = mocks.logs.slice(logsBefore);
        assert.equal(freshLogs.length, 2);
        assert.ok(freshLogs[0]?.includes("kind=reconcile") && freshLogs[0]?.includes("outcome=rejected"));
        assert.equal(freshLogs[1], "plasma-auto-tiler:plan:rejected kind=snapshot-invalid");
        fire(mocks, "geometry");
        runDebounce(mocks);
        const corr2 = plannerPayload(mocks, 2)["correlation_id"] as string;
        const logsBefore2 = mocks.logs.length;
        mocks.callbacks[2]?.(plannedReply(corr2, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }], "win-a-leaf"));
        const fresh2 = mocks.logs.slice(logsBefore2);
        assert.equal(fresh2.length, 3);
        assert.equal(fresh2[0], "plasma-auto-tiler:plan:write window=win-b resource_class=unknown disposition=skip-already-equal rect=600,0,600,800");
        assert.equal(fresh2[1], "plasma-auto-tiler:plan:write window=win-a resource_class=unknown disposition=written rect=0,0,600,800");
        assert.ok(fresh2[2]?.includes("kind=reconcile") && fresh2[2]?.includes("outcome=planned-applied"));
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line.includes(`cmd=${corr2}`) && line.includes("outcome=dispatch") && line.includes("kind=reconcile"),
            ),
            "route entry line for the dispatched reconcile",
        );
    });
    it("parks repeated rejected reconcile signals after three with no further D-Bus", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        baseline(mocks, refs);
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: driftRects("increment") });
        for (let attempt = 0; attempt < 3; attempt += 1) {
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + attempt;
            assert.equal(mocks.dbusCalls.length, index + 1);
            const corr = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(rejectedReply(corr, "snapshot-invalid"));
        }
        const parkedCalls = mocks.dbusCalls.length;
        const parkedLogs = mocks.logs.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, parkedCalls);
        assert.equal(mocks.logs.length, parkedLogs);
    });
    it("parks repeated stale reconcile signals after three with no further D-Bus", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        baseline(mocks, refs);
        const drift = driftRects("increment");
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: drift });
        for (let attempt = 0; attempt < 3; attempt += 1) {
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + attempt;
            const corr = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: driftRects("minimum") });
            mocks.callbacks[index]?.(plannedReply(corr, [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }], null));
            mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: drift });
        }
        const parkedCalls = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, parkedCalls);
    });
    it("clears drift parking when a deferred work-area reprojection supersedes a flight", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        baseline(mocks, refs);
        const oldDrift = driftRects("increment");
        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a, rects: oldDrift });
        for (let attempt = 0; attempt < 2; attempt += 1) {
            fire(mocks, "geometry");
            runDebounce(mocks);
            const index = 1 + attempt;
            const correlation = plannerPayload(mocks, index)["correlation_id"] as string;
            mocks.callbacks[index]?.(rejectedReply(correlation, "snapshot-invalid"));
        }

        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 4);
        const inFlightCorrelation = plannerPayload(mocks, 3)["correlation_id"] as string;

        const translated = { x: 200, y: 100, w: 800, h: 600 };
        const translatedDrift = {
            "win-a": { x: 200, y: 100, w: 200, h: 300 },
            "win-b": { x: 600, y: 100, w: 200, h: 300 },
        };
        mocks.observeImpl = () =>
            makeObserved(refs, { focused: refs.a, bounds: translated, rects: translatedDrift });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 4, "work-area reprojection waits behind the flight");

        mocks.callbacks[3]?.(
            plannedReply(
                inFlightCorrelation,
                [{ window: "win-a", rect: allocA }, { window: "win-b", rect: allocB }],
                "win-a-leaf",
            ),
        );
        assert.equal(mocks.dbusCalls.length, 5);
        const reprojection = plannerPayload(mocks, 4);
        assert.deepEqual(reprojection["command"], { op: "reconcile" });
        const carried = reprojection["windows"] as Array<Record<string, unknown>>;
        for (const entry of carried) {
            const rect = entry["rect"] as { x: number; y: number; w: number; h: number };
            assert.ok(rect.x >= translated.x && rect.y >= translated.y);
            assert.ok(rect.x + rect.w <= translated.x + translated.w);
            assert.ok(rect.y + rect.h <= translated.y + translated.h);
        }
        const reprojectionCorrelation = reprojection["correlation_id"] as string;
        mocks.callbacks[4]?.(
            plannedReply(
                reprojectionCorrelation,
                [
                    { window: "win-a", rect: { x: 208, y: 108, w: 384, h: 584 } },
                    { window: "win-b", rect: { x: 608, y: 108, w: 384, h: 584 } },
                ],
                "win-a-leaf",
            ),
        );

        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                bounds: translated,
                rects: {
                    "win-a": { x: 200, y: 100, w: 100, h: 100 },
                    "win-b": { x: 600, y: 100, w: 200, h: 200 },
                },
            });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 6, "a later drift is not parked by the old flight");
        assert.deepEqual((plannerPayload(mocks, 5)["command"] as Record<string, unknown>)["op"], "reconcile");
    });
});

describe("plan adapter bounded diagnostics", () => {
    it("emits only the bounded plan line shapes with exact tokens and no owner echo", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        mocks.callbacks[0]?.(rejectedReply(plannerPayload(mocks, 0)["correlation_id"] as string, "snapshot-invalid"));
        adapter.requestMove("right");
        const correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                null,
            ),
        );
        assert.ok(mocks.logs.length >= 7);
        for (const line of mocks.logs) {
            assert.match(
                line,
                /^plasma-auto-tiler:plan:(cmd=\S+ kind=(admit|remove|move|focus|resize|reconcile|pointer-resize) windows=\d+ outcome=\S+|rejected kind=[a-z-]+( detail=[a-z-]+)?|write window=\S+ resource_class=\S+ disposition=(written|skip-fullscreen|skip-maximized|skip-already-equal|write-failed) rect=[^ ]+|busy-refused kind=(focus|move|resize)|(focus|move|resize|pointer)-refused-[a-z-]+|maximize-refused-signal|scope-transition [^ ]+|work-area-reprojection selected=retained|echo-fence-(armed|consumed|cleared-equality|mismatched)|reconcile-parked)$/,
                line,
            );
            assert.ok(!line.includes("owner-1"), line);
        }
    });

    it("emits an exact refusal token for every distinct request-route cause", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);

        adapter.disable();
        adapter.requestFocus("left");
        adapter.requestMove("right");
        adapter.requestResize("left", "outwards");
        adapter.requestPointerResize("win-a", "right", 1000);
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:focus-refused-disabled"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:move-refused-disabled"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:resize-refused-disabled"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:pointer-refused-disabled"));

        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        adapter.requestFocus("sideways");
        adapter.requestMove("sideways");
        adapter.requestResize("sideways", "outwards");
        adapter.requestResize("left", "sideways-mode");
        adapter.requestPointerResize("win-a", "sideways", 1000);
        adapter.requestPointerResize("win-a", "right", 999999);
        adapter.requestPointerResize("bad-id-!@#", "right", 1000);
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:focus-refused-invalid-direction"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:move-refused-invalid-direction"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:resize-refused-invalid-direction"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:resize-refused-invalid-mode"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:pointer-refused-direction"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:pointer-refused-boundary"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:pointer-refused-identity"));

        mocks.observeImpl = () => null;
        adapter.requestFocus("left");
        adapter.requestMove("right");
        adapter.requestResize("left", "outwards");
        adapter.requestPointerResize("win-a", "right", 1000);
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:focus-refused-observe"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:move-refused-observe"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:resize-refused-observe"));
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:pointer-refused-observe"));

        mocks.observeImpl = () => makeObserved(refs, { focused: refs.a });
        adapter.requestPointerResize("win-zzz", "right", 1000);
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:pointer-refused-absent"));

        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.b,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                fullscreen: { "win-b": true },
            });
        adapter.requestPointerResize("win-b", "left", 600);
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:pointer-refused-fullscreen"));
    });
});

describe("plan adapter sticky and maximize toggles", () => {
    it("maximizes and restores a tiled member through one fenced native write each", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximized = false;
        mocks.observeImpl = () => makeObserved(refs, { maximized: { "win-a": maximized }, resourceClasses: { "win-a": "firefox" } });
        mocks.maximizeToggleImpl = (target, value) => {
            assert.equal(target, refs.a);
            maximized = value;
            fire(mocks, "maximize", refs.a);
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestMaximize();
        adapter.requestMaximize();
        assert.deepEqual(mocks.maximizeToggles, [{ target: refs.a, maximized: true }, { target: refs.a, maximized: false }]);
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:maximize-toggle-echo-consumed"));
        assert.equal(mocks.maximizeClears.length, 0, "post-admission explicit maximize never uses admission clearing");
    });

    it("refuses maximize and sticky independently for fullscreen and maximize overlays", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { fullscreen: { "win-a": true }, maximized: { "win-a": true }, resourceClasses: { "win-a": "steam" } });
        const adapter = enableAdapter(mocks);
        adapter.requestMaximize();
        adapter.requestSticky();
        assert.equal(mocks.maximizeToggles.length, 0);
        assert.equal(mocks.desktopToggles.length, 0);
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:maximize-refused-fullscreen window=win-a resource_class=steam"));
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:sticky-refused-fullscreen window=win-a resource_class=steam"));
    });

    it("floats a tiled member before sticky and freshly admits it after the fenced unsticky echo", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let floating = false;
        let sticky = false;
        mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": floating }, sticky: { "win-a": sticky }, resourceClasses: { "win-a": "firefox" } });
        mocks.desktopToggleImpl = (target, allDesktops) => {
            assert.equal(target, refs.a);
            sticky = allDesktops;
            fire(mocks, "desktops", refs.a);
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestSticky();
        const floatPayload = plannerPayload(mocks, 0);
        assert.deepEqual(floatPayload["command"], { op: "toggle-float", window: "win-a" });
        floating = true;
        mocks.callbacks[0]?.(JSON.stringify({
            v: 1,
            correlation_id: floatPayload["correlation_id"],
            outcome: "planned",
            desired_geometry: [{ window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } }],
            float_geometry: { window: "win-a", rect: { x: 100, y: 100, w: 600, h: 400 } },
        }));
        assert.deepEqual(mocks.desktopToggles, [{ target: refs.a, allDesktops: true }]);
        adapter.requestSticky();
        assert.deepEqual(mocks.desktopToggles, [{ target: refs.a, allDesktops: true }, { target: refs.a, allDesktops: false }]);
        assert.equal(mocks.dbusCalls.length, 2, "unsticky restores prior tiled placement by fresh admission");
        assert.deepEqual(plannerPayload(mocks, 1)["command"], { op: "toggle-float", window: "win-a", float_rect: { x: 0, y: 0, w: 100, h: 100 } });
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:sticky-echo-consumed"));
    });

    it("keeps an already floating sticky member floating and makes a deliberate maximize block float", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let floating = true;
        let sticky = false;
        let maximized = false;
        mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": floating }, sticky: { "win-a": sticky }, maximized: { "win-a": maximized }, resourceClasses: { "win-a": "firefox" } });
        mocks.desktopToggleImpl = (_target, allDesktops) => {
            sticky = allDesktops;
            fire(mocks, "desktops", refs.a);
            return "invoked";
        };
        mocks.maximizeToggleImpl = (_target, value) => {
            maximized = value;
            fire(mocks, "maximize", refs.a);
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestSticky();
        adapter.requestSticky();
        assert.equal(mocks.dbusCalls.length, 0, "prior floating sticky never enters the tile tree");
        assert.deepEqual(mocks.desktopToggles, [{ target: refs.a, allDesktops: true }, { target: refs.a, allDesktops: false }]);
        floating = false;
        adapter.requestMaximize();
        adapter.requestFloat();
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:float-refused-maximize"));
    });

    it("clears a native-state fence without retry when its setter emits no echo", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestMaximize();
        adapter.requestMaximize();
        assert.equal(mocks.maximizeToggles.length, 1);
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:maximize-toggle-echo-cleared-no-signal"));
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:maximize-refused-attempted window=win-a resource_class=unknown"));
    });
});

describe("plan adapter source hygiene", () => {
    it("performs no tiling, shortcut, config, desktop, outline, or polling access", () => {
        const src = readFileSync(join(kwinSrcDir(), "plan-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "plan-adapter-entry.ts"), "utf8");
        for (const body of [src, entry]) {
            assert.ok(!body.includes("rootTile"), "rootTile");
            assert.ok(!body.includes("relativeGeometry"), "relativeGeometry");
            assert.ok(!body.includes("createDesktop"), "createDesktop");
            assert.ok(!body.includes("removeDesktop"), "removeDesktop");
            assert.ok(!body.includes("showOutline"), "showOutline");
            assert.ok(!body.includes("setTimeout"), "setTimeout");
            assert.ok(!body.includes("setInterval"), "setInterval");
            assert.ok(!body.includes("requestAnimationFrame"), "requestAnimationFrame");
            assert.ok(!body.includes("fallback"), "fallback");
            assert.ok(!body.includes("pollFor"), "pollFor");
        }
        assert.ok(!src.includes("registerShortcut"), "adapter must not register shortcuts");
        assert.ok(entry.includes("connectSignal"), "entry must use the shared connector");
        assert.ok(entry.includes("signal-capability"), "entry must use the shared layer");
    });

    it("keeps legacy movement, focus, and resize routes out of production startup", () => {
        const entry = readFileSync(join(kwinSrcDir(), "entry.ts"), "utf8");
        assert.ok(!entry.includes("movement-adapter"), "movement-adapter");
        assert.ok(!entry.includes("MovementAdapter"), "MovementAdapter");
        assert.ok(!entry.includes("DescribeMovement"), "DescribeMovement");
        assert.ok(!entry.includes("focus-adapter"), "focus-adapter");
        assert.ok(!entry.includes("FocusAdapter"), "FocusAdapter");
        assert.ok(!entry.includes("DescribeFocus"), "DescribeFocus");
        assert.ok(!entry.includes("resize-adapter"), "resize-adapter");
        assert.ok(!entry.includes("ResizeAdapter"), "ResizeAdapter");
        assert.ok(!entry.includes("DescribeResize"), "DescribeResize");
        assert.ok(!entry.includes("legacy-engine-removed"), "legacy marker");
        assert.ok(entry.includes("plan-adapter-entry"), "plan entry wiring");
        assert.ok(entry.includes("startPlanAdapterEntry"), "plan entry start");
    });
});

// Live-observation entry tests through injected fakes only.

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

interface FakeWorld {
    readonly workspace: Record<string, unknown>;
    wins: Array<Record<string, unknown>>;
    readonly output: Record<string, unknown>;
    readonly desktop: Record<string, unknown>;
    readonly added: FakeSignal;
    readonly removed: FakeSignal;
    readonly winFull: Map<object, FakeSignal>;
    readonly winMax: Map<object, FakeSignal>;
    readonly winDesktops: Map<object, FakeSignal>;
    readonly winGeometry: Map<object, FakeSignal>;
    readonly winInteractiveGeometry: Map<object, FakeSignal>;
    readonly maximizeClears: object[];
}

function fakeWorld(): FakeWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const added = fakeSignal();
    const removed = fakeSignal();
    const activated = fakeSignal();
    const screensChanged = fakeSignal();
    const desktopChanged = fakeSignal();
    const winFull = new Map<object, FakeSignal>();
    const winMax = new Map<object, FakeSignal>();
    const winDesktops = new Map<object, FakeSignal>();
    const winGeometry = new Map<object, FakeSignal>();
    const winInteractiveGeometry = new Map<object, FakeSignal>();
    const world: FakeWorld = {
        output,
        desktop,
        added,
        removed,
        wins: [],
        workspace: {},
        winFull,
        winMax,
        winDesktops,
        winGeometry,
        winInteractiveGeometry,
        maximizeClears: [],
    };
    const makeWin = (id: string, x: number): Record<string, unknown> => {
        const geo = fakeSignal();
        const full = fakeSignal();
        const max = fakeSignal();
        const desktopsChanged = fakeSignal();
        const interactive = fakeSignal();
        const win: Record<string, unknown> = {
            normalWindow: true,
            internalId: id,
            resourceClass: "test-app",
            output,
            desktops: [desktop],
            frameGeometry: { x, y: 0, width: 600, height: 800 },
            frameGeometryChanged: geo.signal,
            moveResizedChanged: interactive.signal,
            fullScreenChanged: full.signal,
            fullScreen: false,
            maximizedChanged: max.signal,
            maximizeMode: 0,
            desktopsChanged: desktopsChanged.signal,
            onAllDesktops: false,
        };
        win["setMaximize"] = (vertically: unknown, horizontally: unknown): void => {
            if (vertically !== false || horizontally !== false) {
                return;
            }
            world.maximizeClears.push(win);
            win["maximizeMode"] = 0;
            for (const handler of max.handlers) {
                handler();
            }
        };
        winFull.set(win, full);
        winMax.set(win, max);
        winDesktops.set(win, desktopsChanged);
        winGeometry.set(win, geo);
        winInteractiveGeometry.set(win, interactive);
        return win;
    };
    const winA = makeWin("win-a", 0);
    const winB = makeWin("win-b", 600);
    world.wins = [winA, winB];
    world.workspace["activeWindow"] = winA;
    world.workspace["windowList"] = (): unknown[] => [...world.wins];
    world.workspace["screens"] = [output];
    world.workspace["currentDesktopForScreen"] = (): unknown => desktop;
    world.workspace["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    world.workspace["windowAdded"] = added.signal;
    world.workspace["windowRemoved"] = removed.signal;
    world.workspace["windowActivated"] = activated.signal;
    world.workspace["screensChanged"] = screensChanged.signal;
    world.workspace["currentDesktopChanged"] = desktopChanged.signal;
    return world;
}

interface EntryMocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; sequence: string; callback: () => void }>;
}

function startEntry(
    world: FakeWorld,
    overrides: PlanEntryOverrides = {},
): { handle: ReturnType<typeof startPlanAdapterEntry>; mocks: EntryMocks } {
    const mocks: EntryMocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [] };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (_service, _path, _iface, method, payload, callback): void => {
            mocks.dbusCalls.push({ method, payload });
            mocks.callbacks.push(callback);
        },
        scheduleOnce: (_delayMs, callback): (() => void) => {
            const entry = { callback, cancelled: false };
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
        registerShortcutFn: (action, _text, sequence, callback): boolean => {
            mocks.shortcuts.push({ action, sequence, callback });
            return true;
        },
        readProfileFn: (): string => "cosmic",
        ...overrides,
    });
    return { handle, mocks };
}

describe("plan entry live observation and shortcuts", () => {
    it("logs a bounded ready line identifying the plan session from existing provenance", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:ready owner=owner-1 generation=gen-1 source=local-dev"),
            "startup session-identifying context from the existing owner/generation provenance plus the local-dev source fallback",
        );
        handle?.stop();
    });

    it("registers the three MVP actions and observes stable ids", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        assert.equal(mocks.shortcuts.length, 61);
        const actions = mocks.shortcuts.map((row) => row.action);
        assert.equal(new Set(actions).size, 61);
        assert.ok(actions.includes("plasma-auto-tiler-focus-left"));
        assert.ok(actions.includes("plasma-auto-tiler-focus-right-arrow"));
        assert.ok(actions.includes("plasma-auto-tiler-move-up"));
        assert.ok(actions.includes("plasma-auto-tiler-resize-outwards-right"));
        assert.ok(actions.includes("plasma-auto-tiler-resize-inwards-down"));
        assert.ok(actions.includes("plasma-auto-tiler-resize-inwards-down-arrow"));
        assert.ok(actions.includes("plasma-auto-tiler-toggle-float"));
        assert.ok(actions.includes("plasma-auto-tiler-toggle-sticky"));
        assert.ok(actions.includes("plasma-auto-tiler-toggle-maximize"));
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:shortcut-dispatch-shadowed action=plasma-auto-tiler-toggle-float sequence=Meta+G holder_component=kwin holder_action=Grid_View"));
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:shortcut-dispatch-shadowed action=plasma-auto-tiler-toggle-maximize sequence=Meta+M holder_component=kwin holder_action=KrohnkiteMonocleLayout"));
        const focus = mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-focus-left") as {
            callback: () => void;
        };
        focus.callback();
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.dbusCalls[0]?.method, "DescribePlan");
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(payload["command"], { op: "focus", window: "win-a", direction: "left" });
        const windows = payload["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(
            windows.map((entry) => entry["window"]),
            ["win-a", "win-b"],
        );
        handle?.stop();
    });

    it("routes the internal float request through DescribePlan, writes the replied rectangle, and toggles back", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFloat();
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(payload["command"], { op: "toggle-float", window: "win-a" });
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[0]?.(JSON.stringify({
            v: 1, correlation_id: correlation, outcome: "planned", desired_geometry: [{ window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } }],
            float_geometry: { window: "win-a", rect: { x: 240, y: 160, w: 720, h: 480 } },
        }));
        const active = world.wins[0] as Record<string, unknown>;
        assert.deepEqual(active["frameGeometry"], { x: 240, y: 160, width: 720, height: 480 });
        handle?.requestMove("left");
        assert.ok(mocks.logs.includes("plasma-auto-tiler:plan:move-refused-floating"));
        handle?.requestFloat();
        const unfloat = JSON.parse(mocks.dbusCalls[1]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(unfloat["command"], { op: "toggle-float", window: "win-a", float_rect: { x: 240, y: 160, w: 720, h: 480 } });
        mocks.callbacks[1]?.(JSON.stringify({
            v: 1, correlation_id: unfloat["correlation_id"], outcome: "planned", desired_geometry: [
                { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
            ],
        }));
        assert.deepEqual(active["frameGeometry"], { x: 0, y: 0, width: 600, height: 800 });
        handle?.requestMove("left");
        assert.equal(mocks.dbusCalls[2]?.method, "DescribePlan");
        handle?.stop();
    });

    it("selects session-retained geometry and carries live float geometry across float/unfloat/float", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        const active = world.wins[0] as Record<string, unknown>;
        // First float selects retained/centered geometry; the session replies
        // with the applied placement.
        handle?.requestFloat();
        const first = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(first["command"], { op: "toggle-float", window: "win-a" });
        mocks.callbacks[0]?.(JSON.stringify({
            v: 1, correlation_id: first["correlation_id"], outcome: "planned", desired_geometry: [{ window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } }],
            float_geometry: { window: "win-a", rect: { x: 240, y: 160, w: 720, h: 480 } },
        }));
        assert.deepEqual(active["frameGeometry"], { x: 240, y: 160, width: 720, height: 480 });
        // User moves the floating window.
        active["frameGeometry"] = { x: 300, y: 200, width: 500, height: 400 };
        // Unfloat carries the live (moved) geometry so the session retains it.
        handle?.requestFloat();
        const unfloat = JSON.parse(mocks.dbusCalls[1]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(unfloat["command"], { op: "toggle-float", window: "win-a", float_rect: { x: 300, y: 200, w: 500, h: 400 } });
        mocks.callbacks[1]?.(JSON.stringify({
            v: 1, correlation_id: unfloat["correlation_id"], outcome: "planned", desired_geometry: [
                { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
            ],
        }));
        // Re-float again selects retained geometry (no rect request), and the
        // session replies with the moved placement, not a recomputed center.
        handle?.requestFloat();
        const refloat = JSON.parse(mocks.dbusCalls[2]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(refloat["command"], { op: "toggle-float", window: "win-a" });
        mocks.callbacks[2]?.(JSON.stringify({
            v: 1, correlation_id: refloat["correlation_id"], outcome: "planned", desired_geometry: [{ window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } }],
            float_geometry: { window: "win-a", rect: { x: 300, y: 200, w: 500, h: 400 } },
        }));
        assert.deepEqual(active["frameGeometry"], { x: 300, y: 200, width: 500, height: 400 });
        handle?.stop();
    });

    it("refuses float on fullscreen and maximized targets without native writes", () => {
        for (const [property, value, token] of [
            ["fullScreen", true, "plasma-auto-tiler:plan:float-refused-fullscreen"],
            ["maximizeMode", 3, "plasma-auto-tiler:plan:float-refused-maximize"],
        ] as const) {
            const world = fakeWorld();
            const active = world.wins[0] as Record<string, unknown>;
            active[property] = value;
            const before = active["frameGeometry"];
            const { handle, mocks } = startEntry(world);
            assert.ok(handle !== null);
            handle?.requestFloat();
            assert.equal(mocks.dbusCalls.length, 0);
            assert.equal(active["frameGeometry"], before);
            assert.ok(mocks.logs.includes(token));
            handle?.stop();
        }
    });

    it("maps catalog rows to parameterized focus, move, and resize commands", () => {
        for (const profile of ["cosmic", "hyprland", "bspwm", "unknown"]) {
            const catalog = planShortcutCatalog(profile);
            assert.equal(catalog.length, 31);
            const byAction = new Map(catalog.map((row) => [row.action, row]));
            assert.equal(byAction.get("plasma-auto-tiler-focus-up")?.direction, "up");
            assert.equal(byAction.get("plasma-auto-tiler-focus-up")?.op, "focus");
            assert.equal(byAction.get("plasma-auto-tiler-move-down-arrow")?.direction, "down");
            assert.equal(byAction.get("plasma-auto-tiler-move-down-arrow")?.op, "move");
            assert.equal(byAction.get("plasma-auto-tiler-resize-outwards-left")?.mode, "outwards");
            assert.equal(byAction.get("plasma-auto-tiler-resize-inwards-left")?.mode, "inwards");
            assert.equal(byAction.get("plasma-auto-tiler-resize-inwards-left-arrow")?.mode, "inwards");
            assert.equal(byAction.get("plasma-auto-tiler-resize-inwards-left-arrow")?.op, "resize");
            assert.equal(byAction.get("plasma-auto-tiler-resize-inwards-left-arrow")?.direction, "left");
            assert.deepEqual(byAction.get("plasma-auto-tiler-toggle-float"), {
                action: "plasma-auto-tiler-toggle-float", text: "Toggle floating window", sequence: "Meta+G", op: "float", direction: null, mode: null,
            });
            assert.equal(byAction.get("plasma-auto-tiler-toggle-sticky")?.sequence, "Meta+Shift+G");
            assert.equal(byAction.get("plasma-auto-tiler-toggle-maximize")?.sequence, "Meta+M");
        }
    });

    it("adds only the non-colliding inwards arrow resize family", () => {
        for (const profile of ["cosmic", "hyprland", "bspwm", "unknown"]) {
            const catalog = planShortcutCatalog(profile);
            const byAction = new Map(catalog.map((row) => [row.action, row]));
            const expected: ReadonlyArray<{ direction: string; arrow: string }> = [
                { direction: "left", arrow: "Left" },
                { direction: "down", arrow: "Down" },
                { direction: "up", arrow: "Up" },
                { direction: "right", arrow: "Right" },
            ];
            for (const entry of expected) {
                const row = byAction.get(`plasma-auto-tiler-resize-inwards-${entry.direction}-arrow`);
                assert.ok(row !== undefined, `${profile}:${entry.direction}`);
                assert.equal(row?.mode, "inwards");
                assert.equal(row?.op, "resize");
                assert.equal(row?.direction, entry.direction);
                assert.equal(row?.sequence, `Meta+Alt+Shift+${entry.arrow}`);
                assert.equal(
                    byAction.has(`plasma-auto-tiler-resize-outwards-${entry.direction}-arrow`),
                    false,
                    `${profile}: outwards arrow must stay unregistered for documented insert-* chord ownership`,
                );
                assert.ok(
                    !catalog.some((candidate) => candidate.sequence === `Meta+Alt+${entry.arrow}`),
                    `${profile}: Meta+Alt+${entry.arrow} must stay unregistered`,
                );
            }
        }
    });

    it("routes each inwards resize arrow through the existing resize adapter", () => {
        for (const direction of ["left", "down", "up", "right"]) {
            const { handle, mocks } = startEntry(fakeWorld());
            assert.ok(handle !== null);
            const shortcut = mocks.shortcuts.find(
                (row) => row.action === `plasma-auto-tiler-resize-inwards-${direction}-arrow`,
            ) as { callback: () => void };
            shortcut.callback();
            assert.equal(mocks.dbusCalls[0]?.method, "DescribePlan");
            const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
            assert.deepEqual(payload["command"], {
                op: "resize",
                window: "win-a",
                direction,
                mode: "inwards",
                press_index: 0,
            });
            handle?.stop();
        }
    });

    it("registers distinct Meta+Shift move sequences delivering op=move", () => {
        const first = startEntry(fakeWorld());
        assert.ok(first.handle !== null);
        const moves = first.mocks.shortcuts.filter(
            (row) => row.action.startsWith("plasma-auto-tiler-move-") && !row.action.includes("workspace") && !row.action.includes("append"),
        );
        assert.equal(moves.length, 8);
        const sequences = moves.map((row) => row.sequence);
        assert.equal(new Set(sequences).size, 8);
        for (const row of moves) {
            assert.ok(row.sequence.startsWith("Meta+Shift+"), row.action);
        }
        const letter = moves.find((row) => row.action === "plasma-auto-tiler-move-left") as {
            callback: () => void;
        };
        letter.callback();
        assert.equal(first.mocks.dbusCalls.length, 1);
        const letterPayload = JSON.parse(first.mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(letterPayload["command"], { op: "move", window: "win-a", direction: "left" });
        first.handle?.stop();
        const second = startEntry(fakeWorld());
        assert.ok(second.handle !== null);
        const arrow = second.mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-move-right-arrow") as {
            callback: () => void;
        };
        arrow.callback();
        const arrowPayload = JSON.parse(second.mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(arrowPayload["command"], { op: "move", window: "win-a", direction: "right" });
        assert.equal(second.mocks.dbusCalls[0]?.method, "DescribePlan");
        second.handle?.stop();
    });

    it("registers production workspace number chords alongside the directional core", () => {
        for (const profile of ["cosmic", "hyprland", "bspwm", "unknown"]) {
            const catalog = planShortcutCatalog(profile);
            for (const row of catalog) {
                assert.ok(!row.action.includes("workspace"), `${profile}:${row.action}`);
                assert.ok(!/Meta(\+Shift)?\+\d/.test(row.sequence), `${profile}:${row.action}:${row.sequence}`);
                assert.ok(!/Meta\+\S*\d/.test(row.sequence), `${profile}:${row.action}:${row.sequence}`);
            }
        }
        const live = startEntry(fakeWorld());
        assert.ok(live.handle !== null);
        const byAction = new Map(live.mocks.shortcuts.map((row) => [row.action, row]));
        assert.equal(live.mocks.shortcuts.length, 61);
        for (let index = 1; index <= 9; index += 1) {
            assert.equal(byAction.get(`plasma-auto-tiler-workspace-${String(index)}`)?.sequence, `Meta+${String(index)}`);
            assert.equal(byAction.get(`plasma-auto-tiler-move-workspace-${String(index)}`)?.sequence, `Meta+Shift+${String(index)}`);
        }
        assert.equal(byAction.get("plasma-auto-tiler-workspace-0")?.sequence, "Meta+0");
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-append")?.sequence, "Meta+Shift+0");
        const symbols: ReadonlyArray<[number, string]> = [[1, "!"], [2, "@"], [3, "#"], [4, "$"], [5, "%"], [6, "^"], [7, "&"], [8, "*"], [9, "("]];
        for (const [digit, symbol] of symbols) {
            assert.equal(byAction.get(`plasma-auto-tiler-move-workspace-${String(digit)}-symbol`)?.sequence, `Meta+${symbol}`);
        }
        assert.equal(byAction.get("plasma-auto-tiler-move-workspace-append-symbol")?.sequence, "Meta+)");
        live.handle?.stop();
        const entrySrc = readFileSync(join(kwinSrcDir(), "plan-adapter-entry.ts"), "utf8");
        assert.ok(entrySrc.includes("workspace-native"), "native lifecycle wiring");
        assert.ok(entrySrc.includes("WorkspaceSendAdapter"), "send transport reference");
        assert.ok(entrySrc.includes("workspaceShortcutCatalog"), "number chord catalog wiring");
    });

    it("observes only normal windows with normalized bare UUID ids", () => {
        const world = fakeWorld();
        world.wins.push({
            normalWindow: false,
            internalId: "dock-1",
            resourceClass: "org.kde.plasmashell",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 50, height: 50 },
            moveResizedChanged: fakeSignal().signal,
        });
        world.wins.push({
            normalWindow: true,
            internalId: "broken-frame",
            resourceClass: "broken-app",
            output: world.output,
            desktops: [world.desktop],
            moveResizedChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: fakeSignal().signal,
            maximizeMode: 0,
        });
        world.wins.push({
            normalWindow: true,
            internalId: "{12345678-1234-1234-1234-1234567890ab}",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 10, height: 10 },
            moveResizedChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: fakeSignal().signal,
            maximizeMode: 0,
        });
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("right");
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        const ids = (payload["windows"] as Array<Record<string, unknown>>).map((entry) => entry["window"]);
        assert.deepEqual(ids, ["win-a", "win-b", "12345678-1234-1234-1234-1234567890ab"]);
        assert.ok(
            mocks.logs.some(
                (line) => line === "plasma-auto-tiler:plan:observe-excluded reason=normal-window window=dock-1 resource_class=org.kde.plasmashell",
            ),
            "a non-normal window is excluded with its exact reason",
        );
        assert.ok(
            mocks.logs.some(
                (line) => line === "plasma-auto-tiler:plan:observe-excluded reason=frame-rect-missing window=broken-frame resource_class=broken-app",
            ),
            "an unhandleable member is refused independently while eligible members remain observed",
        );
        handle?.stop();
    });

    it("logs exact output and desktop exclusion reasons once per unchanged window", () => {
        const world = fakeWorld();
        const otherOutput = { name: "out-2" };
        const outputMismatch = {
            normalWindow: true,
            internalId: "other-output",
            resourceClass: "org.mozilla.firefox",
            output: otherOutput,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 10, height: 10 },
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: fakeSignal().signal,
            maximizeMode: 0,
        };
        const desktopMismatch = {
            normalWindow: true,
            internalId: "other-desktop",
            resourceClass: "ghostty",
            output: world.output,
            desktops: [],
            frameGeometry: { x: 0, y: 0, width: 10, height: 10 },
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: fakeSignal().signal,
            maximizeMode: 0,
        };
        world.wins.push(outputMismatch, desktopMismatch);
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("right");
        handle?.requestFocus("left");
        assert.equal(
            mocks.logs.filter((line) => line === "plasma-auto-tiler:plan:observe-excluded reason=output-mismatch window=other-output resource_class=org.mozilla.firefox").length,
            1,
        );
        assert.equal(
            mocks.logs.filter((line) => line === "plasma-auto-tiler:plan:observe-excluded reason=desktop-mismatch window=other-desktop resource_class=ghostty").length,
            1,
        );
        handle?.stop();
    });

    it("fails closed without logging on invalid scope or auth", () => {
        const world = fakeWorld();
        assert.equal(
            startEntry(world, { owner: "OWNER BANG", generation: "gen-1" }).handle,
            null,
        );
        assert.equal(startEntry(world, { owner: "owner-1", generation: "GEN BANG" }).handle, null);
        world.workspace["activeWindow"] = null;
        const { handle, mocks } = startEntry(world);
        assert.equal(handle, null);
        assert.equal(mocks.logs.length, 0);
    });

    it("uses only the DescribePlan transport for every command", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("left");
        handle?.requestMove("up");
        for (const call of mocks.dbusCalls) {
            assert.equal(call.method, "DescribePlan");
        }
        handle?.stop();
    });

    it("logs a bounded shortcut-failed line naming the exact chord and continues", () => {
        const world = fakeWorld();
        const attempts: string[] = [];
        const { handle, mocks } = startEntry(world, {
            registerShortcutFn: (action, _text, sequence, callback): boolean => {
                attempts.push(action);
                void callback;
                void sequence;
                if (action === "plasma-auto-tiler-focus-left") {
                    return false;
                }
                return true;
            },
        });
        assert.ok(handle !== null);
        assert.equal(attempts.length, 61);
        assert.ok(attempts.includes("plasma-auto-tiler-focus-right-arrow"));
        assert.ok(attempts.includes("plasma-auto-tiler-resize-inwards-right-arrow"));
        const line = mocks.logs.find((entry) => entry.includes("shortcut-failed"));
        assert.ok(line !== undefined);
        assert.equal(
            line,
            "plasma-auto-tiler:plan:shortcut-failed action=plasma-auto-tiler-focus-left sequence=Meta+H",
        );
        handle?.stop();
    });

    it("carries the bounded 8px domain gap in live DescribePlan requests", () => {
        assert.equal(DOMAIN_GAP, 8);
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.equal((payload["domain"] as Record<string, unknown>)["gap"], DOMAIN_GAP);
        handle?.stop();
    });

    it("carries the distinct 8px outer domain inset in live DescribePlan requests", () => {
        assert.equal(OUTER_DOMAIN_GAP, 8);
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("left");
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.equal((payload["domain"] as Record<string, unknown>)["outer_gap"], OUTER_DOMAIN_GAP);
        handle?.stop();
    });

    it("keeps normalized ids stable across re-observation", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("left");
        handle?.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        const ids = (payload["windows"] as Array<Record<string, unknown>>).map((entry) => entry["window"]);
        assert.deepEqual(ids, ["win-a", "win-b"]);
        assert.deepEqual(payload["command"], { op: "focus", window: "win-a", direction: "left" });
        handle?.stop();
    });

    it("propagates a production Plan frameGeometry property rejection", () => {
        const world = fakeWorld();
        const rejected = world.wins[1] as Record<string, unknown>;
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestMove("right");
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        Object.defineProperty(rejected, "frameGeometry", {
            value: rejected["frameGeometry"],
            writable: false,
            configurable: true,
        });
        mocks.callbacks[0]?.(JSON.stringify({
            v: 1,
            correlation_id: payload["correlation_id"],
            outcome: "planned",
            desired_geometry: [
                { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 500, h: 800 } },
                { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 500, y: 0, w: 700, h: 800 } },
            ],
        }));
        assert.ok(mocks.logs.some((line) => line.includes("window=win-b") && line.includes("disposition=write-failed")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((line) => line.includes("kind=move") && line.includes("outcome=write-failed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((line) => line.includes("kind=move") && line.includes("outcome=planned-applied")), mocks.logs.join("\n"));
        handle?.stop();
    });

    it("subscribes shared Plan reflow to frameGeometryChanged, not the interactive signal", () => {
        const world = fakeWorld();
        const winA = world.wins[0] as object;
        const { handle } = startEntry(world);
        assert.ok(handle !== null);
        assert.equal(world.winGeometry.get(winA)?.handlers.length, 1, "frameGeometryChanged is the production reflow source");
        assert.equal(world.winInteractiveGeometry.get(winA)?.handlers.length, 0, "interactive-only signal is never subscribed");
        const addedGeometry = fakeSignal();
        const addedInteractive = fakeSignal();
        const added = {
            normalWindow: true,
            internalId: "win-c",
            resourceClass: "test-app",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
            frameGeometryChanged: addedGeometry.signal,
            moveResizedChanged: addedInteractive.signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: fakeSignal().signal,
            maximizeMode: 0,
        };
        world.wins.push(added);
        for (const handler of world.added.handlers) {
            (handler as unknown as (value: unknown) => void)(added);
        }
        assert.equal(addedGeometry.handlers.length, 1, "added windows bind frame geometry changes");
        assert.equal(addedInteractive.handlers.length, 0, "added interactive signals stay unused");
        handle?.stop();
        assert.equal(world.winGeometry.get(winA)?.handlers.length, 0, "stop detaches frame geometry subscription");
        assert.equal(addedGeometry.handlers.length, 0, "stop detaches added-window frame geometry subscription");
    });

    it("subscribes fullScreenChanged per window after enable and for windows added later", () => {
        const world = fakeWorld();
        const winA = world.wins[0] as object;
        const winB = world.wins[1] as object;
        const { handle } = startEntry(world);
        assert.ok(handle !== null);
        assert.equal(world.winFull.get(winA)?.handlers.length, 1, "existing window subscribed on enable");
        assert.equal(world.winFull.get(winB)?.handlers.length, 1, "existing window subscribed on enable");
        const winCFull = fakeSignal();
        const winCMax = fakeSignal();
        const winC = {
            normalWindow: true,
            internalId: "win-c",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: winCFull.signal,
            fullScreen: false,
            maximizedChanged: winCMax.signal,
            maximizeMode: 0,
        };
        world.wins.push(winC);
        world.winFull.set(winC, winCFull);
        world.winMax.set(winC, winCMax);
        const fireAdded = (win: object): void => {
            for (const handler of world.added.handlers) {
                (handler as (payload?: unknown) => void)(win);
            }
        };
        fireAdded(winC);
        assert.equal(winCFull.handlers.length, 1, "added window subscribed exactly once");
        fireAdded(winC);
        assert.equal(winCFull.handlers.length, 1, "no duplicate connection for the same window");
        handle?.stop();
        assert.equal(world.winFull.get(winA)?.handlers.length, 0, "stop detaches window subscriptions");
        assert.equal(winCFull.handlers.length, 0, "stop detaches added-window subscription");
    });

    it("subscribes maximizedChanged per window after enable and for windows added later", () => {
        const world = fakeWorld();
        const winA = world.wins[0] as object;
        const winB = world.wins[1] as object;
        const { handle } = startEntry(world);
        assert.ok(handle !== null);
        assert.equal(world.winMax.get(winA)?.handlers.length, 1, "existing window subscribed on enable");
        assert.equal(world.winMax.get(winB)?.handlers.length, 1, "existing window subscribed on enable");
        const winCMax = fakeSignal();
        const winC = {
            normalWindow: true,
            internalId: "win-c",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: winCMax.signal,
            maximizeMode: 0,
        };
        world.wins.push(winC);
        world.winMax.set(winC, winCMax);
        const fireAdded = (win: object): void => {
            for (const handler of world.added.handlers) {
                (handler as (payload?: unknown) => void)(win);
            }
        };
        fireAdded(winC);
        assert.equal(winCMax.handlers.length, 1, "added window subscribed exactly once");
        fireAdded(winC);
        assert.equal(winCMax.handlers.length, 1, "no duplicate connection for the same window");
        handle?.stop();
        assert.equal(world.winMax.get(winA)?.handlers.length, 0, "stop detaches window subscriptions");
        assert.equal(winCMax.handlers.length, 0, "stop detaches added-window subscription");
    });

    it("collapses maximize modes 1 and 2 to the same isolation as mode 3", () => {
        for (const mode of [1, 2, 3]) {
            const world = fakeWorld();
            (world.wins[0] as Record<string, unknown>)["maximizeMode"] = mode;
            const { handle, mocks } = startEntry(world);
            assert.ok(handle !== null);
            const move = mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-move-left") as {
                callback: () => void;
            };
            move.callback();
            assert.equal(mocks.dbusCalls.length, 0, `mode ${String(mode)} never dispatches`);
            assert.ok(
                mocks.logs.some((line) => line === "plasma-auto-tiler:plan:move-refused-maximize"),
                `mode ${String(mode)} refused with the maximize token`,
            );
            handle?.stop();
        }
        const world = fakeWorld();
        (world.wins[0] as Record<string, unknown>)["maximizeMode"] = 0;
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        const move = mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-move-left") as {
            callback: () => void;
        };
        move.callback();
        assert.equal(mocks.dbusCalls.length, 1, "mode 0 dispatches normally");
        handle?.stop();
    });

    it("refuses startup with an exact maximize-specific token when maximizedChanged cannot attach", () => {
        const world = fakeWorld();
        for (const win of world.wins) {
            delete win["maximizedChanged"];
        }
        const { handle, mocks } = startEntry(world);
        assert.equal(handle, null, "missing maximize attachment refuses the entry");
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:maximize-refused-signal"),
            "exact maximize-specific attachment refusal token",
        );
    });

    it("refuses startup when only one of several eligible windows lacks maximizedChanged", () => {
        const world = fakeWorld();
        const winA = world.wins[0] as object;
        const winB = world.wins[1] as object;
        delete (winB as Record<string, unknown>)["maximizedChanged"];
        const { handle, mocks } = startEntry(world);
        assert.equal(handle, null, "mixed availability refuses the entry");
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:maximize-refused-signal"),
            "exact maximize-specific attachment refusal token",
        );
        assert.equal(
            world.winMax.get(winA)?.handlers.length,
            0,
            "subscription made before the startup refusal is released",
        );
    });

    it("detaches maximizedChanged for a window removed after enable", () => {
        const world = fakeWorld();
        const { handle } = startEntry(world);
        assert.ok(handle !== null);
        const winCMax = fakeSignal();
        const winC = {
            normalWindow: true,
            internalId: "win-c",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: winCMax.signal,
            maximizeMode: 0,
        };
        world.wins.push(winC);
        world.winMax.set(winC, winCMax);
        for (const handler of world.added.handlers) {
            (handler as (payload?: unknown) => void)(winC);
        }
        assert.equal(winCMax.handlers.length, 1, "added window subscribed");
        for (const handler of world.removed.handlers) {
            (handler as (payload?: unknown) => void)(winC);
        }
        assert.equal(winCMax.handlers.length, 0, "removed window detached");
        handle?.stop();
    });

    it("fails closed when a window added after enable lacks maximizedChanged", () => {
        const world = fakeWorld();
        const winA = world.wins[0] as object;
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        assert.equal(world.winMax.get(winA)?.handlers.length, 1, "existing window subscribed on enable");
        const winC = {
            normalWindow: true,
            internalId: "win-c",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
        };
        world.wins.push(winC);
        for (const handler of world.added.handlers) {
            (handler as (payload?: unknown) => void)(winC);
        }
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:maximize-refused-signal"),
            "exact maximize-specific attachment refusal token",
        );
        assert.equal(
            world.winMax.get(winA)?.handlers.length,
            0,
            "prior maximize subscriptions are released on the added-window refusal",
        );
        const callsBefore = mocks.dbusCalls.length;
        handle?.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, callsBefore, "disabled adapter dispatches nothing");
        assert.ok(
            mocks.logs.some((line) => line === "plasma-auto-tiler:plan:focus-refused-disabled"),
            "adapter is disabled, never left enabled and blind",
        );
        handle?.stop();
    });

    it("refreshes the highlight exactly once after a completed move, never on focus or rejection", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world, {
            highlightCallDbus: (): void => {},
        });
        assert.ok(handle !== null);
        const activeGroupCalls = (): number =>
            mocks.dbusCalls.filter((call) => {
                try {
                    return (JSON.parse(call.payload) as Record<string, unknown>)["command"] !== undefined
                        && ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"] === "active-group";
                } catch (error) {
                    void error;
                    return false;
                }
            }).length;
        assert.equal(activeGroupCalls(), 1, "highlight startup query");
        handle?.requestMove("right");
        const moveIndex = mocks.dbusCalls.length - 1;
        const movePayload = JSON.parse(mocks.dbusCalls[moveIndex]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(movePayload["command"], { op: "move", window: "win-a", direction: "right" });
        const moveCorr = movePayload["correlation_id"] as string;
        mocks.callbacks[moveIndex]?.(
            JSON.stringify({
                v: 1,
                correlation_id: moveCorr,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "win-a-leaf" },
            }),
        );
        assert.ok(mocks.logs.some((line) => line.includes("kind=move") && line.includes("outcome=planned-applied")));
        assert.equal(activeGroupCalls(), 2, "exactly one observational refresh after completed move");
        handle?.requestFocus("left");
        const focusIndex = mocks.dbusCalls.length - 1;
        const focusPayload = JSON.parse(mocks.dbusCalls[focusIndex]?.payload as string) as Record<string, unknown>;
        const focusCorr = focusPayload["correlation_id"] as string;
        mocks.callbacks[focusIndex]?.(
            JSON.stringify({
                v: 1,
                correlation_id: focusCorr,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "win-a-leaf", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", leaf: "win-b-leaf", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "win-b-leaf" },
            }),
        );
        assert.ok(mocks.logs.some((line) => line.includes("kind=focus") && line.includes("outcome=planned-applied")));
        assert.equal(activeGroupCalls(), 2, "focus-only plans never refresh via the geometry edge");
        handle?.requestMove("left");
        const rejIndex = mocks.dbusCalls.length - 1;
        const rejPayload = JSON.parse(mocks.dbusCalls[rejIndex]?.payload as string) as Record<string, unknown>;
        mocks.callbacks[rejIndex]?.(
            JSON.stringify({ v: 1, correlation_id: rejPayload["correlation_id"], outcome: "rejected", kind: "snapshot-invalid", message: "no" }),
        );
        assert.equal(activeGroupCalls(), 2, "rejected boundaries never refresh");
        handle?.stop();
    });
});

describe("plan adapter destroyed-window reply boundary", () => {
    it("drops a stale planned reply after a destroyed window without reading it and without writes", () => {
        const liveA: object = {};
        const liveC: object = {};
        let destroyedReads = 0;
        let revalidateCalls = 0;
        const destroyedB = new Proxy(
            {},
            {
                get(_target, _prop, _receiver): unknown {
                    destroyedReads += 1;
                    throw new Error("destroyed-window");
                },
            },
        );
        const refs = { a: liveA, b: destroyedB, c: liveC };
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                fingerprint: "fp-1",
                revalidate: (): boolean => {
                    revalidateCalls += 1;
                    return true;
                },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        assert.equal(mocks.dbusCalls.length, 1);
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        const survivor = Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: { x: 0, y: 0, w: 100, h: 100 },
            output: "out-1",
            workspace: "ws-1",
            fullscreen: false,
            maximized: false,
        });
        mocks.observeImpl = (): PlanObserved | null => ({
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
            domainGap: 0,
            domainOuterGap: 0,
            focusedId: "win-a",
            windows: Object.freeze([survivor]),
            activeRef: refs.a,
            fingerprint: "fp-2",
            revalidate: (): boolean => {
                revalidateCalls += 1;
                return true;
            },
        });
        const writesBefore = mocks.geometries.length;
        assert.doesNotThrow(() => {
            mocks.callbacks[0]?.(
                plannedReply(
                    correlation,
                    [
                        { window: "win-a", rect: { x: 0, y: 0, w: 200, h: 200 } },
                        { window: "win-b", rect: { x: 200, y: 0, w: 100, h: 100 } },
                    ],
                    null,
                ),
            );
        });
        assert.equal(mocks.geometries.length, writesBefore);
        assert.equal(mocks.actives.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("outcome=stale-scope")));
        assert.equal(revalidateCalls, 0);
        assert.equal(destroyedReads, 0);
        assert.equal(adapter.isEnabled, true);
    });

    it("applies remove replies from a fresh observation covering survivors", () => {
        const refs = makeRefs();
        let ids: string[] = ["win-a", "win-b", "win-c"];
        const byId: Record<string, object> = { "win-a": refs.a, "win-b": refs.b, "win-c": refs.c };
        const mocks = mockEnv(refs);
        mocks.observeImpl = (): PlanObserved | null => {
            const wins = ids.map((id) =>
                Object.freeze({
                    id,
                    ref: byId[id] as object,
                    rect: { x: 0, y: 0, w: 100, h: 100 },
                    output: "out-1",
                    workspace: "ws-1",
                    fullscreen: false,
                    maximized: false,
                }),
            );
            return {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-a",
                windows: Object.freeze(wins),
                activeRef: refs.a,
                fingerprint: `fp-${ids.join(",")}`,
                revalidate: () => true,
            };
        };
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.isEnabled, true);
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                admitCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        const writesAfterAdmit = mocks.geometries.length;
        assert.ok(writesAfterAdmit > 0);
        ids = ["win-a", "win-b"];
        fire(mocks, "removed");
        runTimers(mocks);
        const removeIndex = mocks.dbusCalls.length - 1;
        const removeCmd = plannerPayload(mocks, removeIndex)["command"] as Record<string, unknown>;
        assert.deepEqual(removeCmd, { op: "remove", window: "win-c" });
        const removeCorr = plannerPayload(mocks, removeIndex)["correlation_id"] as string;
        const writesBeforeRemove = mocks.geometries.length;
        mocks.callbacks[removeIndex]?.(
            plannedReply(
                removeCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(mocks.geometries.length > writesBeforeRemove);
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
    });

    it("applies remove replies without reading the destroyed window while resolving live survivors", () => {
        const liveA: object = {};
        const liveB: object = {};
        let destroyedReads = 0;
        const destroyedC = new Proxy(
            {},
            {
                get(_target, _prop, _receiver): unknown {
                    destroyedReads += 1;
                    throw new Error("destroyed-window");
                },
            },
        );
        const byId: Record<string, object> = { "win-a": liveA, "win-b": liveB, "win-c": destroyedC };
        let ids: string[] = ["win-a", "win-b", "win-c"];
        const refs = { a: liveA, b: liveB, c: destroyedC };
        const mocks = mockEnv(refs);
        mocks.observeImpl = (): PlanObserved | null => {
            const wins = ids.map((id) =>
                Object.freeze({
                    id,
                    ref: byId[id] as object,
                    rect: { x: 0, y: 0, w: 100, h: 100 },
                    output: "out-1",
                    workspace: "ws-1",
                    fullscreen: false,
                    maximized: false,
                }),
            );
            return {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-a",
                windows: Object.freeze(wins),
                activeRef: liveA,
                fingerprint: `fp-${ids.join(",")}`,
                revalidate: () => true,
            };
        };
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                admitCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(mocks.geometries.length > 0);
        ids = ["win-a", "win-b"];
        fire(mocks, "removed");
        runTimers(mocks);
        const removeIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual(plannerPayload(mocks, removeIndex)["command"], { op: "remove", window: "win-c" });
        const removeCorr = plannerPayload(mocks, removeIndex)["correlation_id"] as string;
        const writesBeforeRemove = mocks.geometries.length;
        const activesBefore = mocks.actives.length;
        assert.doesNotThrow(() => {
            mocks.callbacks[removeIndex]?.(
                plannedReply(
                    removeCorr,
                    [
                        { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                        { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                    ],
                    "win-a-leaf",
                ),
            );
        });
        assert.ok(mocks.geometries.length > writesBeforeRemove);
        for (let index = writesBeforeRemove; index < mocks.geometries.length; index += 1) {
            const target = mocks.geometries[index]?.target as object;
            assert.ok(target === liveA || target === liveB);
        }
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
        assert.equal(destroyedReads, 0);
        assert.equal(mocks.actives.length, activesBefore);
        assert.equal(adapter.isEnabled, true);
    });
});

describe("plan native identity sharing and string-keyed cache", () => {
    it("shares braced-UUID normalization across entries with no local copies", () => {
        const dir = kwinSrcDir();
        const shared = readFileSync(join(dir, "native-id.ts"), "utf8");
        assert.ok(shared.includes("function normalizeNativeId"), "shared normalizer");
        assert.ok(shared.includes("unwrapBraced"), "braced handling");
        assert.ok(shared.includes("String("), "String(internalId)");
        for (const file of [
            "focus-adapter-entry.ts",
            "movement-adapter-entry.ts",
            "resize-adapter-entry.ts",
            "pointer-resize-adapter-entry.ts",
            "plan-adapter-entry.ts",
        ]) {
            const body = readFileSync(join(dir, file), "utf8");
            assert.ok(body.includes("./native-id"), `${file} uses shared utility`);
            assert.ok(body.includes("normalizeNativeId"), `${file} calls shared normalizer`);
        }
        for (const file of [
            "focus-adapter-entry.ts",
            "movement-adapter-entry.ts",
            "resize-adapter-entry.ts",
            "pointer-resize-adapter-entry.ts",
        ]) {
            const body = readFileSync(join(dir, file), "utf8");
            assert.ok(!body.includes("function normalizeNativeId"), `${file} has no local copy`);
            assert.ok(!body.includes("function unwrapBraced"), `${file} has no local unwrap`);
        }
        const planEntry = readFileSync(join(dir, "plan-adapter-entry.ts"), "utf8");
        assert.ok(!planEntry.includes("function normalizeNativeId"), "plan entry uses shared, not a copy");
        assert.ok(!planEntry.includes("function unwrapBraced"), "plan entry uses shared, not a copy");
    });

    it("keeps plan entry identity string-keyed with explicit eviction and no WeakMap", () => {
        const dir = kwinSrcDir();
        const entry = readFileSync(join(dir, "plan-adapter-entry.ts"), "utf8");
        assert.ok(!entry.includes("WeakMap"), "no WeakMap");
        assert.ok(!entry.includes("OpaqueWindowIds"), "no OpaqueWindowIds");
        assert.ok(entry.includes("new Map<string, string>"), "Map<string, string> cache");
        assert.ok(entry.includes(".delete("), "explicit deletion");
        assert.ok(entry.includes("noteRemoved"), "eviction on adapter removed id");
        assert.ok(!entry.includes("windowRemoved\") as"), "no removal payload id read");
    });

    it("retains only primitive snapshots across the plan D-Bus boundary", () => {
        const dir = kwinSrcDir();
        const src = readFileSync(join(dir, "plan-adapter.ts"), "utf8");
        assert.ok(src.includes("snapshotOf"), "snapshot capture");
        assert.ok(src.includes("snapshotsEqual"), "snapshot comparison");
        assert.ok(src.includes("snapshot: PlanSnapshot"), "snapshot-typed flight/intent");
        assert.ok(src.includes("lastGoodByDomain = new Map<string, PlanSnapshot>()"), "snapshot-typed baselines");
        assert.ok(src.includes("noteRemoved"), "removed-id eviction hook");
        assert.ok(!src.includes("flightState.observed"), "no retained observed");
        assert.ok(!src.includes("captured.revalidate"), "no retained revalidation call");
        assert.ok(!src.includes("observed: previous"), "no retained previous observed");
        assert.ok(!src.includes("observed: fresh"), "no retained fresh observed");
    });
});

describe("plan adapter fullscreen isolation", () => {
    function makeObserved3(
        refs: { a: object; b: object; c: object },
        opts: {
            focused?: object;
            rects: Record<string, { x: number; y: number; w: number; h: number }>;
            fullscreen?: Record<string, boolean>;
            maximized?: Record<string, boolean>;
        },
        bounds: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1200, h: 800 },
    ): PlanObserved {
        const focused = opts.focused ?? refs.a;
        const isFullscreen = (id: string): boolean => opts.fullscreen?.[id] === true;
        const isMaximized = (id: string): boolean => opts.maximized?.[id] === true;
        const refById: Record<string, object> = { "win-a": refs.a, "win-b": refs.b, "win-c": refs.c };
        const windows = Object.freeze(
            (["win-a", "win-b", "win-c"] as const)
                .filter((id) => opts.rects[id] !== undefined)
                .map((id) =>
                    Object.freeze({
                        id,
                        ref: refById[id] as object,
                        rect: opts.rects[id] as { x: number; y: number; w: number; h: number },
                        output: "out-1",
                        workspace: "ws-1",
                        fullscreen: isFullscreen(id),
                        maximized: isMaximized(id),
                    }),
                ),
        );
        return {
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            domainBounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
            domainGap: DOMAIN_GAP,
            domainOuterGap: OUTER_DOMAIN_GAP,
            focusedId: focused === refs.a ? "win-a" : focused === refs.b ? "win-b" : "win-c",
            windows,
            activeRef: focused,
            fingerprint: "fp-fs",
            revalidate: () => true,
        };
    }

    function twoWindowBaseline(mocks: Mocks, refs: { a: object; b: object; c: object }): PlanAdapter {
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
            });
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const corr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        return adapter;
    }

    it("subscribes the per-window fullScreenChanged signal kind", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        enableAdapter(mocks);
        assert.ok(mocks.subscribes.some((entry) => entry.kind === "fullscreen"));
    });

    it("refuses directional move/resize/pointer-resize on a fullscreen focused window with no dispatch", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.b,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                fullscreen: { "win-b": true },
            });
        const callsBefore = mocks.dbusCalls.length;
        adapter.requestMove("left");
        adapter.requestResize("left", "outwards");
        assert.equal(adapter.requestPointerResize("win-b", "left", 600), false);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:move-refused-fullscreen"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:resize-refused-fullscreen"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-fullscreen"));
    });

    it("admits a fullscreen member into the tree but never writes its geometry", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 600, h: 800 },
                    "win-b": { x: 600, y: 0, w: 600, h: 800 },
                    "win-c": { x: 0, y: 0, w: 1200, h: 800 },
                },
                fullscreen: { "win-c": true },
            });
        fire(mocks, "added");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        const cmd = plannerPayload(mocks, 1)["command"] as Record<string, unknown>;
        assert.deepEqual(cmd, { op: "admit", window: "win-c", output: "out-1", workspace: "ws-1" });
        const sent = plannerPayload(mocks, 1)["windows"] as Array<Record<string, unknown>>;
        assert.ok(sent.some((entry) => entry["window"] === "win-c"), "fullscreen member stays observed");
        const corr = plannerPayload(mocks, 1)["correlation_id"] as string;
        const writesBefore = mocks.geometries.length;
        mocks.callbacks[1]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-c-leaf",
            ),
        );
        assert.ok(mocks.geometries.length > writesBefore, "siblings reflowed around the admission");
        assert.ok(mocks.geometries.some((entry) => entry.target === refs.a || entry.target === refs.b));
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.c), "fullscreen member never actuated");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-c resource_class=unknown disposition=skip-fullscreen rect=800,0,400,800",
            ),
            "fullscreen member carries skip-fullscreen disposition with its retained target rect",
        );
    });

    it("entering fullscreen from tiled adopts the baseline with no reconcile and no write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                fullscreen: { "win-b": true },
            });
        const callsBefore = mocks.dbusCalls.length;
        const writesBefore = mocks.geometries.length;
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(mocks.geometries.length, writesBefore);
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(adapter.isEnabled, true);
    });

    it("leaving fullscreen restores the retained tiled position via one reconcile", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                fullscreen: { "win-b": true },
            });
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        // KWin restores the window imperfectly: reconcile must reassert the
        // retained slot rather than adopt the post-fullscreen position.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 100, y: 100, w: 400, h: 400 } },
            });
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        const reconcileIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual((plannerPayload(mocks, reconcileIndex)["command"] as Record<string, unknown>)["op"], "reconcile");
        const corr = plannerPayload(mocks, reconcileIndex)["correlation_id"] as string;
        const writesBefore = mocks.geometries.length;
        mocks.callbacks[reconcileIndex]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(mocks.geometries.length > writesBefore);
        assert.ok(
            mocks.geometries.some((entry) => entry.target === refs.b && entry.rect.x === 600 && entry.rect.y === 0),
            "retained position restored",
        );
        // The reconcile write restored the retained slot: adopt the converged
        // observation and confirm no further dispatch.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
            });
        const callsAfter = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsAfter);
        assert.equal(adapter.isEnabled, true);
    });

    it("reflows siblings while one member is fullscreen without actuating it", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 400, h: 800 },
                    "win-b": { x: 400, y: 0, w: 400, h: 800 },
                    "win-c": { x: 800, y: 0, w: 400, h: 800 },
                },
            });
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                admitCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 1200, h: 800 },
                    "win-b": { x: 400, y: 0, w: 400, h: 800 },
                    "win-c": { x: 800, y: 0, w: 400, h: 800 },
                },
                fullscreen: { "win-a": true },
            });
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.b,
                rects: {
                    "win-a": { x: 0, y: 0, w: 1200, h: 800 },
                    "win-b": { x: 400, y: 0, w: 400, h: 800 },
                    "win-c": { x: 800, y: 0, w: 400, h: 800 },
                },
                fullscreen: { "win-a": true },
            });
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 2);
        const moveCorr = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReply(
                moveCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 800, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 400, y: 0, w: 400, h: 800 } },
                ],
                "win-b-leaf",
            ),
        );
        assert.ok(mocks.geometries.some((entry) => entry.target === refs.b), "sibling reflowed");
        assert.ok(mocks.geometries.some((entry) => entry.target === refs.c), "sibling reflowed");
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.a), "fullscreen member not actuated");
        assert.ok(mocks.logs.some((line) => line.includes("kind=move") && line.includes("outcome=planned-applied")));
    });

    it("never targets a fullscreen member for reconcile and converges sibling drift in one attempt", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 1200, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
                fullscreen: { "win-a": true },
            });
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        const callsAfterEnter = mocks.dbusCalls.length;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 1200, h: 800 }, "win-b": { x: 600, y: 0, w: 616, h: 800 } },
                fullscreen: { "win-a": true },
            });
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsAfterEnter + 1);
        const reconcileIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual((plannerPayload(mocks, reconcileIndex)["command"] as Record<string, unknown>)["op"], "reconcile");
        const corr = plannerPayload(mocks, reconcileIndex)["correlation_id"] as string;
        mocks.callbacks[reconcileIndex]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.a), "reconcile never writes fullscreen member");
        // The write corrected the sibling: adopt the converged observation and
        // confirm one reconcile converged with no further dispatch and no park.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 1200, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
                fullscreen: { "win-a": true },
            });
        const callsAfter = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsAfter, "one reconcile converges; no park from fullscreen member");
        assert.equal(adapter.isEnabled, true);
    });

    it("reprojects a changed work area while retaining and not writing a fullscreen member", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        twoWindowBaseline(mocks, refs);
        const writesBefore = mocks.geometries.length;
        const grown = { x: 200, y: 100, w: 800, h: 600 };
        const fullscreenObserved = (bounds: { x: number; y: number; w: number; h: number }): PlanObserved =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 0, w: 1600, h: 900 },
                        "win-b": { x: 600, y: 0, w: 600, h: 800 },
                    },
                    fullscreen: { "win-a": true },
                },
                bounds,
            );
        mocks.observeImpl = () => fullscreenObserved({ x: 0, y: 0, w: 1200, h: 800 });
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 1, "entering fullscreen does not reproject");
        mocks.observeImpl = () => fullscreenObserved(grown);
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.deepEqual((plannerPayload(mocks, 1)["command"] as Record<string, unknown>), { op: "reconcile" });
        assert.deepEqual(plannerPayload(mocks, 1)["domain"], {
            output: "out-1",
            workspace: "ws-1",
            bounds: grown,
            gap: DOMAIN_GAP,
            outer_gap: OUTER_DOMAIN_GAP,
        });
        const carried = plannerPayload(mocks, 1)["windows"] as Array<Record<string, unknown>>;
        for (const entry of carried) {
            const rect = entry["rect"] as { x: number; y: number; w: number; h: number };
            assert.ok(rect.x >= grown.x && rect.y >= grown.y);
            assert.ok(rect.x + rect.w <= grown.x + grown.w);
            assert.ok(rect.y + rect.h <= grown.y + grown.h);
        }
        const correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 208, y: 108, w: 384, h: 584 } },
                    { window: "win-b", rect: { x: 608, y: 108, w: 384, h: 584 } },
                ],
                "win-a-leaf",
            ),
        );
        const applied = mocks.geometries.slice(writesBefore);
        assert.equal(applied.some((entry) => entry.target === refs.a), false);
        assert.deepEqual(applied, [{ target: refs.b, rect: { x: 608, y: 108, w: 384, h: 584 } }]);
        assert.ok(mocks.logs.some((line) => line.includes(`cmd=${correlation}`) && line.includes("outcome=planned-applied")));
    });

    it("routes simultaneous work-area and membership changes through admission", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        twoWindowBaseline(mocks, refs);
        const grown = { x: 0, y: 0, w: 1600, h: 900 };
        mocks.observeImpl = () =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 0, w: 600, h: 800 },
                        "win-b": { x: 600, y: 0, w: 600, h: 800 },
                        "win-c": { x: 0, y: 0, w: 100, h: 100 },
                    },
                },
                grown,
            );
        fire(mocks, "added");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        const payload = plannerPayload(mocks, 1);
        assert.deepEqual(payload["command"], { op: "admit", window: "win-c", output: "out-1", workspace: "ws-1" });
        assert.deepEqual(payload["domain"], {
            output: "out-1",
            workspace: "ws-1",
            bounds: grown,
            gap: DOMAIN_GAP,
            outer_gap: OUTER_DOMAIN_GAP,
        });
        const correlation = payload["correlation_id"] as string;
        const writesBefore = mocks.geometries.length;
        mocks.callbacks[1]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 500, h: 900 } },
                    { window: "win-b", rect: { x: 500, y: 0, w: 500, h: 900 } },
                    { window: "win-c", rect: { x: 1000, y: 0, w: 600, h: 900 } },
                ],
                "win-c-leaf",
            ),
        );
        const applied = mocks.geometries.slice(writesBefore);
        assert.deepEqual(
            new Set(applied.map((entry) => entry.target)),
            new Set([refs.a, refs.b, refs.c]),
        );
        assert.ok(applied.some((entry) => entry.target === refs.c && entry.rect.w === 600));
        assert.ok(mocks.logs.some((line) => line.includes(`cmd=${correlation}`) && line.includes("kind=admit") && line.includes("outcome=planned-applied")));
    });

    it("fullscreen-only rect drift adopts the baseline without dispatching reconcile", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                fullscreen: { "win-b": true },
            });
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 100, y: 50, w: 1000, h: 700 } },
                fullscreen: { "win-b": true },
            });
        const callsBefore = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(adapter.isEnabled, true);
    });

    it("carries a contained retained rect for an out-of-bounds fullscreen frame and reflows siblings", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        // Work area excludes a 24px top panel; the fullscreen frame spans the
        // full physical area and exceeds these bounds.
        const bounds = { x: 0, y: 24, w: 1200, h: 776 };
        mocks.observeImpl = () =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 24, w: 600, h: 776 },
                        "win-b": { x: 600, y: 24, w: 600, h: 776 },
                    },
                },
                bounds,
            );
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                admitCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 24, w: 600, h: 776 } },
                    { window: "win-b", rect: { x: 600, y: 24, w: 600, h: 776 } },
                ],
                "win-a-leaf",
            ),
        );
        mocks.observeImpl = () =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 0, w: 1200, h: 800 },
                        "win-b": { x: 600, y: 24, w: 600, h: 776 },
                    },
                    fullscreen: { "win-a": true },
                },
                bounds,
            );
        fire(mocks, "fullscreen");
        runDebounce(mocks);
        const callsAfterEnter = mocks.dbusCalls.length;
        // Sibling drift while the fullscreen frame is out of bounds must still
        // reconcile, and every carried window rect must stay in-bounds.
        mocks.observeImpl = () =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 0, w: 1200, h: 800 },
                        "win-b": { x: 600, y: 24, w: 560, h: 776 },
                    },
                    fullscreen: { "win-a": true },
                },
                bounds,
            );
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsAfterEnter + 1);
        const reconcileIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual((plannerPayload(mocks, reconcileIndex)["command"] as Record<string, unknown>)["op"], "reconcile");
        const payload = plannerPayload(mocks, reconcileIndex);
        const db = (payload["domain"] as Record<string, unknown>)["bounds"] as { x: number; y: number; w: number; h: number };
        const carried = payload["windows"] as Array<Record<string, unknown>>;
        for (const entry of carried) {
            const rect = entry["rect"] as { x: number; y: number; w: number; h: number };
            assert.ok(
                rect.x >= db.x &&
                    rect.y >= db.y &&
                    rect.x + rect.w <= db.x + db.w &&
                    rect.y + rect.h <= db.y + db.h,
                `${String(entry["window"])} carried in-bounds`,
            );
        }
        const fullscreenCarried = carried.find((entry) => entry["window"] === "win-a") as Record<string, unknown>;
        assert.deepEqual(
            fullscreenCarried["rect"],
            { x: 0, y: 24, w: 600, h: 776 },
            "retained rect carried, never the compositor frame rect",
        );
        const corr = plannerPayload(mocks, reconcileIndex)["correlation_id"] as string;
        const writesBefore = mocks.geometries.length;
        mocks.callbacks[reconcileIndex]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 24, w: 600, h: 776 } },
                    { window: "win-b", rect: { x: 600, y: 24, w: 600, h: 776 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(mocks.geometries.length > writesBefore, "sibling reflowed around the fullscreen member");
        assert.ok(mocks.geometries.some((entry) => entry.target === refs.b), "sibling written");
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.a), "fullscreen member never actuated");
        assert.ok(mocks.logs.some((line) => line.includes("kind=reconcile") && line.includes("outcome=planned-applied")));
        assert.equal(adapter.isEnabled, true);
    });

    it("admits a window already fullscreen out-of-bounds with a contained carried rect", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const bounds = { x: 0, y: 24, w: 1200, h: 776 };
        mocks.observeImpl = () =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 0, w: 1200, h: 800 },
                        "win-b": { x: 600, y: 24, w: 600, h: 776 },
                    },
                    fullscreen: { "win-a": true },
                },
                bounds,
            );
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual((plannerPayload(mocks, 0)["command"] as Record<string, unknown>)["op"], "admit");
        const payload = plannerPayload(mocks, 0);
        const db = (payload["domain"] as Record<string, unknown>)["bounds"] as { x: number; y: number; w: number; h: number };
        const carried = payload["windows"] as Array<Record<string, unknown>>;
        for (const entry of carried) {
            const rect = entry["rect"] as { x: number; y: number; w: number; h: number };
            assert.ok(
                rect.x >= db.x &&
                    rect.y >= db.y &&
                    rect.x + rect.w <= db.x + db.w &&
                    rect.y + rect.h <= db.y + db.h,
                `${String(entry["window"])} carried in-bounds`,
            );
        }
        const fullscreenCarried = carried.find((entry) => entry["window"] === "win-a") as Record<string, unknown>;
        assert.deepEqual(
            fullscreenCarried["rect"],
            { x: 0, y: 24, w: 1200, h: 776 },
            "clamped into bounds on admission, never the frame rect",
        );
        assert.equal(adapter.isEnabled, true);
    });
});

describe("plan adapter maximize isolation", () => {
    function makeObserved3(
        refs: { a: object; b: object; c: object },
        opts: {
            focused?: object;
            rects: Record<string, { x: number; y: number; w: number; h: number }>;
            fullscreen?: Record<string, boolean>;
            maximized?: Record<string, boolean>;
        },
        bounds: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1200, h: 800 },
    ): PlanObserved {
        const focused = opts.focused ?? refs.a;
        const isFullscreen = (id: string): boolean => opts.fullscreen?.[id] === true;
        const isMaximized = (id: string): boolean => opts.maximized?.[id] === true;
        const refById: Record<string, object> = { "win-a": refs.a, "win-b": refs.b, "win-c": refs.c };
        const windows = Object.freeze(
            (["win-a", "win-b", "win-c"] as const)
                .filter((id) => opts.rects[id] !== undefined)
                .map((id) =>
                    Object.freeze({
                        id,
                        ref: refById[id] as object,
                        rect: opts.rects[id] as { x: number; y: number; w: number; h: number },
                        output: "out-1",
                        workspace: "ws-1",
                        fullscreen: isFullscreen(id),
                        maximized: isMaximized(id),
                    }),
                ),
        );
        return {
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            domainBounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
            domainGap: DOMAIN_GAP,
            domainOuterGap: OUTER_DOMAIN_GAP,
            focusedId: focused === refs.a ? "win-a" : focused === refs.b ? "win-b" : "win-c",
            windows,
            activeRef: focused,
            fingerprint: "fp-max",
            revalidate: () => true,
        };
    }

    function twoWindowBaseline(mocks: Mocks, refs: { a: object; b: object; c: object }): PlanAdapter {
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
            });
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const corr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        return adapter;
    }

    it("subscribes the per-window maximizedChanged signal kind", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        enableAdapter(mocks);
        assert.ok(mocks.subscribes.some((entry) => entry.kind === "maximize"));
    });

    it("clears maximize once at admission and tiles the restored window", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximized = true;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
                maximized: { "win-a": maximized },
                resourceClasses: { "win-a": "firefox" },
            });
        mocks.maximizeClearImpl = (target): MaximizeClearOutcome => {
            assert.equal(target, refs.a);
            maximized = false;
            fire(mocks, "maximize", refs.a);
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestResync();
        runDebounce(mocks);
        assert.deepEqual(mocks.maximizeClears, [refs.a]);
        assert.equal((plannerPayload(mocks, 0)["command"] as Record<string, unknown>)["op"], "admit");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 500, h: 800 } },
                    { window: "win-b", rect: { x: 500, y: 0, w: 700, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(mocks.geometries.some((entry) => entry.target === refs.a), "restored admission receives its tile geometry");
        assert.ok(
            mocks.logs.some(
                (line) => line === "plasma-auto-tiler:plan:maximize-admission-clear window=win-a resource_class=firefox outcome=observed-cleared",
            ),
        );
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:maximize-admission-echo-consumed"));
    });

    it("leaves fullscreen admission isolated even when maximize is also set", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 1200, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
                fullscreen: { "win-a": true },
                maximized: { "win-a": true },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestResync();
        runDebounce(mocks);
        assert.equal(mocks.maximizeClears.length, 0, "fullscreen takes precedence over admission clear");
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.a));
        assert.ok(mocks.logs.some((line) => line.includes("window=win-a") && line.includes("disposition=skip-fullscreen")));
    });

    it("refuses directional move/resize/pointer-resize on a maximized focused window with no dispatch", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.b,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                maximized: { "win-b": true },
            });
        const callsBefore = mocks.dbusCalls.length;
        adapter.requestMove("left");
        adapter.requestResize("left", "outwards");
        assert.equal(adapter.requestPointerResize("win-b", "left", 600), false);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:move-refused-maximize"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:resize-refused-maximize"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-maximize"));
    });

    it("prefers fullscreen over maximize for action refusal tokens", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.b,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                fullscreen: { "win-b": true },
                maximized: { "win-b": true },
            });
        const callsBefore = mocks.dbusCalls.length;
        adapter.requestMove("left");
        adapter.requestResize("left", "outwards");
        assert.equal(adapter.requestPointerResize("win-b", "left", 600), false);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:move-refused-fullscreen"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:resize-refused-fullscreen"));
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-fullscreen"));
        assert.ok(!mocks.logs.some((line) => line === "plasma-auto-tiler:plan:move-refused-maximize"));
        assert.ok(!mocks.logs.some((line) => line === "plasma-auto-tiler:plan:resize-refused-maximize"));
        assert.ok(!mocks.logs.some((line) => line === "plasma-auto-tiler:plan:pointer-refused-maximize"));
    });

    it("admits a maximized member into the tree but never writes its geometry", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 600, h: 800 },
                    "win-b": { x: 600, y: 0, w: 600, h: 800 },
                    "win-c": { x: 0, y: 0, w: 1200, h: 800 },
                },
                maximized: { "win-c": true },
            });
        fire(mocks, "added");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        const cmd = plannerPayload(mocks, 1)["command"] as Record<string, unknown>;
        assert.deepEqual(cmd, { op: "admit", window: "win-c", output: "out-1", workspace: "ws-1" });
        const sent = plannerPayload(mocks, 1)["windows"] as Array<Record<string, unknown>>;
        assert.ok(sent.some((entry) => entry["window"] === "win-c"), "maximized member stays observed");
        const corr = plannerPayload(mocks, 1)["correlation_id"] as string;
        const writesBefore = mocks.geometries.length;
        mocks.callbacks[1]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-c-leaf",
            ),
        );
        assert.ok(mocks.geometries.length > writesBefore, "siblings reflowed around the admission");
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.c), "maximized member never actuated");
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-c resource_class=unknown disposition=skip-maximized rect=800,0,400,800",
            ),
            "maximized member carries skip-maximized disposition with its retained target rect",
        );
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
    });

    it("carries a known member's retained rect when KWin transiently reports its frame out of bounds", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const bounds = { x: 0, y: 24, w: 1200, h: 776 };
        mocks.observeImpl = () =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 24, w: 600, h: 776 },
                        "win-b": { x: 600, y: 24, w: 600, h: 776 },
                    },
                },
                bounds,
            );
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        let correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 24, w: 600, h: 776 } },
                    { window: "win-b", rect: { x: 600, y: 24, w: 600, h: 776 } },
                ],
                "win-a-leaf",
            ),
        );
        mocks.observeImpl = () =>
            makeObserved3(
                refs,
                {
                    focused: refs.a,
                    rects: {
                        "win-a": { x: 0, y: 24, w: 560, h: 776 },
                        "win-b": { x: 0, y: 0, w: 1200, h: 800 },
                    },
                },
                bounds,
            );
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal((plannerPayload(mocks, 1)["command"] as Record<string, unknown>)["op"], "reconcile");
        const carried = plannerPayload(mocks, 1)["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(
            carried.find((entry) => entry["window"] === "win-b")?.["rect"],
            { x: 600, y: 24, w: 600, h: 776 },
            "the valid applied projection replaces the transient raw frame",
        );
        correlation = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 24, w: 600, h: 776 } },
                    { window: "win-b", rect: { x: 600, y: 24, w: 600, h: 776 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.equal(adapter.isEnabled, true);
    });

    it("prefers fullscreen over maximize for the write disposition", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 600, h: 800 },
                    "win-b": { x: 600, y: 0, w: 600, h: 800 },
                    "win-c": { x: 0, y: 0, w: 1200, h: 800 },
                },
                fullscreen: { "win-c": true },
                maximized: { "win-c": true },
            });
        fire(mocks, "added");
        runDebounce(mocks);
        const corr = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-c-leaf",
            ),
        );
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.c), "overlay member never actuated");
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-c resource_class=unknown disposition=skip-fullscreen rect=800,0,400,800",
            ),
            "fullscreen disposition wins when both fullscreen and maximized",
        );
        assert.ok(!mocks.logs.some((line) => line.includes("disposition=skip-maximized")));
    });

    it("entering maximize from tiled adopts the baseline with no reconcile and no write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                maximized: { "win-b": true },
            });
        const callsBefore = mocks.dbusCalls.length;
        const writesBefore = mocks.geometries.length;
        fire(mocks, "maximize");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(mocks.geometries.length, writesBefore);
        assert.equal(mocks.maximizeClears.length, 0, "post-admission maximize is never cleared");
        fire(mocks, "maximize");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(adapter.isEnabled, true);
    });

    it("does not re-clear or loop when an admitted window immediately re-maximizes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let maximized = true;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": maximized ? { x: 0, y: 0, w: 1200, h: 800 } : { x: 0, y: 0, w: 600, h: 800 },
                    "win-b": { x: 600, y: 0, w: 600, h: 800 },
                },
                maximized: { "win-a": maximized },
            });
        mocks.maximizeClearImpl = (): MaximizeClearOutcome => {
            maximized = false;
            fire(mocks, "maximize", refs.a);
            return "invoked";
        };
        const adapter = enableAdapter(mocks);
        adapter.requestResync();
        runDebounce(mocks);
        const correlation = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        maximized = true;
        fire(mocks, "maximize");
        runDebounce(mocks);
        assert.equal(mocks.maximizeClears.length, 1, "the admission clear is one-shot");
        assert.equal(mocks.dbusCalls.length, 1, "post-admission maximize does not dispatch a loop");
        assert.equal(adapter.isEnabled, true);
    });

    it("leaving maximize restores the exact retained tiled position via one reconcile", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                maximized: { "win-b": true },
            });
        fire(mocks, "maximize");
        runDebounce(mocks);
        // KWin restores the window imperfectly: reconcile must reassert the
        // retained slot rather than adopt the post-maximize position.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 100, y: 100, w: 400, h: 400 } },
            });
        fire(mocks, "maximize");
        runDebounce(mocks);
        const reconcileIndex = mocks.dbusCalls.length - 1;
        assert.deepEqual((plannerPayload(mocks, reconcileIndex)["command"] as Record<string, unknown>)["op"], "reconcile");
        const corr = plannerPayload(mocks, reconcileIndex)["correlation_id"] as string;
        const writesBefore = mocks.geometries.length;
        mocks.callbacks[reconcileIndex]?.(
            plannedReply(
                corr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        assert.ok(mocks.geometries.length > writesBefore);
        assert.ok(
            mocks.geometries.some((entry) => entry.target === refs.b && entry.rect.x === 600 && entry.rect.y === 0),
            "exact retained position restored",
        );
        // The reconcile write restored the retained slot: adopt the converged
        // observation and confirm no further dispatch.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 600, y: 0, w: 600, h: 800 } },
            });
        const callsAfter = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsAfter);
        assert.equal(adapter.isEnabled, true);
    });

    it("maximized-only rect drift adopts the baseline without dispatching reconcile", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = twoWindowBaseline(mocks, refs);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 0, y: 0, w: 1200, h: 800 } },
                maximized: { "win-b": true },
            });
        fire(mocks, "maximize");
        runDebounce(mocks);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: { "win-a": { x: 0, y: 0, w: 600, h: 800 }, "win-b": { x: 100, y: 50, w: 1000, h: 700 } },
                maximized: { "win-b": true },
            });
        const callsBefore = mocks.dbusCalls.length;
        fire(mocks, "geometry");
        runDebounce(mocks);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.equal(adapter.isEnabled, true);
    });

    it("reflows siblings while one member is maximized without actuating it", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 400, h: 800 },
                    "win-b": { x: 400, y: 0, w: 400, h: 800 },
                    "win-c": { x: 800, y: 0, w: 400, h: 800 },
                },
            });
        const adapter = enableAdapter(mocks);
        fire(mocks, "added");
        runTimers(mocks);
        const admitCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(
            plannedReply(
                admitCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 400, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 800, y: 0, w: 400, h: 800 } },
                ],
                "win-a-leaf",
            ),
        );
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 1200, h: 800 },
                    "win-b": { x: 400, y: 0, w: 400, h: 800 },
                    "win-c": { x: 800, y: 0, w: 400, h: 800 },
                },
                maximized: { "win-a": true },
            });
        fire(mocks, "maximize");
        runDebounce(mocks);
        // Focus is exempt from maximize isolation: a move on a non-maximized
        // sibling reflows around the maximized member without writing it.
        mocks.observeImpl = () =>
            makeObserved3(refs, {
                focused: refs.b,
                rects: {
                    "win-a": { x: 0, y: 0, w: 1200, h: 800 },
                    "win-b": { x: 400, y: 0, w: 400, h: 800 },
                    "win-c": { x: 800, y: 0, w: 400, h: 800 },
                },
                maximized: { "win-a": true },
            });
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 2);
        const moveCorr = plannerPayload(mocks, 1)["correlation_id"] as string;
        mocks.callbacks[1]?.(
            plannedReply(
                moveCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", rect: { x: 800, y: 0, w: 400, h: 800 } },
                    { window: "win-c", rect: { x: 400, y: 0, w: 400, h: 800 } },
                ],
                "win-b-leaf",
            ),
        );
        assert.ok(mocks.geometries.some((entry) => entry.target === refs.b), "sibling reflowed");
        assert.ok(mocks.geometries.some((entry) => entry.target === refs.c), "sibling reflowed");
        assert.ok(!mocks.geometries.some((entry) => entry.target === refs.a), "maximized member not actuated");
        assert.ok(mocks.logs.some((line) => line.includes("kind=move") && line.includes("outcome=planned-applied")));
    });
});

describe("plan adapter observational highlight refresh edge", () => {
    function mockEnvWithApplied(
        refs: { a: object; b: object; c: object },
        applied: string[],
    ): Mocks {
        const mocks = mockEnv(refs);
        (mocks.env as unknown as Record<string, unknown>)["onPlannedApplied"] = (op: unknown): void => {
            applied.push(op as string);
        };
        return mocks;
    }

    function succeedMove(mocks: Mocks, focusLeaf: string): string {
        const correlation = plannerPayload(mocks, mocks.dbusCalls.length - 1)["correlation_id"] as string;
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 500, h: 500 } },
                    { window: "win-b", rect: { x: 500, y: 0, w: 100, h: 100 } },
                ],
                focusLeaf,
            ),
        );
        return correlation;
    }

    it("refreshes exactly once after a successful move even when focus is unchanged", () => {
        const refs = makeRefs();
        const applied: string[] = [];
        const mocks = mockEnvWithApplied(refs, applied);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 100, h: 100 },
                    "win-b": { x: 100, y: 0, w: 500, h: 500 },
                },
            });
        mocks.activeImpl = () => refs.a;
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        // Focus leaf matches the already-active window: no focus write, but
        // the geometry plan still applies and must refresh once.
        succeedMove(mocks, "win-a-leaf");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
        assert.deepEqual(applied, ["move"]);
        assert.equal(adapter.isInFlight, false);
        // Foreground commands are not blocked: the next dispatch proceeds.
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("refreshes after resize but never for focus-only plans", () => {
        const refs = makeRefs();
        const applied: string[] = [];
        const mocks = mockEnvWithApplied(refs, applied);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 100, h: 100 },
                    "win-b": { x: 100, y: 0, w: 500, h: 500 },
                },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestResize("left", "outwards");
        succeedMove(mocks, "win-a-leaf");
        assert.deepEqual(applied, ["resize"]);
        adapter.requestFocus("right");
        const focusCorr = plannerPayload(mocks, mocks.dbusCalls.length - 1)["correlation_id"] as string;
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            plannedReply(
                focusCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 500, h: 500 } },
                    { window: "win-b", rect: { x: 500, y: 0, w: 100, h: 100 } },
                ],
                "win-b-leaf",
            ),
        );
        assert.ok(mocks.logs.some((line) => line.includes("kind=focus") && line.includes("outcome=planned-applied")));
        assert.deepEqual(applied, ["resize"]);
    });

    it("never refreshes on rejected or stale boundaries", () => {
        const refs = makeRefs();
        const applied: string[] = [];
        const mocks = mockEnvWithApplied(refs, applied);
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 100, h: 100 },
                    "win-b": { x: 100, y: 0, w: 500, h: 500 },
                },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        const rejectedCorr = plannerPayload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(rejectedReply(rejectedCorr, "snapshot-invalid"));
        assert.deepEqual(applied, []);
        // Stale: a newer debounced observation fences the reply.
        let version = 0;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                fingerprint: version === 0 ? "fp-1" : "fp-2",
                rects:
                    version === 0
                        ? { "win-a": { x: 0, y: 0, w: 100, h: 100 }, "win-b": { x: 100, y: 0, w: 100, h: 100 } }
                        : { "win-a": { x: 5, y: 5, w: 100, h: 100 }, "win-b": { x: 100, y: 0, w: 100, h: 100 } },
            });
        adapter.requestMove("right");
        const staleCorr = plannerPayload(mocks, mocks.dbusCalls.length - 1)["correlation_id"] as string;
        version = 1;
        fire(mocks, "geometry");
        runDebounce(mocks);
        mocks.callbacks[mocks.callbacks.length - 1]?.(
            plannedReply(
                staleCorr,
                [
                    { window: "win-a", rect: { x: 0, y: 0, w: 200, h: 200 } },
                    { window: "win-b", rect: { x: 200, y: 0, w: 100, h: 100 } },
                ],
                null,
            ),
        );
        assert.ok(mocks.logs.some((line) => line.includes("outcome=stale-dropped")));
        assert.deepEqual(applied, []);
    });

    it("a throwing refresh hook never wedges foreground commands", () => {
        const refs = makeRefs();
        const applied: string[] = [];
        const mocks = mockEnvWithApplied(refs, applied);
        (mocks.env as unknown as Record<string, unknown>)["onPlannedApplied"] = (): void => {
            throw new Error("hook-failed");
        };
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focused: refs.a,
                rects: {
                    "win-a": { x: 0, y: 0, w: 100, h: 100 },
                    "win-b": { x: 100, y: 0, w: 500, h: 500 },
                },
            });
        const adapter = enableAdapter(mocks);
        adapter.requestMove("right");
        succeedMove(mocks, "win-a-leaf");
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
        assert.deepEqual(applied, []);
        adapter.requestMove("right");
        assert.equal(adapter.isInFlight, true);
    });
});

describe("plan entry workspace-send echo wiring", () => {
    it("binds both send entries to native membership and frame geometry signals via signal-capability helpers", () => {
        const srcDir = kwinSrcDir();
        for (const name of ["plan-adapter-entry.ts", "workspace-send-adapter-entry.ts"]) {
            const body = readFileSync(join(srcDir, name), "utf8");
            assert.ok(body.includes("subscribeMoverDesktops"), name);
            assert.ok(body.includes("desktopsChanged"), name);
            assert.ok(body.includes("subscribeWindowGeometry"), name);
            assert.ok(body.includes("frameGeometryChanged"), name);
            assert.ok(body.includes("connectSignal"), name);
            assert.ok(body.includes("readSignal"), name);
        }
        const adapterSrc = readFileSync(join(srcDir, "workspace-send-adapter.ts"), "utf8");
        assert.ok(adapterSrc.includes("subscribeMoverDesktops"), "adapter seam");
        assert.ok(adapterSrc.includes("subscribeWindowGeometry"), "geometry seam");
        assert.ok(adapterSrc.includes("plan-echo"), "waiting/disposition diagnostic");
        assert.ok(adapterSrc.includes("plan-geometry"), "geometry readiness diagnostic");
        assert.ok(adapterSrc.includes("onMoverEcho"), "one-shot echo handler");
        assert.ok(adapterSrc.includes("onGeometryEcho"), "one-shot geometry handler");
    });

    it("exposes a real move-workspace shortcut chord feeding the send transport", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        const move = mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-move-workspace-2");
        assert.ok(move !== undefined, "current Meta+Shift+2 move chord must exist");
        assert.equal(move.sequence, "Meta+Shift+2");
        handle.stop();
    });

    it("supports a native mover desktopsChanged echo through the fake signal seam", () => {
        const world = fakeWorld();
        const mover = world.wins[0] as object;
        const seam = world.winDesktops.get(mover);
        assert.ok(seam !== undefined, "mover must expose a desktopsChanged fake signal");
        let observed = 0;
        const detach = (() => {
            try {
                const signal = (mover as Record<string, unknown>)["desktopsChanged"] as {
                    connect: (handler: () => void) => void;
                    disconnect: (handler: () => void) => void;
                };
                const handler = (): void => {
                    observed += 1;
                };
                signal.connect(handler);
                return (): void => {
                    signal.disconnect(handler);
                };
            } catch (error) {
                void error;
                return null;
            }
        })();
        assert.ok(detach !== null, "fake desktopsChanged must be connectable");
        for (const handler of seam.handlers) {
            handler();
        }
        assert.equal(observed, 1, "echo fires exactly once through the connectable signal");
        detach();
        assert.equal(seam.handlers.length, 0, "one-shot detach releases the echo subscription");
    });
});
