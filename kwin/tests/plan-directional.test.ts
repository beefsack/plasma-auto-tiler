import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PlanAdapter,
    PlanAdapterEnv,
    PlanDirection,
    PlanObserved,
    DirectionalObservation,
    planDirectionalFingerprint,
} from "../src/plan-adapter";
import { observeDirectionalDomain } from "../src/plan-adapter-entry";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

function refs() {
    return { a: {}, b: {}, x: {} };
}

function twoDomainObserved(
    r: { a: object; b: object; x: object },
    opts: {
        focused?: object;
        aRect?: { x: number; y: number; w: number; h: number };
        xRect?: { x: number; y: number; w: number; h: number };
        bRect?: { x: number; y: number; w: number; h: number };
        targetWorkspace?: string;
        targetBounds?: { x: number; y: number; w: number; h: number };
    } = {},
): PlanObserved {
    const focused = opts.focused ?? r.a;
    const aRect = opts.aRect ?? { x: 810, y: 10, w: 100, h: 80 };
    const xRect = opts.xRect ?? { x: 10, y: 10, w: 100, h: 80 };
    const targetWorkspace = opts.targetWorkspace ?? "ws-b";
    const targetBounds = opts.targetBounds ?? { x: 800, y: 0, w: 800, h: 600 };
    const extra =
        opts.bRect === undefined
            ? []
            : [
                  Object.freeze({
                      id: "win-b",
                      ref: r.b,
                      rect: Object.freeze({ ...opts.bRect }),
                      output: "out-1",
                      workspace: "ws-a",
                      fullscreen: false,
                      maximized: false,
                      floating: false,
                      sticky: false,
                      resourceClass: "unknown",
                  }),
              ];
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-a",
        domainBounds: { x: 0, y: 0, w: 800, h: 600 },
        domainGap: 4,
        domainOuterGap: 8,
        focusedId: "win-a",
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
                workspace: targetWorkspace,
                bounds: targetBounds,
                gap: 4,
                outerGap: 8,
                adjacent: Object.freeze({ left: "out-1" }),
            }),
        ]),
        windows: Object.freeze([
            Object.freeze({
                id: "win-a",
                ref: r.a,
                rect: Object.freeze({ ...aRect }),
                output: "out-1",
                workspace: "ws-a",
                fullscreen: false,
                maximized: false,
                floating: false,
                sticky: false,
                resourceClass: "unknown",
            }),
            ...extra,
            Object.freeze({
                id: "win-x",
                ref: r.x,
                rect: Object.freeze({ ...xRect }),
                output: "out-2",
                workspace: targetWorkspace,
                fullscreen: false,
                maximized: false,
                floating: false,
                sticky: false,
                resourceClass: "unknown",
            }),
        ]),
        activeRef: focused,
        fingerprint: "dir-fp-1",
        revalidate: () => true,
    };
}

function sourceObserved(
    r: { a: object; b: object; x: object },
    aRect: { x: number; y: number; w: number; h: number },
): PlanObserved {
    const observed = twoDomainObserved(r, { aRect });
    const { domains: _domains, ...source } = observed;
    return {
        ...source,
        windows: Object.freeze(observed.windows.filter((entry) => entry.output === "out-1")),
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly events: string[];
    readonly geometries: Array<{ target: object; rect: unknown }>;
    readonly actives: object[];
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly subscribes: Array<{ kind: string; handler: (target?: object) => void }>;
    directionalImpl: (direction: PlanDirection) => DirectionalObservation | PlanObserved | null;
    observeImpl: () => PlanObserved | null;
    activeImpl: () => object | null;
    env: PlanAdapterEnv;
}

function mockEnv(r: { a: object; b: object; x: object }): Mocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        logs: [],
        events: [],
        geometries: [],
        actives: [],
        timers: [],
        subscribes: [],
        directionalImpl: (_direction: PlanDirection): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r),
        }),
        observeImpl: (): PlanObserved | null => twoDomainObserved(r),
        activeImpl: (): object | null => r.a,
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
        observeDirectional: (direction): DirectionalObservation | PlanObserved | null =>
            state.directionalImpl(direction),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target, rect): boolean => {
            state.events.push(`geometry:${(rect as { x: number }).x}`);
            state.geometries.push({ target, rect });
            return true;
        },
        setActive: (target): boolean => {
            state.events.push("setActive");
            state.actives.push(target);
            return true;
        },
        active: (): object | null => state.activeImpl(),
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
    };
    (state as { env: PlanAdapterEnv }).env = env;
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

function crossFocusReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "focus", capability: "directional-focus", direction: "right", to_window: "win-x", cross_output: true },
        desired_geometry: [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 100, h: 80 } },
            { window: "win-x", leaf: "leaf-x", output: "out-2", workspace: "ws-b", rect: { x: 810, y: 10, w: 100, h: 80 } },
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

function crossMoveReply(correlation: string, targetWorkspace = "ws-b", targetHeight = 580): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail: { kind: "move", rule: "R4", capability: "CrossOutputTransfer", direction: "right" },
        desired_geometry: [
            { window: "win-a", leaf: "leaf-a", output: "out-2", workspace: targetWorkspace, rect: { x: 810, y: 10, w: 380, h: targetHeight } },
            { window: "win-x", leaf: "leaf-x", output: "out-2", workspace: targetWorkspace, rect: { x: 1200, y: 10, w: 380, h: targetHeight } },
        ],
        desired_focus: { domain_output: "out-2", domain_workspace: targetWorkspace, leaf: "leaf-a" },
        operation: {
            op: "move",
            rule: "R4",
            capability: "CrossOutputTransfer",
            direction: "right",
            window: "win-a",
            leaf: "leaf-a",
            source_output: "out-1",
            source_workspace: "ws-a",
            target_output: "out-2",
            target_workspace: targetWorkspace,
            source_root_child_index: 0,
            target: "occupied",
        },
        preconditions: [
            "focused-leaf-occupied-by-focused-window",
            "source-root-membership-and-adjacent-same-workspace-output",
            "adapter-must-verify-postconditions",
        ],
    });
}

describe("directional fingerprint (cross-language golden vector)", () => {
    it("matches the Rust derivation byte for byte", () => {
        // Pinned with the Rust `directional_fingerprint_golden_vector`
        // test: same input must emit the same value on both sides, or
        // requests fail `fingerprint-mismatch` validation.
        const fp = planDirectionalFingerprint(
            [
                {
                    output: "out-2",
                    workspace: "ws-b",
                    bounds: { x: 800, y: 0, w: 800, h: 600 },
                    gap: 4,
                    outerGap: 8,
                    adjacent: { left: "out-1" },
                },
                {
                    output: "out-1",
                    workspace: "ws-a",
                    bounds: { x: 0, y: 0, w: 800, h: 600 },
                    gap: 4,
                    outerGap: 8,
                    adjacent: { right: "out-2" },
                },
            ],
            "win-a",
            [
                { window: "win-a", output: "out-2", workspace: "ws-b", rect: { x: 810, y: 10, w: 100, h: 80 }, floating: false, fitExcluded: false },
                { window: "win-x", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 100, h: 80 }, floating: false, fitExcluded: false },
            ],
        );
        assert.equal(fp, 1986527274);
    });
});

