import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    MOVEMENT_CONTRACT_VERSION,
    MOVEMENT_DBUS_INTERFACE,
    MOVEMENT_DBUS_OBJECT,
    MOVEMENT_DBUS_SERVICE,
    MOVEMENT_GET_OWNER_METHOD,
    MOVEMENT_INTERFACE,
    MOVEMENT_METHOD,
    MOVEMENT_OBJECT,
    MOVEMENT_SERVICE,
    MOVEMENT_START_ALREADY,
    MOVEMENT_START_FLAGS,
    MOVEMENT_START_METHOD,
    MOVEMENT_START_PRIMARY,
    MovementAdapter,
    MovementAdapterEnv,
    MovementDomain,
    MovementObserved,
    MovementRect,
    movementFingerprint,
    orderMovementWrites,
} from "../src/movement-adapter";
import { startMovementAdapterEntry } from "../src/movement-adapter-entry";

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

interface WinState {
    readonly id: string;
    readonly ref: object;
    rect: MovementRect;
    readonly output: string;
    readonly workspace: string;
}

interface Mocks {
    readonly dbusCalls: Array<{
        service: string;
        path: string;
        iface: string;
        method: string;
        payload: string;
    }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly subscribes: string[];
    readonly unsubscribes: number[];
    readonly geometryWrites: Array<{ id: string; rect: MovementRect }>;
    focusWrites: number;
    wins: WinState[];
    domains: MovementDomain[];
    activeId: string;
    domainOutput: string;
    domainWorkspace: string;
    authorityImpl: () => boolean;
    revalidateImpl: () => boolean;
    failGeometry: boolean;
    env: MovementAdapterEnv;
    handlers: Map<string, () => void>;
}

function singleDomain(): MovementDomain[] {
    return [
        {
            output: "out-1",
            workspace: "ws-1",
            bounds: { x: 0, y: 0, w: 1920, h: 1080 },
            gap: 0,
            adjacent: {},
        },
    ];
}

function r4Domains(): MovementDomain[] {
    return [
        {
            output: "out-1",
            workspace: "ws-1",
            bounds: { x: 0, y: 0, w: 960, h: 1080 },
            gap: 0,
            adjacent: { right: "out-2" },
        },
        {
            output: "out-2",
            workspace: "ws-1",
            bounds: { x: 960, y: 0, w: 960, h: 1080 },
            gap: 0,
            adjacent: { left: "out-1" },
        },
    ];
}

function buildObserved(mocks: Mocks): MovementObserved {
    const sorted = [...mocks.wins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const activeRef = sorted.find((w) => w.id === mocks.activeId)?.ref ?? null;
    const fingerprint = JSON.stringify({ ids: sorted.map((w) => w.id), active: mocks.activeId });
    const windows = Object.freeze(
        sorted.map((w) =>
            Object.freeze({ id: w.id, ref: w.ref, rect: Object.freeze({ ...w.rect }), output: w.output, workspace: w.workspace }),
        ),
    );
    const domains = Object.freeze(mocks.domains.map((d) => Object.freeze({ ...d, bounds: Object.freeze({ ...d.bounds }), adjacent: Object.freeze({ ...d.adjacent }) })));
    return {
        domainOutput: mocks.domainOutput,
        domainWorkspace: mocks.domainWorkspace,
        focusedId: mocks.activeId,
        windows,
        domains,
        activeRef,
        fingerprint,
        revalidate: () => mocks.revalidateImpl(),
    };
}

function mockEnvTwoWindow(): Mocks {
    const a: object = {};
    const b: object = {};
    const state = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        subscribes: [],
        unsubscribes: [],
        geometryWrites: [],
        focusWrites: 0,
        wins: [
            { id: "win-a", ref: a, rect: { x: 0, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: b, rect: { x: 960, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1" },
        ] as WinState[],
        domains: singleDomain(),
        activeId: "win-a",
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        authorityImpl: () => true,
        revalidateImpl: () => true,
        failGeometry: false,
        handlers: new Map<string, () => void>(),
    } as unknown as Mocks;
    const env: MovementAdapterEnv = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            state.dbusCalls.push({ service, path, iface, method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            void delayMs;
            const entry = { callback, cancelled: false };
            state.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): MovementObserved | null => buildObserved(state),
        setGeometry: (target, rect): boolean => {
            if (state.failGeometry) {
                return false;
            }
            const hit = state.wins.find((w) => w.ref === target);
            if (hit === undefined) {
                return false;
            }
            hit.rect = { ...rect };
            state.geometryWrites.push({ id: hit.id, rect: { ...rect } });
            return true;
        },
        setActive: (target): boolean => {
            const hit = state.wins.find((w) => w.ref === target);
            if (hit === undefined) {
                return false;
            }
            state.focusWrites += 1;
            state.activeId = hit.id;
            return true;
        },
        active: (): object | null => state.wins.find((w) => w.id === state.activeId)?.ref ?? null,
        hasExclusiveMovementAuthority: (): boolean => state.authorityImpl(),
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push(kind);
            state.handlers.set(kind, handler);
            return (): void => {
                state.unsubscribes.push(1);
            };
        },
    };
    (state as { env: MovementAdapterEnv }).env = env;
    return state;
}

function enableAdapter(mocks: Mocks): MovementAdapter {
    const adapter = new MovementAdapter(mocks.env);
    assert.equal(adapter.isEnabled, false);
    const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
    assert.equal(ok, true);
    return adapter;
}

function firstPayload(mocks: Mocks): Record<string, unknown> {
    const planner = mocks.dbusCalls.find((call) => call.method === MOVEMENT_METHOD);
    assert.ok(planner !== undefined);
    return JSON.parse(planner.payload) as Record<string, unknown>;
}

const PINNED_OWNER = ":1.42";

// Drives the initial GetNameOwner phase with a present unique owner, so the
// next D-Bus call is the pinned planner request with no service activation.
function driveOwnerPresent(mocks: Mocks, owner: string = PINNED_OWNER): void {
    assert.ok(mocks.callbacks[0] !== undefined);
    mocks.callbacks[0]?.(owner);
}

function plannerCallIndex(mocks: Mocks): number {
    const index = mocks.dbusCalls.findIndex((call) => call.method === MOVEMENT_METHOD);
    assert.ok(index >= 0);
    return index;
}

function swappedGeometry(): Array<Record<string, unknown>> {
    return [
        { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 960, y: 0, w: 960, h: 1080 } },
        { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 960, h: 1080 } },
    ];
}

