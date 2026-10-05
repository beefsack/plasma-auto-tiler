import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PlanAdapter,
    PlanAdapterEnv,
    PlanDirection,
    PlanObserved,
    PlanObservedWindow,
    DirectionalObservation,
    selectFloatFocusTarget,
} from "../src/plan-adapter";

function refs() {
    return { f: {}, g: {}, s: {}, a: {}, b: {}, x: {} };
}

interface FloatEntry {
    readonly id: string;
    readonly ref: object;
    readonly x: number;
    readonly y: number;
    readonly floating?: boolean;
    readonly sticky?: boolean;
    readonly output?: string;
    readonly workspace?: string;
}

function floatObserved(
    r: Record<string, object>,
    opts: {
        subject?: FloatEntry;
        extra?: FloatEntry[];
        tiles?: FloatEntry[];
        directional?: boolean;
        focused?: object;
        revalidate?: () => boolean;
    } = {},
): PlanObserved {
    const subject: FloatEntry = opts.subject ?? { id: "win-f", ref: r["f"] as object, x: 500, y: 500, floating: true };
    const entries: PlanObservedWindow[] = [];
    const push = (entry: FloatEntry): void => {
        entries.push(
            Object.freeze({
                id: entry.id,
                ref: entry.ref,
                rect: Object.freeze({ x: entry.x, y: entry.y, w: 300, h: 200 }),
                output: entry.output ?? "out-1",
                workspace: entry.workspace ?? "ws-a",
                fullscreen: false,
                maximized: false,
                floating: entry.floating,
                sticky: entry.sticky,
                resourceClass: "unknown",
            }) as PlanObservedWindow,
        );
    };
    push(subject);
    for (const entry of opts.extra ?? []) {
        push(entry);
    }
    for (const entry of opts.tiles ?? []) {
        push({ ...entry, floating: false, sticky: false });
    }
    // Target tile on the adjacent output for cross-fallback tests.
    if (opts.directional === true) {
        entries.push(
            Object.freeze({
                id: "win-x",
                ref: r["x"] as object,
                rect: Object.freeze({ x: 10, y: 10, w: 100, h: 80 }),
                output: "out-2",
                workspace: "ws-b",
                fullscreen: false,
                maximized: false,
                floating: false,
                sticky: false,
                resourceClass: "unknown",
            }) as PlanObservedWindow,
        );
    }
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-a",
        domainBounds: { x: 0, y: 0, w: 800, h: 600 },
        domainGap: 4,
        domainOuterGap: 8,
        focusedId: subject.id,
        activeExcluded: true,
        ...(opts.directional === true
            ? {
                  domains: Object.freeze([
                      Object.freeze({
                          output: "out-1",
                          workspace: "ws-a",
                          bounds: { x: 0, y: 0, w: 800, h: 600 },
                          gap: 4,
                          outerGap: 8,
                          adjacent: Object.freeze({ right: "out-2" }),
                      }),
                      Object.freeze({
                          output: "out-2",
                          workspace: "ws-b",
                          bounds: { x: 800, y: 0, w: 800, h: 600 },
                          gap: 4,
                          outerGap: 8,
                          adjacent: Object.freeze({ left: "out-1" }),
                      }),
                  ]),
              }
            : {}),
        windows: Object.freeze(entries),
        activeRef: opts.focused ?? (subject.ref as object),
        fingerprint: "float-fp-1",
        revalidate: opts.revalidate ?? (() => true),
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly actives: object[];
    readonly geometries: Array<{ target: object; rect: unknown }>;
    directionalImpl: (direction: PlanDirection) => DirectionalObservation | PlanObserved | null;
    observeImpl: () => PlanObserved | null;
    activeImpl: () => object | null;
    setActiveImpl: (target: object) => boolean;
    env: PlanAdapterEnv;
}

function mockEnv(r: Record<string, object>, observed: PlanObserved): Mocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        logs: [],
        actives: [],
        geometries: [],
        directionalImpl: (_direction: PlanDirection): DirectionalObservation | PlanObserved | null => ({
            status: "no-target",
            observed: null,
        }),
        observeImpl: (): PlanObserved | null => observed,
        activeImpl: (): object | null => observed.activeRef,
        setActiveImpl: (_target: object): boolean => true,
    } as unknown as Mocks;
    const env: PlanAdapterEnv = {
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
            state.dbusCalls.push({ method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (_delayMs, _callback): (() => void) => (): void => {},
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        observeDirectional: (direction): DirectionalObservation | PlanObserved | null =>
            state.directionalImpl(direction),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect });
            return true;
        },
        setActive: (target): boolean => {
            state.actives.push(target);
            return state.setActiveImpl(target);
        },
        active: (): object | null => state.activeImpl(),
        subscribe: (_kind, _handler): (() => void) => (): void => {},
    };
    (state as { env: PlanAdapterEnv }).env = env;
    void r;
    return state;
}