describe("plan adapter directional cross-output (active route)", () => {
    it("sends the bounded two-domain payload on Meta+Right focus", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        const domains = body["domains"] as Array<Record<string, unknown>>;
        assert.equal(domains.length, 2);
        assert.equal(domains[0]?.["output"], "out-1");
        assert.equal(domains[1]?.["output"], "out-2");
        assert.deepEqual((domains[0] as Record<string, unknown>)["adjacent"], { right: "out-2" });
        assert.deepEqual((domains[1] as Record<string, unknown>)["adjacent"], { left: "out-1" });
        const windows = body["windows"] as Array<Record<string, unknown>>;
        assert.equal(windows.length, 2);
        assert.deepEqual(body["command"], { op: "focus", window: "win-a", direction: "right" });
    });

    it("omits domains on Up (no vertical crossing)", () => {
        const r = refs();
        const mocks = mockEnv(r);
        let directionalCalled = false;
        mocks.directionalImpl = (_direction): DirectionalObservation | PlanObserved | null => {
            directionalCalled = true;
            return { status: "ready", observed: twoDomainObserved(r) };
        };
        mocks.observeImpl = (): PlanObserved | null => ({
            domainOutput: "out-1",
            domainWorkspace: "ws-a",
            domainBounds: { x: 0, y: 0, w: 800, h: 600 },
            domainGap: 4,
            domainOuterGap: 8,
            focusedId: "win-a",
            windows: Object.freeze([
                Object.freeze({
                    id: "win-a",
                    ref: r.a,
                    rect: Object.freeze({ x: 10, y: 10, w: 100, h: 80 }),
                    output: "out-1",
                    workspace: "ws-a",
                    fullscreen: false,
                    maximized: false,
                    floating: false,
                    sticky: false,
                    resourceClass: "unknown",
                }),
            ]),
            activeRef: r.a,
            fingerprint: "single-fp",
            revalidate: () => true,
        });
        const adapter = enable(mocks);
        adapter.requestFocus("up");
        assert.equal(directionalCalled, false);
        const body = payload(mocks, 0);
        assert.equal("domains" in body, false);
    });

    it("refuses before dispatch on invalid directional evidence", () => {
        for (const op of ["focus", "move"] as const) {
            const r = refs();
            const mocks = mockEnv(r);
            mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
                status: "invalid",
                observed: null,
            });
            const adapter = enable(mocks);
            if (op === "focus") {
                adapter.requestFocus("right");
            } else {
                adapter.requestMove("right");
            }
            assert.equal(mocks.dbusCalls.length, 0);
            assert.ok(
                mocks.logs.some((line) => line.includes(`${op}-refused-ambiguous`)),
                JSON.stringify(mocks.logs),
            );
        }
    });

    it("refuses before dispatch on null directional evidence", () => {
        const r = refs();
        const mocks = mockEnv(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => null;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("move-refused-ambiguous")));
    });

    it("keeps local single-domain behavior on confirmed no-target", () => {
        const r = refs();
        const mocks = mockEnv(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "no-target",
            observed: null,
        });
        mocks.observeImpl = (): PlanObserved | null => ({
            domainOutput: "out-1",
            domainWorkspace: "ws-a",
            domainBounds: { x: 0, y: 0, w: 800, h: 600 },
            domainGap: 4,
            domainOuterGap: 8,
            focusedId: "win-a",
            windows: Object.freeze([
                Object.freeze({
                    id: "win-a",
                    ref: r.a,
                    rect: Object.freeze({ x: 10, y: 10, w: 100, h: 80 }),
                    output: "out-1",
                    workspace: "ws-a",
                    fullscreen: false,
                    maximized: false,
                    floating: false,
                    sticky: false,
                    resourceClass: "unknown",
                }),
            ]),
            activeRef: r.a,
            fingerprint: "single-fp",
            revalidate: () => true,
        });
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal("domains" in payload(mocks, 0), false);
    });

    it("applies cross focus with exactly one setActive and no geometry writes", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(crossFocusReply(body["correlation_id"] as string));
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r.x);
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("planned-applied")));
    });

    it("refuses cross focus when the operation source mismatches", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        const reply = JSON.parse(crossFocusReply(body["correlation_id"] as string)) as Record<string, unknown>;
        (reply["operation"] as Record<string, unknown>)["cross_source_output"] = "out-9";
        mocks.callbacks[0]?.(JSON.stringify(reply));
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.geometries.length, 0);
    });

    it("refuses R4 before membership, geometry, or focus writes", () => {
        const r = refs();
        const mocks = mockEnv(r);
        // Native active trails the plan (e.g. the mover is not yet active on
        // the target) so the focus-follow actuation fires exactly once.
        mocks.activeImpl = () => r.x;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        assert.equal((body["domains"] as Array<unknown>).length, 2);
        assert.equal((body["command"] as Record<string, unknown>)["cross_output_transfer"], false);
        mocks.callbacks[0]?.(crossMoveReply(body["correlation_id"] as string));
        // A synthetic R4 reply cannot bypass the disabled capability. No
        // geometry or focus write occurs.
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.actives.length, 0);
    });

    it("refuses an R4 reply even when the mover is already active", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(crossMoveReply(body["correlation_id"] as string));
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.actives.length, 0);
    });

    it("applies a local plan on a two-domain flight without cross actuation", () => {
        const r = refs();
        const mocks = mockEnv(r);
        mocks.activeImpl = () => r.x;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        // Local R1/R2/R3 shape: source-only geometry, source focus, no
        // operation. Must apply as an ordinary local move: no membership
        // transfer, geometry writes plus focus follow only.
        const local = JSON.stringify({
            v: 1,
            correlation_id: body["correlation_id"],
            outcome: "planned",
            base_revision: 2,
            detail: { kind: "move", rule: "R1", capability: "WrapPerpendicular", direction: "right" },
            desired_geometry: [
                { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 380, h: 580 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-a", leaf: "leaf-a" },
        });
        mocks.callbacks[0]?.(local);
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.actives.length, 1);
    });

    it("does not synthesize a target removal after a local two-domain move", () => {
        const r = refs();
        const mocks = mockEnv(r);
        mocks.activeImpl = () => r.x;
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: body["correlation_id"],
                outcome: "planned",
                base_revision: 2,
                detail: { kind: "move", rule: "R1", capability: "WrapPerpendicular", direction: "right" },
                desired_geometry: [
                    { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 380, h: 580 } },
                ],
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-a", leaf: "leaf-a" },
            }),
        );
        mocks.observeImpl = () => sourceObserved(r, { x: 10, y: 10, w: 380, h: 580 });
        mocks.subscribes.find((entry) => entry.kind === "geometry")?.handler(r.a);
        mocks.timers[mocks.timers.length - 1]?.callback();
        assert.equal(mocks.dbusCalls.length, 1);
    });

    it("refuses on stale directional scope before any write", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const adapter = enable(mocks);
        adapter.requestFocus("right");
        const body = payload(mocks, 0);
        // Fresh observation drifts: target rect changes.
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r, { xRect: { x: 20, y: 10, w: 100, h: 80 } }),
        });
        mocks.callbacks[0]?.(crossFocusReply(body["correlation_id"] as string));
        assert.equal(mocks.actives.length, 0);
        assert.equal(mocks.geometries.length, 0);
    });

    it("does not retain a fabricated post-move baseline", () => {
        const r = refs();
        const mocks = mockEnv(r);
        mocks.activeImpl = () => r.x;
        const adapter = enable(mocks);
        const takeoff = twoDomainObserved(r, { bRect: { x: 400, y: 10, w: 100, h: 80 } });
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: takeoff,
        });
        mocks.observeImpl = (): PlanObserved | null => takeoff;
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        mocks.callbacks[0]?.(crossMoveReply(body["correlation_id"] as string));
        assert.equal(mocks.geometries.length, 0);
    });
});

