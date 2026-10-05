import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PlanAdapter,
    PlanAdapterEnv,
    PlanDirection,
    PlanObserved,
    PlanObservedWindow,
    floatHalfSnapRect,
} from "../src/plan-adapter";

function refs() {
    return { f: {}, g: {} };
}

function moveObserved(
    r: Record<string, object>,
    opts: {
        bounds?: { x: number; y: number; w: number; h: number };
        gap?: number;
        subject?: { floating?: boolean; sticky?: boolean; fullscreen?: boolean; maximized?: boolean };
        revalidate?: () => boolean;
    } = {},
): PlanObserved {
    const s = opts.subject ?? { floating: true };
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-a",
        domainBounds: opts.bounds ?? { x: 0, y: 0, w: 2560, h: 1440 },
        domainGap: opts.gap ?? 0,
        domainOuterGap: 8,
        focusedId: "win-f",
        activeExcluded: true,
        windows: Object.freeze([
            Object.freeze({
                id: "win-f",
                ref: r["f"] as object,
                rect: Object.freeze({ x: 100, y: 100, w: 300, h: 200 }),
                output: "out-1",
                workspace: "ws-a",
                fullscreen: s.fullscreen ?? false,
                maximized: s.maximized ?? false,
                floating: s.floating,
                sticky: s.sticky,
                resourceClass: "unknown",
            }) as PlanObservedWindow,
        ]),
        activeRef: r["f"] as object,
        fingerprint: "move-fp-1",
        revalidate: opts.revalidate ?? (() => true),
    };
}

interface MoveMocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly logs: string[];
    readonly actives: object[];
    readonly geometries: Array<{ target: object; rect: unknown }>;
    observeImpl: () => PlanObserved | null;
    activeImpl: () => object | null;
    setActiveImpl: (target: object) => boolean;
    setGeometryImpl: (target: object, rect: unknown) => boolean;
    readConstraintsImpl: ((ref: object) => unknown) | null;
    interactiveImpl: () => boolean;
    tiledImpl: () => boolean;
    env: PlanAdapterEnv;
}

function mockMoveEnv(r: Record<string, object>, observed: PlanObserved): MoveMocks {
    const state = {
        dbusCalls: [],
        logs: [],
        actives: [],
        geometries: [],
        observeImpl: (): PlanObserved | null => observed,
        activeImpl: (): object | null => observed.activeRef,
        setActiveImpl: (_target: object): boolean => true,
        setGeometryImpl: (_target: object, _rect: unknown): boolean => true,
        readConstraintsImpl: null,
        interactiveImpl: (): boolean => false,
        tiledImpl: (): boolean => true,
    } as unknown as MoveMocks;
    const env: PlanAdapterEnv = {
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
            state.dbusCalls.push({ method, payload });
            void callback;
        },
        scheduleOnce: (_delayMs: number, _callback: () => void): (() => void) => (): void => {},
        log: (message: string): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target: object, rect: { x: number; y: number; w: number; h: number }): boolean => {
            state.geometries.push({ target, rect });
            return state.setGeometryImpl(target, rect);
        },
        setActive: (target: object): boolean => {
            state.actives.push(target);
            return state.setActiveImpl(target);
        },
        active: (): object | null => state.activeImpl(),
        subscribe: (_kind: unknown, _handler: unknown): (() => void) => (): void => {},
        isDomainTiled: (): boolean => state.tiledImpl(),
        isInteractiveResizeActive: (): boolean => state.interactiveImpl(),
        readWindowConstraints: (ref: object): unknown => {
            if (state.readConstraintsImpl === null) {
                return null;
            }
            return state.readConstraintsImpl(ref);
        },
    } as unknown as PlanAdapterEnv;
    (state as { env: PlanAdapterEnv }).env = env;
    void r;
    return state;
}