const PRECONDITIONS: Record<string, string[]> = {
    WrapPerpendicular: ["focused-leaf-occupied-by-focused-window", "container-is-direct-parent", "adapter-must-verify-postconditions"],
    SwapNeighbor: ["focused-leaf-occupied-by-focused-window", "neighbor-leaf-occupied", "container-is-direct-parent", "adapter-must-verify-postconditions"],
    InsertIntoGroup: ["focused-leaf-occupied-by-focused-window", "container-is-direct-parent", "target-group-membership", "adapter-must-verify-postconditions"],
    SplitGroupChild: ["focused-leaf-occupied-by-focused-window", "neighbor-leaf-occupied", "container-is-direct-parent", "target-group-membership", "adapter-must-verify-postconditions"],
    WrapNeighbor: ["focused-leaf-occupied-by-focused-window", "neighbor-leaf-occupied", "container-is-direct-parent", "adapter-must-verify-postconditions"],
    EscapeParent: ["focused-leaf-occupied-by-focused-window", "container-is-direct-parent", "parent-group-membership", "adapter-must-verify-postconditions"],
    CrossOutput: ["focused-leaf-occupied-by-focused-window", "source-root-membership-and-adjacent-same-workspace-output", "adapter-must-verify-postconditions"],
};

function operationFor(kind: string): Record<string, unknown> {
    switch (kind) {
        case "WrapPerpendicular":
            return { kind, rule: "R1", container: "cont-1", axis: "horizontal" };
        case "SwapNeighbor":
            return { kind, rule: "R2a", container: "cont-1", neighbor: "leaf-b" };
        case "InsertIntoGroup":
            return { kind, rule: "R2b", container: "cont-1", target_group: "group-1", insertion_index: 0, insertion: "near-edge" };
        case "SplitGroupChild":
            return { kind, rule: "R2b", container: "cont-1", target_group: "group-1", target_child: "leaf-c", target_child_index: 0, focused_side: "second", axis: "horizontal" };
        case "WrapNeighbor":
            return { kind, rule: "R2c", container: "cont-1", neighbor: "leaf-b", focused_before_neighbor: true, axis: "horizontal" };
        case "EscapeParent":
            return { kind, rule: "R3", container: "cont-1", parent: "parent-1", container_child_index: 0, parent_insertion_index: 1, continuation: "none" };
        case "CrossOutput":
            return { kind, rule: "R4", target_output: "out-2", source_root_child_index: 0, target: "empty" };
        default:
            throw new Error("unknown kind");
    }
}

function capabilityFor(kind: string): string {
    switch (kind) {
        case "WrapPerpendicular": return "wrap-perpendicular";
        case "SwapNeighbor": return "swap-neighbor";
        case "InsertIntoGroup": return "insert-child";
        case "SplitGroupChild": return "split-group-child";
        case "WrapNeighbor": return "wrap-siblings";
        case "EscapeParent": return "reparent-leaf";
        case "CrossOutput": return "cross-output-transfer";
        default: throw new Error("unknown");
    }
}

function ruleFor(kind: string): string {
    const op = operationFor(kind);
    return op["rule"] as string;
}

function plannedReply(
    correlation: string,
    baseRevision: number,
    kind: string,
    geometry: Array<Record<string, unknown>> = swappedGeometry(),
): string {
    return JSON.stringify({
        v: MOVEMENT_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: baseRevision,
        capability: capabilityFor(kind),
        rule: ruleFor(kind),
        preconditions: PRECONDITIONS[kind],
        operation: operationFor(kind),
        desired_geometry: geometry,
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-a" },
    });
}

function ackReply(correlation: string, baseRevision: number): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: baseRevision });
}

interface EntrySignal {
    readonly connect: (handler: () => void) => void;
    readonly disconnect: (handler: () => void) => void;
    readonly fire: () => void;
}

function makeEntrySignal(): EntrySignal {
    const handlers = new Set<() => void>();
    return {
        connect: (handler): void => {
            handlers.add(handler);
        },
        disconnect: (handler): void => {
            handlers.delete(handler);
        },
        fire: (): void => {
            for (const handler of [...handlers]) {
                handler();
            }
        },
    };
}

interface EntryWorld {
    readonly surface: Record<string, unknown>;
    readonly dbusCalls: Array<{
        service: string;
        path: string;
        iface: string;
        method: string;
        payload: string;
    }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
}

function makeR4EntryWorld(fractionalArea: boolean): EntryWorld {
    const output1 = { name: "out-1" };
    const output2 = { name: "out-2" };
    const desktop = { id: "ws-1" };
    const areas = new Map<object, { x: number; y: number; width: number; height: number }>([
        [output1, { x: 0, y: 0, width: 960, height: 1080 }],
        [
            output2,
            fractionalArea
                ? { x: 960, y: 0, width: 960.5, height: 1080 }
                : { x: 960, y: 0, width: 960, height: 1080 },
        ],
    ]);
    const winA: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        output: output1,
        desktops: [desktop],
        internalId: "win-a",
        frameGeometry: { x: 0, y: 0, width: 960, height: 1080 },
        moveResizedChanged: makeEntrySignal(),
    };
    const winB: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        output: output2,
        desktops: [desktop],
        internalId: "win-b",
        frameGeometry: { x: 960, y: 0, width: 960, height: 1080 },
        moveResizedChanged: makeEntrySignal(),
    };
    const surface: Record<string, unknown> = {
        activeWindow: winA,
        windowList: (): Array<Record<string, unknown>> => [winA, winB],
        screens: [output1, output2],
        currentDesktopForScreen: (): Record<string, unknown> => desktop,
        clientArea: (_kind: unknown, output: unknown): unknown => areas.get(output as object) ?? null,
        windowActivated: makeEntrySignal(),
        windowAdded: makeEntrySignal(),
        windowRemoved: makeEntrySignal(),
        screensChanged: makeEntrySignal(),
        currentDesktopChanged: makeEntrySignal(),
    };
    const world: EntryWorld = { surface, dbusCalls: [], callbacks: [], logs: [] };
    return world;
}

function startR4Entry(world: EntryWorld): ReturnType<typeof startMovementAdapterEntry> {
    return startMovementAdapterEntry({
        workspace: world.surface,
        callDbus: (service, path, iface, method, payload, callback): void => {
            world.dbusCalls.push({ service, path, iface, method, payload });
            world.callbacks.push(callback);
        },
        scheduleOnce: (): (() => void) => () => {},
        log: (message): void => {
            world.logs.push(message);
        },
        owner: "owner-1",
        generation: "gen-1",
        hasExclusiveMovementAuthority: (): boolean => true,
    });
}