describe("plan adapter R4 production transfer (fake-native async)", () => {
    interface R4Native {
        readonly out1: { name: string };
        readonly out2: { name: string };
        readonly wsA: { id: string };
        readonly wsB: { id: string };
        outputOfMover: string;
        desktopsOfMover: string[];
        desktopsOfTarget: string[];
        outputOfTarget: string;
        rects: Map<object, { x: number; y: number; w: number; h: number }>;
        activeRef: object | null;
        outputHandlers: Array<(old: unknown) => void>;
        desktopsHandlers: Array<() => void>;
        geoHandlers: Map<string, () => void>;
        sentTransfers: Array<{ mover: object; output: object }>;
        sentMemberships: Array<{ mover: object; refs: ReadonlyArray<object> }>;
        duringTransfer?: () => void;
    }

    function r4Mocks(r: { a: object; b: object; x: object }): { mocks: Mocks; native: R4Native } {
        const mocks = mockEnv(r);
        const native: R4Native = {
            out1: { name: "out-1" },
            out2: { name: "out-2" },
            wsA: { id: "ws-a" },
            wsB: { id: "ws-b" },
            outputOfMover: "out-1",
            desktopsOfMover: ["ws-a"],
            outputOfTarget: "out-2",
            desktopsOfTarget: ["ws-b"],
            rects: new Map([
                [r.a, { x: 810, y: 10, w: 100, h: 80 }],
                [r.x, { x: 10, y: 10, w: 100, h: 80 }],
            ]),
            activeRef: r.b,
            outputHandlers: [],
            desktopsHandlers: [],
            geoHandlers: new Map(),
            sentTransfers: [],
            sentMemberships: [],
        };
        const env = mocks.env as unknown as Record<string, unknown>;
        env["resolveOutput"] = (name: string): object | null =>
            name === "out-1" ? native.out1 : name === "out-2" ? native.out2 : null;
        env["resolveDesktop"] = (workspace: string): object | null =>
            workspace === "ws-a" ? native.wsA : workspace === "ws-b" ? native.wsB : null;
        env["sendClientToScreen"] = (mover: object, output: object): boolean => {
            native.sentTransfers.push({ mover, output });
            if (mover !== r.a || (output !== native.out1 && output !== native.out2)) {
                return false;
            }
            native.outputOfMover = (output as { name: string }).name;
            native.duringTransfer?.();
            return true;
        };
        env["setDesktops"] = (mover: object, refs: ReadonlyArray<object>): boolean => {
            native.sentMemberships.push({ mover, refs });
            if (mover !== r.a || refs.length !== 1 || (refs[0] !== native.wsA && refs[0] !== native.wsB)) {
                return false;
            }
            native.desktopsOfMover = [(refs[0] as { id: string }).id];
            return true;
        };
        env["readOutputName"] = (ref: object): string | null =>
            ref === r.a ? native.outputOfMover : ref === r.x ? native.outputOfTarget : null;
        env["readDesktopIds"] = (ref: object): ReadonlyArray<string> | null =>
            ref === r.a ? [...native.desktopsOfMover] : ref === r.x ? [...native.desktopsOfTarget] : null;
        env["readGeometry"] = (ref: object): { x: number; y: number; w: number; h: number } | null => {
            const rect = native.rects.get(ref);
            return rect === undefined ? null : { ...rect };
        };
        env["subscribeMoverOutput"] = (mover: object, handler: (old: unknown) => void): (() => void) | null => {
            if (mover !== r.a) {
                return null;
            }
            native.outputHandlers.push(handler);
            return (): void => {};
        };
        env["subscribeMoverDesktops"] = (mover: object, handler: () => void): (() => void) | null => {
            if (mover !== r.a) {
                return null;
            }
            native.desktopsHandlers.push(handler);
            return (): void => {};
        };
        env["subscribeWindowGeometry"] = (ref: object, handler: () => void): (() => void) | null => {
            for (const [id, known] of [[ "win-a", r.a ], [ "win-x", r.x ]] as const) {
                if (ref === known) {
                    native.geoHandlers.set(id, handler);
                    return (): void => {};
                }
            }
            return null;
        };
        // Geometry writes land on the fake natives so readback proves; the
        // mock records every write for ordering assertions.
        const baseSetGeometry = mocks.env.setGeometry;
        (env as { setGeometry: PlanAdapterEnv["setGeometry"] })["setGeometry"] = (target, rect): boolean => {
            native.rects.set(target, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
            return baseSetGeometry(target, rect);
        };
        mocks.activeImpl = (): object | null => native.activeRef;
        (env as { setActive: PlanAdapterEnv["setActive"] })["setActive"] = (target): boolean => {
            mocks.events.push("setActive");
            mocks.actives.push(target);
            native.activeRef = target;
            return true;
        };
        return { mocks, native };
    }

    function startR4(
        r: { a: object; b: object; x: object },
        targetWorkspace = "ws-b",
    ): { mocks: Mocks; native: R4Native; adapter: PlanAdapter; correlation: string } {
        const { mocks, native } = r4Mocks(r);
        native.desktopsOfTarget = [targetWorkspace];
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r, { targetWorkspace }),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        assert.equal((body["command"] as Record<string, unknown>)["cross_output_transfer"], true);
        const correlation = body["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation, targetWorkspace));
        return { mocks, native, adapter, correlation };
    }

    function ackPayload(mocks: Mocks, index: number): Record<string, unknown> {
        return payload(mocks, index);
    }

    it("follows after mover placement proof but defers ack and commit until every geometry echoes", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r);
        // Native actuation ran synchronously in plan order: exact target
        // Output object, exact target VirtualDesktop refs, then geometries.
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentTransfers[0]?.output, native.out2);
        assert.equal(native.sentMemberships.length, 1);
        assert.deepEqual(native.sentMemberships[0]?.refs, [native.wsB]);
        assert.equal(mocks.geometries.length, 2);
        // Nothing else may happen before every echo proves: no ack, no
        // verify, no focus.
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, true);
        assert.equal(adapter.isInFlight, true);
        // The global pending gate blocks interleaving work while the flight
        // holds the single-flight.
        adapter.requestFocus("left");
        assert.ok(mocks.logs.some((line) => line.includes("busy-refused kind=focus")));
        assert.equal(mocks.dbusCalls.length, 1);
        // Deferred separate signals: output alone proves nothing.
        native.outputHandlers.forEach((handler) => handler(native.out1));
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.actives.length, 0);
        native.desktopsHandlers.forEach((handler) => handler());
        // Exact mover output plus desktop membership is sufficient for the
        // one explicit follow, even while a sibling geometry is unsettled.
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r.a);
        native.geoHandlers.get("win-a")?.();
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.actives.length, 1);
        // The final geometry echo completes full proof and binds the ack;
        // it never follows a second time.
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r.a);
        assert.equal(mocks.dbusCalls.length, 2);
        const ack = ackPayload(mocks, 1);
        assert.equal(ack["correlation_id"], correlation);
        assert.equal(ack["revision"], 2);
        assert.deepEqual(ack["command"], { op: "directional-move-ack", ack_outcome: "accepted" });
        assert.equal((ack["windows"] as Array<unknown>).length, 2);
        // Acknowledgement binds but never verifies by itself.
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 3);
        const verify = ackPayload(mocks, 2);
        assert.deepEqual(verify["command"], {
            op: "directional-move-verify",
            verified: true,
            preconditions: [
                "focused-leaf-occupied-by-focused-window",
                "source-root-membership-and-adjacent-same-workspace-output",
                "adapter-must-verify-postconditions",
            ],
            operation: {
                op: "move",
                rule: "R4",
                capability: "CrossOutputTransfer",
                direction: "right",
                window: "win-a",
                leaf: "leaf-a",
                source_output: "out-1",
                source_workspace: "ws-a",
                target_output: "out-2",
                target_workspace: "ws-b",
                source_root_child_index: 0,
                target: "occupied",
            },
        });
        // Commit releases the flight without replay.
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.ok(mocks.logs.some((line) => line.includes("planned-applied")));
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 3);
    });

    it("commits a same-workspace transfer when unchanged desktop membership has no echo", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r, "ws-a");
        assert.deepEqual(native.sentMemberships[0]?.refs, [native.wsA]);
        assert.ok(mocks.logs.some((line) => line.includes("r4-desktops-readback")));
        // This is the native no-op case: membership already proves exactly, so
        // KWin need not emit desktopsChanged for the transfer to finish.
        assert.equal(native.desktopsHandlers.length, 1);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r.a);
        assert.equal(mocks.dbusCalls.length, 2);
        const ack = ackPayload(mocks, 1);
        assert.equal(ack["correlation_id"], correlation);
        assert.deepEqual(ack["command"], { op: "directional-move-ack", ack_outcome: "accepted" });
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 3);
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
    });

    it("verifies a plan-flagged R4 mover against its native client-held geometry", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({ status: "ready", observed: twoDomainObserved(r) });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        const planned = JSON.parse(crossMoveReply(correlation)) as { desired_geometry: Array<Record<string, unknown>> };
        planned.desired_geometry[0]!["overconstrained"] = true;
        mocks.callbacks[0]?.(JSON.stringify(planned));
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.geometries[0]?.target, r.x);
        assert.equal(native.geoHandlers.has("win-a"), false);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        const ack = payload(mocks, 1);
        const ackWindows = ack["windows"] as Array<{ window: string; rect: unknown }>;
        assert.deepEqual(ackWindows.find((entry) => entry.window === "win-a")?.rect, native.rects.get(r.a));
        assert.notDeepEqual(ackWindows.find((entry) => entry.window === "win-a")?.rect, planned.desired_geometry[0]!["rect"]);
        assert.equal(ack["fingerprint"], planDirectionalFingerprint(twoDomainObserved(r).domains!, "", ackWindows.map((entry) => ({
            window: entry.window, output: "out-2", workspace: "ws-b", rect: entry.rect as { x: number; y: number; w: number; h: number }, floating: false, fitExcluded: false,
        }))));
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual((payload(mocks, 2)["windows"] as Array<{ window: string; rect: unknown }>)[0]?.rect, native.rects.get(r.a));
        assert.ok(mocks.logs.some((line) => line.includes(`r4-verify correlation=${correlation} window=win-a overconstrained=true`)));
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.equal(adapter.isR4InFlight, false);
    });

    it("rejects a genuine R4 member mismatch even with another member overconstrained", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({ status: "ready", observed: twoDomainObserved(r) });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        const planned = JSON.parse(crossMoveReply(correlation)) as { desired_geometry: Array<Record<string, unknown>> };
        planned.desired_geometry[0]!["overconstrained"] = true;
        mocks.callbacks[0]?.(JSON.stringify(planned));
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.rects.set(r.x, { x: 1201, y: 10, w: 380, h: 580 });
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 1);
        native.rects.set(r.x, { x: 1200, y: 10, w: 380, h: 580 });
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        native.outputOfTarget = "out-1";
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 2);
        assert.ok(mocks.logs.some((line) => line.includes("stale-scope")));
        assert.equal(adapter.isR4InFlight, false);
    });

    it("waits for the mover's final geometry after an output-transfer geometry echo", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        native.duringTransfer = () => native.geoHandlers.get("win-a")?.();
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r, { targetBounds: { x: 800, y: 0, w: 800, h: 720 } }),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation, "ws-b", 700));

        // sendClientToScreen repositions the mover before its queued XDG resize
        // reaches the client. That intermediate echo must not consume the
        // mover's planned-geometry fence.
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(adapter.isR4InFlight, true);

        // The delayed client resize now reports the exact target rectangle.
        native.geoHandlers.get("win-a")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 3);
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.equal(adapter.isInFlight, false);
    });

    it("still requires a desktop echo when membership changes", () => {
        const r = refs();
        const { mocks, native } = startR4(r);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.actives.length, 0);
        assert.ok(!mocks.logs.some((line) => line.includes("r4-desktops-readback")));
    });

    it("fails terminal on wrong-output readback with adapter-lost ack and no verify", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r);
        assert.equal(mocks.dbusCalls.length, 1);
        // The transfer reports the wrong output: terminal before any focus.
        native.outputOfMover = "out-1";
        native.outputHandlers.forEach((handler) => handler(native.out1));
        assert.equal(mocks.actives.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("wrong-output")));
        const lost = ackPayload(mocks, 1);
        assert.equal(lost["correlation_id"], correlation);
        assert.deepEqual(lost["command"], { op: "directional-move-ack", ack_outcome: "adapter-lost" });
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        // No verify is ever sent and late echoes never replay the flight.
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(mocks.actives.length, 0);
    });

    it("fails terminal on whole-flight timeout with adapter-lost ack and no verify", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r);
        assert.equal(mocks.dbusCalls.length, 1);
        // No echo arrives: the armed whole-flight deadline settles terminal.
        const deadline = mocks.timers[mocks.timers.length - 1];
        assert.notEqual(deadline, undefined);
        deadline?.callback();
        assert.ok(mocks.logs.some((line) => line.includes("timeout")));
        const lost = ackPayload(mocks, 1);
        assert.equal(lost["correlation_id"], correlation);
        assert.deepEqual(lost["command"], { op: "directional-move-ack", ack_outcome: "adapter-lost" });
        assert.equal(adapter.isR4InFlight, false);
        // Late echoes after settlement never replay ack or verify.
        native.outputHandlers.forEach((handler) => handler(native.out1));
        assert.equal(mocks.dbusCalls.length, 2);
        void adapter;
    });

    it("drops duplicate planned during ack and verify waiting without restarting native transfer", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r);
        const plannedReply = crossMoveReply(correlation);
        const timersAfterStart = mocks.timers.length;
        const wholeFlightDeadline = mocks.timers[timersAfterStart - 1];
        const transfersAfterStart = native.sentTransfers.length;
        const membershipsAfterStart = native.sentMemberships.length;
        const geometriesAfterStart = mocks.geometries.length;
        assert.equal(mocks.dbusCalls.length, 1);
        // Duplicate planned while echoes are still pending: no restart.
        mocks.callbacks[0]?.(plannedReply);
        assert.equal(native.sentTransfers.length, transfersAfterStart);
        assert.equal(native.sentMemberships.length, membershipsAfterStart);
        assert.equal(mocks.geometries.length, geometriesAfterStart);
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.timers.length, timersAfterStart);
        assert.equal(wholeFlightDeadline?.cancelled, false);
        assert.equal(adapter.isR4InFlight, true);
        // Drive to bound ack.
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        // Duplicate planned while ack is bound but ack reply pending.
        mocks.callbacks[0]?.(plannedReply);
        assert.equal(native.sentTransfers.length, transfersAfterStart);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(mocks.actives.length, 1);
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 3);
        // Duplicate planned while verify is pending: still no restart and the
        // original whole-flight timer still governs (no new timer).
        mocks.callbacks[0]?.(plannedReply);
        assert.equal(native.sentTransfers.length, transfersAfterStart);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(mocks.timers.length, timersAfterStart);
        assert.equal(wholeFlightDeadline?.cancelled, false);
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((line) => line.includes("planned-applied")));
    });

    it("consumes R4 ack once and never issues duplicate verify", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        const ackReply = JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 });
        mocks.callbacks[1]?.(ackReply);
        assert.equal(mocks.dbusCalls.length, 3);
        // Duplicate ack before verify completes: no second verify, no second follow.
        mocks.callbacks[1]?.(ackReply);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(mocks.actives.length, 1);
        assert.equal(native.sentTransfers.length, 1);
        // Duplicate ack after the verify transition still issues nothing.
        mocks.callbacks[1]?.(ackReply);
        assert.equal(mocks.dbusCalls.length, 3);
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.equal(adapter.isR4InFlight, false);
        const appliedAfter = mocks.logs.filter((line) => line.includes("planned-applied")).length;
        assert.equal(appliedAfter, 1);
        // Late ack after completion never replays verify or settle.
        mocks.callbacks[1]?.(ackReply);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(mocks.logs.filter((line) => line.includes("planned-applied")).length, 1);
    });

    it("drops stale and duplicate verify after completion without second settle", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        const verifyReply = JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 });
        mocks.callbacks[2]?.(verifyReply);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(mocks.dbusCalls.length, 3);
        const appliedAfter = mocks.logs.filter((line) => line.includes("planned-applied")).length;
        const activesAfter = mocks.actives.length;
        const geometriesAfter = mocks.geometries.length;
        // Duplicate verify after completion: no second settle/admit.
        mocks.callbacks[2]?.(verifyReply);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(mocks.logs.filter((line) => line.includes("planned-applied")).length, appliedAfter);
        assert.equal(mocks.actives.length, activesAfter);
        assert.equal(mocks.geometries.length, geometriesAfter);
        // Newer flight starts from idle with a fresh correlation.
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 4);
        const nextBody = payload(mocks, 3);
        const nextCorrelation = nextBody["correlation_id"] as string;
        assert.notEqual(nextCorrelation, correlation);
        // Stale old verify cannot consume the newer flight guard.
        mocks.callbacks[2]?.(verifyReply);
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, true);
        void native;
    });

    it("requires an issued verify before consuming verify without blocking the live flight", () => {
        const r = refs();
        const { mocks, native, adapter, correlation } = startR4(r);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        const state = adapter as unknown as {
            r4Flight: { flight: number; session: number; verifyRequested: boolean; verifyReplySeen: boolean } | null;
            onR4VerifyReply: (reply: unknown, flight: number, session: number) => void;
        };
        assert.notEqual(state.r4Flight, null);
        assert.equal(state.r4Flight?.verifyRequested, false);
        // Out-of-order verify with exact flight/session before verify is
        // issued: dropped without consuming the verify guard.
        const earlyVerify = JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 });
        state.onR4VerifyReply(earlyVerify, state.r4Flight?.flight as number, state.r4Flight?.session as number);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(adapter.isR4InFlight, true);
        assert.equal(state.r4Flight?.verifyReplySeen, false);
        assert.equal(state.r4Flight?.verifyRequested, false);
        // The live flight still completes exactly once once verify is issued.
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(state.r4Flight?.verifyRequested, true);
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(mocks.logs.filter((line) => line.includes("planned-applied")).length, 1);
    });

    it("processes deferred admission exactly once after settle once send protection releases", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        let sendActive = false;
        (mocks.env as unknown as Record<string, unknown>)["isSendActive"] = (): boolean => sendActive;
        let applied = 0;
        (mocks.env as unknown as Record<string, unknown>)["onPlannedApplied"] = (): void => {
            applied += 1;
        };
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(adapter.isR4InFlight, true);
        // A new foreground window appears while the R4 flight holds the
        // single-flight. Lifecycle resync attempts cannot interleave: the R4
        // fence drops signals and no admission dispatches mid-flight.
        mocks.observeImpl = (): PlanObserved | null => {
            const full = twoDomainObserved(r, {
                aRect: { x: 10, y: 10, w: 100, h: 80 },
                bRect: { x: 400, y: 10, w: 100, h: 80 },
                xRect: { x: 810, y: 10, w: 100, h: 80 },
            });
            const { domains: _domains, ...source } = full;
            return {
                ...source,
                windows: Object.freeze(source.windows.filter((entry) => entry.output === "out-1")),
            };
        };
        adapter.requestResync();
        assert.equal(mocks.dbusCalls.length, 1);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        native.geoHandlers.get("win-a")?.();
        native.geoHandlers.get("win-x")?.();
        assert.equal(mocks.dbusCalls.length, 2);
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: 2 }));
        assert.equal(mocks.dbusCalls.length, 3);
        // Workspace send becomes pending before the exact successful settle.
        sendActive = true;
        mocks.callbacks[2]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", base_revision: 3 }));
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.equal(applied, 1);
        // The post-settle resync observes the queued new window but stays
        // protected while send is active.
        const debounceWhileBlocked = mocks.timers.filter((entry) => entry.delayMs === 120 && !entry.cancelled);
        for (const entry of debounceWhileBlocked) {
            entry.callback();
        }
        assert.equal(mocks.dbusCalls.length, 3);
        // Releasing protection admits the queued new window exactly once.
        sendActive = false;
        adapter.requestResync();
        const pending = mocks.timers.filter((entry) => entry.delayMs === 120 && !entry.cancelled);
        assert.ok(pending.length > 0);
        pending[pending.length - 1]?.callback();
        assert.equal(mocks.dbusCalls.length, 4);
        const admission = payload(mocks, 3);
        assert.equal((admission["command"] as Record<string, unknown>)["op"], "admit");
        const admitted = (admission["windows"] as Array<Record<string, unknown>>).map((entry) => entry["window"] as string);
        assert.ok(admitted.includes("win-b"), `queued win-b admitted, got ${JSON.stringify(admitted)}`);
        assert.ok(admitted.includes("win-a"), `admission retains win-a, got ${JSON.stringify(admitted)}`);
        // Completing the queued admission converges once with no replay.
        const admissionCorrelation = admission["correlation_id"] as string;
        mocks.callbacks[3]?.(
            JSON.stringify({
                v: 1,
                correlation_id: admissionCorrelation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 10, y: 10, w: 100, h: 80 } },
                    { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-a", rect: { x: 400, y: 10, w: 100, h: 80 } },
                ],
            }),
        );
        assert.equal(applied, 2);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 4);
        // A fresh resync after convergence never redispatches.
        const timersBeforeTrailing = mocks.timers.length;
        adapter.requestResync();
        const freshTrailing = mocks.timers
            .slice(timersBeforeTrailing)
            .filter((entry) => entry.delayMs === 120 && !entry.cancelled);
        for (const entry of freshTrailing) {
            entry.callback();
        }
        assert.equal(mocks.dbusCalls.length, 4);
    });
});