function enable(mocks: MoveMocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

describe("floatHalfSnapRect COSMIC arithmetic", () => {
    it("zero-gap 2560x1440 right is the exact half", () => {
        assert.deepEqual(floatHalfSnapRect({ x: 0, y: 0, w: 2560, h: 1440 }, 0, "right"), {
            x: 1280,
            y: 0,
            w: 1280,
            h: 1440,
        });
    });

    it("covers all four directions with zero gap", () => {
        assert.deepEqual(floatHalfSnapRect({ x: 0, y: 0, w: 2560, h: 1440 }, 0, "left"), {
            x: 0,
            y: 0,
            w: 1280,
            h: 1440,
        });
        assert.deepEqual(floatHalfSnapRect({ x: 0, y: 0, w: 2560, h: 1440 }, 0, "up"), {
            x: 0,
            y: 0,
            w: 2560,
            h: 720,
        });
        assert.deepEqual(floatHalfSnapRect({ x: 0, y: 0, w: 2560, h: 1440 }, 0, "down"), {
            x: 0,
            y: 720,
            w: 2560,
            h: 720,
        });
    });

    it("odd sizes use trunc division exactly", () => {
        // W=1001: halfW=500; inner=7: halfInner=3, threeHalf=10.
        // Right x=0+500+3=503, w=500-10=490; h=501-14=487 for H=501.
        assert.deepEqual(floatHalfSnapRect({ x: 0, y: 0, w: 1001, h: 501 }, 7, "right"), {
            x: 503,
            y: 7,
            w: 490,
            h: 487,
        });
        assert.deepEqual(floatHalfSnapRect({ x: 0, y: 0, w: 1001, h: 501 }, 7, "left"), {
            x: 7,
            y: 7,
            w: 490,
            h: 487,
        });
        assert.deepEqual(floatHalfSnapRect({ x: 10, y: 20, w: 1001, h: 501 }, 7, "down"), {
            x: 17,
            y: 20 + 250 + 3,
            w: 1001 - 14,
            h: 250 - 10,
        });
    });

    it("ignores outer gap and offsets by global origin", () => {
        // Outer gap must not shift the result; global origin offsets all.
        const rect = floatHalfSnapRect({ x: 800, y: 100, w: 800, h: 600 }, 4, "right");
        assert.deepEqual(rect, { x: 800 + 400 + 2, y: 104, w: 400 - 6, h: 600 - 8 });
    });

    it("rejects nonpositive output rectangles", () => {
        // Tiny work area with a large inner gap goes nonpositive.
        assert.equal(floatHalfSnapRect({ x: 0, y: 0, w: 10, h: 10 }, 8, "right"), null);
        assert.equal(floatHalfSnapRect({ x: 0, y: 0, w: 0, h: 600 }, 0, "left"), null);
    });
});

describe("plan adapter float-origin move", () => {
    it("snaps right with one geometry write and no dispatch", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.geometries[0]?.target, r["f"]);
        assert.deepEqual(mocks.geometries[0]?.rect, { x: 1280, y: 0, w: 1280, h: 1440 });
        assert.ok(mocks.logs.some((line) => line.includes("move-float-applied direction=right")));
        // Focus retention: already active, so no setActive steal.
        assert.equal(mocks.actives.length, 0);
    });

    it("snaps all four directions", () => {
        const cases: Array<{ direction: PlanDirection; rect: unknown }> = [
            { direction: "left", rect: { x: 0, y: 0, w: 1280, h: 1440 } },
            { direction: "right", rect: { x: 1280, y: 0, w: 1280, h: 1440 } },
            { direction: "up", rect: { x: 0, y: 0, w: 2560, h: 720 } },
            { direction: "down", rect: { x: 0, y: 720, w: 2560, h: 720 } },
        ];
        for (const entry of cases) {
            const r = refs();
            const mocks = mockMoveEnv(r, moveObserved(r));
            const adapter = enable(mocks);
            adapter.requestMove(entry.direction);
            assert.equal(mocks.geometries.length, 1);
            assert.deepEqual(mocks.geometries[0]?.rect, entry.rect);
        }
    });

    it("snaps sticky subjects the same as ordinary floats", () => {
        const r = refs();
        const mocks = mockMoveEnv(
            r,
            moveObserved(r, { subject: { sticky: true, floating: true } }),
        );
        const adapter = enable(mocks);
        adapter.requestMove("left");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.deepEqual(mocks.geometries[0]?.rect, { x: 0, y: 0, w: 1280, h: 1440 });
        assert.ok(mocks.logs.some((line) => line.includes("move-float-applied direction=left")));
    });

    it("repeated arrows request the half again, never advancing", () => {
        const r = refs();
        let current = moveObserved(r);
        const mocks = mockMoveEnv(r, current);
        (mocks as { observeImpl: () => PlanObserved | null }).observeImpl = () => current;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const first = mocks.geometries[0]?.rect;
        // Follow-up reconcile state: subject still excluded and focused on the snapped rect.
        current = {
            ...current,
            windows: Object.freeze([
                Object.freeze({
                    ...(current.windows[0] as object),
                    rect: Object.freeze(first as { x: number; y: number; w: number; h: number }),
                }),
            ]),
        } as PlanObserved;
        adapter.requestMove("right");
        adapter.requestMove("left");
        assert.equal(mocks.geometries.length, 3);
        assert.deepEqual(mocks.geometries[1]?.rect, first);
        assert.deepEqual(mocks.geometries[2]?.rect, { x: 0, y: 0, w: 1280, h: 1440 });
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("refuses stale revalidation before any write", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r, { revalidate: () => false }));
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-refused-stale")));
    });

    it("refuses when the active identity moved", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        mocks.activeImpl = () => ({} as object);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-refused-stale")));
    });

    it("refuses overlay subjects without clearing state", () => {
        for (const subject of [{ fullscreen: true, floating: true }, { maximized: true, floating: true }]) {
            const r = refs();
            const mocks = mockMoveEnv(r, moveObserved(r, { subject }));
            const adapter = enable(mocks);
            adapter.requestMove("right");
            assert.equal(mocks.geometries.length, 0);
            assert.equal(mocks.dbusCalls.length, 0);
        }
    });

    it("refuses a tiled subject claiming exclusion", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r, { subject: {} }));
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-floating")));
    });

    it("reports write failure without retry", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        mocks.setGeometryImpl = () => false;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 1);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-write-failed")));
    });

    it("refuses invalid geometry from a tiny work area", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r, { bounds: { x: 0, y: 0, w: 10, h: 10 }, gap: 8 }));
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-refused-invalid-geometry")));
    });

    it("refuses while busy without writing", () => {
        const r = refs();
        const tiled: PlanObserved = {
            domainOutput: "out-1",
            domainWorkspace: "ws-a",
            domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
            domainGap: 0,
            domainOuterGap: 0,
            focusedId: "win-a",
            activeExcluded: false,
            windows: Object.freeze([
                Object.freeze({
                    id: "win-a",
                    ref: r["f"] as object,
                    rect: Object.freeze({ x: 0, y: 0, w: 600, h: 800 }),
                    output: "out-1",
                    workspace: "ws-a",
                    fullscreen: false,
                    maximized: false,
                    resourceClass: "unknown",
                }),
            ]),
            activeRef: r["f"] as object,
            fingerprint: "tile-fp-1",
            revalidate: () => true,
        };
        const mocks = mockMoveEnv(r, tiled);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        // Flip to a float subject while the tile flight holds the single flight.
        mocks.observeImpl = () => moveObserved(r);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("busy-refused kind=move")));
    });

    it("refuses client size-hint rejection with one write only", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        mocks.readConstraintsImpl = () => ({ resizeable: false, minSize: null, maxSize: null });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-refused-constraints")));
    });

    it("refuses when the domain is not tiled with no geometry or dispatch", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        mocks.tiledImpl = () => false;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-workspace-floating")));
    });

    it("refuses a min size larger than the half with no write", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        mocks.readConstraintsImpl = () => ({ resizeable: true, minSize: { w: 2000, h: 100 }, maxSize: null });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-refused-constraints")));
    });

    it("refuses a max size smaller than the half with no write", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        mocks.readConstraintsImpl = () => ({ resizeable: true, minSize: null, maxSize: { w: 100, h: 100 } });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-refused-constraints")));
    });

    it("reports a distinct token when focus retention fails after the write", () => {
        const r = refs();
        const mocks = mockMoveEnv(r, moveObserved(r));
        let calls = 0;
        mocks.activeImpl = () => {
            calls += 1;
            return calls === 1 ? (r["f"] as object) : ({} as object);
        };
        mocks.setActiveImpl = () => false;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-float-focus-failed direction=right")));
    });

    it("keeps tile-origin move dispatch byte-identical", () => {
        const r = refs();
        const tiled: PlanObserved = {
            domainOutput: "out-1",
            domainWorkspace: "ws-a",
            domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
            domainGap: 0,
            domainOuterGap: 0,
            focusedId: "win-a",
            activeExcluded: false,
            windows: Object.freeze([
                Object.freeze({
                    id: "win-a",
                    ref: r["f"] as object,
                    rect: Object.freeze({ x: 0, y: 0, w: 600, h: 800 }),
                    output: "out-1",
                    workspace: "ws-a",
                    fullscreen: false,
                    maximized: false,
                    resourceClass: "unknown",
                }),
            ]),
            activeRef: r["f"] as object,
            fingerprint: "tile-fp-1",
            revalidate: () => true,
        };
        const mocks = mockMoveEnv(r, tiled);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.dbusCalls.length, 1);
    });
});