describe("movement entry observation end to end", () => {
    it("derives reciprocal R4 adjacency live from work-area geometry in the request payload", () => {
        const world = makeR4EntryWorld(false);
        const handle = startR4Entry(world);
        assert.ok(handle !== null);
        handle.request("right");
        assert.equal(world.dbusCalls.length, 1);
        // Activation first resolves the Planner name; reply present so the
        // planner request follows with no service activation.
        world.callbacks[0]?.(PINNED_OWNER);
        assert.equal(world.dbusCalls.length, 2);
        const planner = world.dbusCalls.find((call) => call.method === MOVEMENT_METHOD);
        assert.ok(planner !== undefined);
        const payload = JSON.parse(planner.payload) as Record<string, unknown>;
        assert.equal(payload["direction"], "right");
        const domains = payload["domains"] as Array<Record<string, unknown>>;
        assert.equal(domains.length, 2);
        const byOutput = new Map<string, Record<string, unknown>>();
        for (const domain of domains) {
            byOutput.set(domain["output"] as string, domain);
        }
        // Edge contact (960) plus full orthogonal overlap derives reciprocal
        // cardinal adjacency purely from the public work areas.
        assert.deepEqual(byOutput.get("out-1")?.["adjacent"], { right: "out-2" });
        assert.deepEqual(byOutput.get("out-2")?.["adjacent"], { left: "out-1" });
        assert.deepEqual(byOutput.get("out-1")?.["bounds"], { x: 0, y: 0, w: 960, h: 1080 });
        assert.deepEqual(byOutput.get("out-2")?.["bounds"], { x: 960, y: 0, w: 960, h: 1080 });
        handle.stop();
    });

    it("quantizes fractional QRectF work-area geometry with integer wire bounds", () => {
        const world = makeR4EntryWorld(true);
        const handle = startR4Entry(world);
        assert.ok(handle !== null);
        handle.request("right");
        assert.equal(world.dbusCalls.length, 1);
        world.callbacks[0]?.(PINNED_OWNER);
        assert.equal(world.dbusCalls.length, 2);
        const planner = world.dbusCalls.find((call) => call.method === MOVEMENT_METHOD);
        assert.ok(planner !== undefined);
        const payload = JSON.parse(planner.payload) as Record<string, unknown>;
        const domains = payload["domains"] as Array<Record<string, unknown>>;
        const byOutput = new Map<string, Record<string, unknown>>();
        for (const domain of domains) {
            byOutput.set(domain["output"] as string, domain);
        }
        // 960.5 quantizes to 961; integer Rust wire contract preserved.
        assert.deepEqual(byOutput.get("out-2")?.["bounds"], { x: 960, y: 0, w: 961, h: 1080 });
        for (const domain of domains) {
            const bounds = domain["bounds"] as Record<string, unknown>;
            for (const key of ["x", "y", "w", "h"]) {
                assert.equal(Number.isInteger(bounds[key]), true);
            }
        }
        handle.stop();
    });
});

describe("movement adapter disabled default", () => {
    it("rejects requests while disabled with no write and no bus call", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = new MovementAdapter(mocks.env);
        adapter.requestMovement("right");
        assert.ok(mocks.logs.some((l) => l.includes("movement-disabled")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.geometryWrites.length, 0);
    });
});

describe("movement adapter exclusive authority", () => {
    it("refuses before mutation when authority is false and disables", () => {
        const mocks = mockEnvTwoWindow();
        mocks.authorityImpl = () => false;
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        assert.ok(mocks.logs.some((l) => l.includes("movement-exclusive-conflict")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, false);
    });

    it("rechecks authority before native writes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.authorityImpl = () => false;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-exclusive-conflict")));
        assert.equal(adapter.isEnabled, false);
    });
});

describe("movement adapter request binding and revalidation", () => {
    it("binds owner, generation, revision N, direction, opaque source and full capabilities over DescribeMovement", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(MOVEMENT_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(MOVEMENT_METHOD, "DescribeMovement");
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        assert.equal(payload["owner"], "owner-1");
        assert.equal(payload["generation"], "gen-1");
        assert.equal(payload["revision"], 2);
        assert.equal(payload["direction"], "right");
        assert.equal(payload["focused_window"], "win-a");
        const caps = payload["capabilities"] as Record<string, unknown>;
        for (const key of ["swap_neighbor", "wrap_perpendicular", "wrap_siblings", "insert_child", "split_group_child", "reparent_leaf", "cross_output_transfer"]) {
            assert.equal(caps[key], true);
        }
        assert.equal(typeof payload["fingerprint"], "number");
        assert.notEqual(payload["fingerprint"], 0);
        const expected = movementFingerprint("out-1", "ws-1", "win-a", ["win-a", "win-b"]);
        assert.equal(payload["fingerprint"], expected);
    });

    it("includes observed current-workspace output domains with bounds in request", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = r4Domains();
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 960, y: 0, w: 960, h: 1080 }, output: "out-2", workspace: "ws-1" },
        ];
        mocks.activeId = "win-a";
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const domains = payload["domains"] as Array<Record<string, unknown>>;
        assert.equal(domains.length, 2);
        const outputs = domains.map((d) => d["output"] as string).sort();
        assert.deepEqual(outputs, ["out-1", "out-2"]);
        for (const d of domains) {
            assert.ok(typeof d["bounds"] === "object");
            assert.equal(typeof d["gap"], "number");
            assert.ok(typeof d["adjacent"] === "object");
        }
    });

    it("fails closed on stale revalidation with no write", () => {
        const mocks = mockEnvTwoWindow();
        mocks.revalidateImpl = () => false;
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-stale-revalidate")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects a second request while one is in flight", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        adapter.requestMovement("left");
        assert.ok(mocks.logs.some((l) => l.includes("movement-busy")));
        assert.equal(mocks.dbusCalls.length, 1);
    });
});

