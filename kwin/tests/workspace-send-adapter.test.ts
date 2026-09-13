import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    WORKSPACE_SEND_CONTRACT_VERSION,
    WORKSPACE_SEND_DBUS_INTERFACE,
    WORKSPACE_SEND_DBUS_OBJECT,
    WORKSPACE_SEND_DBUS_SERVICE,
    WORKSPACE_SEND_GET_OWNER_METHOD,
    WORKSPACE_SEND_INTERFACE,
    WORKSPACE_SEND_METHOD,
    WORKSPACE_SEND_OBJECT,
    WORKSPACE_SEND_SERVICE,
    WORKSPACE_SEND_START_ALREADY,
    WORKSPACE_SEND_START_METHOD,
    WORKSPACE_SEND_START_PRIMARY,
    WorkspaceSendAdapter,
    WorkspaceSendAdapterEnv,
    WorkspaceSendObserved,
    workspaceFingerprint,
} from "../src/workspace-send-adapter";
import { startWorkspaceSendAdapterEntry, WorkspaceSendEntryHandle } from "../src/workspace-send-adapter-entry";
import { DOMAIN_GAP, OUTER_DOMAIN_GAP } from "../src/domain-gap";

function kwinSrcDir(): string {
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
            if (dir.indexOf("kwin") >= 0 && dir.endsWith("src")) {
                // fallthrough
            }
        } catch (error) {
            void error;
        }
    }
    return resolve(process.cwd(), "src");
}

declare const __dirname: string | undefined;

function makeRefs(): { a: object; b: object; t: object; desktop: object } {
    return { a: {}, b: {}, t: {}, desktop: {} };
}

function rect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
    return { x, y, w, h };
}

function makeObserved(
    refs: { a: object; b: object; t: object; desktop: object },
    opts: {
        focused?: string;
        activeRef?: object | null;
        sourceOutput?: string;
        targetOutput?: string;
        sourceWorkspace?: string;
        targetWorkspace?: string;
        desktopCount?: number;
        targetExists?: boolean;
        sourceWindows?: ReadonlyArray<{ id: string; ref: object; rect: { x: number; y: number; w: number; h: number } }>;
        targetWindows?: ReadonlyArray<{ id: string; ref: object; rect: { x: number; y: number; w: number; h: number } }>;
    } = {},
): WorkspaceSendObserved {
    const focused = opts.focused ?? "win-a";
    const sourceWindows =
        opts.sourceWindows ??
        Object.freeze([
            Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
            Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze(rect(100, 0, 100, 100)) }),
        ]);
    const targetWindows =
        opts.targetWindows ??
        Object.freeze([Object.freeze({ id: "win-t", ref: refs.t, rect: Object.freeze(rect(0, 0, 100, 100)) })]);
    return {
        sourceOutput: opts.sourceOutput ?? "out-1",
        sourceWorkspace: opts.sourceWorkspace ?? "ws-1",
        sourceBounds: Object.freeze(rect(0, 0, 1200, 800)),
        targetOutput: opts.targetOutput ?? "out-1",
        targetWorkspace: opts.targetWorkspace ?? "ws-2",
        targetBounds: Object.freeze(rect(0, 0, 1200, 800)),
        focusedId: focused,
        sourceWindows,
        targetWindows,
        activeRef: opts.activeRef === undefined ? refs.a : opts.activeRef,
        moverRef: focused === "" ? null : refs.a,
        targetDesktopRef: refs.desktop,
        targetExists: opts.targetExists ?? true,
        desktopCount: opts.desktopCount ?? 2,
        sourceFingerprint: "sfp-1",
        targetFingerprint: "tfp-1",
    };
}

interface DbusCall {
    readonly service: string;
    readonly path: string;
    readonly iface: string;
    readonly method: string;
    readonly payload: string;
}

// Mutable native world behind the mock observation: geometry and desktop
// membership writes are observable by the next `observe()` call, exactly like
// the real KWin surface.
interface WorldWindow {
    readonly id: string;
    readonly ref: object;
    rect: { x: number; y: number; w: number; h: number };
    workspace: string;
}

interface World {
    readonly windows: WorldWindow[];
    readonly activeId: string;
    readonly activeRef: object | null;
    desktopCount: number;
    targetExists: boolean;
}

