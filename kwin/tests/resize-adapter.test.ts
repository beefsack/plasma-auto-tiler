import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    RESIZE_CONTRACT_VERSION,
    RESIZE_DBUS_INTERFACE,
    RESIZE_DBUS_OBJECT,
    RESIZE_DBUS_SERVICE,
    RESIZE_GET_OWNER_METHOD,
    RESIZE_INTERFACE,
    RESIZE_METHOD,
    RESIZE_OBJECT,
    RESIZE_SERVICE,
    RESIZE_START_ALREADY,
    RESIZE_START_FLAGS,
    RESIZE_START_METHOD,
    RESIZE_START_PRIMARY,
    ResizeAdapter,
    ResizeAdapterEnv,
    ResizeDesired,
    ResizeObserved,
    ResizeRect,
    orderResizeWrites,
    resizeFingerprint,
} from "../src/resize-adapter";
import { startResizeAdapterEntry } from "../src/resize-adapter-entry";

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
    rect: ResizeRect;
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
    readonly geometryWrites: Array<{ id: string; rect: ResizeRect }>;
    focusWrites: number;
    wins: WinState[];
    activeId: string;
    domainOutput: string;
    domainWorkspace: string;
    domainBounds: ResizeRect;
    authorityImpl: () => boolean;
    revalidateImpl: () => boolean;
    failGeometry: boolean;
    env: ResizeAdapterEnv;
    handlers: Map<string, () => void>;
}

function buildObserved(mocks: Mocks): ResizeObserved {
    const sorted = [...mocks.wins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const activeRef = sorted.find((w) => w.id === mocks.activeId)?.ref ?? null;
    // One canonical fingerprint: numeric wire binding carried as a string.
    const fingerprint = String(
        resizeFingerprint(
            mocks.domainOutput,
            mocks.domainWorkspace,
            mocks.activeId,
            sorted.map((w) => w.id),
        ),
    );
    const windows = Object.freeze(
        sorted.map((w) =>
            Object.freeze({ id: w.id, ref: w.ref, rect: Object.freeze({ ...w.rect }), output: w.output, workspace: w.workspace }),
        ),
    );
    return {
        domainOutput: mocks.domainOutput,
        domainWorkspace: mocks.domainWorkspace,
        domainBounds: Object.freeze({ ...mocks.domainBounds }),
        domainGap: 0,
        focusedId: mocks.activeId,
        windows,
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
        activeId: "win-a",
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1920, h: 1080 },
        authorityImpl: () => true,
        revalidateImpl: () => true,
        failGeometry: false,
        handlers: new Map<string, () => void>(),
    } as unknown as Mocks;
    const env: ResizeAdapterEnv = {
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
        observe: (): ResizeObserved | null => buildObserved(state),
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
        hasExclusiveResizeAuthority: (): boolean => state.authorityImpl(),
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push(kind);
            state.handlers.set(kind, handler);
            return (): void => {
                state.unsubscribes.push(1);
            };
        },
    };
    (state as { env: ResizeAdapterEnv }).env = env;
    return state;
}

function enableAdapter(mocks: Mocks): ResizeAdapter {
    const adapter = new ResizeAdapter(mocks.env);
    assert.equal(adapter.isEnabled, false);
    const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
    assert.equal(ok, true);
    return adapter;
}