describe("movement adapter R1-R4 plan shapes apply behaviorally", () => {
    for (const kind of ["WrapPerpendicular", "SwapNeighbor", "InsertIntoGroup", "SplitGroupChild", "WrapNeighbor", "EscapeParent"] as const) {
        it(`${kind} writes swapped geometry then acks and verifies to applied`, () => {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            adapter.requestMovement("right");
            driveOwnerPresent(mocks);
            const payload = firstPayload(mocks);
            const correlation = payload["correlation_id"] as string;
            mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, kind));
            assert.equal(mocks.dbusCalls.length, 3);
            assert.equal(mocks.geometryWrites.length, 2);
            const ack = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
            assert.equal(ack["outcome"], "accepted");
            mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
            assert.equal(mocks.dbusCalls.length, 4);
            const verify = JSON.parse((mocks.dbusCalls[3] as { payload: string }).payload) as Record<string, unknown>;
            assert.equal(verify["action"], "verify");
            assert.equal((verify["verified_geometry"] as Array<Record<string, unknown>>).length, 2);
            mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: (payload["revision"] as number) + 1 }));
            assert.ok(mocks.logs.some((l) => l.includes("movement:applied")));
            assert.equal(adapter.isEnabled, true);
        });
    }

    it("CrossOutput applies with R4 domains", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = r4Domains();
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 960, y: 0, w: 960, h: 1080 }, output: "out-2", workspace: "ws-1" },
        ];
        const crossGeometry = [
            { window: "win-a", leaf: "leaf-a", output: "out-2", workspace: "ws-1", rect: { x: 960, y: 0, w: 480, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-2", workspace: "ws-1", rect: { x: 1440, y: 0, w: 480, h: 1080 } },
        ];
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        // R4 desired need not fill a single domain; overlap-free within target is enough.
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "CrossOutput", crossGeometry));
        // CrossOutput geometry above packs out-2 exactly (480+480=960) so no gap error.
        assert.equal(mocks.geometryWrites.length, 2);
    });

    it("CrossOutput rejects a target that is not current-direction adjacent before any write", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = r4Domains();
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 960, y: 0, w: 960, h: 1080 }, output: "out-2", workspace: "ws-1" },
        ];
        const crossGeometry = [
            { window: "win-a", leaf: "leaf-a", output: "out-2", workspace: "ws-1", rect: { x: 960, y: 0, w: 480, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-2", workspace: "ws-1", rect: { x: 1440, y: 0, w: 480, h: 1080 } },
        ];
        const adapter = enableAdapter(mocks);
        // out-2 is right-adjacent to the source, so a plan moving left into
        // it is not current-direction reciprocal and must be refused.
        adapter.requestMovement("left");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        assert.equal(payload["direction"], "left");
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "CrossOutput", crossGeometry));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-target-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects non-reciprocal observed adjacency fail-closed with no bus call", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = [
            {
                output: "out-1",
                workspace: "ws-1",
                bounds: { x: 0, y: 0, w: 960, h: 1080 },
                gap: 0,
                adjacent: { right: "out-2" },
            },
            {
                output: "out-2",
                workspace: "ws-1",
                bounds: { x: 960, y: 0, w: 960, h: 1080 },
                gap: 0,
                adjacent: {},
            },
        ];
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        assert.ok(mocks.logs.some((l) => l.includes("movement-stale-scope")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, false);
    });

    it("CrossOutput rejects an unaccounted gap in the multi-domain target", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = r4Domains();
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 960, y: 0, w: 960, h: 1080 }, output: "out-2", workspace: "ws-1" },
        ];
        // Contained and overlap-free in out-2, but 480+400=880 leaves 80px
        // of zero-gap work area unaccounted.
        const gapped = [
            { window: "win-a", leaf: "leaf-a", output: "out-2", workspace: "ws-1", rect: { x: 960, y: 0, w: 480, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-2", workspace: "ws-1", rect: { x: 1440, y: 0, w: 400, h: 1080 } },
        ];
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "CrossOutput", gapped));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-gap-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("CrossOutput rejects incomplete multi-domain coverage before any write", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = r4Domains();
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 960, y: 0, w: 960, h: 1080 }, output: "out-2", workspace: "ws-1" },
        ];
        // win-b is dropped from the desired projection: identity/coverage
        // mismatch even though the single entry is contained.
        const partial = [
            { window: "win-a", leaf: "leaf-a", output: "out-2", workspace: "ws-1", rect: { x: 960, y: 0, w: 960, h: 1080 } },
        ];
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "CrossOutput", partial));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-target-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });
});

describe("movement adapter changed-only and deterministic ordering", () => {
    it("writes only changed windows through adapter behavior exactly once each", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = [{ output: "out-1", workspace: "ws-1", bounds: { x: 0, y: 0, w: 1920, h: 1080 }, gap: 0, adjacent: {} }];
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 640, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 640, y: 0, w: 640, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-c", ref: {}, rect: { x: 1280, y: 0, w: 640, h: 1080 }, output: "out-1", workspace: "ws-1" },
        ];
        // win-a keeps its rectangle; win-b and win-c swap. The adapter must
        // write exactly the two changed windows, one write each.
        const partialSwap = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 640, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 1280, y: 0, w: 640, h: 1080 } },
            { window: "win-c", leaf: "leaf-c", output: "out-1", workspace: "ws-1", rect: { x: 640, y: 0, w: 640, h: 1080 } },
        ];
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor", partialSwap));
        assert.equal(mocks.geometryWrites.length, 2);
        assert.deepEqual(mocks.geometryWrites.map((w) => w.id), ["win-b", "win-c"]);
    });

    it("applies growing covering rectangles before shrinking ones", () => {
        const mocks = mockEnvTwoWindow();
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 640, h: 1080 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 640, y: 0, w: 1280, h: 1080 }, output: "out-1", workspace: "ws-1" },
        ];
        const growFirst = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1280, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 1280, y: 0, w: 640, h: 1080 } },
        ];
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor", growFirst));
        assert.equal(mocks.geometryWrites.length, 2);
        assert.equal((mocks.geometryWrites[0] as { id: string }).id, "win-a");
        assert.equal((mocks.geometryWrites[1] as { id: string }).id, "win-b");
    });

    it("handles N-window swaps and cycles without dropped or duplicate writes", () => {
        const old = new Map<string, MovementRect>([
            ["win-a", { x: 0, y: 0, w: 400, h: 600 }],
            ["win-b", { x: 400, y: 0, w: 400, h: 600 }],
            ["win-c", { x: 800, y: 0, w: 400, h: 600 }],
        ]);
        const desired = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 400, y: 0, w: 400, h: 600 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 800, y: 0, w: 400, h: 600 } },
            { window: "win-c", leaf: "leaf-c", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 400, h: 600 } },
        ];
        const ordered = orderMovementWrites(old, desired);
        assert.equal(ordered.length, 3);
        assert.deepEqual(ordered.map((e) => e.window), ["win-a", "win-b", "win-c"]);
    });

    it("applies a 3-window cycle natively exactly once each in lexical order", () => {
        const mocks = mockEnvTwoWindow();
        mocks.domains = [{ output: "out-1", workspace: "ws-1", bounds: { x: 0, y: 0, w: 1200, h: 600 }, gap: 0, adjacent: {} }];
        mocks.wins = [
            { id: "win-a", ref: {}, rect: { x: 0, y: 0, w: 400, h: 600 }, output: "out-1", workspace: "ws-1" },
            { id: "win-b", ref: {}, rect: { x: 400, y: 0, w: 400, h: 600 }, output: "out-1", workspace: "ws-1" },
            { id: "win-c", ref: {}, rect: { x: 800, y: 0, w: 400, h: 600 }, output: "out-1", workspace: "ws-1" },
        ];
        const cycle = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 400, y: 0, w: 400, h: 600 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 800, y: 0, w: 400, h: 600 } },
            { window: "win-c", leaf: "leaf-c", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 400, h: 600 } },
        ];
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        // Use a valid R2a-shaped operation; geometry cycle is what matters here.
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor", cycle));
        assert.equal(mocks.geometryWrites.length, 3);
        assert.deepEqual(mocks.geometryWrites.map((w) => w.id), ["win-a", "win-b", "win-c"]);
    });
});