function defaultWorld(refs: { a: object; b: object; t: object; desktop: object }): World {
    return {
        windows: [
            { id: "win-a", ref: refs.a, rect: rect(0, 0, 100, 100), workspace: "ws-1" },
            { id: "win-b", ref: refs.b, rect: rect(100, 0, 100, 100), workspace: "ws-1" },
            { id: "win-t", ref: refs.t, rect: rect(0, 0, 100, 100), workspace: "ws-2" },
        ],
        activeId: "win-a",
        activeRef: refs.a,
        desktopCount: 2,
        targetExists: true,
    };
}

function makeWorldObserved(
    world: World,
    refs: { a: object; b: object; t: object; desktop: object },
): WorkspaceSendObserved {
    const sourceWindows = Object.freeze(
        world.windows
            .filter((entry) => entry.workspace === "ws-1")
            .map((entry) =>
                Object.freeze({
                    id: entry.id,
                    ref: entry.ref,
                    rect: Object.freeze({
                        x: entry.rect.x,
                        y: entry.rect.y,
                        w: entry.rect.w,
                        h: entry.rect.h,
                    }),
                }),
            ),
    );
    const targetWindows = Object.freeze(
        world.windows
            .filter((entry) => entry.workspace === "ws-2")
            .map((entry) =>
                Object.freeze({
                    id: entry.id,
                    ref: entry.ref,
                    rect: Object.freeze({
                        x: entry.rect.x,
                        y: entry.rect.y,
                        w: entry.rect.w,
                        h: entry.rect.h,
                    }),
                }),
            ),
    );
    // Mirror the entry's focus rule: the active window is only the focused id
    // while it still belongs to the source desktop.
    const focused = sourceWindows.some((entry) => entry.id === world.activeId) ? world.activeId : "";
    const moverEntry = sourceWindows.find((entry) => entry.id === world.activeId);
    return {
        sourceOutput: "out-1",
        sourceWorkspace: "ws-1",
        sourceBounds: Object.freeze(rect(0, 0, 1200, 800)),
        targetOutput: "out-1",
        targetWorkspace: "ws-2",
        targetBounds: Object.freeze(rect(0, 0, 1200, 800)),
        focusedId: focused,
        sourceWindows,
        targetWindows,
        activeRef: world.activeRef,
        moverRef: moverEntry === undefined ? null : moverEntry.ref,
        targetDesktopRef: refs.desktop,
        targetExists: world.targetExists,
        desktopCount: world.desktopCount,
        sourceFingerprint: "sfp-1",
        targetFingerprint: "tfp-1",
    };
}

interface Mocks {
    readonly dbusCalls: DbusCall[];
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    readonly desktops: Array<{ target: object; refs: ReadonlyArray<object> }>;
    readonly world: World;
    observeImpl: () => WorkspaceSendObserved | null;
    geometryImpl: (target: object, r: { x: number; y: number; w: number; h: number }) => boolean;
    desktopsImpl: (target: object, refs: ReadonlyArray<object>) => boolean;
    env: WorkspaceSendAdapterEnv;
}