function enable(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function payload(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function floatCrossReply(correlation: string, fromWindow: string, includeSourceTile = false): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "focus", capability: "directional-focus", direction: "right", to_window: "win-x", cross_output: true },
        desired_geometry: [
            ...(includeSourceTile
                ? [{ window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 380, h: 580 } }]
                : []),
            { window: "win-x", leaf: "leaf-x", output: "out-2", workspace: "ws-b", rect: { x: 10, y: 10, w: 100, h: 80 } },
        ],
        desired_focus: { domain_output: "out-2", domain_workspace: "ws-b", leaf: "leaf-x" },
        operation: {
            op: "focus",
            domain_output: "out-2",
            domain_workspace: "ws-b",
            from_leaf: null,
            to_leaf: "leaf-x",
            from_window: fromWindow,
            to_window: "win-x",
            direction: "right",
            route: ["leaf-x"],
            cross_source_output: "out-1",
            cross_source_workspace: "ws-a",
        },
        preconditions: [
            "focused-floating-window",
            "target-leaf-occupied",
            "focus-targets-adjacent-output",
            "adapter-must-verify-postconditions",
        ],
    });
}

function tileCrossReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "focus", capability: "directional-focus", direction: "right", to_window: "win-x", cross_output: true },
        desired_geometry: [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 380, h: 580 } },
            { window: "win-x", leaf: "leaf-x", output: "out-2", workspace: "ws-b", rect: { x: 10, y: 10, w: 100, h: 80 } },
        ],
        desired_focus: { domain_output: "out-2", domain_workspace: "ws-b", leaf: "leaf-x" },
        operation: {
            op: "focus",
            domain_output: "out-2",
            domain_workspace: "ws-b",
            from_leaf: "leaf-a",
            to_leaf: "leaf-x",
            from_window: "win-a",
            to_window: "win-x",
            direction: "right",
            route: ["leaf-x"],
            cross_source_output: "out-1",
            cross_source_workspace: "ws-a",
        },
        preconditions: [
            "focused-leaf-occupied-by-focused-window",
            "target-leaf-occupied",
            "focus-targets-adjacent-output",
            "adapter-must-verify-postconditions",
        ],
    });
}

describe("selectFloatFocusTarget (COSMIC top-left axis rule)", () => {
    it("right selects the nearest positive x delta, tiles excluded", () => {
        const r = refs();
        const observed = floatObserved(r, {
            extra: [{ id: "win-g", ref: r["g"] as object, x: 1800, y: 500, floating: true }],
            tiles: [{ id: "win-b", ref: r["b"] as object, x: 600, y: 500 }],
        });
        const target = selectFloatFocusTarget(observed, "right");
        assert.equal(target?.id, "win-g");
    });

    it("left admits equal deltas and keeps the first nearest tie", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 1000, y: 500, floating: true },
            extra: [
                { id: "win-g1", ref: r["g"] as object, x: 900, y: 0, floating: true },
                { id: "win-g2", ref: r["s"] as object, x: 1000, y: 900, floating: true },
            ],
        });
        // g1 delta -100 beats g2 delta 0? No: 0 is nearer, so g2 (equal) wins.
        assert.equal(selectFloatFocusTarget(observed, "left")?.id, "win-g2");
    });

    it("left keeps the first of two equidistant candidates", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 1000, y: 500, floating: true },
            extra: [
                { id: "win-g1", ref: r["g"] as object, x: 900, y: 0, floating: true },
                { id: "win-g2", ref: r["s"] as object, x: 900, y: 900, floating: true },
            ],
        });
        assert.equal(selectFloatFocusTarget(observed, "left")?.id, "win-g1");
    });

    it("right keeps the last of two equidistant candidates", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 500, y: 500, floating: true },
            extra: [
                { id: "win-g1", ref: r["g"] as object, x: 600, y: 0, floating: true },
                { id: "win-g2", ref: r["s"] as object, x: 600, y: 900, floating: true },
            ],
        });
        assert.equal(selectFloatFocusTarget(observed, "right")?.id, "win-g2");
    });

    it("down requires strictly positive deltas", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 500, y: 500, floating: true },
            extra: [{ id: "win-g", ref: r["g"] as object, x: 900, y: 500, floating: true }],
        });
        assert.equal(selectFloatFocusTarget(observed, "down"), null);
    });

    it("up selects candidates above on the y axis only", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 500, y: 500, floating: true },
            extra: [
                { id: "win-near", ref: r["g"] as object, x: 0, y: 400, floating: true },
                { id: "win-far", ref: r["s"] as object, x: 500, y: 100, floating: true },
            ],
        });
        assert.equal(selectFloatFocusTarget(observed, "up")?.id, "win-near");
    });

    it("sticky layer wins cross-layer ties on the left, loses them on the right", () => {
        const r = refs();
        const left = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 1000, y: 500, floating: true },
            extra: [
                { id: "win-ord", ref: r["g"] as object, x: 900, y: 0, floating: true },
                { id: "win-sticky", ref: r["s"] as object, x: 900, y: 900, sticky: true, floating: true },
            ],
        });
        assert.equal(selectFloatFocusTarget(left, "left")?.id, "win-sticky");
        const right = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 500, y: 500, floating: true },
            extra: [
                { id: "win-ord", ref: r["g"] as object, x: 600, y: 0, floating: true },
                { id: "win-sticky", ref: r["s"] as object, x: 600, y: 900, sticky: true, floating: true },
            ],
        });
        assert.equal(selectFloatFocusTarget(right, "right")?.id, "win-ord");
    });

    it("sticky subjects search the same shared layer", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 500, y: 500, sticky: true, floating: true },
            extra: [{ id: "win-g", ref: r["g"] as object, x: 700, y: 500, floating: true }],
        });
        assert.equal(selectFloatFocusTarget(observed, "right")?.id, "win-g");
    });

    it("other-domain floats are never candidates", () => {
        const r = refs();
        const observed = floatObserved(r, {
            extra: [{ id: "win-g", ref: r["g"] as object, x: 700, y: 500, floating: true, output: "out-2", workspace: "ws-b" }],
        });
        assert.equal(selectFloatFocusTarget(observed, "right"), null);
    });

    it("non-floating subjects have no local target", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-f", ref: r["f"] as object, x: 500, y: 500 },
            extra: [{ id: "win-g", ref: r["g"] as object, x: 700, y: 500, floating: true }],
        });
        assert.equal(selectFloatFocusTarget(observed, "right"), null);
    });
});