function firstPayload(mocks: Mocks): Record<string, unknown> {
    const planner = mocks.dbusCalls.find((call) => call.method === RESIZE_METHOD);
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

function plannerPayloads(mocks: Mocks): Array<Record<string, unknown>> {
    return mocks.dbusCalls
        .filter((call) => call.method === RESIZE_METHOD)
        .map((call) => JSON.parse(call.payload) as Record<string, unknown>);
}

function plannerCallbacks(mocks: Mocks): Array<(reply: unknown) => void> {
    const out: Array<(reply: unknown) => void> = [];
    mocks.dbusCalls.forEach((call, index) => {
        if (call.method === RESIZE_METHOD) {
            out.push(mocks.callbacks[index] as (reply: unknown) => void);
        }
    });
    return out;
}

// Drives the latest pending GetNameOwner phase (for flights after the first,
// where callbacks[0] already belongs to an earlier flight).
function driveLatestOwner(mocks: Mocks, owner: string = PINNED_OWNER): void {
    const index = mocks.callbacks.length - 1;
    assert.ok(mocks.callbacks[index] !== undefined);
    mocks.callbacks[index]?.(owner);
}

function resizedGeometry(): Array<Record<string, unknown>> {
    return [
        { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1080, h: 1080 } },
        { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 1080, y: 0, w: 840, h: 1080 } },
    ];
}

function resizeOperation(direction = "right", mode = "outwards"): Record<string, unknown> {
    return {
        kind: "ResizeSplitShare",
        domain_output: "out-1",
        domain_workspace: "ws-1",
        focused_leaf: "leaf-a",
        focused_window: "win-a",
        direction,
        mode,
        target_group: "group-1",
        focused_child: "leaf-a",
        neighbor_child: "leaf-b",
        focused_index: 0,
        neighbor_index: 1,
        old_shares: [8, 8],
        new_shares: [9, 7],
    };
}

function plannedReply(
    correlation: string,
    baseRevision: number,
    geometry: Array<Record<string, unknown>> = resizedGeometry(),
    direction = "right",
    mode = "outwards",
): string {
    return JSON.stringify({
        v: RESIZE_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: baseRevision,
        capability: "keyboard-resize",
        preconditions: [
            "focused-leaf-occupied-by-focused-window",
            "target-boundary-valid",
            "resize-targets-same-domain",
            "adapter-must-verify-postconditions",
        ],
        operation: resizeOperation(direction, mode),
        desired_geometry: geometry,
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-a" },
    });
}

function ackReply(correlation: string, baseRevision: number): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: baseRevision });
}