function mockEnv(refs: { a: object; b: object; t: object; desktop: object }): Mocks {
    const state: Mocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        geometries: [],
        desktops: [],
        world: defaultWorld(refs),
        observeImpl: () => makeWorldObserved(state.world, refs),
        geometryImpl: () => true,
        desktopsImpl: () => true,
        env: null as unknown as WorkspaceSendAdapterEnv,
    };
    state.env = {
        callDbus: (service, path, iface, method, payload, callback) => {
            state.dbusCalls.push({ service, path, iface, method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback) => {
            const timer = { delayMs, callback, cancelled: false };
            state.timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
        log: (message) => {
            state.logs.push(message);
        },
        observe: () => state.observeImpl(),
        setGeometry: (target, r) => {
            state.geometries.push({ target, rect: r });
            const ok = state.geometryImpl(target, r);
            if (ok) {
                for (const entry of state.world.windows) {
                    if (entry.ref === target) {
                        entry.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
                    }
                }
            }
            return ok;
        },
        setDesktops: (target, refs) => {
            state.desktops.push({ target, refs });
            const ok = state.desktopsImpl(target, refs);
            if (ok && refs.length > 0) {
                for (const entry of state.world.windows) {
                    if (entry.ref === target) {
                        entry.workspace = "ws-2";
                    }
                }
            }
            return ok;
        },
    };
    return state;
}

const KNOWN_PRECONDITIONS = [
    "window-observed",
    "desired-topology-valid",
    "adapter-must-verify-postconditions",
];

function plannedReply(correlation: string): string {
    return JSON.stringify({
        v: WORKSPACE_SEND_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        kind: "send-to-workspace",
        base_revision: 0,
        detail: { kind: "send-to-workspace", policy_version: 1, capability: "move-tiled" },
        desired_geometry: [
            { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
            { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ],
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-win-b" },
        preconditions: KNOWN_PRECONDITIONS,
        operation: {
            op: "move-tiled",
            window: "win-a",
            leaf: "leaf-win-a",
            source_output: "out-1",
            source_workspace: "ws-1",
            target_output: "out-1",
            target_workspace: "ws-2",
        },
    });
}

function ackReply(correlation: string): string {
    return JSON.stringify({
        v: WORKSPACE_SEND_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "acknowledged",
        kind: "send-to-workspace",
        base_revision: 0,
    });
}

function committedReply(correlation: string): string {
    return JSON.stringify({
        v: WORKSPACE_SEND_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "committed",
        kind: "send-to-workspace",
        base_revision: 1,
    });
}

function parsePayload(payload: string): Record<string, unknown> {
    return JSON.parse(payload) as Record<string, unknown>;
}

// Entry-level harness: a realistic read-only KWin surface whose writeable
// frameGeometry/desktops are visible to the next observation, plus the
// standalone entry handle. Drives a real planned flight for stop assertions.
interface EntryHarness {
    readonly handle: WorkspaceSendEntryHandle | null;
    readonly dbusCalls: DbusCall[];
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
}

function startEntryForPlannedFlight(): EntryHarness {
    const outRef = { name: "out-1" };
    const desktopRef = { id: "ws-1" };
    const targetDesktopRef = { id: "ws-2" };
    const winA = {};
    const winB = {};
    const winT = {};
    const frameA = { x: 0, y: 0, width: 100, height: 100 };
    const frameB = { x: 100, y: 0, width: 100, height: 100 };
    const frameT = { x: 0, y: 0, width: 100, height: 100 };
    Object.assign(winA, {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        internalId: "win-a",
        output: outRef,
        frameGeometry: frameA,
        desktops: [desktopRef],
    });
    Object.assign(winB, {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        internalId: "win-b",
        output: outRef,
        frameGeometry: frameB,
        desktops: [desktopRef],
    });
    Object.assign(winT, {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        internalId: "win-t",
        output: outRef,
        frameGeometry: frameT,
        desktops: [targetDesktopRef],
    });
    const surface = {
        activeWindow: winA,
        screens: [outRef],
        currentDesktopForScreen: () => desktopRef,
        desktops: [desktopRef, targetDesktopRef],
        clientArea: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowList: () => [winA, winB, winT],
    };
    const dbusCalls: DbusCall[] = [];
    const callbacks: Array<(reply: unknown) => void> = [];
    const logs: string[] = [];
    const handle = startWorkspaceSendAdapterEntry({
        workspace: surface,
        callDbus: (service, path, iface, method, payload, callback) => {
            dbusCalls.push({ service, path, iface, method, payload });
            callbacks.push(callback);
        },
        scheduleOnce: () => () => {},
        log: (message) => {
            logs.push(message);
        },
        owner: "owner-1",
        generation: "gen-1",
    });
    return { handle, dbusCalls, callbacks, logs };
}

// Drive the full request -> planned -> ack -> verify -> committed lifecycle
// against the mocked planner. Returns the mock state for assertions.
function runLifecycle(mocks: Mocks, adapter: WorkspaceSendAdapter): Mocks {
    assert.equal(adapter.requestSend("ws-2"), true);
    // Activation: GetNameOwner pins the owner immediately.
    const ownerCall = mocks.dbusCalls[0];
    assert.equal(ownerCall?.method, WORKSPACE_SEND_GET_OWNER_METHOD);
    assert.equal(ownerCall?.service, WORKSPACE_SEND_DBUS_SERVICE);
    assert.equal(ownerCall?.payload, WORKSPACE_SEND_SERVICE);
    mocks.callbacks[0]?.(":1.7");
    // Request phase: DescribePlan addressed to the pinned unique owner.
    const requestCall = mocks.dbusCalls[1];
    assert.equal(requestCall?.service, ":1.7");
    assert.equal(requestCall?.path, WORKSPACE_SEND_OBJECT);
    assert.equal(requestCall?.iface, WORKSPACE_SEND_INTERFACE);
    assert.equal(requestCall?.method, WORKSPACE_SEND_METHOD);
    const requestPayload = parsePayload(requestCall?.payload ?? "{}");
    assert.equal(requestPayload["op"] !== undefined, false);
    const command = requestPayload["command"] as Record<string, unknown>;
    assert.equal(command["op"], "send-to-workspace");
    const correlation = requestPayload["correlation_id"] as string;
    assert.ok(correlation.length > 0);
    // Planned reply: apply writes, then ack.
    mocks.callbacks[1]?.(plannedReply(correlation));
    const ackCall = mocks.dbusCalls[2];
    assert.equal(ackCall?.service, ":1.7");
    const ackPayload = parsePayload(ackCall?.payload ?? "{}");
    const ackCommand = ackPayload["command"] as Record<string, unknown>;
    assert.equal(ackCommand["op"], "send-to-workspace-ack");
    assert.equal(ackCommand["ack_outcome"], "accepted");
    mocks.callbacks[2]?.(ackReply(correlation));
    // Verify phase: echoes the exact preconditions and operation.
    const verifyCall = mocks.dbusCalls[3];
    assert.equal(verifyCall?.service, ":1.7");
    const verifyPayload = parsePayload(verifyCall?.payload ?? "{}");
    const verifyCommand = verifyPayload["command"] as Record<string, unknown>;
    assert.equal(verifyCommand["op"], "send-to-workspace-verify");
    assert.equal(verifyCommand["verified"], true);
    assert.deepEqual(verifyCommand["preconditions"], KNOWN_PRECONDITIONS);
    const operation = verifyCommand["operation"] as Record<string, unknown>;
    assert.equal(operation["op"], "move-tiled");
    assert.equal(operation["window"], "win-a");
    assert.equal(operation["target_workspace"], "ws-2");
    mocks.callbacks[3]?.(committedReply(correlation));
    return mocks;
}

describe("cosmic send-to-workspace adapter lifecycle", () => {
    it("commits after exact accepted ack and verified post-observation", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        runLifecycle(mocks, adapter);
        // Geometry writes cover all three affected windows in canonical order.
        assert.equal(mocks.geometries.length, 3);
        assert.deepEqual(mocks.geometries.map((g) => g.rect.w), [1200, 600, 600]);
        // Only the mover's desktop membership is written, to the target ref.
        assert.equal(mocks.desktops.length, 1);
        assert.equal(mocks.desktops[0]?.target, refs.a);
        assert.deepEqual(mocks.desktops[0]?.refs, [refs.desktop]);
        assert.equal(mocks.timers[0]?.cancelled, true);
        // Structured route diagnostics record pinned owner, accepted ack, and
        // verified completion with fixed fields only.
        assert.ok(mocks.logs.some((l) => l.includes("outcome=owner-pinned")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("outcome=acknowledged")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        for (const line of mocks.logs) {
            assert.ok(line.startsWith("plasma-auto-tiler:route-diag component=cosmic-send "), line);
            assert.ok(line.includes(" stage=") && line.includes(" correlation=") && line.includes(" generation=gen-1"), line);
            assert.ok(line.includes(" event=") && line.includes(" outcome="), line);
            assert.ok(!line.includes("win-a"), line);
            assert.ok(!line.includes(":1.7"), line);
        }
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("drives the request/ack/verify phases over the one DescribePlan route only", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        for (const call of mocks.dbusCalls.slice(1)) {
            assert.equal(call.method, WORKSPACE_SEND_METHOD, "no other D-Bus method may be invoked");
        }
    });

    it("keeps the source focused after the send (no focus or desktop switch)", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        // Only frameGeometry writes plus the single desktops write occur.
        assert.equal(mocks.geometries.length, 3);
        assert.equal(mocks.desktops.length, 1);
        for (const write of mocks.geometries) {
            assert.deepEqual(Object.keys(write.rect).sort(), ["h", "w", "x", "y"]);
        }
    });
});

describe("cosmic send-to-workspace refusal routes", () => {
    function refusalOutcome(opts: Parameters<typeof makeObserved>[1]): string {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, opts);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), false);
        assert.equal(adapter.isEnabled, false, "refusal must disable");
        const line = mocks.logs[mocks.logs.length - 1] ?? "";
        assert.ok(line.includes("event=refuse"), line);
        return line.split("outcome=")[1] ?? "";
    }

    it("refuses last-desktop when no distinct target can exist", () => {
        assert.equal(refusalOutcome({ desktopCount: 1 }), "last-desktop");
    });

    it("refuses a missing target workspace", () => {
        assert.equal(refusalOutcome({ targetExists: false }), "target-workspace-missing");
    });

    it("refuses cross-output requests", () => {
        assert.equal(refusalOutcome({ targetOutput: "out-2" }), "cross-output");
    });

    it("refuses same-workspace sends", () => {
        assert.equal(refusalOutcome({ targetWorkspace: "ws-1" }), "same-workspace");
    });

    it("refuses an absent focused window", () => {
        assert.equal(refusalOutcome({ activeRef: null, focused: "" }), "absent-focus");
    });

    it("refuses a non-tiled focused window", () => {
        assert.equal(refusalOutcome({ focused: "", activeRef: {} }), "non-tiled-focus");
    });

    it("refuses desktop-cap when more than 25 desktops are observed", () => {
        // KWin caps desktops at 25; 26 observed desktops must fail closed with
        // desktop-cap. The desktop count is a desktop observation, never a
        // window-count claim.
        const outcome = refusalOutcome({ desktopCount: 26 });
        assert.equal(outcome, "desktop-cap");
    });

    it("accepts exactly 25 desktops (the KWin cap is inclusive)", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, { desktopCount: 25 });
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
    });

    it("refuses no-planner when activation never produces an owner", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        // Absent initial owner: exactly one StartServiceByName phase.
        mocks.callbacks[0]?.("");
        const startCall = mocks.dbusCalls[1];
        assert.equal(startCall?.method, WORKSPACE_SEND_START_METHOD);
        assert.equal(startCall?.service, WORKSPACE_SEND_DBUS_SERVICE);
        // Only 1/2 are accepted; anything else is a terminal no-planner.
        mocks.callbacks[1]?.(WORKSPACE_SEND_START_PRIMARY + 7);
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")), mocks.logs.join("\n"));
        // No planner request is ever issued.
        assert.equal(mocks.dbusCalls.filter((c) => c.method === WORKSPACE_SEND_METHOD).length, 0);
    });

    it("refuses no-planner when the post-start owner is missing", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.("");
        assert.equal(mocks.dbusCalls[1]?.method, WORKSPACE_SEND_START_METHOD);
        mocks.callbacks[1]?.(WORKSPACE_SEND_START_PRIMARY);
        // Post-start GetNameOwner yields no unique owner.
        mocks.callbacks[2]?.("");
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")), mocks.logs.join("\n"));
    });

    it("refuses owner-loss when a D-Bus call throws after pinning", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const throwing = {
            ...mocks.env,
            callDbus: (_service: string, _path: string, _iface: string, method: string, _payload: string, callback: (reply: unknown) => void) => {
                if (method === WORKSPACE_SEND_METHOD) {
                    throw new Error("transport lost");
                }
                mocks.callbacks.push(callback);
            },
        };
        const adapter = new WorkspaceSendAdapter(throwing);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        // Pin the owner; the request call then throws -> owner-loss.
        mocks.callbacks[0]?.(":1.7");
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=owner-loss")), mocks.logs.join("\n"));
    });

    it("refuses stale-revision when the re-observation no longer matches", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        // A window appears on the source desktop before the reply is handled:
        // the exact re-observation no longer equals the flight snapshot.
        const drifted = makeObserved(refs, {
            sourceWindows: Object.freeze([
                Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
                Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze(rect(100, 0, 100, 100)) }),
                Object.freeze({ id: "win-c", ref: {}, rect: Object.freeze(rect(200, 0, 100, 100)) }),
            ]),
        });
        mocks.observeImpl = () => drifted;
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=stale-revision")), mocks.logs.join("\n"));
        // No native writes happened.
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.desktops.length, 0);
    });

    it("refuses a terminal diverged planner reply (e.g. stale-revision)", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(
            JSON.stringify({
                v: WORKSPACE_SEND_CONTRACT_VERSION,
                correlation_id: correlation,
                outcome: "diverged",
                kind: "stale-revision",
                message: "observation revision does not match verified state",
            }),
        );
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=stale-revision")), mocks.logs.join("\n"));
        assert.equal(mocks.geometries.length, 0);
    });

    it("refuses post-observation mismatch without an accepted ack or verify", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        // The request and pre-write revalidation observe the captured scope;
        // the post-write observation then reports the mover still in the source
        // with the stale rectangle, so the strict post-observation binding fails.
        let observeCalls = 0;
        mocks.observeImpl = () => {
            observeCalls += 1;
            if (observeCalls <= 2) {
                return makeObserved(refs);
            }
            return makeObserved(refs, {
                sourceWindows: Object.freeze([
                    Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
                    Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze(rect(100, 0, 100, 100)) }),
                ]),
            });
        };
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(adapter.isEnabled, false);
        assert.ok(
            mocks.logs.some((l) => l.includes("outcome=post-observation-mismatch")),
            mocks.logs.join("\n"),
        );
        // No accepted ack and no verify are ever sent; the only post-request
        // planner call is the bounded adapter-lost report.
        const verify = mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify"));
        const acceptedAck = mocks.dbusCalls.some(
            (c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted"),
        );
        assert.equal(verify, false, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(acceptedAck, false, JSON.stringify(mocks.dbusCalls, null, 2));
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(lost[0]?.service, ":1.7");
    });

    it("reports exactly one adapter-lost ack to the pinned owner on write failure", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        // The mover's desktop membership write fails after a valid plan.
        mocks.desktopsImpl = () => false;
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=write-failed")), mocks.logs.join("\n"));
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(lost[0]?.service, ":1.7", JSON.stringify(mocks.dbusCalls, null, 2));
        const lostPayload = parsePayload(lost[0]?.payload ?? "{}");
        const lostCommand = lostPayload["command"] as Record<string, unknown>;
        assert.equal(lostCommand["op"], "send-to-workspace-ack");
        assert.equal(lostCommand["ack_outcome"], "adapter-lost");
        assert.equal(parsePayload(lost[0]?.payload ?? "{}")["correlation_id"], correlation);
        assert.equal(parsePayload(lost[0]?.payload ?? "{}")["revision"], 0);
        // Failure behavior is unchanged: no accepted ack and no verify.
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")),
            false,
        );
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
        );
    });

    it("never falls back to the well-known name for the adapter-lost report", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.geometryImpl = () => false;
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=write-failed")), mocks.logs.join("\n"));
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        for (const call of lost) {
            assert.equal(call.service, ":1.7");
            assert.notEqual(call.service, WORKSPACE_SEND_SERVICE);
        }
    });

    it("times out a flight that never resolves", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        // Owner never resolves; the single timer fires. No valid planned reply
        // exists, so no adapter-lost report may be emitted.
        const timer = mocks.timers[0];
        assert.ok(timer);
        timer.callback();
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=timeout")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
    });
});

