import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PLAN_CONTRACT_VERSION,
    PlanAdapter,
    type PlanAdapterEnv,
    type PlanObserved,
} from "../src/plan-adapter";
import { planShortcutCatalog } from "../src/plan-adapter-entry";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";

function makeRefs(): { a: object; b: object } {
    return { a: {}, b: {} };
}

function makeObserved(
    refs: { a: object; b: object },
    opts: {
        focused?: object;
        activeExcluded?: boolean;
        floating?: Record<string, boolean>;
        fullscreen?: Record<string, boolean>;
        maximized?: Record<string, boolean>;
        fingerprint?: string;
        rects?: Record<string, { x: number; y: number; w: number; h: number }>;
    } = {},
): PlanObserved {
    const focused = opts.focused ?? refs.a;
    const rect = (id: string): { x: number; y: number; w: number; h: number } =>
        opts.rects?.[id] ?? { x: 0, y: 0, w: 100, h: 100 };
    const flag = (id: string, table?: Record<string, boolean>): boolean => table?.[id] === true;
    const windows = Object.freeze([
        Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: rect("win-a"),
            output: "out-1",
            workspace: "ws-1",
            fullscreen: flag("win-a", opts.fullscreen),
            maximized: flag("win-a", opts.maximized),
            floating: flag("win-a", opts.floating),
            sticky: false,
            resourceClass: "unknown",
        }),
        Object.freeze({
            id: "win-b",
            ref: refs.b,
            rect: rect("win-b"),
            output: "out-1",
            workspace: "ws-1",
            fullscreen: flag("win-b", opts.fullscreen),
            maximized: flag("win-b", opts.maximized),
            floating: flag("win-b", opts.floating),
            sticky: false,
            resourceClass: "unknown",
        }),
    ]);
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: DOMAIN_GAP,
        domainOuterGap: OUTER_DOMAIN_GAP,
        focusedId: focused === refs.a ? "win-a" : "win-b",
        ...(opts.activeExcluded === true ? { activeExcluded: true as const } : {}),
        windows,
        activeRef: focused,
        fingerprint: opts.fingerprint ?? "fp-1",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object }>;
    readonly actives: object[];
    observeImpl: () => PlanObserved | null;
    tiledImpl: (output: string, workspace: string) => boolean;
    activeImpl: () => object | null;
    env: PlanAdapterEnv;
}

function mockEnv(refs: { a: object; b: object }): Mocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        logs: [],
        geometries: [],
        actives: [],
        observeImpl: (): PlanObserved | null => makeObserved(refs),
        tiledImpl: (_o: string, _w: string): boolean => true,
        activeImpl: (): object | null => refs.a,
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
            (state.dbusCalls as Array<{ payload: string }>).push({ payload });
            (state.callbacks as Array<(reply: unknown) => void>).push(callback);
        },
        scheduleOnce: (_delayMs, _callback): (() => void) => (): void => {},
        log: (message): void => {
            (state.logs as string[]).push(message);
        },
        observe: (): PlanObserved | null => (state as Mocks).observeImpl(),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target): boolean => {
            (state.geometries as Array<{ target: object }>).push({ target });
            return true;
        },
        isDomainTiled: (output, workspace): boolean => (state as Mocks).tiledImpl(output, workspace),
        setActive: (target): boolean => {
            (state.actives as object[]).push(target);
            return true;
        },
        active: (): object | null => (state as Mocks).activeImpl(),
        subscribe: (): (() => void) => (): void => {},
    };
    (state as { env: PlanAdapterEnv }).env = env;
    return state as Mocks;
}