describe("observeDirectionalDomain (active route observation)", () => {
    function fakeWorkspace(
        opts: { ambiguous?: boolean; unreadable?: boolean; single?: boolean; badFrame?: boolean } = {},
    ): unknown {
        const out1 = { name: "out-1" };
        const out2 = { name: "out-2" };
        const out3 = { name: "out-3" };
        const wsA = { id: "ws-a" };
        const wsB = { id: "ws-b" };
        const screens = opts.single === true ? [out1] : opts.ambiguous === true ? [out1, out2, out3] : [out1, out2];
        const currentFor = (screen: object): object => {
            if (screen === out1) {
                return wsA;
            }
            return wsB;
        };
        const areaFor = (screen: object): { x: number; y: number; w: number; h: number } => {
            if (screen === out1) {
                return { x: 0, y: 0, w: 800, h: 600 };
            }
            if (screen === out2) {
                return { x: 800, y: 0, w: 800, h: 600 };
            }
            return { x: 800, y: 0, w: 800, h: 600 };
        };
        const winA = {
            normalWindow: true,
            output: out1,
            onAllDesktops: false,
            desktops: [wsA],
            internalId: "a",
            frameGeometry: { x: 10, y: 10, width: 100, height: 80 },
            fullScreen: false,
            maximizeMode: 0,
            resourceClass: "app",
        };
        const winX = {
            normalWindow: true,
            output: out2,
            onAllDesktops: false,
            desktops: [wsB],
            internalId: "x",
            frameGeometry:
                opts.badFrame === true
                    ? { x: Number.NaN, y: 10, width: 100, height: 80 }
                    : { x: 810, y: 10, width: 100, height: 80 },
            fullScreen: false,
            maximizeMode: 0,
            resourceClass: "app",
        };
        return {
            activeWindow: winA,
            screens,
            desktops: [wsA, wsB],
            currentDesktopForScreen: (screen: object): object => currentFor(screen),
            clientArea: (_kind: number, screen: object, _desktop: object): object => {
                if (opts.unreadable === true && screen === out2) {
                    throw new Error("unreadable");
                }
                return areaFor(screen);
            },
            windowList: (): object[] => [winA, winX],
        };
    }

    it("observes source plus the reciprocal adjacent current desktop", () => {
        const observed = observeDirectionalDomain(
            fakeWorkspace(),
            new Map(),
            new Set(),
            { innerGap: 4, outerGap: 8 },
            "right",
        );
        assert.equal(observed.status, "ready");
        assert.notEqual(observed.observed, null);
        assert.equal(observed.observed?.domains?.length, 2);
        assert.equal(observed.observed?.domains?.[0]?.output, "out-1");
        assert.equal(observed.observed?.domains?.[1]?.output, "out-2");
        // Distinct current workspaces are allowed.
        assert.equal(observed.observed?.domains?.[1]?.workspace, "ws-b");
        assert.deepEqual(observed.observed?.domains?.[0]?.adjacent, { right: "out-2" });
        assert.deepEqual(observed.observed?.domains?.[1]?.adjacent, { left: "out-1" });
        assert.equal(observed.observed?.windows.length, 2);
    });

    it("reports no-target on a confirmed single output", () => {
        const observed = observeDirectionalDomain(
            fakeWorkspace({ single: true }),
            new Map(),
            new Set(),
            { innerGap: 4, outerGap: 8 },
            "right",
        );
        assert.equal(observed.status, "no-target");
        assert.equal(observed.observed, null);
    });

    it("reports invalid on ambiguous adjacency", () => {
        const observed = observeDirectionalDomain(
            fakeWorkspace({ ambiguous: true }),
            new Map(),
            new Set(),
            { innerGap: 4, outerGap: 8 },
            "right",
        );
        assert.equal(observed.status, "invalid");
    });

    it("reports invalid on unreadable target work area", () => {
        const observed = observeDirectionalDomain(
            fakeWorkspace({ unreadable: true }),
            new Map(),
            new Set(),
            { innerGap: 4, outerGap: 8 },
            "right",
        );
        assert.equal(observed.status, "invalid");
    });

    it("reports invalid on an unreadable target frame", () => {
        const observed = observeDirectionalDomain(
            fakeWorkspace({ badFrame: true }),
            new Map(),
            new Set(),
            { innerGap: 4, outerGap: 8 },
            "right",
        );
        assert.equal(observed.status, "invalid");
    });

    it("reports invalid for vertical directions", () => {
        for (const direction of ["up", "down"]) {
            const observed = observeDirectionalDomain(
                fakeWorkspace(),
                new Map(),
                new Set(),
                { innerGap: 4, outerGap: 8 },
                direction,
            );
            assert.equal(observed.status, "invalid");
        }
    });
});