describe("movement adapter noop and refusal", () => {
    it("treats service noop with zero writes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "noop", kind: "planner-noop", message: "no change" }));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement:noop")));
    });

    it("fails closed on rejected with no write", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "rejected", kind: "snapshot-invalid", message: "bad" }));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-rejected")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects partial operation shapes before any write", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        const bad = JSON.parse(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor")) as Record<string, unknown>;
        const op = { ...(bad["operation"] as Record<string, unknown>) };
        delete op["neighbor"];
        mocks.callbacks[1]?.(JSON.stringify({ ...bad, operation: op }));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-precondition-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects extra reply fields before any write", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        const bad = JSON.parse(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor")) as Record<string, unknown>;
        (bad as Record<string, unknown>)["extra"] = 1;
        mocks.callbacks[1]?.(JSON.stringify(bad));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, false);
    });
});

describe("movement adapter recursion guard and invalidation", () => {
    it("guards adapter-originated geometry signals without invalidating", () => {
        const mocks = mockEnvTwoWindow();
        let geometryHandler: (() => void) | null = null;
        const env: MovementAdapterEnv = {
            ...mocks.env,
            subscribe: (kind, handler) => {
                if (kind === "geometry") {
                    geometryHandler = handler;
                    return (): void => {
                        mocks.unsubscribes.push(1);
                    };
                }
                return mocks.env.subscribe(kind, handler);
            },
            setGeometry: (target, rect): boolean => {
                const ok = mocks.env.setGeometry(target, rect);
                // KWin re-entrantly emits geometry for the own write; the
                // guard must swallow it so the transaction still commits.
                try {
                    geometryHandler?.();
                } catch (error) {
                    void error;
                }
                return ok;
            },
        };
        const adapter = new MovementAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestMovement("right");
        mocks.callbacks[0]?.(PINNED_OWNER);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 2);
        assert.ok(!mocks.logs.some((l) => l.includes("movement-signal-invalid")));
        mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
        mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: (payload["revision"] as number) + 1 }));
        assert.ok(mocks.logs.some((l) => l.includes("movement:applied")));
        assert.equal(adapter.isEnabled, true);
    });

    it("fails closed on an unrelated geometry change inside the write transaction", () => {
        const mocks = mockEnvTwoWindow();
        let geometryHandler: (() => void) | null = null;
        const env: MovementAdapterEnv = {
            ...mocks.env,
            subscribe: (kind, handler) => {
                if (kind === "geometry") {
                    geometryHandler = handler;
                    return (): void => {
                        mocks.unsubscribes.push(1);
                    };
                }
                return mocks.env.subscribe(kind, handler);
            },
            setGeometry: (target, rect): boolean => {
                const ok = mocks.env.setGeometry(target, rect);
                // An unrelated native change lands with the own-write
                // emission (swallowed by the guard) and corrupts a window the
                // plan never touched in this write.
                const hit = mocks.wins.find((w) => w.ref === target);
                const other = mocks.wins.find((w) => w.ref !== target && w.id !== hit?.id);
                if (other !== undefined) {
                    other.rect = { x: 5, y: 5, w: 100, h: 100 };
                }
                try {
                    geometryHandler?.();
                } catch (error) {
                    void error;
                }
                return ok;
            },
        };
        const adapter = new MovementAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestMovement("right");
        mocks.callbacks[0]?.(PINNED_OWNER);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        // Only the first write lands; active-transaction revalidation
        // catches the unrelated rect before the second write.
        assert.equal(mocks.geometryWrites.length, 1);
        assert.ok(mocks.logs.some((l) => l.includes("movement-signal-invalid")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 3);
        const loss = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["outcome"], "adapter-lost");
    });

    it("invalidates terminally on unrelated geometry-independent signals", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        mocks.handlers.get("added")?.();
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-signal-invalid")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 3);
        const loss = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["outcome"], "adapter-lost");
    });

    it("suppresses own geometry signals during sequential writes and still commits", () => {
        const mocks = mockEnvTwoWindow();
        let geometryHandler: (() => void) | null = null;
        const env: MovementAdapterEnv = {
            ...mocks.env,
            subscribe: (kind, handler) => {
                if (kind === "geometry") {
                    geometryHandler = handler;
                    return (): void => {
                        mocks.unsubscribes.push(1);
                    };
                }
                return mocks.env.subscribe(kind, handler);
            },
            setGeometry: (target, rect): boolean => {
                const ok = mocks.env.setGeometry(target, rect);
                // KWin emits geometry for the own write; guard must ignore it.
                try {
                    geometryHandler?.();
                } catch (error) {
                    void error;
                }
                return ok;
            },
        };
        const adapter = new MovementAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestMovement("right");
        mocks.callbacks[0]?.(PINNED_OWNER);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 2);
        assert.ok(!mocks.logs.some((l) => l.includes("movement-signal-invalid")));
        mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
        mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: (payload["revision"] as number) + 1 }));
        assert.ok(mocks.logs.some((l) => l.includes("movement:applied")));
    });
});

describe("movement adapter focus retention", () => {
    it("restores focus to the moved window after forced focus loss", () => {
        const mocks = mockEnvTwoWindow();
        const env: MovementAdapterEnv = {
            ...mocks.env,
            setGeometry: (target, rect): boolean => {
                const ok = mocks.env.setGeometry(target, rect);
                // Native stacking steals focus to the untouched window on
                // every own write; the adapter must restore it to the mover.
                mocks.activeId = "win-b";
                return ok;
            },
        };
        const adapter = new MovementAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestMovement("right");
        mocks.callbacks[0]?.(PINNED_OWNER);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 2);
        // Focus was stolen mid-apply and restored to the moved window.
        assert.ok(mocks.focusWrites >= 1);
        assert.equal(mocks.activeId, "win-a");
        mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
        mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: (payload["revision"] as number) + 1 }));
        assert.ok(mocks.logs.some((l) => l.includes("movement:applied")));
        assert.equal(adapter.isEnabled, true);
    });

    it("rejects post-observation focus drift before verify", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.dbusCalls.length, 3);
        // Focus drifts to the untouched window after native writes.
        mocks.activeId = "win-b";
        mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
        assert.ok(mocks.logs.some((l) => l.includes("movement-post-mismatch")));
        assert.equal(adapter.isEnabled, false);
        assert.ok(
            !mocks.dbusCalls.some((c) => {
                if (c.method !== MOVEMENT_METHOD) {
                    return false;
                }
                try {
                    return (JSON.parse(c.payload) as Record<string, unknown>)["action"] === "verify";
                } catch (error) {
                    void error;
                    return false;
                }
            }),
        );
    });
});

