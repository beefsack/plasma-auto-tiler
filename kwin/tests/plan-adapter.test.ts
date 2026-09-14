import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
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
    const windows = Object.freeze([
        Object.freeze({ id: "win-a", ref: refs.a, rect: rect("win-a"), output: "out-1", workspace: "ws-1", fullscreen: isFullscreen("win-a") }),
        Object.freeze({ id: "win-b", ref: refs.b, rect: rect("win-b"), output: "out-1", workspace: "ws-1", fullscreen: isFullscreen("win-b") }),
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
    readonly subscribes: Array<{ kind: string; handler: () => void }>;
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    readonly actives: object[];
    observeImpl: () => PlanObserved | null;
    activeImpl: () => object | null;
    geometryImpl: (target: object, rect: { x: number; y: number; w: number; h: number }) => boolean;
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
        observeImpl: () => makeObserved(refs, { focused: refs.a }),
        activeImpl: () => refs.a,
        geometryImpl: (_target: object, _rect: { x: number; y: number; w: number; h: number }): boolean => true,
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
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return state.geometryImpl(target, rect);
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

function fire(mocks: Mocks, kind: string): void {
    for (const sub of mocks.subscribes) {
        if (sub.kind === kind) {
            sub.handler();
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
                    line === "plasma-auto-tiler:plan:write window=win-a disposition=skip-already-equal rect=0,0,100,100",
            ),
            "unchanged member carries skip-already-equal disposition",
        );
        assert.ok(
            mocks.logs.some(
                (line) =>
                    line === "plasma-auto-tiler:plan:write window=win-b disposition=written rect=100,0,400,500",
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
                    line === "plasma-auto-tiler:plan:write window=win-a disposition=write-failed rect=0,0,600,800",
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
                Object.freeze({ id, ref: byId[id] as object, rect: { x: 0, y: 0, w: 100, h: 100 }, output: "out-1", workspace: "ws-1", fullscreen: false }),
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

    it("keeps a cross-workspace duplicate admit fail-closed and recovers for a new window", () => {
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
                    rect: { x: 0, y: 0, w: 100, h: 100 },
                    output: "out-1",
                    workspace,
                    fullscreen: false,
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
        assert.deepEqual(plannerPayload(mocks, 2)["command"], { op: "admit", window: "win-a", output: "out-1", workspace: "ws-a" });
        mocks.callbacks[2]?.(rejectedReply(plannerPayload(mocks, 2)["correlation_id"] as string, "duplicate-window"));
        assert.equal(adapter.isEnabled, true);
        assert.ok(mocks.logs.some((line) => line === "plasma-auto-tiler:plan:rejected kind=duplicate-window"));

        workspace = "ws-b";
        ids = ["win-b", "win-c"];
        fire(mocks, "scope");
        runTimers(mocks);
        assert.deepEqual(plannerPayload(mocks, 3)["command"], { op: "admit", window: "win-b", output: "out-1", workspace: "ws-b" });
        correlation = plannerPayload(mocks, 3)["correlation_id"] as string;
        mocks.callbacks[3]?.(
            plannedReply(
                correlation,
                [
                    { window: "win-b", rect: { x: 0, y: 0, w: 600, h: 800 } },
                    { window: "win-c", rect: { x: 600, y: 0, w: 600, h: 800 } },
                ],
                null,
            ),
        );
        assert.ok(mocks.logs.some((line) => line.includes("cmd=gen-1-p3") && line.includes("outcome=planned-applied")));
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
        assert.equal(fresh2[0], "plasma-auto-tiler:plan:write window=win-b disposition=skip-already-equal rect=600,0,600,800");
        assert.equal(fresh2[1], "plasma-auto-tiler:plan:write window=win-a disposition=written rect=0,0,600,800");
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
                /^plasma-auto-tiler:plan:(cmd=\S+ kind=(admit|remove|move|focus|resize|reconcile|pointer-resize) windows=\d+ outcome=\S+|rejected kind=[a-z-]+|write window=\S+ disposition=(written|skip-fullscreen|skip-already-equal|write-failed) rect=[^ ]+|busy-refused kind=(focus|move|resize)|(focus|move|resize|pointer)-refused-[a-z-]+|scope-transition [^ ]+|work-area-reprojection selected=retained|echo-fence-(armed|consumed|cleared-equality|mismatched)|reconcile-parked)$/,
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
    readonly winFull: Map<object, FakeSignal>;
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
    const world: FakeWorld = {
        output,
        desktop,
        added,
        wins: [],
        workspace: {},
        winFull,
    };
    const makeWin = (id: string, x: number): Record<string, unknown> => {
        const geo = fakeSignal();
        const full = fakeSignal();
        const win = {
            normalWindow: true,
            internalId: id,
            output,
            desktops: [desktop],
            frameGeometry: { x, y: 0, width: 600, height: 800 },
            moveResizedChanged: geo.signal,
            fullScreenChanged: full.signal,
            fullScreen: false,
        };
        winFull.set(win, full);
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

    it("starts with 24 parameterized directional shortcuts and observes stable ids", () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        assert.equal(mocks.shortcuts.length, 24);
        const actions = mocks.shortcuts.map((row) => row.action);
        assert.equal(new Set(actions).size, 24);
        assert.ok(actions.includes("plasma-auto-tiler-focus-left"));
        assert.ok(actions.includes("plasma-auto-tiler-focus-right-arrow"));
        assert.ok(actions.includes("plasma-auto-tiler-move-up"));
        assert.ok(actions.includes("plasma-auto-tiler-resize-outwards-right"));
        assert.ok(actions.includes("plasma-auto-tiler-resize-inwards-down"));
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

    it("maps catalog rows to parameterized focus, move, and resize commands", () => {
        for (const profile of ["cosmic", "hyprland", "bspwm", "unknown"]) {
            const catalog = planShortcutCatalog(profile);
            assert.equal(catalog.length, 24);
            const byAction = new Map(catalog.map((row) => [row.action, row]));
            assert.equal(byAction.get("plasma-auto-tiler-focus-up")?.direction, "up");
            assert.equal(byAction.get("plasma-auto-tiler-focus-up")?.op, "focus");
            assert.equal(byAction.get("plasma-auto-tiler-move-down-arrow")?.direction, "down");
            assert.equal(byAction.get("plasma-auto-tiler-move-down-arrow")?.op, "move");
            assert.equal(byAction.get("plasma-auto-tiler-resize-outwards-left")?.mode, "outwards");
            assert.equal(byAction.get("plasma-auto-tiler-resize-inwards-left")?.mode, "inwards");
        }
    });

    it("registers distinct Meta+Shift move sequences delivering op=move", () => {
        const first = startEntry(fakeWorld());
        assert.ok(first.handle !== null);
        const moves = first.mocks.shortcuts.filter((row) => row.action.startsWith("plasma-auto-tiler-move-"));
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

    it("never registers Meta+digit or Meta+Shift+digit workspace sequences", () => {
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
        for (const row of live.mocks.shortcuts) {
            assert.ok(!row.action.includes("workspace"), row.action);
            assert.ok(!/Meta(\+Shift)?\+\d/.test(row.sequence), `${row.action}:${row.sequence}`);
        }
        live.handle?.stop();
        const entrySrc = readFileSync(join(kwinSrcDir(), "plan-adapter-entry.ts"), "utf8");
        assert.ok(!entrySrc.includes("workspace-"), "no workspace shortcut ids");
        assert.ok(!/Meta\+\$\{(index|digit|n)\}/.test(entrySrc), "no digit sequence template");
    });

    it("observes only normal windows with normalized bare UUID ids", () => {
        const world = fakeWorld();
        world.wins.push({
            normalWindow: false,
            internalId: "dock-1",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 50, height: 50 },
            moveResizedChanged: fakeSignal().signal,
        });
        world.wins.push({
            normalWindow: true,
            internalId: "{12345678-1234-1234-1234-1234567890ab}",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 10, height: 10 },
            moveResizedChanged: fakeSignal().signal,
            fullScreen: false,
        });
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("right");
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        const ids = (payload["windows"] as Array<Record<string, unknown>>).map((entry) => entry["window"]);
        assert.deepEqual(ids, ["win-a", "win-b", "12345678-1234-1234-1234-1234567890ab"]);
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
        assert.equal(attempts.length, 24);
        assert.ok(attempts.includes("plasma-auto-tiler-focus-right-arrow"));
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

    it("subscribes fullScreenChanged per window after enable and for windows added later", () => {
        const world = fakeWorld();
        const winA = world.wins[0] as object;
        const winB = world.wins[1] as object;
        const { handle } = startEntry(world);
        assert.ok(handle !== null);
        assert.equal(world.winFull.get(winA)?.handlers.length, 1, "existing window subscribed on enable");
        assert.equal(world.winFull.get(winB)?.handlers.length, 1, "existing window subscribed on enable");
        const winCFull = fakeSignal();
        const winC = {
            normalWindow: true,
            internalId: "win-c",
            output: world.output,
            desktops: [world.desktop],
            frameGeometry: { x: 0, y: 0, width: 600, height: 800 },
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: winCFull.signal,
            fullScreen: false,
        };
        world.wins.push(winC);
        world.winFull.set(winC, winCFull);
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
        assert.ok(src.includes("lastGood: PlanSnapshot | null"), "snapshot-typed baseline");
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
        },
        bounds: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1200, h: 800 },
    ): PlanObserved {
        const focused = opts.focused ?? refs.a;
        const isFullscreen = (id: string): boolean => opts.fullscreen?.[id] === true;
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
                    line === "plasma-auto-tiler:plan:write window=win-c disposition=skip-fullscreen rect=800,0,400,800",
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