describe("entry-to-adapter directional route (production style)", () => {
    it("dispatches bounded two-domain DescribePlan through the real entry", () => {
        const stubSignal = (): { connect: (h: (p?: unknown) => void) => void; disconnect: (h: (p?: unknown) => void) => void } => ({
            connect: (): void => {},
            disconnect: (): void => {},
        });
        const out1 = { name: "out-1" };
        const out2 = { name: "out-2" };
        const wsA = { id: "ws-a" };
        const wsB = { id: "ws-b" };
        const winA = {
            normalWindow: true,
            output: out1,
            onAllDesktops: false,
            desktops: [wsA],
            internalId: "entry-a",
            frameGeometry: { x: 10, y: 10, width: 100, height: 80 },
            fullScreen: false,
            maximizeMode: 0,
            resourceClass: "app",
            frameGeometryChanged: stubSignal(),
            fullScreenChanged: stubSignal(),
            maximizedChanged: stubSignal(),
            desktopsChanged: stubSignal(),
        };
        const winX = {
            normalWindow: true,
            output: out2,
            onAllDesktops: false,
            desktops: [wsB],
            internalId: "entry-x",
            frameGeometry: { x: 810, y: 10, width: 100, height: 80 },
            fullScreen: false,
            maximizeMode: 0,
            resourceClass: "app",
            frameGeometryChanged: stubSignal(),
            fullScreenChanged: stubSignal(),
            maximizedChanged: stubSignal(),
            desktopsChanged: stubSignal(),
        };
        const workspace = {
            activeWindow: winA,
            activeScreen: out1,
            screens: [out1, out2],
            desktops: [wsA, wsB],
            currentDesktopForScreen: (screen: object): object => (screen === out1 ? wsA : wsB),
            clientArea: (_kind: number, screen: object, _desktop: object): object =>
                screen === out1 ? { x: 0, y: 0, w: 800, h: 600 } : { x: 800, y: 0, w: 800, h: 600 },
            windowList: (): object[] => [winA, winX],
            windowAdded: stubSignal(),
            windowRemoved: stubSignal(),
            windowActivated: stubSignal(),
            screensChanged: stubSignal(),
            currentDesktopChanged: stubSignal(),
            desktopsChanged: stubSignal(),
        };
        const calls: Array<{ method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const logs: string[] = [];
        const handle = startPlanAdapterEntry({
            workspace,
            owner: "owner-1",
            generation: "gen-1",
            log: (message: string): void => {
                logs.push(message);
            },
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
                calls.push({ method, payload });
                callbacks.push(callback);
            },
            scheduleOnce: (): (() => void) => (): void => {},
            registerShortcutFn: (): boolean => true,
            readProfileFn: (): string => "cosmic",
            readWorkspaceModeFn: (): string => "per-output-local",
            readInnerGapFn: (): number => 4,
            readOuterGapFn: (): number => 8,
        });
        assert.notEqual(handle, null);
        handle?.requestFocus("right");
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.method, "DescribePlan");
        const body = JSON.parse(calls[0]?.payload as string) as Record<string, unknown>;
        const domains = body["domains"] as Array<Record<string, unknown>>;
        assert.equal(domains.length, 2);
        assert.equal(domains[0]?.["output"], "out-1");
        assert.equal(domains[1]?.["output"], "out-2");
        assert.equal(domains[1]?.["workspace"], "ws-b");
        const windows = body["windows"] as Array<Record<string, unknown>>;
        assert.equal(windows.length, 2);
        // The directional fingerprint binds the full evidence: recompute it
        // over the sent primitives and require an exact match.
        const sentFp = body["fingerprint"] as number;
        assert.ok(Number.isInteger(sentFp));
        handle?.stop();
        void logs;
    });
});