describe("resize adapter", () => {
    it("is disabled by default and rejects requests while disabled", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = new ResizeAdapter(mocks.env);
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        adapter.requestResize("right", "outwards");
        assert.ok(mocks.logs.some((line) => line.includes("resize-disabled")));
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("sends a bounded resize request over DescribeResize", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        assert.equal(mocks.dbusCalls.length, 1);
        driveOwnerPresent(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        const payload = firstPayload(mocks);
        assert.equal(payload["v"], 1);
        assert.equal(payload["action"], "request");
        assert.deepEqual(payload["domain"], {
            output: "out-1",
            workspace: "ws-1",
            bounds: { x: 0, y: 0, w: 1920, h: 1080 },
            gap: 0,
        });
        assert.equal(payload["focused_window"], "win-a");
        assert.equal(payload["direction"], "right");
        assert.equal(payload["mode"], "outwards");
        assert.equal(payload["press_index"], 0);
        assert.deepEqual(payload["capabilities"], { keyboard_resize: true, pointer_resize: false });
        assert.deepEqual(payload["windows"], [
            { window: "win-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 960, h: 1080 } },
            { window: "win-b", output: "out-1", workspace: "ws-1", rect: { x: 960, y: 0, w: 960, h: 1080 } },
        ]);
        const sortedIds = ["win-a", "win-b"];
        assert.equal(
            payload["fingerprint"],
            resizeFingerprint("out-1", "ws-1", "win-a", sortedIds),
        );
        assert.equal(payload["revision"], 2);
    });

    it("rejects exclusive-authority conflicts before dispatch and disables", () => {
        const mocks = mockEnvTwoWindow();
        mocks.authorityImpl = () => false;
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        assert.ok(mocks.logs.some((line) => line.includes("resize-exclusive-conflict")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(adapter.isEnabled, false);
    });

    it("transmits repeats with incremented press_index instead of deduping", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        plannerCallbacks(mocks)[0]?.(JSON.stringify({ v: 1, correlation_id: firstPayload(mocks)["correlation_id"], outcome: "noop" }));
        assert.equal(adapter.isInFlight, false);
        // Same fingerprint+direction+mode repeats with press_index 1, not dedup.
        adapter.requestResize("right", "outwards");
        driveLatestOwner(mocks, ":1.43");
        assert.equal(plannerPayloads(mocks).length, 2);
        const second = plannerPayloads(mocks)[1] as Record<string, unknown>;
        assert.equal(second["mode"], "outwards");
        assert.equal(second["press_index"], 1);
        assert.ok(!mocks.logs.some((line) => line.includes("resize-dedup")));
    });

    it("binds dedup to mode: different mode transmits with reset press_index", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        plannerCallbacks(mocks)[0]?.(JSON.stringify({ v: 1, correlation_id: firstPayload(mocks)["correlation_id"], outcome: "noop" }));
        adapter.requestResize("right", "inwards");
        driveLatestOwner(mocks, ":1.43");
        assert.equal(plannerPayloads(mocks).length, 2);
        const second = plannerPayloads(mocks)[1] as Record<string, unknown>;
        assert.equal(second["mode"], "inwards");
        assert.equal(second["press_index"], 0);
    });

    it("rejects missing or invalid mode before D-Bus without defaulting", () => {
        for (const bad of [undefined, null, "", "sideways", "Outwards", "OUTWARDS", 0, true]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            adapter.requestResize("right", bad);
            assert.ok(mocks.logs.some((line) => line.includes("resize-invalid-intent")));
            assert.equal(mocks.dbusCalls.length, 0);
            assert.equal(adapter.isEnabled, true);
        }
        const missing = mockEnvTwoWindow();
        const adapter2 = enableAdapter(missing);
        // Single-arg call (missing mode) also rejects.
        (adapter2.requestResize as (direction: unknown) => void)("right");
        assert.ok(missing.logs.some((line) => line.includes("resize-invalid-intent")));
        assert.equal(missing.dbusCalls.length, 0);
    });

    it("resets press_index when edge, mode, or focused identity changes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        plannerCallbacks(mocks)[0]?.(JSON.stringify({ v: 1, correlation_id: firstPayload(mocks)["correlation_id"], outcome: "noop" }));
        adapter.requestResize("right", "outwards");
        driveLatestOwner(mocks, ":1.43");
        assert.equal(plannerPayloads(mocks)[1]?.["press_index"], 1);
        plannerCallbacks(mocks)[1]?.(JSON.stringify({ v: 1, correlation_id: plannerPayloads(mocks)[1]?.["correlation_id"], outcome: "noop" }));
        // Edge change resets to 0.
        adapter.requestResize("left", "outwards");
        driveLatestOwner(mocks, ":1.44");
        assert.equal(plannerPayloads(mocks)[2]?.["press_index"], 0);
        plannerCallbacks(mocks)[2]?.(JSON.stringify({ v: 1, correlation_id: plannerPayloads(mocks)[2]?.["correlation_id"], outcome: "noop" }));
        // Focused identity change resets to 0.
        mocks.activeId = "win-b";
        adapter.requestResize("left", "outwards");
        driveLatestOwner(mocks, ":1.45");
        assert.equal(plannerPayloads(mocks)[3]?.["press_index"], 0);
    });

    it("resets repeat on disable", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        plannerCallbacks(mocks)[0]?.(JSON.stringify({ v: 1, correlation_id: firstPayload(mocks)["correlation_id"], outcome: "noop" }));
        adapter.requestResize("right", "outwards");
        driveLatestOwner(mocks, ":1.43");
        assert.equal(plannerPayloads(mocks).length, 2);
        adapter.disable();
        const adapter2 = enableAdapter(mocks);
        adapter2.requestResize("right", "outwards");
        driveLatestOwner(mocks, ":1.44");
        const last = plannerPayloads(mocks)[plannerPayloads(mocks).length - 1] as Record<string, unknown>;
        assert.equal(last["press_index"], 0);
    });

    it("rejects planned operations without required mode", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        const operation = resizeOperation("right", "outwards") as Record<string, unknown>;
        delete operation["mode"];
        onRequest(
            JSON.stringify({
                v: RESIZE_CONTRACT_VERSION,
                correlation_id: correlation,
                outcome: "planned",
                base_revision: 2,
                capability: "keyboard-resize",
                preconditions: [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                operation,
                desired_geometry: resizedGeometry(),
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-a" },
            }),
        );
        assert.ok(mocks.logs.some((line) => line.includes("resize-precondition-mismatch")));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects a second request while in flight", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        assert.equal(adapter.isInFlight, true);
        adapter.requestResize("left", "outwards");
        assert.ok(mocks.logs.some((line) => line.includes("resize-busy")));
        assert.equal(mocks.dbusCalls.length, 1);
    });

    it("applies planned geometry grow-first, acks, verifies, and commits", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, 2));
        // Grow-first: win-a (+129600) before win-b (-129600).
        assert.deepEqual(
            mocks.geometryWrites.map((w) => w.id),
            ["win-a", "win-b"],
        );
        assert.equal(mocks.dbusCalls.length, 3);
        const ackPayload = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(ackPayload["action"], "acknowledge");
        assert.equal(ackPayload["outcome"], "accepted");
        const onAck = mocks.callbacks[2] as (reply: unknown) => void;
        onAck(ackReply(correlation, 2));
        assert.equal(mocks.dbusCalls.length, 4);
        const verifyPayload = JSON.parse((mocks.dbusCalls[3] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(verifyPayload["action"], "verify");
        assert.equal(verifyPayload["verified"], true);
        assert.deepEqual(verifyPayload["verified_geometry"], resizedGeometry());
        const onVerify = mocks.callbacks[3] as (reply: unknown) => void;
        onVerify(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: 3 }));
        assert.ok(mocks.logs.some((line) => line.endsWith(":applied")));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        // Focus retained on the focused window (already active: no write needed).
        assert.equal(mocks.activeId, "win-a");
    });

    it("fails closed on stale revalidation", () => {
        const mocks = mockEnvTwoWindow();
        mocks.revalidateImpl = () => false;
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, 2));
        assert.ok(mocks.logs.some((line) => line.includes("resize-stale-revalidate")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.geometryWrites.length, 0);
    });

    it("fails closed on unrelated signals during apply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        // Queue an unrelated signal before the planned reply arrives.
        const geometryHandler = mocks.handlers.get("geometry");
        void geometryHandler;
        const addedHandler = mocks.handlers.get("added") as () => void;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        addedHandler();
        onRequest(plannedReply(correlation, 2));
        assert.ok(mocks.logs.some((line) => line.includes("resize-signal-invalid")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects malformed planned replies without writes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "planned" }));
        assert.ok(mocks.logs.some((line) => line.includes("resize-precondition-mismatch")));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects extra geometry windows in the planned reply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(
            plannedReply(correlation, 2, [
                ...resizedGeometry(),
                { window: "win-c", leaf: "leaf-c", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 10, h: 10 } },
            ]),
        );
        assert.ok(mocks.logs.some((line) => line.includes("resize-precondition-mismatch")));
        assert.equal(mocks.geometryWrites.length, 0);
    });

    it("rejects cross-domain geometry in the planned reply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(
            plannedReply(correlation, 2, [
                { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1080, h: 1080 } },
                { window: "win-b", leaf: "leaf-b", output: "out-9", workspace: "ws-1", rect: { x: 1080, y: 0, w: 840, h: 1080 } },
            ]),
        );
        assert.ok(mocks.logs.some((line) => line.includes("resize-precondition-mismatch")));
        assert.equal(mocks.geometryWrites.length, 0);
    });

    it("handles noop replies without writes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("up", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "noop" }));
        assert.ok(mocks.logs.some((line) => line.endsWith(":noop")));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, true);
    });

    it("fails closed when post-observation geometry drifts before verify", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        driveOwnerPresent(mocks);
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, 2));
        const onAck = mocks.callbacks[2] as (reply: unknown) => void;
        onAck(ackReply(correlation, 2));
        // The ack reply triggers sendVerify synchronously against the fresh
        // exact post-observation; a divergent commit then fails closed.
        assert.equal(mocks.dbusCalls.length, 4);
        const onVerify = mocks.callbacks[3] as (reply: unknown) => void;
        onVerify(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "diverged" }));
        assert.ok(mocks.logs.some((line) => line.includes("resize-service-fault")));
        assert.equal(adapter.isEnabled, false);
    });

    it("orderResizeWrites is changed-only, grow-first, lexically stable", () => {
        const oldById = new Map<string, ResizeRect>([
            ["win-a", { x: 0, y: 0, w: 960, h: 1080 }],
            ["win-b", { x: 960, y: 0, w: 960, h: 1080 }],
            ["win-c", { x: 0, y: 0, w: 100, h: 100 }],
        ]);
        const desired: ResizeDesired[] = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1080, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 1080, y: 0, w: 840, h: 1080 } },
            { window: "win-c", leaf: "leaf-c", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 100, h: 100 } },
        ];
        const ordered = orderResizeWrites(oldById, desired);
        assert.deepEqual(
            ordered.map((entry) => entry.window),
            ["win-a", "win-b"],
        );
    });

    it("uses the DescribeResize route identity", () => {
        assert.equal(RESIZE_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(RESIZE_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(RESIZE_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(RESIZE_METHOD, "DescribeResize");
        assert.equal(RESIZE_CONTRACT_VERSION, 1);
    });

    it("source performs no forbidden tiling, shortcut, config, or polling access", () => {
        const src = readFileSync(join(kwinSrcDir(), "resize-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "resize-adapter-entry.ts"), "utf8");
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
        const src = readFileSync(join(kwinSrcDir(), "resize-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "resize-adapter-entry.ts"), "utf8");
        assert.ok(src.includes("RESIZE_TIMEOUT_MS"));
        assert.ok(src.includes("scheduleOnce"));
        assert.ok(entry.includes("scheduleOnce"));
        assert.ok(src.includes("no configure barrier"));
        assert.ok(!src.includes("configureBarrier"));
        assert.ok(!entry.includes("configureBarrier"));
        assert.ok(!src.includes("pollFor"));
        assert.ok(!entry.includes("pollFor"));
    });

    it("production startup activates the adapter only through the mode-gated dispatcher", () => {
        const entry = readFileSync(join(kwinSrcDir(), "entry.ts"), "utf8");
        assert.ok(!entry.includes("resize-adapter"));
        assert.ok(!entry.includes("ResizeAdapter"));
        assert.ok(!entry.includes("startResizeAdapterEntry"));
        assert.ok(!entry.includes("DescribeResize"));
        const authority = readFileSync(join(kwinSrcDir(), "engine-authority.ts"), "utf8");
        assert.ok(authority.includes("resize-adapter-entry"));
        assert.ok(authority.includes("startResizeAdapterEntry"));
    });

    it("explicit entry requires exclusive authority and fails closed", () => {
        const handle = startResizeAdapterEntry({
            workspace: {},
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
        });
        assert.equal(handle, null);
    });

    it("explicit entry rejects a non-function authority", () => {
        const handle = startResizeAdapterEntry({
            workspace: {},
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: true as unknown as () => boolean,
        });
        assert.equal(handle, null);
    });

    it("routes the resize slice only through the mode-gated dispatcher", () => {
        const dir = kwinSrcDir();
        for (const name of ["controller.ts", "controller-input-actions.ts", "controller-interactive-drag.ts"]) {
            const body = readFileSync(join(dir, name), "utf8");
            assert.ok(!body.includes("resize-adapter"));
            assert.ok(!body.includes("ResizeAdapter"));
            assert.ok(!body.includes("DescribeResize"));
            assert.ok(!body.includes("startResizeAdapterEntry"));
        }
        const controller = readFileSync(join(dir, "controller.ts"), "utf8");
        assert.ok(controller.includes("engine-authority"));
        assert.ok(controller.includes("isRustAuthorityActive"));
        const authority = readFileSync(join(dir, "engine-authority.ts"), "utf8");
        assert.ok(authority.includes("resize-adapter-entry"));
        assert.ok(authority.includes("startResizeAdapterEntry"));
    });
});

describe("resize adapter session D-Bus activation", () => {
    it("pins a present owner with no service activation and routes planner calls to the unique name", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(RESIZE_DBUS_SERVICE, "org.freedesktop.DBus");
        assert.equal(RESIZE_DBUS_OBJECT, "/org/freedesktop/DBus");
        assert.equal(RESIZE_DBUS_INTERFACE, "org.freedesktop.DBus");
        assert.equal(RESIZE_GET_OWNER_METHOD, "GetNameOwner");
        adapter.requestResize("right", "outwards");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(
            [mocks.dbusCalls[0]?.service, mocks.dbusCalls[0]?.method, mocks.dbusCalls[0]?.payload],
            [RESIZE_DBUS_SERVICE, RESIZE_GET_OWNER_METHOD, RESIZE_SERVICE],
        );
        driveOwnerPresent(mocks, ":1.42");
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(mocks.dbusCalls[1]?.service, ":1.42");
        assert.equal(mocks.dbusCalls[1]?.method, RESIZE_METHOD);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === RESIZE_SERVICE));
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 2));
        assert.equal(mocks.dbusCalls[2]?.service, ":1.42");
        mocks.callbacks[2]?.(ackReply(correlation, 2));
        assert.equal(mocks.dbusCalls[3]?.service, ":1.42");
        mocks.callbacks[3]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: 3 }),
        );
        assert.ok(mocks.logs.some((l) => l.includes("resize:applied")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === RESIZE_SERVICE));
    });

    it("activates an absent name with exactly one StartServiceByName(1) then pins", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(RESIZE_START_METHOD, "StartServiceByName");
        assert.equal(RESIZE_START_FLAGS, 0);
        assert.equal(RESIZE_START_PRIMARY, 1);
        assert.equal(RESIZE_START_ALREADY, 2);
        adapter.requestResize("right", "outwards");
        mocks.callbacks[0]?.("");
        assert.equal(mocks.dbusCalls.length, 2);
        const start = mocks.dbusCalls[1];
        assert.deepEqual(
            [start?.service, start?.method, start?.payload],
            [RESIZE_DBUS_SERVICE, RESIZE_START_METHOD, RESIZE_SERVICE],
        );
        mocks.callbacks[1]?.(RESIZE_START_PRIMARY);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(
            [mocks.dbusCalls[2]?.service, mocks.dbusCalls[2]?.method],
            [RESIZE_DBUS_SERVICE, RESIZE_GET_OWNER_METHOD],
        );
        mocks.callbacks[2]?.(":1.77");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.77");
        assert.equal(mocks.dbusCalls[3]?.method, RESIZE_METHOD);
        assert.equal(mocks.dbusCalls.filter((call) => call.method === RESIZE_START_METHOD).length, 1);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === RESIZE_SERVICE));
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        mocks.callbacks[3]?.(plannedReply(correlation, 2));
        assert.ok(mocks.geometryWrites.length > 0);
        assert.equal(adapter.isEnabled, true);
    });

    it("accepts AlreadyOwner(2) as already-running then resolves and pins", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        mocks.callbacks[0]?.(null);
        mocks.callbacks[1]?.(RESIZE_START_ALREADY);
        mocks.callbacks[2]?.(":1.78");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.78");
        const correlation = firstPayload(mocks)["correlation_id"] as string;
        mocks.callbacks[3]?.(plannedReply(correlation, 2));
        assert.ok(mocks.geometryWrites.length > 0);
        assert.equal(adapter.isEnabled, true);
    });

    it("rejects malformed or unknown activation results with no planner call and disables", () => {
        for (const bad of [0, 3, 4, 99, "1", "ok", null, undefined, {}, []]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            adapter.requestResize("right", "outwards");
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(bad);
            assert.ok(mocks.logs.some((l) => l.includes("resize-activation-failed")));
            assert.equal(adapter.isEnabled, false);
            assert.equal(mocks.geometryWrites.length, 0);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === RESIZE_METHOD));
            assert.ok(!mocks.dbusCalls.some((call) => call.service === RESIZE_SERVICE));
            assert.equal(mocks.dbusCalls.filter((call) => call.method === RESIZE_START_METHOD).length, 1);
            assert.equal(mocks.dbusCalls.length, 2);
        }
    });

    it("fails closed when the post-start owner is missing with no planner call", () => {
        for (const badOwner of ["", "not-a-unique-name", null, RESIZE_SERVICE]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            adapter.requestResize("right", "outwards");
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(RESIZE_START_PRIMARY);
            mocks.callbacks[2]?.(badOwner);
            assert.ok(mocks.logs.some((l) => l.includes("resize-owner-missing")));
            assert.equal(adapter.isEnabled, false);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === RESIZE_METHOD));
            assert.equal(mocks.geometryWrites.length, 0);
        }
    });

    it("coalesces concurrent commands into one activation attempt with no duplicate service request", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        adapter.requestResize("left", "outwards");
        assert.ok(mocks.logs.some((l) => l.includes("resize-busy")));
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.("");
        adapter.requestResize("left", "outwards");
        assert.ok(mocks.logs.some((l) => l.includes("resize-busy")));
        assert.equal(mocks.dbusCalls.filter((call) => call.method === RESIZE_START_METHOD).length, 1);
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("times out during activation with no retry and ignores the late reply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        assert.equal(mocks.timers.length, 1);
        mocks.timers[0]?.callback();
        assert.ok(mocks.logs.some((l) => l.includes("resize-timeout-request")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.(":1.42");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(!mocks.logs.some((l) => l.includes("resize:applied")));
    });

    it("refuses the Rust command with no Legacy fallback on activation failure", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        mocks.callbacks[0]?.("");
        mocks.callbacks[1]?.(0);
        assert.ok(mocks.logs.some((l) => l.includes("resize-activation-failed")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("resize:disabled")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === RESIZE_SERVICE));
        const src = readFileSync(join(kwinSrcDir(), "resize-adapter.ts"), "utf8");
        assert.ok(!src.includes("fallback"));
    });

    it("allows a subsequent idle command to activate again only after state reset", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.requestResize("right", "outwards");
        mocks.callbacks[0]?.("");
        mocks.callbacks[1]?.("bogus");
        assert.equal(adapter.isEnabled, false);
        const callsAfterFailure = mocks.dbusCalls.length;
        adapter.requestResize("right", "outwards");
        assert.ok(mocks.logs.some((l) => l.includes("resize-disabled")));
        assert.equal(mocks.dbusCalls.length, callsAfterFailure);
        const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        assert.equal(ok, true);
        adapter.requestResize("right", "outwards");
        assert.equal(mocks.dbusCalls.length, callsAfterFailure + 1);
        assert.equal(mocks.dbusCalls[mocks.dbusCalls.length - 1]?.method, RESIZE_GET_OWNER_METHOD);
    });
});