describe("cosmic send-to-workspace disable and stop divergence", () => {
    it("reports exactly one adapter-lost when disable() tears down a planned flight", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        // A valid planned reply bound the flight; explicit disable is terminal.
        adapter.disable();
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.timers[0]?.cancelled, true);
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(lost[0]?.service, ":1.7");
        assert.equal(lost[0]?.path, WORKSPACE_SEND_OBJECT);
        assert.equal(lost[0]?.method, WORKSPACE_SEND_METHOD);
        const lostPayload = parsePayload(lost[0]?.payload ?? "{}");
        assert.equal(lostPayload["correlation_id"], correlation);
        assert.equal(lostPayload["revision"], 0);
        assert.equal(lostPayload["owner"], "owner-1");
        const lostCommand = lostPayload["command"] as Record<string, unknown>;
        assert.equal(lostCommand["op"], "send-to-workspace-ack");
        assert.equal(lostCommand["ack_outcome"], "adapter-lost");
        // No verify was sent on the torn-down flight (the accepted ack was
        // legitimately sent while applying the plan before the disable).
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")),
            false,
        );
        // A second disable is a no-op: exactly one report stays.
        adapter.disable();
        assert.equal(mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost")).length, 1);
    });

    it("does not report adapter-lost when disable() runs before a valid plan", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        // Owner pinned but no planned reply yet: no valid plan, no report.
        mocks.callbacks[0]?.(":1.7");
        adapter.disable();
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
    });

    it("entry stop() during a planned flight reports exactly one adapter-lost to the pinned owner", () => {
        const { handle, dbusCalls, callbacks, logs } = startEntryForPlannedFlight();
        assert.ok(handle !== null);
        assert.equal(handle.requestSend("ws-2"), true);
        callbacks[0]?.(":1.7");
        const requestCall = dbusCalls[1];
        assert.equal(requestCall?.service, ":1.7");
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        callbacks[1]?.(plannedReply(correlation));
        handle.stop();
        const lost = dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(dbusCalls, null, 2));
        assert.equal(lost[0]?.service, ":1.7");
        assert.equal(parsePayload(lost[0]?.payload ?? "{}")["correlation_id"], correlation);
        // Stopped entry rejects further sends and stays silent on repeat stop.
        assert.equal(handle.requestSend("ws-2"), false);
        handle.stop();
        assert.equal(dbusCalls.filter((c) => c.payload.includes("adapter-lost")).length, 1);
        assert.equal(dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")), false);
        assert.ok(logs.length > 0, logs.join("\n"));
    });

    it("fails closed before verify when the scope changed after an accepted ack", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        // Request, pre-write revalidation, and post-write verified observations
        // are stable; the fourth (just before verify) reports a drifted scope.
        // The request observation predates the override, so the first two counted
// observations are the pre-write and post-write revalidations; the third
// (just before verify) reports a drifted scope.
        let observeCalls = 0;
        mocks.observeImpl = () => {
            observeCalls += 1;
            if (observeCalls <= 2) {
                return makeWorldObserved(mocks.world, refs);
            }
            return makeObserved(refs, { sourceOutput: "out-9" });
        };
        mocks.callbacks[1]?.(plannedReply(correlation));
        // Accepted ack arrives, then the pre-verify re-observation fails.
        mocks.callbacks[2]?.(ackReply(correlation));
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=stale-revision")), mocks.logs.join("\n"));
        // No verify was sent with the stale data; exactly one adapter-lost.
        const verify = mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify"));
        assert.equal(verify, false, JSON.stringify(mocks.dbusCalls, null, 2));
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(lost[0]?.service, ":1.7");
        assert.equal(parsePayload(lost[0]?.payload ?? "{}")["correlation_id"], correlation);
    });
});