describe("movement adapter fail-close loss and divergence", () => {
    it("reports loss once on partial apply with no retry", () => {
        const mocks = mockEnvTwoWindow();
        mocks.failGeometry = true;
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(mocks.dbusCalls.length, 3);
        const loss = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["outcome"], "adapter-lost");
        assert.equal(loss["correlation_id"], correlation);
        assert.ok(mocks.logs.some((l) => l.includes("movement-partial-apply")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on post mismatch with loss", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.dbusCalls.length, 3);
        // Corrupt post-observation after native writes but before ack so the
        // verify-time fresh projection mismatches the desired geometry.
        mocks.wins[0]!.rect = { x: 5, y: 5, w: 100, h: 100 };
        mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
        assert.ok(mocks.logs.some((l) => l.includes("movement-post-mismatch")));
        assert.equal(adapter.isEnabled, false);
        assert.ok(
            !mocks.dbusCalls.some((c) => {
                if (c.method !== MOVEMENT_METHOD) {
                    return false;
                }
                try {
                    return (JSON.parse(c.payload) as Record<string, unknown>)["action"] === "verify";
                } catch (error) {
                    void error;
                    return false;
                }
            }),
        );
    });

    it("fails closed on ack correlation mismatch with loss and no verify", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        mocks.callbacks[2]?.(ackReply("other-corr", 0));
        assert.equal(mocks.dbusCalls.length, 4);
        const loss = JSON.parse((mocks.dbusCalls[3] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["outcome"], "adapter-lost");
        assert.ok(
            !mocks.dbusCalls.some((c) => {
                if (c.method !== MOVEMENT_METHOD) {
                    return false;
                }
                try {
                    return (JSON.parse(c.payload) as Record<string, unknown>)["action"] === "verify";
                } catch (error) {
                    void error;
                    return false;
                }
            }),
        );
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on malformed service reply with no write", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        mocks.callbacks[1]?.("not-json");
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-service-fault")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects a base-revision mismatch with no write", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        const revision = payload["revision"] as number;
        mocks.callbacks[1]?.(plannedReply(correlation, revision + 1, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-revision-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("stays fail-closed when D-Bus itself is lost", () => {
        const mocks = mockEnvTwoWindow();
        let lossCalls = 0;
        const env: MovementAdapterEnv = {
            ...mocks.env,
            callDbus: (service, path, iface, method, payload, callback): void => {
                // Daemon owner calls carry the well-known name, never JSON.
                if (method === MOVEMENT_GET_OWNER_METHOD || method === MOVEMENT_START_METHOD) {
                    mocks.dbusCalls.push({ service, path, iface, method, payload });
                    mocks.callbacks.push(callback);
                    return;
                }
                let parsed: Record<string, unknown> | null = null;
                try {
                    parsed = JSON.parse(payload) as Record<string, unknown>;
                } catch (error) {
                    void error;
                    parsed = null;
                }
                if (parsed !== null && parsed["outcome"] === "adapter-lost") {
                    lossCalls += 1;
                    throw new Error("dbus-lost");
                }
                mocks.dbusCalls.push({ service, path, iface, method, payload });
                mocks.callbacks.push(callback);
            },
        };
        const adapter = new MovementAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.revalidateImpl = () => false;
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(lossCalls, 1);
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects overlapping desired projection before any write", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const overlapping = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 800, y: 0, w: 1120, h: 1080 } },
        ];
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor", overlapping));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-overlap-mismatch")));
    });

    it("rejects missing-window projection before any write", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const missing = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1920, h: 1080 } },
        ];
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor", missing));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-target-mismatch")));
    });

    it("disconnects all six subscriptions on disable", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(mocks.subscribes.length, 6);
        adapter.disable();
        assert.equal(mocks.unsubscribes.length, 6);
    });
});