function enableAdapter(mocks: Mocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function payload(mocks: Mocks, index: number): Record<string, unknown> {
    return JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
}

function orientReply(
    correlation: string,
    opts: {
        kind?: unknown;
        capability?: unknown;
        policyVersion?: unknown;
        extraDetail?: Record<string, unknown>;
        focusLeaf?: string | null;
        operation?: unknown;
        floatGeometry?: unknown;
        geom?: ReadonlyArray<{ window: string; rect: { x: number; y: number; w: number; h: number } }>;
    } = {},
): string {
    const detail: Record<string, unknown> = {
        kind: opts.kind ?? "toggle-orientation",
        policy_version: opts.policyVersion ?? 1,
        capability: opts.capability ?? "toggle-orientation",
        ...(opts.extraDetail ?? {}),
    };
    const geom =
        opts.geom ??
        ([
            { window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ] as const);
    const body: Record<string, unknown> = {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: 2,
        detail,
        desired_geometry: geom.map((entry) => ({
            window: entry.window,
            leaf: `${entry.window}-leaf`,
            output: "out-1",
            workspace: "ws-1",
            rect: entry.rect,
        })),
    };
    if (opts.focusLeaf === null) {
        // leave desired_focus absent
    } else {
        body["desired_focus"] = {
            domain_output: "out-1",
            domain_workspace: "ws-1",
            leaf: opts.focusLeaf ?? "win-a-leaf",
        };
    }
    if (opts.operation !== undefined) {
        body["operation"] = opts.operation;
    }
    if (opts.floatGeometry !== undefined) {
        body["float_geometry"] = opts.floatGeometry;
    }
    return JSON.stringify(body);
}

function rejectedReply(correlation: string, kind: string, detail?: string): string {
    const body: Record<string, unknown> = {
        v: 1,
        correlation_id: correlation,
        outcome: "rejected",
        kind,
        message: "no",
    };
    if (detail !== undefined) {
        body["detail"] = detail;
    }
    return JSON.stringify(body);
}

describe("toggle-orientation routing and reply validation", () => {
    it("dispatches the exact command and applies the valid reply with geometry and retained focus", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        // Native active lags the observed focus: the reply must retain
        // focus on the toggled window with exactly one activation.
        mocks.activeImpl = () => refs.b;
        const adapter = enableAdapter(mocks);
        adapter.requestToggleOrientation();
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(payload(mocks, 0)["command"], { op: "toggle-orientation", window: "win-a" });
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(orientReply(correlation));
        assert.equal(mocks.geometries.length, 2);
        assert.deepEqual(mocks.actives, [refs.a]);
        assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")));
    });

    it("refuses malformed detail, wrong kind, wrong capability, and wrong policy version without writes", () => {
        const cases: Array<{ name: string; reply: (correlation: string) => string }> = [
            { name: "wrong-kind", reply: (c) => orientReply(c, { kind: "move" }) },
            { name: "wrong-capability", reply: (c) => orientReply(c, { capability: "keyboard-resize" }) },
            { name: "wrong-policy", reply: (c) => orientReply(c, { policyVersion: 2 }) },
            { name: "extra-detail-key", reply: (c) => orientReply(c, { extraDetail: { direction: "left" } }) },
            { name: "missing-focus", reply: (c) => orientReply(c, { focusLeaf: null }) },
            {
                name: "sibling-focus",
                reply: (c) => orientReply(c, { focusLeaf: "win-b-leaf" }),
            },
            {
                name: "operation-present",
                reply: (c) =>
                    orientReply(c, {
                        operation: {
                            op: "move",
                            rule: "R4",
                            capability: "CrossOutputTransfer",
                            direction: "right",
                            window: "win-a",
                            leaf: "win-a-leaf",
                            source_output: "out-1",
                            source_workspace: "ws-1",
                            target_output: "out-1",
                            target_workspace: "ws-1",
                            source_root_child_index: 0,
                            target: "occupied",
                        },
                    }),
            },
            {
                name: "float-geometry-present",
                reply: (c) =>
                    orientReply(c, { floatGeometry: { window: "win-a", rect: { x: 0, y: 0, w: 10, h: 10 } } }),
            },
            {
                name: "partial-geometry",
                reply: (c) =>
                    orientReply(c, {
                        geom: [{ window: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 } }],
                    }),
            },
        ];
        for (const entry of cases) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            const correlation = payload(mocks, 0)["correlation_id"] as string;
            mocks.callbacks[0]?.(entry.reply(correlation));
            assert.equal(mocks.geometries.length, 0, entry.name);
            assert.equal(mocks.actives.length, 0, entry.name);
            assert.ok(
                mocks.logs.some((line) => line.includes("cause=precondition-mismatch")),
                entry.name,
            );
            assert.equal(adapter.isEnabled, true);
        }
    });

    it("drops a correlation-mismatched reply without writes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestToggleOrientation();
        const correlation = payload(mocks, 0)["correlation_id"] as string;
        mocks.callbacks[0]?.(orientReply(`${correlation}-other`));
        assert.equal(mocks.geometries.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("cause=correlation-mismatch")));
        assert.equal(adapter.isEnabled, true);
    });

    it("refuses floating focus, floating target, missing focus, and floating workspaces before dispatch", () => {
        // Floating focus via activeExcluded.
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            mocks.observeImpl = () => makeObserved(refs, { activeExcluded: true });
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            assert.equal(mocks.dbusCalls.length, 0);
            assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:toggle-orient-refused-floating"));
        }
        // Floating focused target.
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            mocks.observeImpl = () => makeObserved(refs, { floating: { "win-a": true } });
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            assert.equal(mocks.dbusCalls.length, 0);
            assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:toggle-orient-refused-floating"));
        }
        // No observation.
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            mocks.observeImpl = () => null;
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            assert.equal(mocks.dbusCalls.length, 0);
            assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:toggle-orient-refused-observe"));
        }
        // Floating workspace domain.
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            mocks.tiledImpl = () => false;
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            assert.equal(mocks.dbusCalls.length, 0);
            assert.ok(
                mocks.logs.some((l) => l === "plasma-auto-tiler:plan:toggle-orient-refused-workspace-floating"),
            );
        }
    });

    it("refuses focused fullscreen or maximized overlays before dispatch", () => {
        const cases: Array<{ name: string; observed: (refs: { a: object; b: object }) => PlanObserved; token: string }> = [
            {
                name: "focused-fullscreen",
                observed: (refs) => makeObserved(refs, { fullscreen: { "win-a": true } }),
                token: "plasma-auto-tiler:plan:toggle-orient-refused-fullscreen",
            },
            {
                name: "focused-maximized",
                observed: (refs) => makeObserved(refs, { maximized: { "win-a": true } }),
                token: "plasma-auto-tiler:plan:toggle-orient-refused-maximize",
            },
        ];
        for (const entry of cases) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            mocks.observeImpl = () => entry.observed(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            assert.equal(mocks.dbusCalls.length, 0, entry.name);
            assert.ok(mocks.logs.some((l) => l === entry.token), entry.name);
        }
    });

    it("dispatches past sibling overlays and skips their native writes on apply", () => {
        // Sibling overlays stay dispatchable like requestResize: the carried
        // snapshot preserves their slots and apply skips their writes. Seed
        // retained evidence with one clean flight so the sibling keeps its
        // tiled slot instead of the born-fullscreen hold.
        const cases: Array<{ name: string; overlay: (refs: { a: object; b: object }) => PlanObserved }> = [
            { name: "sibling-fullscreen", overlay: (refs) => makeObserved(refs, { fullscreen: { "win-b": true } }) },
            { name: "sibling-maximized", overlay: (refs) => makeObserved(refs, { maximized: { "win-b": true } }) },
        ];
        for (const entry of cases) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            const seedCorrelation = payload(mocks, 0)["correlation_id"] as string;
            mocks.callbacks[0]?.(orientReply(seedCorrelation));
            assert.equal(mocks.geometries.length, 2, `${entry.name}:seed`);
            mocks.observeImpl = () => entry.overlay(refs);
            adapter.requestToggleOrientation();
            assert.equal(mocks.dbusCalls.length, 2, `${entry.name}:dispatch`);
            assert.deepEqual(payload(mocks, 1)["command"], { op: "toggle-orientation", window: "win-a" });
            const correlation = payload(mocks, 1)["correlation_id"] as string;
            mocks.callbacks[1]?.(orientReply(correlation));
            const writes = mocks.geometries.slice(2).map((write) => write.target);
            assert.deepEqual(writes, [refs.a], `${entry.name}:overlay-skipped`);
            assert.ok(mocks.logs.some((line) => line.includes("outcome=planned-applied")), entry.name);
            assert.equal(adapter.isEnabled, true);
        }
    });

    it("surfaces lone-root no-op and floating rejections without writes", () => {
        // Lone root leaf no-op: Rust `unchanged`.
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            const correlation = payload(mocks, 0)["correlation_id"] as string;
            mocks.callbacks[0]?.(rejectedReply(correlation, "unchanged"));
            assert.equal(mocks.geometries.length, 0);
            assert.equal(mocks.actives.length, 0);
            assert.ok(mocks.logs.some((line) => line.includes("kind=toggle-orientation")));
            assert.ok(mocks.logs.some((line) => line.includes("outcome=rejected")));
            assert.equal(adapter.isEnabled, true);
        }
        // Floating subject: Rust `not-tiled`.
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            const correlation = payload(mocks, 0)["correlation_id"] as string;
            mocks.callbacks[0]?.(rejectedReply(correlation, "not-tiled"));
            assert.equal(mocks.geometries.length, 0);
            assert.equal(mocks.actives.length, 0);
            assert.ok(mocks.logs.some((line) => line.includes("outcome=rejected")));
        }
        // Snapshot-invalid details stay verbatim.
        {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestToggleOrientation();
            const correlation = payload(mocks, 0)["correlation_id"] as string;
            mocks.callbacks[0]?.(rejectedReply(correlation, "snapshot-invalid", "toggle-orient-window-invalid"));
            assert.ok(
                mocks.logs.some((line) => line.includes("detail=toggle-orient-window-invalid")),
            );
        }
    });

    it("refuses while disabled or busy", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.disable();
        adapter.requestToggleOrientation();
        assert.equal(mocks.dbusCalls.length, 0);
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:toggle-orient-refused-disabled"));
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        adapter.requestToggleOrientation();
        assert.equal(mocks.dbusCalls.length, 1);
        adapter.requestToggleOrientation();
        assert.equal(mocks.dbusCalls.length, 1);
        assert.ok(mocks.logs.some((l) => l === "plasma-auto-tiler:plan:busy-refused kind=toggle-orientation"));
    });
});

describe("toggle-orientation shortcut catalog", () => {
    it("registers Meta+O on every profile with the toggle-orientation op", () => {
        for (const profile of ["cosmic", "hyprland", "bspwm", "unknown"]) {
            const catalog = planShortcutCatalog(profile);
            const row = catalog.find((entry) => entry.action === "plasma-auto-tiler-toggle-orientation");
            assert.ok(row !== undefined, profile);
            assert.deepEqual(row, {
                action: "plasma-auto-tiler-toggle-orientation",
                text: "Toggle split orientation",
                sequence: "Meta+O",
                op: "toggle-orientation",
                direction: null,
                mode: null,
            });
            const sequences = catalog.map((entry) => entry.sequence);
            assert.equal(new Set(sequences).size, catalog.length);
        }
    });
});