describe("cosmic send-to-workspace wire contract", () => {
    it("binds owner, generation, correlation, and base revision across phases", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        for (const call of mocks.dbusCalls.slice(1)) {
            const payload = parsePayload(call.payload);
            assert.equal(payload["v"], WORKSPACE_SEND_CONTRACT_VERSION);
            assert.equal(payload["owner"], "owner-1");
            assert.equal(payload["generation"], "gen-1");
            assert.ok((payload["correlation_id"] as string).length > 0);
        }
    });

    it("carries the established selected geometry gaps in every domain payload", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        const plannerPayloads = mocks.dbusCalls
            .filter((call) => call.method === WORKSPACE_SEND_METHOD)
            .map((call) => parsePayload(call.payload));
        assert.ok(plannerPayloads.length >= 3, mocks.dbusCalls.join("\n"));
        for (const payload of plannerPayloads) {
            const domain = payload["domain"] as Record<string, unknown>;
            const targetDomain = payload["target_domain"] as Record<string, unknown>;
            assert.equal(domain["gap"], DOMAIN_GAP);
            assert.equal(domain["outer_gap"], OUTER_DOMAIN_GAP);
            assert.equal(targetDomain["gap"], DOMAIN_GAP);
            assert.equal(targetDomain["outer_gap"], OUTER_DOMAIN_GAP);
        }
    });

    it("carries the complete source and target post-observation in ack and verify", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        for (const call of mocks.dbusCalls.slice(2)) {
            const payload = parsePayload(call.payload);
            const windows = payload["windows"] as Array<Record<string, unknown>>;
            const targetWindows = payload["target_windows"] as Array<Record<string, unknown>>;
            const ids = [...windows.map((w) => w["window"]), ...targetWindows.map((w) => w["window"])].sort();
            assert.deepEqual(ids, ["win-a", "win-b", "win-t"]);
        }
    });

    it("emits a deterministic bounded scope fingerprint", () => {
        const expected = workspaceFingerprint("out-1", "ws-1", ["win-a", "win-b"].sort());
        const actual = workspaceFingerprint("out-1", "ws-1", ["win-a", "win-b"]);
        assert.equal(actual, expected);
        assert.ok(actual > 0);
    });

    it("refuses unknown command op replies as service-fault", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "bogus" }));
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=service-fault")), mocks.logs.join("\n"));
        assert.equal(mocks.geometries.length, 0);
    });

    it("validates the entry handle and disabled-by-default activation", () => {
        const handle = startWorkspaceSendAdapterEntry({});
        assert.equal(handle, null, "no production import path supplies a live workspace");
        const handle2 = startWorkspaceSendAdapterEntry({
            workspace: {},
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
        });
        assert.ok(handle2 !== null, "explicit entry with overrides starts");
        assert.equal(handle2.requestSend("bad id!"), false);
        handle2.stop();
    });
});