describe("movement adapter source hygiene and production isolation", () => {
    it("uses the narrow movement route and redacted logs only", () => {
        assert.equal(MOVEMENT_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(MOVEMENT_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(MOVEMENT_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(MOVEMENT_METHOD, "DescribeMovement");
    });

    it("emits no raw identity in logs", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
        mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: (payload["revision"] as number) + 1 }));
        for (const line of mocks.logs) {
            assert.ok(!line.includes("win-a"));
            assert.ok(!line.includes("win-b"));
            assert.ok(!line.includes("owner-1"));
        }
    });

    it("source performs no forbidden tiling, shortcut, config, or polling access", () => {
        const src = readFileSync(join(kwinSrcDir(), "movement-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "movement-adapter-entry.ts"), "utf8");
        for (const body of [src, entry]) {
            assert.ok(!body.includes("rootTile"));
            assert.ok(!body.includes("relativeGeometry"));
            assert.ok(!body.includes("registerShortcut"));
            assert.ok(!body.includes("registerSessionShortcut"));
            assert.ok(!body.includes("readConfig"));
            assert.ok(!body.includes("writeConfig"));
            assert.ok(!body.includes("createDesktop"));
            assert.ok(!body.includes("removeDesktop"));
            assert.ok(!body.includes("showOutline"));
            assert.ok(!body.includes("setTimeout"));
            assert.ok(!body.includes("setInterval"));
            assert.ok(!body.includes("requestAnimationFrame"));
            assert.ok(!body.includes("waitFor"));
        }
        assert.ok(!src.includes("fallback"));
        assert.ok(!entry.includes("fallback"));
    });

    it("allows only the bounded service-response timeout with no configure barrier", () => {
        const src = readFileSync(join(kwinSrcDir(), "movement-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "movement-adapter-entry.ts"), "utf8");
        // The bounded D-Bus response timeout is the only timer path.
        assert.ok(src.includes("MOVEMENT_TIMEOUT_MS"));
        assert.ok(src.includes("scheduleOnce"));
        assert.ok(entry.includes("scheduleOnce"));
        // No polling loop and no configure-barrier wait: writes are applied
        // sequentially with no barrier and no timer polling.
        assert.ok(src.includes("no configure barrier"));
        assert.ok(!src.includes("configureBarrier"));
        assert.ok(!entry.includes("configureBarrier"));
        assert.ok(!src.includes("pollFor"));
        assert.ok(!entry.includes("pollFor"));
    });

    it("production startup activates the adapter only through the mode-gated dispatcher", () => {
        const entry = readFileSync(join(kwinSrcDir(), "entry.ts"), "utf8");
        assert.ok(!entry.includes("movement-adapter"));
        assert.ok(!entry.includes("MovementAdapter"));
        assert.ok(!entry.includes("startMovementAdapterEntry"));
        assert.ok(!entry.includes("DescribeMovement"));
        const authority = readFileSync(join(kwinSrcDir(), "engine-authority.ts"), "utf8");
        assert.ok(authority.includes("movement-adapter-entry"));
        assert.ok(authority.includes("startMovementAdapterEntry"));
    });

    it("explicit entry requires exclusive authority and fails closed", () => {
        const handle = startMovementAdapterEntry({
            workspace: {},
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
        });
        assert.equal(handle, null);
    });

    it("routes the movement slice only through the mode-gated dispatcher", () => {
        const dir = kwinSrcDir();
        for (const name of ["controller.ts", "controller-input-actions.ts", "controller-interactive-drag.ts"]) {
            const body = readFileSync(join(dir, name), "utf8");
            assert.ok(!body.includes("movement-adapter"));
            assert.ok(!body.includes("MovementAdapter"));
            assert.ok(!body.includes("DescribeMovement"));
            assert.ok(!body.includes("startMovementAdapterEntry"));
        }
        const controller = readFileSync(join(dir, "controller.ts"), "utf8");
        assert.ok(controller.includes("engine-authority"));
        assert.ok(controller.includes("isRustAuthorityActive"));
        const authority = readFileSync(join(dir, "engine-authority.ts"), "utf8");
        assert.ok(authority.includes("movement-adapter-entry"));
        assert.ok(authority.includes("startMovementAdapterEntry"));
    });
});

describe("movement adapter session D-Bus activation", () => {
    it("pins a present owner with no service activation and routes planner calls to the unique name", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(MOVEMENT_DBUS_SERVICE, "org.freedesktop.DBus");
        assert.equal(MOVEMENT_DBUS_OBJECT, "/org/freedesktop/DBus");
        assert.equal(MOVEMENT_DBUS_INTERFACE, "org.freedesktop.DBus");
        assert.equal(MOVEMENT_GET_OWNER_METHOD, "GetNameOwner");
        adapter.requestMovement("right");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(
            [mocks.dbusCalls[0]?.service, mocks.dbusCalls[0]?.method, mocks.dbusCalls[0]?.payload],
            [MOVEMENT_DBUS_SERVICE, MOVEMENT_GET_OWNER_METHOD, MOVEMENT_SERVICE],
        );
        driveOwnerPresent(mocks, ":1.42");
        assert.equal(mocks.dbusCalls.length, 2);
        const planner = mocks.dbusCalls[1];
        assert.equal(planner?.service, ":1.42");
        assert.equal(planner?.method, MOVEMENT_METHOD);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === MOVEMENT_SERVICE));
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 2);
        // Ack and verify stay pinned to the same unique owner, never the
        // well-known fallback.
        assert.equal(mocks.dbusCalls[2]?.service, ":1.42");
        mocks.callbacks[2]?.(ackReply(correlation, payload["revision"] as number));
        assert.equal(mocks.dbusCalls[3]?.service, ":1.42");
        mocks.callbacks[3]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: (payload["revision"] as number) + 1 }),
        );
        assert.ok(mocks.logs.some((l) => l.includes("movement:applied")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === MOVEMENT_SERVICE));
    });

    it("activates an absent name with exactly one StartServiceByName(1) then pins", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(MOVEMENT_START_METHOD, "StartServiceByName");
        assert.equal(MOVEMENT_START_FLAGS, 0);
        assert.equal(MOVEMENT_START_PRIMARY, 1);
        assert.equal(MOVEMENT_START_ALREADY, 2);
        adapter.requestMovement("right");
        mocks.callbacks[0]?.("");
        assert.equal(mocks.dbusCalls.length, 2);
        const start = mocks.dbusCalls[1];
        assert.deepEqual(
            [start?.service, start?.method, start?.payload],
            [MOVEMENT_DBUS_SERVICE, MOVEMENT_START_METHOD, MOVEMENT_SERVICE],
        );
        mocks.callbacks[1]?.(MOVEMENT_START_PRIMARY);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(
            [mocks.dbusCalls[2]?.service, mocks.dbusCalls[2]?.method],
            [MOVEMENT_DBUS_SERVICE, MOVEMENT_GET_OWNER_METHOD],
        );
        mocks.callbacks[2]?.(":1.77");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.77");
        assert.equal(mocks.dbusCalls[3]?.method, MOVEMENT_METHOD);
        const starts = mocks.dbusCalls.filter((call) => call.method === MOVEMENT_START_METHOD);
        assert.equal(starts.length, 1);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === MOVEMENT_SERVICE));
        const payload = firstPayload(mocks);
        mocks.callbacks[3]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 2);
        assert.equal(adapter.isEnabled, true);
    });

    it("accepts AlreadyOwner(2) as already-running then resolves and pins", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        mocks.callbacks[0]?.(null);
        mocks.callbacks[1]?.(MOVEMENT_START_ALREADY);
        mocks.callbacks[2]?.(":1.78");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.78");
        const payload = firstPayload(mocks);
        mocks.callbacks[3]?.(plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor"));
        assert.equal(mocks.geometryWrites.length, 2);
        assert.equal(adapter.isEnabled, true);
    });

    it("rejects malformed or unknown activation results with no planner call and disables", () => {
        for (const bad of [0, 3, 4, 99, "1", "ok", null, undefined, {}, []]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            adapter.requestMovement("right");
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(bad);
            assert.ok(mocks.logs.some((l) => l.includes("movement-activation-failed")));
            assert.equal(adapter.isEnabled, false);
            assert.equal(mocks.geometryWrites.length, 0);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === MOVEMENT_METHOD));
            assert.ok(!mocks.dbusCalls.some((call) => call.service === MOVEMENT_SERVICE));
            // Exactly one service request, no retry or second activation.
            assert.equal(mocks.dbusCalls.filter((call) => call.method === MOVEMENT_START_METHOD).length, 1);
            assert.equal(mocks.dbusCalls.length, 2);
        }
    });

    it("fails closed when the post-start owner is missing with no planner call", () => {
        for (const badOwner of ["", "not-a-unique-name", null, MOVEMENT_SERVICE]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            adapter.requestMovement("right");
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(MOVEMENT_START_PRIMARY);
            mocks.callbacks[2]?.(badOwner);
            assert.ok(mocks.logs.some((l) => l.includes("movement-owner-missing")));
            assert.equal(adapter.isEnabled, false);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === MOVEMENT_METHOD));
            assert.equal(mocks.geometryWrites.length, 0);
        }
    });

    it("coalesces concurrent commands into one activation attempt with no duplicate service request", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        adapter.requestMovement("left");
        assert.ok(mocks.logs.some((l) => l.includes("movement-busy")));
        assert.equal(mocks.dbusCalls.length, 1);
        // Absent path still issues exactly one service request for the one flight.
        mocks.callbacks[0]?.("");
        adapter.requestMovement("left");
        assert.ok(mocks.logs.some((l) => l.includes("movement-busy")));
        assert.equal(mocks.dbusCalls.filter((call) => call.method === MOVEMENT_START_METHOD).length, 1);
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("times out during activation with no retry and ignores the late reply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        assert.equal(mocks.timers.length, 1);
        mocks.timers[0]?.callback();
        assert.ok(mocks.logs.some((l) => l.includes("movement-timeout-request")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.(":1.42");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(!mocks.logs.some((l) => l.includes("movement:applied")));
    });

    it("treats owner loss during a pending plan as terminal timeout with no rebind after restart", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        mocks.callbacks[0]?.(":1.10");
        const plannerIndex = plannerCallIndex(mocks);
        assert.equal(mocks.dbusCalls[plannerIndex]?.service, ":1.10");
        // Planner never answers (service crash): the bounded timeout fires.
        mocks.timers[0]?.callback();
        assert.ok(mocks.logs.some((l) => l.includes("movement-timeout-request")));
        assert.equal(adapter.isEnabled, false);
        // Late planned reply for the dead flight never binds or writes.
        const payload = JSON.parse(mocks.dbusCalls[plannerIndex]?.payload ?? "{}") as Record<string, unknown>;
        mocks.callbacks[1]?.(
            plannedReply(payload["correlation_id"] as string, payload["revision"] as number, "SwapNeighbor"),
        );
        assert.equal(mocks.geometryWrites.length, 0);
        // State reset (re-enable) allows a subsequent idle command to
        // activate again, pinning the new owner without rebinding the old plan.
        const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        assert.equal(ok, true);
        const before = mocks.dbusCalls.length;
        adapter.requestMovement("right");
        mocks.callbacks[before]?.(":1.11");
        const fresh = mocks.dbusCalls.find(
            (call, index) => index >= before && call.method === MOVEMENT_METHOD,
        );
        assert.ok(fresh !== undefined);
        assert.equal(fresh?.service, ":1.11");
        assert.ok(!mocks.dbusCalls.some((call) => call.service === MOVEMENT_SERVICE));
    });

    it("refuses the Rust command with no Legacy fallback on activation failure", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        mocks.callbacks[0]?.("");
        mocks.callbacks[1]?.(0);
        assert.ok(mocks.logs.some((l) => l.includes("movement-activation-failed")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(mocks.focusWrites, 0);
        assert.ok(mocks.logs.some((l) => l.includes("movement:disabled")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === MOVEMENT_SERVICE));
        const src = readFileSync(join(kwinSrcDir(), "movement-adapter.ts"), "utf8");
        assert.ok(!src.includes("fallback"));
    });

    it("allows a subsequent idle command to activate again only after state reset", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestMovement("right");
        mocks.callbacks[0]?.("");
        mocks.callbacks[1]?.("bogus");
        assert.equal(adapter.isEnabled, false);
        const callsAfterFailure = mocks.dbusCalls.length;
        adapter.requestMovement("right");
        assert.ok(mocks.logs.some((l) => l.includes("movement-disabled")));
        assert.equal(mocks.dbusCalls.length, callsAfterFailure);
        const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        assert.equal(ok, true);
        adapter.requestMovement("right");
        assert.equal(mocks.dbusCalls.length, callsAfterFailure + 1);
        assert.equal(mocks.dbusCalls[mocks.dbusCalls.length - 1]?.method, MOVEMENT_GET_OWNER_METHOD);
    });
});

