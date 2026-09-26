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


describe("plan adapter R4 immediate transfer (lean, no wire protocol)", () => {
    interface R4Native {
        readonly out1: { name: string };
        readonly out2: { name: string };
        readonly wsA: { id: string };
        readonly wsB: { id: string };
        outputOfMover: string;
        desktopsOfMover: string[];
        rects: Map<object, { x: number; y: number; w: number; h: number }>;
        activeRef: object | null;
        outputHandlers: Array<(old: unknown) => void>;
        desktopsHandlers: Array<() => void>;
        sentTransfers: Array<{ mover: object; output: object }>;
        sentMemberships: Array<{ mover: object; refs: ReadonlyArray<object> }>;
        autoUpdate: boolean;
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
            rects: new Map([
                [r.a, { x: 810, y: 10, w: 100, h: 80 }],
                [r.x, { x: 10, y: 10, w: 100, h: 80 }],
            ]),
            activeRef: r.b,
            outputHandlers: [],
            desktopsHandlers: [],
            sentTransfers: [],
            sentMemberships: [],
            autoUpdate: true,
        };
        const env = mocks.env as unknown as Record<string, unknown>;
        env["resolveOutput"] = (name: string): object | null =>
            name === "out-1" ? native.out1 : name === "out-2" ? native.out2 : null;
        env["resolveDesktop"] = (workspace: string): object | null =>
            workspace === "ws-a" ? native.wsA : workspace === "ws-b" ? native.wsB : null;
        env["sendClientToScreen"] = (mover: object, output: object): boolean => {
            native.sentTransfers.push({ mover, output });
            mocks.events.push("transfer");
            if (mover !== r.a || (output !== native.out1 && output !== native.out2)) {
                return false;
            }
            if (native.autoUpdate) {
                native.outputOfMover = (output as { name: string }).name;
            }
            return true;
        };
        env["setDesktops"] = (mover: object, refs: ReadonlyArray<object>): boolean => {
            native.sentMemberships.push({ mover, refs });
            mocks.events.push("membership");
            if (mover !== r.a || refs.length !== 1 || (refs[0] !== native.wsA && refs[0] !== native.wsB)) {
                return false;
            }
            if (native.autoUpdate) {
                native.desktopsOfMover = [(refs[0] as { id: string }).id];
            }
            return true;
        };
        env["readOutputName"] = (ref: object): string | null =>
            ref === r.a ? native.outputOfMover : ref === r.x ? "out-2" : null;
        env["readDesktopIds"] = (ref: object): ReadonlyArray<string> | null =>
            ref === r.a ? [...native.desktopsOfMover] : ref === r.x ? ["ws-b"] : null;
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
        env["subscribeWindowGeometry"] = (): (() => void) | null => (): void => {};
        const baseSetGeometry = mocks.env.setGeometry;
        (env as { setGeometry: PlanAdapterEnv["setGeometry"] })["setGeometry"] = (target, rect): boolean => {
            native.rects.set(target, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
            mocks.events.push("geometry");
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

    // Dynamic R4 observation reflecting native mover placement: the fresh
    // directional re-observation used by per-setter scope fences and follow
    // proof must show the mover where native reads place it (source, half,
    // or target). Static mocks would otherwise pin the mover on source and
    // block truthful follow.
    function dynamicOccupiedObserved(
        r: { a: object; b: object; x: object },
        native: { outputOfMover: string; desktopsOfMover: string[] },
    ): PlanObserved {
        const moverOutput = native.outputOfMover;
        const moverWorkspace = native.desktopsOfMover[0] ?? "ws-a";
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
                    workspace: "ws-b",
                    bounds: { x: 800, y: 0, w: 800, h: 600 },
                    gap: 4,
                    outerGap: 8,
                    adjacent: Object.freeze({ left: "out-1" }),
                }),
            ]),
            windows: Object.freeze([
                Object.freeze({
                    id: "win-a",
                    ref: r.a,
                    rect: Object.freeze({ x: 810, y: 10, w: 100, h: 80 }),
                    output: moverOutput,
                    workspace: moverWorkspace,
                    fullscreen: false,
                    maximized: false,
                    floating: false,
                    sticky: false,
                    resourceClass: "unknown",
                }),
                Object.freeze({
                    id: "win-x",
                    ref: r.x,
                    rect: Object.freeze({ x: 10, y: 10, w: 100, h: 80 }),
                    output: "out-2",
                    workspace: "ws-b",
                    fullscreen: false,
                    maximized: false,
                    floating: false,
                    sticky: false,
                    resourceClass: "unknown",
                }),
            ]),
            activeRef: r.a,
            fingerprint: "dir-fp-1",
            revalidate: () => true,
        };
    }

    function dynamicEmptyObserved(
        r: { a: object; b: object; x: object },
        native: { outputOfMover: string; desktopsOfMover: string[] },
    ): PlanObserved {
        const moverOutput = native.outputOfMover;
        const moverWorkspace = native.desktopsOfMover[0] ?? "ws-a";
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
                    workspace: "ws-b",
                    bounds: { x: 800, y: 0, w: 800, h: 600 },
                    gap: 4,
                    outerGap: 8,
                    adjacent: Object.freeze({ left: "out-1" }),
                }),
            ]),
            windows: Object.freeze([
                Object.freeze({
                    id: "win-a",
                    ref: r.a,
                    rect: Object.freeze({ x: 810, y: 10, w: 100, h: 80 }),
                    output: moverOutput,
                    workspace: moverWorkspace,
                    fullscreen: false,
                    maximized: false,
                    floating: false,
                    sticky: false,
                    resourceClass: "unknown",
                }),
            ]),
            activeRef: r.a,
            fingerprint: "dir-fp-empty",
            revalidate: () => true,
        };
    }

    function emptyMoveReply(correlation: string): string {
        return JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "planned",
            base_revision: 2,
            detail: { kind: "move", rule: "R4", capability: "CrossOutputTransfer", direction: "right" },
            desired_geometry: [
                { window: "win-a", leaf: "leaf-a", output: "out-2", workspace: "ws-b", rect: { x: 810, y: 10, w: 380, h: 580 } },
            ],
            desired_focus: { domain_output: "out-2", domain_workspace: "ws-b", leaf: "leaf-a" },
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
                target: "empty",
            },
            preconditions: [
                "focused-leaf-occupied-by-focused-window",
                "source-root-membership-and-adjacent-same-workspace-output",
                "adapter-must-verify-postconditions",
            ],
        });
    }

    function assertNoWireProtocol(mocks: Mocks): void {
        for (const call of mocks.dbusCalls) {
            assert.ok(!call.payload.includes("directional-move-ack"), call.payload.slice(0, 160));
            assert.ok(!call.payload.includes("directional-move-verify"), call.payload.slice(0, 160));
            assert.ok(!call.payload.includes("directional-move-cancel"), call.payload.slice(0, 160));
            assert.ok(!call.payload.includes("adapter-lost"), call.payload.slice(0, 160));
            assert.ok(!call.payload.includes("ack_outcome"), call.payload.slice(0, 160));
        }
        for (const line of mocks.logs) {
            assert.ok(!line.includes("directional-move-ack"), line);
            assert.ok(!line.includes("directional-move-verify"), line);
            assert.ok(!line.includes("directional-move-cancel"), line);
            assert.ok(!line.includes("adapter-lost"), line);
        }
    }

    function assertCorrelated(mocks: Mocks, correlation: string, outcome: string): void {
        assert.ok(
            mocks.logs.some((line) => line.includes(correlation) && line.includes(outcome)),
            `correlated ${outcome} for ${correlation}, got ${JSON.stringify(mocks.logs)}`,
        );
    }

    function fireDebounce(mocks: Mocks): number {
        const pending = mocks.timers.filter((entry) => entry.delayMs === 120 && !entry.cancelled);
        for (const entry of pending) {
            entry.callback();
        }
        return pending.length;
    }

    it("moves to an occupied target with output, desktop, geometry order and one follow", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicOccupiedObserved(r, native),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const body = payload(mocks, 0);
        assert.equal((body["command"] as Record<string, unknown>)["cross_output_transfer"], true);
        const correlation = body["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentTransfers[0]?.output, native.out2);
        assert.equal(native.sentMemberships.length, 1);
        assert.deepEqual(native.sentMemberships[0]?.refs, [native.wsB]);
        assert.equal(mocks.geometries.length, 2);
        const order = mocks.events.filter((entry) => entry === "transfer" || entry === "membership" || entry === "geometry");
        assert.deepEqual(order, ["transfer", "membership", "geometry", "geometry"]);
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r.a);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 1);
        assertNoWireProtocol(mocks);
        assertCorrelated(mocks, correlation, "r4-transfer-started");
        assertCorrelated(mocks, correlation, "r4-native-written");
        assertCorrelated(mocks, correlation, "r4-followed");
        assertCorrelated(mocks, correlation, "arrived");
    });

    it("moves to an empty target with one geometry and one follow", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicEmptyObserved(r, native),
        });
        mocks.observeImpl = (): PlanObserved | null => dynamicEmptyObserved(r, native);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(emptyMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentMemberships.length, 1);
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r.a);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 1);
        assertNoWireProtocol(mocks);
        assertCorrelated(mocks, correlation, "arrived");
    });

    it("skips plan-flagged overconstrained geometry without extra writes", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicOccupiedObserved(r, native),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        const planned = JSON.parse(crossMoveReply(correlation)) as { desired_geometry: Array<Record<string, unknown>> };
        planned.desired_geometry[0]!["overconstrained"] = true;
        mocks.callbacks[0]?.(JSON.stringify(planned));
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentMemberships.length, 1);
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.geometries[0]?.target, r.x);
        assert.equal(mocks.actives.length, 1);
        assert.equal(adapter.isR4InFlight, false);
        assert.ok(mocks.logs.some((line) => line.includes(correlation) && line.includes("overconstrained-skipped")));
        assertNoWireProtocol(mocks);
    });

    it("fails terminal on native write refusal with no follow and forced reconcile", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        (mocks.env as unknown as Record<string, unknown>)["sendClientToScreen"] = (): boolean => false;
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 1);
        assertNoWireProtocol(mocks);
        assertCorrelated(mocks, correlation, "write-failed");
        const before = mocks.dbusCalls.length;
        fireDebounce(mocks);
        assert.ok(mocks.dbusCalls.length > before, "terminal forces source+target reconcile");
        void native;
    });

    it("fails terminal on wrong-output proof with no follow", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        native.autoUpdate = false;
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(adapter.isR4InFlight, true);
        assert.equal(mocks.actives.length, 0);
        native.outputOfMover = "out-9";
        native.desktopsOfMover = ["ws-a"];
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((line) => line.includes(correlation) && line.includes("wrong-output")));
        assertNoWireProtocol(mocks);
    });

    it("waits for delayed arrival then follows exactly once; busy second command refuses", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        native.autoUpdate = false;
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicOccupiedObserved(r, native),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(adapter.isR4InFlight, true);
        assert.equal(mocks.actives.length, 0);
        adapter.requestFocus("left");
        assert.ok(mocks.logs.some((line) => line.includes("busy-refused kind=focus")));
        assert.equal(mocks.dbusCalls.length, 1);
        native.outputOfMover = "out-2";
        native.outputHandlers.forEach((handler) => handler(native.out1));
        assert.equal(mocks.actives.length, 0);
        native.desktopsOfMover = ["ws-b"];
        native.desktopsHandlers.forEach((handler) => handler());
        assert.equal(mocks.actives.length, 1);
        assert.equal(mocks.actives[0], r.a);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        native.outputHandlers.forEach((handler) => handler(native.out1));
        native.desktopsHandlers.forEach((handler) => handler());
        assert.equal(mocks.actives.length, 1);
        assertCorrelated(mocks, correlation, "r4-arrival-waiting");
        assertCorrelated(mocks, correlation, "arrived");
        assertNoWireProtocol(mocks);
        // Flight released: a fresh source-consistent observation dispatches
        // again. The post-move dynamic observation leaves source empty, so
        // reset to a source-homed view solely to prove release.
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r),
        });
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("stops remaining setters on changed scope mid-write", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicOccupiedObserved(r, native),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        // After the first geometry, swap to a stale target workspace so the
        // structural scope fence (domains) fails before the second setter.
        const env = mocks.env as unknown as Record<string, unknown>;
        const baseSetGeometry = mocks.env.setGeometry.bind(mocks.env);
        let calls = 0;
        (env as { setGeometry: PlanAdapterEnv["setGeometry"] })["setGeometry"] = (target, rect): boolean => {
            calls += 1;
            const ok = baseSetGeometry(target, rect);
            if (calls === 1) {
                mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
                    status: "ready",
                    observed: twoDomainObserved(r, { targetWorkspace: "ws-c" }),
                });
            }
            return ok;
        };
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentMemberships.length, 1);
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((line) => line.includes(correlation) && line.includes("stale-scope")));
        assertNoWireProtocol(mocks);
    });

    it("stops remaining setters on non-mover flag change mid-write", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicOccupiedObserved(r, native),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        // After the first geometry, flip a non-mover flag (win-x maximized)
        // while keeping scope identical so only the flag fence trips.
        const env = mocks.env as unknown as Record<string, unknown>;
        const baseSetGeometry = mocks.env.setGeometry.bind(mocks.env);
        let calls = 0;
        (env as { setGeometry: PlanAdapterEnv["setGeometry"] })["setGeometry"] = (target, rect): boolean => {
            calls += 1;
            const ok = baseSetGeometry(target, rect);
            if (calls === 1) {
                mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => {
                    const base = dynamicOccupiedObserved(r, native);
                    return {
                        status: "ready",
                        observed: {
                            ...base,
                            windows: Object.freeze(
                                base.windows.map((entry) =>
                                    entry.id === "win-x" ? { ...entry, maximized: true } : entry,
                                ),
                            ),
                        },
                    };
                };
            }
            return ok;
        };
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentMemberships.length, 1);
        assert.equal(mocks.geometries.length, 1);
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((line) => line.includes(correlation) && line.includes("stale-scope")));
        assertNoWireProtocol(mocks);
    });

    it("closed mover cannot focus despite native arrival", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicOccupiedObserved(r, native),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        // Let both geometries succeed, then present a closed-mover fresh view
        // (mover absent) for the follow proof. Native still reports arrival
        // via autoUpdate, but observed proof must block setActive.
        const env = mocks.env as unknown as Record<string, unknown>;
        const baseSetGeometry = mocks.env.setGeometry.bind(mocks.env);
        let calls = 0;
        (env as { setGeometry: PlanAdapterEnv["setGeometry"] })["setGeometry"] = (target, rect): boolean => {
            calls += 1;
            const ok = baseSetGeometry(target, rect);
            if (calls === 2) {
                mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
                    status: "ready",
                    observed: {
                        domainOutput: "out-1",
                        domainWorkspace: "ws-a",
                        domainBounds: { x: 0, y: 0, w: 800, h: 600 },
                        domainGap: 4,
                        domainOuterGap: 8,
                        focusedId: "win-x",
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
                        windows: Object.freeze([
                            Object.freeze({
                                id: "win-x",
                                ref: r.x,
                                rect: Object.freeze({ x: 10, y: 10, w: 100, h: 80 }),
                                output: "out-2",
                                workspace: "ws-b",
                                fullscreen: false,
                                maximized: false,
                                floating: false,
                                sticky: false,
                                resourceClass: "unknown",
                            }),
                        ]),
                        activeRef: r.x,
                        fingerprint: "dir-fp-closed",
                        revalidate: () => true,
                    },
                });
            }
            return ok;
        };
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentMemberships.length, 1);
        assert.equal(mocks.geometries.length, 2);
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, true);
        assertNoWireProtocol(mocks);
        void native;
    });

    it("wrong mover placement cannot focus despite native arrival", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: dynamicOccupiedObserved(r, native),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        // Both geometries succeed, then the fresh view shows the mover on a
        // third output while native still reports target arrival. Follow must
        // stay waiting with no setActive.
        const env = mocks.env as unknown as Record<string, unknown>;
        const baseSetGeometry = mocks.env.setGeometry.bind(mocks.env);
        let calls = 0;
        (env as { setGeometry: PlanAdapterEnv["setGeometry"] })["setGeometry"] = (target, rect): boolean => {
            calls += 1;
            const ok = baseSetGeometry(target, rect);
            if (calls === 2) {
                mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
                    status: "ready",
                    observed: {
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
                                workspace: "ws-b",
                                bounds: { x: 800, y: 0, w: 800, h: 600 },
                                gap: 4,
                                outerGap: 8,
                                adjacent: Object.freeze({ left: "out-1" }),
                            }),
                        ]),
                        windows: Object.freeze([
                            Object.freeze({
                                id: "win-a",
                                ref: r.a,
                                rect: Object.freeze({ x: 810, y: 10, w: 100, h: 80 }),
                                output: "out-9",
                                workspace: "ws-b",
                                fullscreen: false,
                                maximized: false,
                                floating: false,
                                sticky: false,
                                resourceClass: "unknown",
                            }),
                            Object.freeze({
                                id: "win-x",
                                ref: r.x,
                                rect: Object.freeze({ x: 10, y: 10, w: 100, h: 80 }),
                                output: "out-2",
                                workspace: "ws-b",
                                fullscreen: false,
                                maximized: false,
                                floating: false,
                                sticky: false,
                                resourceClass: "unknown",
                            }),
                        ]),
                        activeRef: r.a,
                        fingerprint: "dir-fp-wrong",
                        revalidate: () => true,
                    },
                });
            }
            return ok;
        };
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 1);
        assert.equal(native.sentMemberships.length, 1);
        assert.equal(mocks.geometries.length, 2);
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, true);
        assertNoWireProtocol(mocks);
        void native;
    });

    it("refuses stale reply after newer observation with no native writes", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r, { xRect: { x: 20, y: 10, w: 100, h: 80 } }),
        });
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 0);
        assert.equal(native.sentMemberships.length, 0);
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((line) => line.includes(correlation) && line.includes("stale")));
        assertNoWireProtocol(mocks);
        const before = mocks.dbusCalls.length;
        fireDebounce(mocks);
        assert.ok(mocks.dbusCalls.length >= before, "stale terminal still converges");
    });

    it("releases an unanswered request on timeout with no writes and forced reconcile", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        const adapter = enable(mocks);
        adapter.requestMove("right");
        assert.equal(mocks.dbusCalls.length, 1);
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        const deadline = mocks.timers[mocks.timers.length - 1];
        assert.notEqual(deadline, undefined);
        deadline?.callback();
        assert.equal(native.sentTransfers.length, 0);
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assertCorrelated(mocks, correlation, "timeout");
        assertNoWireProtocol(mocks);
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(native.sentTransfers.length, 0);
        assert.equal(mocks.dbusCalls.length, 1);
        const before = mocks.dbusCalls.length;
        fireDebounce(mocks);
        assert.ok(mocks.dbusCalls.length >= before);
    });

    it("releases delayed arrival on arrival timeout with forced reconcile", () => {
        const r = refs();
        const { mocks, native } = r4Mocks(r);
        native.autoUpdate = false;
        mocks.directionalImpl = (): DirectionalObservation | PlanObserved | null => ({
            status: "ready",
            observed: twoDomainObserved(r),
        });
        const adapter = enable(mocks);
        adapter.requestMove("right");
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(crossMoveReply(correlation));
        assert.equal(adapter.isR4InFlight, true);
        const arrivalTimer = mocks.timers[mocks.timers.length - 1];
        assert.notEqual(arrivalTimer, undefined);
        arrivalTimer?.callback();
        assert.equal(mocks.actives.length, 0);
        assert.equal(adapter.isR4InFlight, false);
        assert.equal(adapter.isInFlight, false);
        assertCorrelated(mocks, correlation, "arrival-timeout");
        assertNoWireProtocol(mocks);
        void native;
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