describe("cosmic send-to-workspace source guards", () => {
    const srcDir = kwinSrcDir();

    it("keeps the adapter out of the single-engine entry", () => {
        const entry = readFileSync(join(srcDir, "entry.ts"), "utf8");
        assert.ok(!entry.includes("workspace-send"));
        assert.ok(!entry.includes("WorkspaceSend"));
        assert.ok(!entry.includes("startWorkspaceSendAdapterEntry"));
    });

    it("registers no shortcuts and performs no forbidden native access", () => {
        for (const name of ["workspace-send-adapter.ts", "workspace-send-adapter-entry.ts"]) {
            const body = readFileSync(join(srcDir, name), "utf8");
            assert.ok(!body.includes("registerShortcut"), name);
            assert.ok(!body.includes("registerSessionShortcut"), name);
            assert.ok(!body.includes("readConfig"), name);
            assert.ok(!body.includes("writeConfig"), name);
            assert.ok(!body.includes("createDesktop"), name);
            assert.ok(!body.includes("removeDesktop"), name);
            assert.ok(!body.includes("setTimeout"), name);
            assert.ok(!body.includes("setInterval"), name);
            assert.ok(!body.includes("requestAnimationFrame"), name);
            assert.ok(!body.includes("waitFor"), name);
            assert.ok(!body.includes("fallback"), name);
        }
    });

    it("uses only the one DescribePlan transport", () => {
        const src = readFileSync(join(srcDir, "workspace-send-adapter.ts"), "utf8");
        assert.ok(src.includes("DescribePlan"));
        assert.ok(src.includes(WORKSPACE_SEND_METHOD));
        assert.ok(!src.includes("DescribeMovement"));
        assert.ok(!src.includes("DescribeFocus"));
        assert.ok(!src.includes("DescribeResize"));
        // Same-UID stays the Planner's single check; never duplicated here.
        assert.ok(!src.includes("GetConnectionUnixUser"));
    });

it("drives activation exactly like the bounded owner-pin sequence", () => {
        const src = readFileSync(join(srcDir, "workspace-send-adapter.ts"), "utf8");
        assert.ok(src.includes(WORKSPACE_SEND_GET_OWNER_METHOD));
        assert.ok(src.includes(WORKSPACE_SEND_START_METHOD));
        assert.ok(src.includes(String(WORKSPACE_SEND_START_PRIMARY)));
        assert.ok(src.includes(String(WORKSPACE_SEND_START_ALREADY)));
        assert.ok(src.includes(WORKSPACE_SEND_DBUS_SERVICE));
        assert.ok(src.includes(WORKSPACE_SEND_DBUS_OBJECT));
        assert.ok(src.includes(WORKSPACE_SEND_DBUS_INTERFACE));
        assert.ok(src.includes(":N.M"));
    });
});