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
        fingerprint?: string;
        revalidate?: () => boolean;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const rect = (id: string): { x: number; y: number; w: number; h: number } =>
        opts.rects?.[id] ?? { x: 0, y: 0, w: 100, h: 100 };
    const windows = Object.freeze([
        Object.freeze({ id: "win-a", ref: refs.a, rect: rect("win-a"), output: "out-1", workspace: "ws-1" }),
        Object.freeze({ id: "win-b", ref: refs.b, rect: rect("win-b"), output: "out-1", workspace: "ws-1" }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: 0,
        domainOuterGap: 0,
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
            gap: 0,
            outer_gap: 0,
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

    it("coalesces busy shortcut commands silently with one in flight", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("left");
        const logsBefore = mocks.logs.length;
        adapter.requestMove("right");
        adapter.requestResize("left", "outwards");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.logs.length, logsBefore);
    });

    it("drives admit and remove from debounced membership diffs", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let ids: string[] = ["win-a", "win-b"];
        const byId: Record<string, object> = { "win-a": refs.a, "win-b": refs.b, "win-c": refs.c };
        mocks.observeImpl = (): PlanObserved | null => {
            const wins = ids.map((id) =>
                Object.freeze({ id, ref: byId[id] as object, rect: { x: 0, y: 0, w: 100, h: 100 }, output: "out-1", workspace: "ws-1" }),
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
});

describe("plan adapter bounded diagnostics", () => {
    it("emits only the two redacted line shapes with no identity echo", () => {
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
        assert.ok(mocks.logs.length >= 3);
        for (const line of mocks.logs) {
            assert.match(
                line,
                /^plasma-auto-tiler:plan:(cmd=\S+ kind=(admit|remove|move|focus|resize) windows=\d+ outcome=\S+|rejected kind=[a-z-]+)$/,
                line,
            );
            assert.ok(!line.includes("win-a"), line);
            assert.ok(!line.includes("win-b"), line);
            assert.ok(!line.includes("win-c"), line);
            assert.ok(!line.includes("owner-1"), line);
        }
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
}

function fakeWorld(): FakeWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const added = fakeSignal();
    const removed = fakeSignal();
    const activated = fakeSignal();
    const screensChanged = fakeSignal();
    const desktopChanged = fakeSignal();
    const world: FakeWorld = {
        output,
        desktop,
        added,
        wins: [],
        workspace: {},
    };
    const makeWin = (id: string, x: number): Record<string, unknown> => {
        const geo = fakeSignal();
        return {
            normalWindow: true,
            internalId: id,
            output,
            desktops: [desktop],
            frameGeometry: { x, y: 0, width: 600, height: 800 },
            moveResizedChanged: geo.signal,
        };
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
        assert.deepEqual(payload["command"], { op: "focus", window: "w-1", direction: "left" });
        const windows = payload["windows"] as Array<Record<string, unknown>>;
        assert.deepEqual(
            windows.map((entry) => entry["window"]),
            ["w-1", "w-2"],
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
        assert.deepEqual(letterPayload["command"], { op: "move", window: "w-1", direction: "left" });
        first.handle?.stop();
        const second = startEntry(fakeWorld());
        assert.ok(second.handle !== null);
        const arrow = second.mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-move-right-arrow") as {
            callback: () => void;
        };
        arrow.callback();
        const arrowPayload = JSON.parse(second.mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(arrowPayload["command"], { op: "move", window: "w-1", direction: "right" });
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

    it("observes only normal windows with stable opaque ids", () => {
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
        });
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null);
        handle?.requestFocus("right");
        const payload = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        const ids = (payload["windows"] as Array<Record<string, unknown>>).map((entry) => entry["window"]);
        assert.deepEqual(ids, ["w-1", "w-2", "w-3"]);
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
});