interface Qv4Signal {
    readonly fire: () => void;
    readonly count: () => number;
}

function makeQv4Signal(): Qv4Signal & ((...args: readonly unknown[]) => void) {
    const handlers = new Set<() => void>();
    const fn = function (): void {};
    Object.setPrototypeOf(fn, {
        connect: (handler: () => void): void => {
            handlers.add(handler);
        },
        disconnect: (handler: () => void): void => {
            handlers.delete(handler);
        },
    });
    const callable = fn as unknown as Qv4Signal & ((...args: readonly unknown[]) => void);
    (callable as unknown as Record<string, unknown>)["fire"] = (): void => {
        for (const handler of [...handlers]) {
            handler();
        }
    };
    (callable as unknown as Record<string, unknown>)["count"] = (): number => handlers.size;
    return callable;
}

function makeMovementQv4World(): {
    readonly surface: Record<string, unknown>;
    readonly workspaceSignals: Record<string, Qv4Signal & ((...args: readonly unknown[]) => void)>;
    readonly geometrySignals: Array<Qv4Signal & ((...args: readonly unknown[]) => void)>;
} {
    const output = { name: "out-1" };
    const desktop = { id: "ws-1" };
    const geometrySignals: Array<Qv4Signal & ((...args: readonly unknown[]) => void)> = [
        makeQv4Signal(),
        makeQv4Signal(),
    ];
    const winA: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        output,
        desktops: [desktop],
        internalId: "win-a",
        frameGeometry: { x: 0, y: 0, width: 960, height: 1080 },
        moveResizedChanged: geometrySignals[0],
    };
    const winB: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        output,
        desktops: [desktop],
        internalId: "win-b",
        frameGeometry: { x: 960, y: 0, width: 960, height: 1080 },
        moveResizedChanged: geometrySignals[1],
    };
    const workspaceSignals: Record<string, Qv4Signal & ((...args: readonly unknown[]) => void)> = {
        windowActivated: makeQv4Signal(),
        windowAdded: makeQv4Signal(),
        windowRemoved: makeQv4Signal(),
        screensChanged: makeQv4Signal(),
        currentDesktopChanged: makeQv4Signal(),
    };
    const surface: Record<string, unknown> = {
        activeWindow: winA,
        windowList: (): unknown[] => [winA, winB],
        screens: [output],
        currentDesktopForScreen: (): unknown => desktop,
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        ...workspaceSignals,
    };
    return { surface, workspaceSignals, geometrySignals };
}

describe("movement entry QV4 callable signal startup", () => {
    it("attaches callable workspace plus per-window geometry signals and detaches exactly", () => {
        const { surface, workspaceSignals, geometrySignals } = makeMovementQv4World();
        const logs: string[] = [];
        for (const signal of [...Object.values(workspaceSignals), ...geometrySignals]) {
            assert.equal(typeof signal, "function");
        }
        const handle = startMovementAdapterEntry({
            workspace: surface,
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveMovementAuthority: () => true,
        });
        assert.ok(handle !== null);
        assert.ok(logs.some((line) => line.endsWith(":ready")));
        for (const signal of [...Object.values(workspaceSignals), ...geometrySignals]) {
            assert.equal(signal.count(), 1);
        }
        handle.stop();
        for (const signal of [...Object.values(workspaceSignals), ...geometrySignals]) {
            assert.equal(signal.count(), 0);
        }
        handle.stop();
        for (const signal of [...Object.values(workspaceSignals), ...geometrySignals]) {
            assert.equal(signal.count(), 0);
        }
    });

    it("fails closed with exact rollback when a required callable signal is missing", () => {
        const { surface, workspaceSignals, geometrySignals } = makeMovementQv4World();
        surface["screensChanged"] = {};
        const logs: string[] = [];
        const handle = startMovementAdapterEntry({
            workspace: surface,
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveMovementAuthority: () => true,
        });
        assert.equal(handle, null);
        for (const signal of [...Object.values(workspaceSignals), ...geometrySignals]) {
            assert.equal(signal.count(), 0);
        }
    });
});