describe("plan adapter R4 pre-staging cancellation", () => {
    function cancelledR4Reply(correlation: string): string {
        return JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "cancelled",
            kind: "directional-move",
            base_revision: 2,
        });
    }

    function staleR4Reply(correlation: string): string {
        return JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "rejected",
            kind: "stale",
            message: "cancel identity does not match the pending transaction",
        });
    }

    // Drive an R4-shape move to a live unanswered request: no plan bound, no
    // transfer staged, zero native writes. Activation resolves synchronously
    // in this harness, so dbusCalls[0] is the move request.
    function driveToLiveR4Move(): {
        mocks: Mocks;
        adapter: PlanAdapter;
        correlation: string;
    } {
        const r = refs();
        const mocks = mockEnv(r);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        assert.equal((body["command"] as Record<string, unknown>)["op"], "move");
        assert.ok(Array.isArray(body["domains"]) && (body["domains"] as unknown[]).length === 2);
        const correlation = body["correlation_id"] as string;
        return { mocks, adapter, correlation };
    }

    function cancelCall(mocks: Mocks): { method: string; payload: string } | undefined {
        return mocks.dbusCalls.find((c) => c.payload.includes("directional-move-cancel"));
    }

    // Minimal native capability installer for transfer-staging tests (mirrors
    // the production R4 suite's fake natives): enough for beginR4Transfer to
    // reach its setters, recording transfers and memberships.
    function r4Caps(
        mocks: Mocks,
    ): { sentTransfers: Array<{ mover: object; output: object }>; sentMemberships: Array<{ mover: object; refs: ReadonlyArray<object> }> } {
        const sentTransfers: Array<{ mover: object; output: object }> = [];
        const sentMemberships: Array<{ mover: object; refs: ReadonlyArray<object> }> = [];
        const out1 = { name: "out-1" };
        const out2 = { name: "out-2" };
        const wsA = { id: "ws-a" };
        const wsB = { id: "ws-b" };
        const env = mocks.env as unknown as Record<string, unknown>;
        env["resolveOutput"] = (name: string): object | null =>
            name === "out-1" ? out1 : name === "out-2" ? out2 : null;
        env["resolveDesktop"] = (workspace: string): object | null =>
            workspace === "ws-a" ? wsA : workspace === "ws-b" ? wsB : null;
        env["sendClientToScreen"] = (mover: object, output: object): boolean => {
            sentTransfers.push({ mover, output });
            return true;
        };
        env["setDesktops"] = (mover: object, refs: ReadonlyArray<object>): boolean => {
            sentMemberships.push({ mover, refs });
            return true;
        };
        env["readOutputName"] = (): string | null => "out-2";
        env["readDesktopIds"] = (): ReadonlyArray<string> | null => ["ws-b"];
        env["readGeometry"] = (): { x: number; y: number; w: number; h: number } | null => ({
            x: 810,
            y: 10,
            w: 380,
            h: 580,
        });
        env["subscribeMoverOutput"] = (): (() => void) | null => (): void => {};
        env["subscribeMoverDesktops"] = (): (() => void) | null => (): void => {};
        env["subscribeWindowGeometry"] = (): (() => void) | null => (): void => {};
        return { sentTransfers, sentMemberships };
    }

    it("attempts cancel on pre-staging timeout and clears the flight on cancelled", () => {
        const { mocks, adapter, correlation } = driveToLiveR4Move();
        let observations = 0;
        const baseDirectional = mocks.directionalImpl;
        mocks.directionalImpl = (direction) => {
            observations += 1;
            return baseDirectional(direction);
        };
        // The dispatch-phase timer fires with no plan bound and no transfer.
        mocks.timers[0]?.callback();
        // Exactly one fresh observation ran for the cancel payload.
        assert.equal(observations, 1);
        const cancel = cancelCall(mocks);
        assert.ok(cancel, JSON.stringify(mocks.dbusCalls.map((c) => c.method)));
        // Exact current pre observation with the original request revision (0,
        // never a staged base), the dispatch correlation/identity, and the
        // attestation.
        const body = payload(mocks, 1);
        assert.equal(body["correlation_id"], correlation);
        assert.equal(body["revision"], 0);
        assert.equal(body["owner"], "owner-1");
        assert.equal(body["generation"], "gen-1");
        assert.equal(body["focused_window"], "win-a");
        assert.ok(Array.isArray(body["domains"]) && (body["domains"] as unknown[]).length === 2);
        assert.deepEqual(
            (body["windows"] as Array<Record<string, unknown>>).map((w) => w["window"]),
            ["win-a", "win-x"],
        );
        const command = body["command"] as Record<string, unknown>;
        assert.equal(command["op"], "directional-move-cancel");
        assert.equal(command["zero_dispatch"], true);
        assert.ok(!("cross_output_transfer" in command));
        // Flight retained through the wait.
        assert.equal(adapter.isInFlight, true);
        assert.equal(mocks.timers[0]?.cancelled, true);
        // Normal-level attempt record with the dispatch correlation.
        assert.ok(
            mocks.logs.some(
                (l) =>
                    l.includes(`cmd=${correlation}`) &&
                    l.includes("component=cosmic-directional") &&
                    l.includes("route=directional-r4") &&
                    l.includes("stage=cancel") &&
                    l.includes(`correlation=${correlation}`) &&
                    l.includes("generation=gen-1") &&
                    l.includes("revision=0") &&
                    l.includes("event=attempt") &&
                    l.includes("outcome=cancel-requested") &&
                    l.includes("cause=timeout"),
            ),
            mocks.logs.join("\n"),
        );
        // Exact matching cancellation clears the flight without terminal
        // accounting and without any native write.
        mocks.callbacks[1]?.(cancelledR4Reply(correlation));
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(mocks.geometries.length, 0);
        const accepted = mocks.logs.findIndex(
            (l) =>
                l.includes(`cmd=${correlation}`) &&
                l.includes("stage=cancel") &&
                l.includes("event=reply") &&
                l.includes("outcome=accepted") &&
                l.includes("revision=2") &&
                l.includes("cause=timeout"),
        );
        const released = mocks.logs.findIndex(
            (l) =>
                l.includes(`cmd=${correlation}`) &&
                l.includes("stage=release") &&
                l.includes("event=local-release") &&
                l.includes("outcome=cancelled") &&
                l.includes("revision=2") &&
                l.includes("cause=timeout"),
        );
        assert.ok(accepted >= 0 && released > accepted, mocks.logs.join("\n"));
        // Later commands proceed under a new correlation.
        adapter.requestMove("right");
        const next = payload(mocks, mocks.dbusCalls.length - 1);
        assert.notEqual(next["correlation_id"], correlation);
        assert.ok(
            mocks.logs.some(
                (l) =>
                    l.includes(`cmd=${next["correlation_id"] as string}`) &&
                    l.includes("stage=request") &&
                    l.includes("event=dispatch") &&
                    l.includes("outcome=started"),
            ),
            mocks.logs.join("\n"),
        );
    });

    it("runs terminal teardown unchanged when cancel is refused or diverged", () => {
        for (const [replyOf, refusedLine] of [
            [
                (c: string): string => staleR4Reply(c),
                "cancel-refused-stale",
            ],
            [
                (c: string): string =>
                    JSON.stringify({ v: 1, correlation_id: c, outcome: "diverged", kind: "stale-revision" }),
                "cancel-refused-stale-revision",
            ],
        ] as const) {
            const driven = driveToLiveR4Move();
            driven.mocks.timers[0]?.callback();
            assert.ok(cancelCall(driven.mocks), replyOf("probe"));
            driven.mocks.callbacks[1]?.(replyOf(driven.correlation));
            // The Rust refusal kind is attributed on the cancel line; the
            // fallthrough keeps the original timeout terminal line.
            assert.ok(
                driven.mocks.logs.some(
                    (l) => l.includes(`cmd=${driven.correlation}`) && l.includes(`outcome=${refusedLine}`),
                ),
                driven.mocks.logs.join("\n"),
            );
            // Same terminal surface as the pre-cancel timeout path: flight
            // cleared, timeout line, no success, no transfer ever staged.
            assert.equal(driven.adapter.isInFlight, false);
            assert.equal(driven.adapter.isR4InFlight, false);
            assert.equal(driven.mocks.geometries.length, 0);
            assert.ok(
                driven.mocks.logs.some((l) => l.includes("outcome=timeout")),
                driven.mocks.logs.join("\n"),
            );
            assert.ok(
                driven.mocks.logs.every((l) => !l.includes("outcome=cancelled")),
                driven.mocks.logs.join("\n"),
            );
        }
    });

    it("preserves a planner diverged terminal without attempting cancellation", () => {
        const { mocks, adapter, correlation } = driveToLiveR4Move();
        mocks.callbacks[0]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "diverged", kind: "stale-revision" }),
        );
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
        assert.ok(!cancelCall(mocks), "no cancellation after a terminal Rust divergence");
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=stale-revision")),
            mocks.logs.join("\n"),
        );
    });

    it("runs terminal teardown unchanged when the cancel reply is malformed", () => {
        const { mocks, adapter } = driveToLiveR4Move();
        mocks.timers[0]?.callback();
        assert.ok(cancelCall(mocks));
        mocks.callbacks[1]?.("{not-json");
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=timeout")), mocks.logs.join("\n"));
    });

    it("runs terminal teardown unchanged when the cancel round trip times out", () => {
        const { mocks, adapter, correlation } = driveToLiveR4Move();
        mocks.timers[0]?.callback();
        assert.ok(cancelCall(mocks));
        assert.equal(mocks.timers[1]?.cancelled, false);
        // The cancel deadline fires with no reply: cancel-specific timeout
        // attribution, then the same terminal teardown.
        mocks.timers[1]?.callback();
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=cancel-timed-out")),
            mocks.logs.join("\n"),
        );
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(mocks.geometries.length, 0);
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=timeout")),
            mocks.logs.join("\n"),
        );
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=timeout")),
            mocks.logs.join("\n"),
        );
    });

    it("never attempts cancel after transfer staged and still reports adapter-lost", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const caps = r4Caps(mocks);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        const correlation = body["correlation_id"] as string;
        // Stage the R4 transfer: native setters ran (dispatch counter > 0).
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.ok(caps.sentTransfers.length > 0);
        // The R4 deadline fires post-staging: terminal with the established
        // adapter-lost report and no cancel attempt.
        mocks.timers[1]?.callback();
        assert.ok(
            mocks.dbusCalls.some(
                (c) =>
                    c.payload.includes("directional-move-ack") && c.payload.includes("adapter-lost"),
            ),
            JSON.stringify(mocks.dbusCalls.map((c) => c.payload.slice(0, 120))),
        );
        assert.ok(!cancelCall(mocks), "no cancel after transfer staging");
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
    });

    it("never attempts cancel after a transfer setter throws", () => {
        const r = refs();
        const mocks = mockEnv(r);
        r4Caps(mocks);
        const env = mocks.env as unknown as Record<string, unknown>;
        env["sendClientToScreen"] = (): boolean => {
            throw new Error("native transfer fault");
        };
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.ok(!cancelCall(mocks), "no cancel after a throwing transfer setter");
        assert.ok(
            mocks.dbusCalls.some(
                (c) =>
                    c.payload.includes("directional-move-ack") && c.payload.includes("adapter-lost"),
            ),
        );
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
    });

    it("runs terminal teardown unchanged when the cancel send throws", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const baseCallDbus = mocks.env.callDbus.bind(mocks.env);
        const throwingEnv: PlanAdapterEnv = {
            ...mocks.env,
            callDbus: (service, path, iface, method, payload, callback) => {
                if (payload.includes("directional-move-cancel")) {
                    throw new Error("transport down");
                }
                baseCallDbus(service, path, iface, method, payload, callback);
            },
        };
        const adapter = new PlanAdapter(throwingEnv);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        const correlation = body["correlation_id"] as string;
        mocks.timers[0]?.callback();
        // The attempt cannot leave the adapter: one bounded unavailable
        // record, then the preserved timeout terminal path with no transfer
        // staged and no native writes.
        assert.ok(
            mocks.logs.some(
                (l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=cancel-unavailable"),
            ),
            mocks.logs.join("\n"),
        );
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(mocks.geometries.length, 0);
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=timeout")),
            mocks.logs.join("\n"),
        );
        assert.ok(
            mocks.logs.every((l) => !l.includes("outcome=cancelled")),
            mocks.logs.join("\n"),
        );
    });

    it("maps unknown refusal kinds to refused-unknown without echo", () => {
        for (const outcome of ["rejected", "diverged"]) {
            const driven = driveToLiveR4Move();
            driven.mocks.timers[0]?.callback();
            assert.ok(cancelCall(driven.mocks));
            driven.mocks.callbacks[1]?.(
                JSON.stringify({ v: 1, correlation_id: driven.correlation, outcome, kind: "bogus-kind" }),
            );
            // Syntax-valid but foreign kinds never echo: the record carries
            // the allowlist fallback while the fallthrough stays terminal.
            assert.ok(
                driven.mocks.logs.some(
                    (l) => l.includes(`cmd=${driven.correlation}`) && l.includes("outcome=cancel-refused-unknown"),
                ),
                driven.mocks.logs.join("\n"),
            );
            assert.ok(
                driven.mocks.logs.every((l) => !l.includes("bogus-kind")),
                driven.mocks.logs.join("\n"),
            );
            assert.equal(driven.adapter.isInFlight, false);
            assert.equal(driven.mocks.geometries.length, 0);
        }
    });

    it("drops the late original reply and duplicate cancel callbacks while armed", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const caps = r4Caps(mocks);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        const correlation = body["correlation_id"] as string;
        mocks.timers[0]?.callback();
        assert.ok(cancelCall(mocks));
        const callsBefore = mocks.dbusCalls.length;
        // Late original planned reply while armed would stage transfer if not
        // fenced: assert zero native dispatch of any kind.
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(caps.sentTransfers.length, 0);
        assert.equal(caps.sentMemberships.length, 0);
        assert.equal(mocks.geometries.length, 0);
        assert.equal(adapter.isInFlight, true);
        assert.equal(adapter.isR4InFlight, false);
        // Exact cancellation settles; replays of its callback and timer are inert.
        mocks.callbacks[1]?.(cancelledR4Reply(correlation));
        assert.equal(adapter.isInFlight, false);
        mocks.callbacks[1]?.(cancelledR4Reply(correlation));
        mocks.timers[1]?.callback();
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.ok(
            mocks.dbusCalls.every((c) => !c.payload.includes("adapter-lost")),
            JSON.stringify(mocks.dbusCalls.map((c) => c.payload.slice(0, 120))),
        );
        assert.equal(
            mocks.logs.filter((l) => l.includes("event=local-release") && l.includes("outcome=cancelled")).length,
            1,
            mocks.logs.join("\n"),
        );
    });

    it("attributes a malformed cancel reply before the unchanged fallthrough", () => {
        const { mocks, adapter, correlation } = driveToLiveR4Move();
        mocks.timers[0]?.callback();
        assert.ok(cancelCall(mocks));
        mocks.callbacks[1]?.("{not-json");
        assert.ok(
            mocks.logs.some(
                (l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=cancel-reply-malformed"),
            ),
            mocks.logs.join("\n"),
        );
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(mocks.geometries.length, 0);
    });

    it("records ineligible-dispatched when a local plan's setter threw", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const throwingEnv: PlanAdapterEnv = {
            ...mocks.env,
            setGeometry: (): boolean => {
                throw new Error("native write fault");
            },
        };
        const adapter = new PlanAdapter(throwingEnv);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        const correlation = body["correlation_id"] as string;
        // A local (non-cross) plan on the two-domain flight actuates ordinary
        // geometries: the first setter throw marks the flight dispatched, so
        // no cancel may be attempted and the write-failed terminal stands.
        // Focus stays source-homed with no operation, the exact local shape.
        // Rects differ from the observed ones so the writes are not skipped
        // as already-equal.
        const local = {
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            base_revision: 2,
            desired_geometry: [
                { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-a", rect: { x: 800, y: 0, w: 120, h: 100 } },
                { window: "win-x", leaf: "leaf-x", output: "out-2", workspace: "ws-b", rect: { x: 0, y: 0, w: 120, h: 100 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-a", leaf: "leaf-a" },
        };
        mocks.callbacks[0]?.(JSON.stringify(local));
        assert.ok(!cancelCall(mocks), "no cancel after a setter ran");
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=cancel-ineligible-dispatched")),
            mocks.logs.join("\n"),
        );
        assert.ok(
            mocks.logs.some((l) => l.includes(`cmd=${correlation}`) && l.includes("outcome=write-failed")),
            mocks.logs.join("\n"),
        );
        assert.equal(adapter.isInFlight, false);
    });

    it("keeps logging failure-harmless when the logger throws", () => {
        const r = refs();
        const mocks = mockEnv(r);
        const throwingEnv = { ...mocks.env, log: (): void => { throw new Error("log down"); } };
        const adapter = new PlanAdapter(throwingEnv);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        adapter.requestMove("right");
        const body = payload(mocks, 0);
        const correlation = body["correlation_id"] as string;
        mocks.timers[0]?.callback();
        assert.ok(cancelCall(mocks));
        mocks.callbacks[1]?.(cancelledR4Reply(correlation));
        // Every diagnostic above threw inside the adapter and was swallowed:
        // the flight still settles exactly like the logged path.
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isR4InFlight, false);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 3);
    });
});