describe("plan adapter float-origin focus", () => {
    it("focuses the local float with one setActive and no dispatch", () => {
        const r = refs();
        const observed = floatObserved(r, {
            extra: [
                { id: "win-g", ref: r["g"] as object, x: 1800, y: 500, floating: true },
                { id: "win-t", ref: r["a"] as object, x: 0, y: 0 },
            ],
            tiles: [{ id: "win-b", ref: r["b"] as object, x: 600, y: 500 }],
        });
        const mocks = mockEnv(r, observed);
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r["g"]);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-float-applied direction=right")));
    });

    it("retains a lone float on right with no adjacent output", () => {
        const r = refs();
        const mocks = mockEnv(r, floatObserved(r));
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-float-retained direction=right")));
    });

    it("retains on up miss even with a directional target present", () => {
        const r = refs();
        const observed = floatObserved(r, { directional: true });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("up");
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-float-retained direction=up")));
    });

    it("refuses before actuation when revalidation fails", () => {
        const r = refs();
        const observed = floatObserved(r, {
            extra: [{ id: "win-g", ref: r["g"] as object, x: 700, y: 500, floating: true }],
            revalidate: () => false,
        });
        const mocks = mockEnv(r, observed);
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-float-refused-stale")));
    });

    it("refuses before actuation when the active identity moved", () => {
        const r = refs();
        const observed = floatObserved(r, {
            extra: [{ id: "win-g", ref: r["g"] as object, x: 700, y: 500, floating: true }],
        });
        const mocks = mockEnv(r, observed);
        mocks.activeImpl = () => r["a"];
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-float-refused-stale")));
    });

    it("reports a write failure when setActive refuses", () => {
        const r = refs();
        const observed = floatObserved(r, {
            extra: [{ id: "win-g", ref: r["g"] as object, x: 700, y: 500, floating: true }],
        });
        const mocks = mockEnv(r, observed);
        mocks.setActiveImpl = () => false;
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-float-write-failed")));
    });

    it("dispatches a float_subject cross fallback on left/right miss with adjacency", () => {
        const r = refs();
        const observed = floatObserved(r, { directional: true });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        assert.equal((body["command"] as Record<string, unknown>)["float_subject"], true);
        assert.equal((body["command"] as Record<string, unknown>)["window"], "win-f");
        assert.equal((body["domains"] as Array<unknown>).length, 2);
    });

    it("actuates the remembered tile through the cross fallback fences", () => {
        const r = refs();
        const observed = floatObserved(r, { directional: true });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(floatCrossReply(body["correlation_id"] as string, "win-f"));
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r["x"]);
        assert.ok(mocks.logs.some((line) => line.includes("planned-applied")));
    });

    it("refuses the cross fallback when the reply names another source window", () => {
        const r = refs();
        const observed = floatObserved(r, { directional: true });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(floatCrossReply(body["correlation_id"] as string, "win-other"));
        assert.equal(mocks.actives.length, 0);
    });

    it("keeps tile-origin focus dispatch free of float_subject", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-a", ref: r["a"] as object, x: 10, y: 10 },
            tiles: [{ id: "win-b", ref: r["b"] as object, x: 400, y: 10 }],
            directional: true,
        });
        const tiled = { ...observed, focusedId: "win-a", activeExcluded: false };
        const mocks = mockEnv(r, tiled);
        mocks.directionalImpl = () => ({ status: "ready", observed: tiled });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        assert.ok(!("float_subject" in (body["command"] as Record<string, unknown>)));
    });

    it("refuses a second float focus while a flight is in flight", () => {
        const r = refs();
        const observed = floatObserved(r, { directional: true });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.ok(mocks.logs.some((line) => line.includes("busy-refused kind=focus")));
    });

    it("crosses leafless from a mixed source without borrowing a tile leaf", () => {
        const r = refs();
        const observed = floatObserved(r, {
            directional: true,
            tiles: [{ id: "win-a", ref: r["a"] as object, x: 10, y: 10 }],
        });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(floatCrossReply(body["correlation_id"] as string, "win-f", true));
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r["x"]);
        assert.ok(mocks.logs.some((line) => line.includes("planned-applied")));
    });

    it("refuses a float-token reply carrying a tile from_leaf", () => {
        const r = refs();
        const observed = floatObserved(r, { directional: true });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        const reply = JSON.parse(floatCrossReply(body["correlation_id"] as string, "win-f")) as Record<string, unknown>;
        // A from_leaf string with the floating-subject token is malformed.
        (reply["operation"] as Record<string, unknown>)["from_leaf"] = "leaf-a";
        mocks.callbacks[0]?.(JSON.stringify(reply));
        assert.equal(mocks.actives.length, 0);
    });

    it("refuses an ineligible subject before any search or dispatch", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-a", ref: r["a"] as object, x: 10, y: 10 },
            tiles: [{ id: "win-b", ref: r["b"] as object, x: 400, y: 10 }],
            directional: true,
        });
        // Active claims exclusion but the focused entry is tiled.
        const mismatched = { ...observed, focusedId: "win-a", activeExcluded: true };
        const mocks = mockEnv(r, mismatched);
        mocks.directionalImpl = () => ({ status: "ready", observed: mismatched });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-refused-floating")));
    });

    it("actuates the tile on tile-origin cross while floats stay untouched", () => {
        const r = refs();
        const observed = floatObserved(r, {
            subject: { id: "win-a", ref: r["a"] as object, x: 10, y: 10 },
            extra: [{ id: "win-f", ref: r["f"] as object, x: 500, y: 500, floating: true }],
            directional: true,
        });
        const tiled = { ...observed, focusedId: "win-a", activeExcluded: false };
        const mocks = mockEnv(r, tiled);
        mocks.directionalImpl = () => ({ status: "ready", observed: tiled });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(tileCrossReply(body["correlation_id"] as string));
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r["x"]);
        assert.ok(mocks.logs.some((line) => line.includes("planned-applied")));
    });

    it("refuses the cross fallback when the target vanishes mid-flight", () => {
        const r = refs();
        const observed = floatObserved(r, { directional: true });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        // Fresh evidence loses the remembered target before apply.
        mocks.directionalImpl = () => ({
            status: "ready",
            observed: {
                ...observed,
                windows: Object.freeze(observed.windows.filter((entry) => entry.id !== "win-x")),
            },
        });
        mocks.callbacks[0]?.(floatCrossReply(body["correlation_id"] as string, "win-f"));
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.geometries.length, 0);
    });

    it("refuses a local plan on a float flight without actuating source focus", () => {
        const r = refs();
        const observed = floatObserved(r, {
            directional: true,
            tiles: [{ id: "win-a", ref: r["a"] as object, x: 10, y: 10 }],
        });
        const mocks = mockEnv(r, observed);
        mocks.directionalImpl = () => ({ status: "ready", observed });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: body["correlation_id"],
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "focus", capability: "directional-focus", direction: "right", to_window: "win-a" },
                desired_geometry: [
                    { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 380, h: 580 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-a", leaf: "leaf-a" },
            }),
        );
        assert.equal(mocks.actives.length, 0);
    });
});
