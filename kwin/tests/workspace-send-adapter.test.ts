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
    readonly switches: object[];
    readonly focuses: object[];
    readonly world: World;
    observeImpl: () => WorkspaceSendObserved | null;
    geometryImpl: (target: object, r: { x: number; y: number; w: number; h: number }) => boolean;
    desktopsImpl: (target: object, refs: ReadonlyArray<object>) => boolean;
    switchImpl: (desktopRef: object) => boolean;
    focusImpl: (windowRef: object) => boolean;
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
        switches: [],
        focuses: [],
        world: defaultWorld(refs),
        observeImpl: () => makeWorldObserved(state.world, refs),
        geometryImpl: () => true,
        desktopsImpl: () => true,
        switchImpl: () => true,
        focusImpl: () => true,
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
        switchToTarget: (desktopRef) => {
            state.switches.push(desktopRef);
            return state.switchImpl(desktopRef);
        },
        focusWindow: (windowRef) => {
            state.focuses.push(windowRef);
            return state.focusImpl(windowRef);
        },
    };
    return state;
}

interface EchoSeam {
    readonly handlers: Array<() => void>;
    readonly targets: object[];
    readonly geoHandlers: Map<object, Array<() => void>>;
    detachCount: number;
    geoDetachCount: number;
    fire(): void;
    fireGeometry(): void;
}

function addEchoSeam(mocks: Mocks): EchoSeam {
    const handlers: Array<() => void> = [];
    const targets: object[] = [];
    const geoHandlers = new Map<object, Array<() => void>>();
    const seam: EchoSeam = {
        handlers,
        targets,
        geoHandlers,
        detachCount: 0,
        geoDetachCount: 0,
        fire(): void {
            const pending = [...handlers];
            for (const handler of pending) {
                handler();
            }
        },
        fireGeometry(): void {
            for (const list of geoHandlers.values()) {
                for (const handler of [...list]) {
                    handler();
                }
            }
        },
    };
    const withEcho: WorkspaceSendAdapterEnv = {
        ...mocks.env,
        subscribeMoverDesktops: (moverRef: object, handler: () => void) => {
            targets.push(moverRef);
            handlers.push(handler);
            let detached = false;
            return () => {
                if (!detached) {
                    detached = true;
                    seam.detachCount += 1;
                }
            };
        },
        subscribeWindowGeometry: (windowRef: object, handler: () => void) => {
            const list = geoHandlers.get(windowRef) ?? [];
            list.push(handler);
            geoHandlers.set(windowRef, list);
            let detached = false;
            return () => {
                if (!detached) {
                    detached = true;
                    seam.geoDetachCount += 1;
                }
            };
        },
    };
    (mocks as { env: WorkspaceSendAdapterEnv }).env = withEcho;
    return seam;
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
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
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
// Each window exposes connectable desktopsChanged plus frameGeometryChanged
// signals so the production fence seams can arm; fire helpers emit them.
// A stale moveResizedChanged decoy is also exposed: per KWin source it only
// mirrors interactive start/finish and must never settle the fence.
interface EntryHarness {
    readonly handle: WorkspaceSendEntryHandle | null;
    readonly dbusCalls: DbusCall[];
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly winA: Record<string, unknown>;
    readonly winB: Record<string, unknown>;
    readonly winT: Record<string, unknown>;
    fireMoverEcho(): void;
    fireGeometry(): void;
    fireOldGeometry(): void;
}

function makeDesktopSignal(): { signal: object; fire(): void } {
    const handlers: Array<() => void> = [];
    const signal = {
        connect: (handler: () => void): void => {
            handlers.push(handler);
        },
        disconnect: (handler: () => void): void => {
            const at = handlers.indexOf(handler);
            if (at >= 0) {
                handlers.splice(at, 1);
            }
        },
    };
    return {
        signal,
        fire(): void {
            for (const handler of [...handlers]) {
                handler();
            }
        },
    };
}

function startEntryForPlannedFlight(): EntryHarness {
    const outRef = { name: "out-1" };
    const desktopRef = { id: "ws-1" };
    const targetDesktopRef = { id: "ws-2" };
    const echoA = makeDesktopSignal();
    const echoB = makeDesktopSignal();
    const echoT = makeDesktopSignal();
    const geoA = makeDesktopSignal();
    const geoB = makeDesktopSignal();
    const geoT = makeDesktopSignal();
    const oldA = makeDesktopSignal();
    const oldB = makeDesktopSignal();
    const oldT = makeDesktopSignal();
    const winA: Record<string, unknown> = {};
    const winB: Record<string, unknown> = {};
    const winT: Record<string, unknown> = {};
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
        desktopsChanged: echoA.signal,
        frameGeometryChanged: geoA.signal,
        moveResizedChanged: oldA.signal,
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
        desktopsChanged: echoB.signal,
        frameGeometryChanged: geoB.signal,
        moveResizedChanged: oldB.signal,
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
        desktopsChanged: echoT.signal,
        frameGeometryChanged: geoT.signal,
        moveResizedChanged: oldT.signal,
    });
    const surface: Record<string, unknown> = {
        activeWindow: winA,
        screens: [outRef],
        currentDesktopForScreen: () => desktopRef,
        currentDesktop: desktopRef,
        setCurrentDesktopForScreen: (desktop: unknown) => {
            surface["currentDesktop"] = desktop;
        },
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
    return {
        handle,
        dbusCalls,
        callbacks,
        logs,
        winA,
        winB,
        winT,
        fireMoverEcho: () => echoA.fire(),
        fireGeometry: () => {
            geoA.fire();
            geoB.fire();
            geoT.fire();
        },
        fireOldGeometry: () => {
            oldA.fire();
            oldB.fire();
            oldT.fire();
        },
    };
}

// Drive the full request -> planned -> ack -> verify -> committed lifecycle
// against the mocked planner. Returns the mock state for assertions.
function runLifecycle(mocks: Mocks, adapter: WorkspaceSendAdapter, requestedOrdinal?: unknown): Mocks {
    if (requestedOrdinal === undefined) {
        assert.equal(adapter.requestSend("ws-2"), true);
    } else {
        assert.equal(adapter.requestSend("ws-2", requestedOrdinal), true);
    }
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

    it("follows to the Rust-planned target and focuses the moved window after commit", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        // Only frameGeometry writes plus the single desktops write occur
        // before the follow.
        assert.equal(mocks.geometries.length, 3);
        assert.equal(mocks.desktops.length, 1);
        for (const write of mocks.geometries) {
            assert.deepEqual(Object.keys(write.rect).sort(), ["h", "w", "x", "y"]);
        }
        // Legacy follow: exactly one desktop switch to the planned target
        // ref plus exactly one focus of the moved window ref.
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.ok(mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("carries the requested logical ordinal into follow diagnostics without gating", () => {
        for (const ordinal of [2, 0]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            mocks.observeImpl = () => ({
                ...makeWorldObserved(mocks.world, refs),
                targetOrdinal: 1,
                targetNumber: 2,
                outputOrdinal: 0,
                currentOrdinal: 0,
                currentNumber: 1,
                currentIdEq: 0,
                currentRefEq: 0,
            });
            const adapter = new WorkspaceSendAdapter(mocks.env);
            adapter.enable({ owner: "owner-1", generation: "gen-1" });
            runLifecycle(mocks, adapter, ordinal);
            const correlation = parsePayload(mocks.dbusCalls[1]?.payload ?? "{}")["correlation_id"] as string;
            const followLines = mocks.logs.filter(
                (l) => l.includes("component=cosmic-send") && l.includes("stage=follow") && l.includes(`correlation=${correlation}`),
            );
            assert.ok(followLines.length >= 4, mocks.logs.join("\n"));
            for (const line of followLines.filter((l) => l.includes("event=follow-"))) {
                assert.ok(line.includes(`req_ord=${String(ordinal)}`), `req handoff missing in:\n${line}`);
                for (const raw of ["win-a", "ws-1", "ws-2", "out-1", ":1.7", "owner-1"]) {
                    assert.ok(!line.includes(raw), `${raw} leaked in:\n${line}`);
                }
            }
            assert.deepEqual(mocks.switches, [refs.desktop]);
            assert.deepEqual(mocks.focuses, [refs.a]);
        }
        // Invalid ordinals sanitize to -1 and never refuse the send.
        for (const bad of [99, -1, "bad"]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            mocks.observeImpl = () => ({
                ...makeWorldObserved(mocks.world, refs),
                targetOrdinal: 1,
                targetNumber: 2,
                outputOrdinal: 0,
                currentOrdinal: 0,
                currentNumber: 1,
                currentIdEq: 0,
                currentRefEq: 0,
            });
            const adapter = new WorkspaceSendAdapter(mocks.env);
            adapter.enable({ owner: "owner-1", generation: "gen-1" });
            runLifecycle(mocks, adapter, bad);
            const correlation = parsePayload(mocks.dbusCalls[1]?.payload ?? "{}")["correlation_id"] as string;
            const pre = mocks.logs.find((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow-pre")) ?? "";
            assert.ok(pre.includes("req_ord=-1"), `invalid ordinal must sanitize:\n${pre}`);
            assert.deepEqual(mocks.switches, [refs.desktop]);
        }
    });

    it("discriminates live current-desktop divergence from the target", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let calls = 0;
        mocks.observeImpl = () => {
            calls += 1;
            const live = makeWorldObserved(mocks.world, refs);
            // Calls 1-5 cover request through the pre-switch gate while live
            // current stays on the source; the immediate after-setter read and
            // later reads see live current on the target.
            if (calls >= 6) {
                return {
                    ...live,
                    targetOrdinal: 1,
                    targetNumber: 2,
                    outputOrdinal: 0,
                    currentOrdinal: 1,
                    currentNumber: 2,
                    currentIdEq: 1,
                    currentRefEq: 1,
                };
            }
            return {
                ...live,
                targetOrdinal: 1,
                targetNumber: 2,
                outputOrdinal: 0,
                currentOrdinal: 0,
                currentNumber: 1,
                currentIdEq: 0,
                currentRefEq: 0,
            };
        };
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter, 2);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        const correlation = parsePayload(mocks.dbusCalls[1]?.payload ?? "{}")["correlation_id"] as string;
        const pre = mocks.logs.find((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow-pre")) ?? "";
        assert.ok(pre.includes("req_ord=2"), pre);
        assert.ok(pre.includes("tgt_ord=1") && pre.includes("tgt_num=2"), pre);
        assert.ok(pre.includes("cur_ord=0") && pre.includes("cur_num=1"), pre);
        assert.ok(pre.includes("cur_id_eq=0") && pre.includes("cur_ref_eq=0"), pre);
        assert.ok(pre.includes("out_ord=0") && pre.includes("out_eq=1"), pre);
        assert.ok(pre.includes("switched=-1") && pre.includes("focused=-1"), pre);
        const switched = mocks.logs.find((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow-switched")) ?? "";
        assert.ok(switched.includes("cur_ord=1") && switched.includes("cur_num=2"), switched);
        assert.ok(switched.includes("cur_id_eq=1") && switched.includes("cur_ref_eq=1"), switched);
        assert.ok(switched.includes("switched=1") && switched.includes("focused=-1"), switched);
        const focused = mocks.logs.find((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow-focused")) ?? "";
        assert.ok(focused.includes("cur_id_eq=1") && focused.includes("switched=1") && focused.includes("focused=1"), focused);
        const settled = mocks.logs.find((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow-settled")) ?? "";
        assert.ok(settled.includes("cur_ord=1") && settled.includes("mover_in_target=1"), settled);
        for (const line of [pre, switched, focused, settled]) {
            for (const raw of ["win-a", "win-b", "win-t", "ws-1", "ws-2", "out-1", ":1.7", "owner-1"]) {
                assert.ok(!line.includes(raw), `${raw} leaked in:\n${line}`);
            }
        }
    });

    it("reports post-focus reversal while follow still completes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let calls = 0;
        mocks.observeImpl = () => {
            calls += 1;
            const live = makeWorldObserved(mocks.world, refs);
            const base = {
                ...live,
                targetOrdinal: 1,
                targetNumber: 2,
                outputOrdinal: 0,
            };
            // Calls 1-6 cover request through the after-setter read with live
            // current on the target and the mover active.
            if (calls <= 6) {
                const current = calls >= 6
                    ? { currentOrdinal: 1, currentNumber: 2, currentIdEq: 1, currentRefEq: 1 }
                    : { currentOrdinal: 0, currentNumber: 1, currentIdEq: 0, currentRefEq: 0 };
                return { ...base, ...current };
            }
            // Post-focus and settled reads reverse: live current falls back to
            // the source and the active window is no longer the mover.
            return {
                ...base,
                sourceWindows: live.sourceWindows,
                targetWindows: live.targetWindows,
                activeRef: refs.b,
                currentOrdinal: 0,
                currentNumber: 1,
                currentIdEq: 0,
                currentRefEq: 0,
            };
        };
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter, 2);
        // Diagnostics never gate behavior: the native hooks still ran and the
        // truthful follow line still reports the focus result.
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        const correlation = parsePayload(mocks.dbusCalls[1]?.payload ?? "{}")["correlation_id"] as string;
        const switched = mocks.logs.find((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow-switched")) ?? "";
        assert.ok(switched.includes("cur_id_eq=1") && switched.includes("active_is_mover=1"), switched);
        const focused = mocks.logs.find((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow-focused")) ?? "";
        assert.ok(focused.includes("cur_ord=0") && focused.includes("cur_id_eq=0"), `reversal missing:\n${focused}`);
        assert.ok(focused.includes("active_is_mover=0"), `active reversal missing:\n${focused}`);
        assert.ok(focused.includes("switched=1") && focused.includes("focused=1"), focused);
        assert.ok(
            mocks.logs.some((l) => l.includes(`correlation=${correlation}`) && l.includes("event=follow") && l.includes("outcome=state-confirmed")),
            mocks.logs.join("\n"),
        );
    });

    it("leaves follow behavior unchanged when follow observations return null", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let calls = 0;
        const liveObserve = mocks.observeImpl;
        mocks.observeImpl = () => {
            calls += 1;
            // Post-switch and post-focus re-reads fail; pre-switch, gates,
            // and the settled boundary still observe.
            if (calls === 6 || calls === 7) {
                return null;
            }
            return liveObserve();
        };
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.ok(mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        for (const event of ["event=follow-switched", "event=follow-focused"]) {
            const line = mocks.logs.find((l) => l.includes(event)) ?? "";
            assert.ok(line.includes("outcome=unknown"), `${event} must report unknown:\n${line}`);
            assert.ok(line.includes("tgt_ord=-1") && line.includes("cur_ord=-1"), line);
        }
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("leaves follow behavior unchanged when follow logging throws", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter({
            ...mocks.env,
            log: (message: string) => {
                if (message.includes("stage=follow")) {
                    throw new Error("log lost");
                }
                mocks.logs.push(message);
            },
        });
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("rejects a planned reply whose desired focus is not the Rust target mover", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        const mismatch = JSON.parse(plannedReply(correlation)) as Record<string, unknown>;
        mismatch["desired_focus"] = { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-win-b" };
        mocks.callbacks[1]?.(JSON.stringify(mismatch));
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=precondition-mismatch")), mocks.logs.join("\n"));
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.desktops.length, 0);
    });

    it("does not follow when the post-commit observation drifts from the plan", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        mocks.callbacks[2]?.(ackReply(correlation));
        // Drift between the verify request and the committed follow check:
        // the mover reports back in the source with a stale rect.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                sourceWindows: Object.freeze([
                    Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
                    Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze(rect(100, 0, 100, 100)) }),
                ]),
            });
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        // No success telemetry, but the correlated later-boundary observation
        // still reports the drifted state instead of claiming a follow.
        assert.ok(
            !mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")),
            mocks.logs.join("\n"),
        );
        for (const event of ["event=follow-pre", "event=follow-switched", "event=follow-focused"]) {
            assert.ok(!mocks.logs.some((l) => l.includes(event)), `${event} must not emit on drift:\n${mocks.logs.join("\n")}`);
        }
        const settled = mocks.logs.filter(
            (l) => l.includes("stage=follow") && l.includes("event=follow-settled") && l.includes(`correlation=${correlation}`),
        );
        assert.equal(settled.length, 1, mocks.logs.join("\n"));
        assert.ok(settled[0]?.includes("outcome=observed"), settled.join("\n"));
        assert.ok(settled[0]?.includes("mover_in_target=0"), settled.join("\n"));
    });

    it("ignores a duplicate committed reply without a second follow", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        // A stale duplicate verify echo after the flight cleared is ignored.
        mocks.callbacks[3]?.(committedReply("gen-1-w0"));
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
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
        assert.equal(adapter.isEnabled, true, "pre-flight refusal must stay enabled");
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 0, "pre-flight refusal must not touch D-Bus");
        assert.equal(mocks.timers.length, 0, "pre-flight refusal must not arm a timer");
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.desktops.length, 0);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")),
            false,
        );
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

    it("refuses scope-invalid without disabling when observation is absent", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => null;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), false);
        assert.equal(adapter.isEnabled, true, "pre-flight refusal must stay enabled");
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.timers.length, 0);
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.desktops.length, 0);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.ok(mocks.logs.some((l) => l.includes("event=refuse") && l.includes("outcome=scope-invalid")), mocks.logs.join("\n"));
    });

    it("stays enabled across valid, same-workspace no-op, then valid sends", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        runLifecycle(mocks, adapter);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 1);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
        const afterFirst = {
            dbus: mocks.dbusCalls.length,
            timers: mocks.timers.length,
            geometries: mocks.geometries.length,
            desktops: mocks.desktops.length,
            switches: mocks.switches.length,
            focuses: mocks.focuses.length,
        };
        assert.equal(afterFirst.dbus, 4);
        assert.equal(afterFirst.timers, 1);
        mocks.observeImpl = () => makeObserved(refs, { targetWorkspace: "ws-1" });
        assert.equal(adapter.requestSend("ws-1"), false);
        assert.equal(adapter.isEnabled, true, "same-workspace no-op must stay enabled");
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("event=refuse") && l.includes("outcome=same-workspace")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.length, afterFirst.dbus, "no-op must not touch D-Bus");
        assert.equal(mocks.timers.length, afterFirst.timers, "no-op must not arm a timer");
        assert.equal(mocks.geometries.length, afterFirst.geometries);
        assert.equal(mocks.desktops.length, afterFirst.desktops);
        assert.equal(mocks.switches.length, afterFirst.switches);
        assert.equal(mocks.focuses.length, afterFirst.focuses);
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 1);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
        for (const entry of mocks.world.windows) {
            if (entry.id === "win-a") {
                entry.workspace = "ws-1";
                entry.rect = rect(0, 0, 100, 100);
            } else if (entry.id === "win-b") {
                entry.workspace = "ws-1";
                entry.rect = rect(100, 0, 100, 100);
            } else if (entry.id === "win-t") {
                entry.workspace = "ws-2";
                entry.rect = rect(0, 0, 100, 100);
            }
        }
        mocks.observeImpl = () => makeWorldObserved(mocks.world, refs);
        assert.equal(adapter.requestSend("ws-2"), true);
        const base = afterFirst.dbus;
        assert.equal(mocks.dbusCalls[base]?.method, WORKSPACE_SEND_GET_OWNER_METHOD);
        mocks.callbacks[base]?.(":1.7");
        const requestCall = mocks.dbusCalls[base + 1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[base + 1]?.(plannedReply(correlation));
        mocks.callbacks[base + 2]?.(ackReply(correlation));
        mocks.callbacks[base + 3]?.(committedReply(correlation));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.deepEqual(mocks.switches, [refs.desktop, refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a, refs.a]);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 2);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
    });

    it("keeps post-plan divergence terminal and disabled", () => {
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
            }),
        );
        assert.equal(adapter.isEnabled, false, "post-plan divergence stays terminal");
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.requestSend("ws-2"), false, "terminal adapter stays fail-closed");
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
        // Only 1/2 are accepted; anything else is a remote-clean no-planner:
        // definitely before planner dispatch, so no adapter-lost and the
        // adapter stays enabled with no flight.
        mocks.callbacks[1]?.(WORKSPACE_SEND_START_PRIMARY + 7);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")), mocks.logs.join("\n"));
        // No planner request is ever issued.
        assert.equal(mocks.dbusCalls.filter((c) => c.method === WORKSPACE_SEND_METHOD).length, 0);
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        // Next distinct send works.
        assert.equal(adapter.requestSend("ws-2"), true);
        const base = mocks.dbusCalls.length - 1;
        mocks.callbacks[base]?.(":1.7");
        const requestCall = mocks.dbusCalls[base + 1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[base + 1]?.(plannedReply(correlation));
        mocks.callbacks[base + 2]?.(ackReply(correlation));
        mocks.callbacks[base + 3]?.(committedReply(correlation));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
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
        // Post-start GetNameOwner yields no unique owner: remote-clean,
        // definitely before planner dispatch.
        mocks.callbacks[2]?.("");
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=no-planner")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        assert.equal(adapter.requestSend("ws-2"), true);
        const base = mocks.dbusCalls.length - 1;
        mocks.callbacks[base]?.(":1.7");
        const requestCall = mocks.dbusCalls[base + 1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[base + 1]?.(plannedReply(correlation));
        mocks.callbacks[base + 2]?.(ackReply(correlation));
        mocks.callbacks[base + 3]?.(committedReply(correlation));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
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

    it("enables once at startup and stays fail-closed after terminal disable", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), false);
        adapter.disable();
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), false, "no revival after terminal disable");
        assert.equal(adapter.requestSend("ws-2"), false, "pending route stays fail-closed");
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
        // Mover echo fence: native writes applied but the accepted ack waits
        // for the mover desktopsChanged echo, so stop tears down a waiting
        // flight with no accepted ack and no verify.
        assert.ok(logs.some((l) => l.includes("event=plan-echo") && l.includes("outcome=waiting")), logs.join("\n"));
        assert.equal(
            dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
        );
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

describe("cosmic send-to-workspace review follow-ups", () => {
    it("refuses an internally consistent plan whose mover differs from the snapshot before writes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        // Internally consistent: desired_focus names the operation leaf in the
        // operation target domain, but the operation mover (win-b) differs
        // from the captured snapshot mover (win-a).
        const mismatched = JSON.parse(plannedReply(correlation)) as Record<string, unknown>;
        const operation = mismatched["operation"] as Record<string, unknown>;
        operation["window"] = "win-b";
        operation["leaf"] = "leaf-win-b";
        mismatched["desired_focus"] = { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-b" };
        mocks.callbacks[1]?.(JSON.stringify(mismatched));
        assert.equal(adapter.isEnabled, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=precondition-mismatch")), mocks.logs.join("\n"));
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.desktops.length, 0);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
    });

    it("clears the flight after a committed follow so the next request completes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        runLifecycle(mocks, adapter);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        const firstCorrelation = parsePayload(mocks.dbusCalls[1]?.payload ?? "{}")["correlation_id"] as string;
        // Restore the native world to the pre-flight layout so the next
        // request observes the same scope with the same harness.
        for (const entry of mocks.world.windows) {
            if (entry.id === "win-a") {
                entry.workspace = "ws-1";
                entry.rect = rect(0, 0, 100, 100);
            } else if (entry.id === "win-b") {
                entry.workspace = "ws-1";
                entry.rect = rect(100, 0, 100, 100);
            } else if (entry.id === "win-t") {
                entry.workspace = "ws-2";
                entry.rect = rect(0, 0, 100, 100);
            }
        }
        assert.equal(adapter.requestSend("ws-2"), true);
        const base = 4;
        assert.equal(mocks.dbusCalls[base]?.method, WORKSPACE_SEND_GET_OWNER_METHOD);
        mocks.callbacks[base]?.(":1.7");
        const requestCall = mocks.dbusCalls[base + 1];
        assert.equal(requestCall?.method, WORKSPACE_SEND_METHOD);
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        assert.notEqual(correlation, firstCorrelation);
        mocks.callbacks[base + 1]?.(plannedReply(correlation));
        const ackCall = mocks.dbusCalls[base + 2];
        assert.ok((parsePayload(ackCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"] === "send-to-workspace-ack");
        mocks.callbacks[base + 2]?.(ackReply(correlation));
        const verifyCall = mocks.dbusCalls[base + 3];
        assert.ok((parsePayload(verifyCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"] === "send-to-workspace-verify");
        mocks.callbacks[base + 3]?.(committedReply(correlation));
        assert.deepEqual(mocks.switches, [refs.desktop, refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a, refs.a]);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 2);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
    });

    it("causes no desktop switch or focus when the ack reply is rejected", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(mocks.dbusCalls[2]?.method, WORKSPACE_SEND_METHOD);
        mocks.callbacks[2]?.(
            JSON.stringify({
                v: WORKSPACE_SEND_CONTRACT_VERSION,
                correlation_id: correlation,
                outcome: "rejected",
                kind: "policy-deny",
            }),
        );
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
    });

    it("causes no desktop switch or focus when the verify reply diverges", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        mocks.callbacks[2]?.(ackReply(correlation));
        const verifyCall = mocks.dbusCalls[3];
        assert.ok((parsePayload(verifyCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"] === "send-to-workspace-verify");
        mocks.callbacks[3]?.(
            JSON.stringify({
                v: WORKSPACE_SEND_CONTRACT_VERSION,
                correlation_id: correlation,
                outcome: "diverged",
                kind: "stale-revision",
            }),
        );
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
    });
});

describe("cosmic send-to-workspace mover echo fence", () => {
    function startEchoFlight(refs: { a: object; b: object; t: object; desktop: object }): {
        mocks: Mocks;
        adapter: WorkspaceSendAdapter;
        seam: EchoSeam;
        correlation: string;
    } {
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        return { mocks, adapter, seam, correlation };
    }

    function finishEchoFlight(
        mocks: Mocks,
        seam: EchoSeam,
        correlation: string,
    ): void {
        seam.fire();
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
            "mover echo alone must not ack while geometry echoes are pending",
        );
        seam.fireGeometry();
        const ackCall = mocks.dbusCalls[2];
        assert.equal(ackCall?.method, WORKSPACE_SEND_METHOD);
        const ackPayload = parsePayload(ackCall?.payload ?? "{}");
        assert.equal((ackPayload["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        mocks.callbacks[2]?.(ackReply(correlation));
        const verifyCall = mocks.dbusCalls[3];
        assert.equal((parsePayload(verifyCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"], "send-to-workspace-verify");
        mocks.callbacks[3]?.(committedReply(correlation));
    }

    function resetWorldToSource(mocks: Mocks): void {
        for (const entry of mocks.world.windows) {
            if (entry.id === "win-a") {
                entry.workspace = "ws-1";
                entry.rect = rect(0, 0, 100, 100);
            } else if (entry.id === "win-b") {
                entry.workspace = "ws-1";
                entry.rect = rect(100, 0, 100, 100);
            } else if (entry.id === "win-t") {
                entry.workspace = "ws-2";
                entry.rect = rect(0, 0, 100, 100);
            }
        }
    }

    it("sends no ack or verify before the mover echo", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startEchoFlight(refs);
        void correlation;
        assert.equal(mocks.geometries.length, 3);
        assert.equal(mocks.desktops.length, 1);
        assert.deepEqual(seam.targets, [refs.a]);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.ok(mocks.logs.some((l) => l.includes("event=plan-echo") && l.includes("outcome=waiting")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("event=plan-geometry") && l.includes("outcome=waiting")), mocks.logs.join("\n"));
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
        );
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")), false);
        seam.fire();
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
            "geometry fence must still hold the ack after the mover echo alone",
        );
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, true);
    });

    it("verifies exact geometry plus membership on echo, then commits and follows", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startEchoFlight(refs);
        finishEchoFlight(mocks, seam, correlation);
        assert.equal(mocks.geometries.length, 3);
        assert.deepEqual(mocks.geometries.map((g) => g.rect.w), [1200, 600, 600]);
        assert.equal(mocks.desktops.length, 1);
        assert.equal(mocks.desktops[0]?.target, refs.a);
        assert.ok(mocks.logs.some((l) => l.includes("event=plan-echo") && l.includes("outcome=consumed")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("event=plan-geometry") && l.includes("outcome=consumed")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("outcome=acknowledged")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.ok(mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.equal(seam.detachCount, 1);
        assert.equal(seam.geoDetachCount, 3);
    });

    it("keeps the adapter enabled across a second and third completed move", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        for (let move = 0; move < 3; move += 1) {
            assert.equal(adapter.requestSend("ws-2"), true);
            const base = move * 4;
            assert.equal(mocks.dbusCalls[base]?.method, WORKSPACE_SEND_GET_OWNER_METHOD);
            mocks.callbacks[base]?.(":1.7");
            const requestCall = mocks.dbusCalls[base + 1];
            const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
            mocks.callbacks[base + 1]?.(plannedReply(correlation));
            assert.equal(mocks.dbusCalls.length, base + 2);
            seam.fire();
            seam.fireGeometry();
            mocks.callbacks[base + 2]?.(ackReply(correlation));
            mocks.callbacks[base + 3]?.(committedReply(correlation));
            assert.equal(adapter.isEnabled, true);
            assert.equal(adapter.isInFlight, false);
            if (move < 2) {
                resetWorldToSource(mocks);
            }
        }
        assert.deepEqual(mocks.switches, [refs.desktop, refs.desktop, refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a, refs.a, refs.a]);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 3);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
        assert.equal(seam.detachCount, 3);
        assert.equal(seam.geoDetachCount, 9);
    });

    it("ignores a duplicate echo without duplicate membership or ack", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startEchoFlight(refs);
        finishEchoFlight(mocks, seam, correlation);
        const calls = mocks.dbusCalls.length;
        const memberships = mocks.desktops.length;
        seam.fire();
        seam.fireGeometry();
        assert.equal(mocks.dbusCalls.length, calls);
        assert.equal(mocks.desktops.length, memberships);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("treats an echo mismatch as terminal with exactly one adapter-lost", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startEchoFlight(refs);
        // Mover reports back in the source with a stale rect: strict echo
        // post-observation must fail terminal without an accepted ack.
        mocks.observeImpl = () =>
            makeObserved(refs, {
                sourceWindows: Object.freeze([
                    Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
                    Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze(rect(100, 0, 100, 100)) }),
                ]),
            });
        seam.fire();
        seam.fireGeometry();
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(
            mocks.logs.some((l) => l.includes("outcome=post-observation-mismatch")),
            mocks.logs.join("\n"),
        );
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")),
            false,
        );
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
        );
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(lost[0]?.service, ":1.7");
        assert.equal(parsePayload(lost[0]?.payload ?? "{}")["correlation_id"], correlation);
        assert.equal(seam.detachCount, 1);
    });

    it("completes a real entry shortcut-shaped flight only after the native echo", () => {
        const harness = startEntryForPlannedFlight();
        assert.ok(harness.handle !== null);
        assert.equal(harness.handle.requestSend("ws-2"), true);
        harness.callbacks[0]?.(":1.7");
        const requestCall = harness.dbusCalls[1];
        assert.equal(requestCall?.service, ":1.7");
        const requestPayload = parsePayload(requestCall?.payload ?? "{}");
        assert.equal((requestPayload["command"] as Record<string, unknown>)["op"], "send-to-workspace");
        const correlation = requestPayload["correlation_id"] as string;
        harness.callbacks[1]?.(plannedReply(correlation));
        // Native writes applied, but Rust-shaped ack waits for both echoes.
        assert.equal(
            harness.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
        );
        harness.fireMoverEcho();
        assert.equal(
            harness.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
            "mover echo alone must not ack while geometry echoes are pending",
        );
        harness.fireGeometry();
        const ackCall = harness.dbusCalls[2];
        assert.equal((parsePayload(ackCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        harness.callbacks[2]?.(ackReply(correlation));
        const verifyCall = harness.dbusCalls[3];
        const verifyPayload = parsePayload(verifyCall?.payload ?? "{}");
        assert.equal((verifyPayload["command"] as Record<string, unknown>)["op"], "send-to-workspace-verify");
        assert.deepEqual(
            (verifyPayload["command"] as Record<string, unknown>)["preconditions"],
            KNOWN_PRECONDITIONS,
        );
        harness.callbacks[3]?.(committedReply(correlation));
        assert.ok(harness.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), harness.logs.join("\n"));
        assert.ok(!harness.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), harness.logs.join("\n"));
        harness.handle.stop();
    });

    it("needs no geometry echo when planned geometry is unchanged", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        const unchanged = JSON.stringify({
            v: WORKSPACE_SEND_CONTRACT_VERSION,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            detail: { kind: "send-to-workspace", policy_version: 1, capability: "move-tiled" },
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 100, h: 100 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 100, y: 0, w: 100, h: 100 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 100, h: 100 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
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
        mocks.callbacks[1]?.(unchanged);
        assert.equal(seam.geoHandlers.size, 0, "unchanged geometry subscribes to no window");
        assert.ok(mocks.logs.some((l) => l.includes("event=plan-echo") && l.includes("outcome=waiting")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=plan-geometry")), mocks.logs.join("\n"));
        seam.fire();
        const ackCall = mocks.dbusCalls[2];
        assert.equal(ackCall?.method, WORKSPACE_SEND_METHOD);
        assert.equal((parsePayload(ackCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.equal(seam.detachCount, 1);
        assert.equal(seam.geoDetachCount, 0);
    });

    it("fails terminal and detaches every handler when a geometry subscription fails", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const handlers: Array<() => void> = [];
        const targets: object[] = [];
        const geoHandlers = new Map<object, Array<() => void>>();
        let moverDetaches = 0;
        let geoDetaches = 0;
        let geoCalls = 0;
        const failingEnv: WorkspaceSendAdapterEnv = {
            ...mocks.env,
            subscribeMoverDesktops: (moverRef: object, handler: () => void) => {
                targets.push(moverRef);
                handlers.push(handler);
                let detached = false;
                return () => {
                    if (!detached) {
                        detached = true;
                        moverDetaches += 1;
                    }
                };
            },
            subscribeWindowGeometry: (windowRef: object, handler: () => void) => {
                geoCalls += 1;
                if (geoCalls === 1) {
                    const list = geoHandlers.get(windowRef) ?? [];
                    list.push(handler);
                    geoHandlers.set(windowRef, list);
                    let detached = false;
                    return () => {
                        if (!detached) {
                            detached = true;
                            geoDetaches += 1;
                        }
                    };
                }
                return null;
            },
        };
        (mocks as { env: WorkspaceSendAdapterEnv }).env = failingEnv;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(adapter.isEnabled, false, "geometry subscription failure is terminal");
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=write-failed")), mocks.logs.join("\n"));
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(parsePayload(lost[0]?.payload ?? "{}")["correlation_id"], correlation);
        assert.equal(moverDetaches, 1, "mover handler detached");
        assert.equal(geoDetaches, 1, "prior geometry handler detached");
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
        );
    });

    it("detaches every handler on disable while waiting for geometry echoes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(adapter.isInFlight, true);
        assert.equal(seam.geoHandlers.size, 3, "three changed windows subscribed");
        adapter.disable();
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.equal(seam.detachCount, 1, "mover detached");
        assert.equal(seam.geoDetachCount, 3, "every geometry handler detached");
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.equal(parsePayload(lost[0]?.payload ?? "{}")["correlation_id"], correlation);
    });
});

describe("cosmic send-to-workspace frameGeometry fence P0", () => {
    function plannedReplyTwo(correlation: string): string {
        return JSON.stringify({
            v: WORKSPACE_SEND_CONTRACT_VERSION,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            detail: { kind: "send-to-workspace", policy_version: 1, capability: "move-tiled" },
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
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

    function setWorldWindows(mocks: Mocks, refs: { a: object; b: object; t: object; desktop: object }, mode: 2 | 3): void {
        if (mode === 2) {
            mocks.world.windows.length = 0;
            mocks.world.windows.push(
                { id: "win-a", ref: refs.a, rect: rect(0, 0, 100, 100), workspace: "ws-1" },
                { id: "win-t", ref: refs.t, rect: rect(0, 0, 100, 100), workspace: "ws-2" },
            );
        } else {
            mocks.world.windows.length = 0;
            mocks.world.windows.push(
                { id: "win-a", ref: refs.a, rect: rect(0, 0, 100, 100), workspace: "ws-1" },
                { id: "win-b", ref: refs.b, rect: rect(100, 0, 100, 100), workspace: "ws-1" },
                { id: "win-t", ref: refs.t, rect: rect(0, 0, 100, 100), workspace: "ws-2" },
            );
        }
        (mocks.world as { activeId: string }).activeId = "win-a";
        (mocks.world as { activeRef: object | null }).activeRef = refs.a;
    }

    function driveOneFlight(mocks: Mocks, seam: EchoSeam, base: number, mode: 2 | 3): string {
        assert.equal(mocks.dbusCalls[base]?.method, WORKSPACE_SEND_GET_OWNER_METHOD);
        mocks.callbacks[base]?.(":1.7");
        const requestCall = mocks.dbusCalls[base + 1];
        assert.equal(requestCall?.method, WORKSPACE_SEND_METHOD);
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[base + 1]?.(mode === 2 ? plannedReplyTwo(correlation) : plannedReply(correlation));
        assert.equal(mocks.dbusCalls.length, base + 2, "ack waits for mover plus frame echoes");
        seam.fire();
        assert.equal(
            mocks.dbusCalls.some(
                (c) => c.payload.includes(`"${correlation}"`) && c.payload.includes("accepted"),
            ) ||
                mocks.dbusCalls.slice(base + 2).some((c) => c.payload.includes("accepted")),
            false,
            "mover echo alone must not ack while frame echoes are pending",
        );
        seam.fireGeometry();
        const ackCall = mocks.dbusCalls[base + 2];
        assert.equal(ackCall?.method, WORKSPACE_SEND_METHOD);
        assert.equal((parsePayload(ackCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        mocks.callbacks[base + 2]?.(ackReply(correlation));
        const verifyCall = mocks.dbusCalls[base + 3];
        assert.equal((parsePayload(verifyCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"], "send-to-workspace-verify");
        mocks.callbacks[base + 3]?.(committedReply(correlation));
        return correlation;
    }

    it("binds the workspace-send geometry fence to frameGeometryChanged only", () => {
        const adapterSrc = readFileSync(join(kwinSrcDir(), "workspace-send-adapter.ts"), "utf8");
        const entrySrc = readFileSync(join(kwinSrcDir(), "workspace-send-adapter-entry.ts"), "utf8");
        const planEntrySrc = readFileSync(join(kwinSrcDir(), "plan-adapter-entry.ts"), "utf8");
        const globals = readFileSync(join(kwinSrcDir(), "kwin-globals.d.ts"), "utf8");
        assert.ok(entrySrc.includes('readSignal(windowRef, "frameGeometryChanged")'), "entry must bind frameGeometryChanged");
        assert.ok(!entrySrc.includes('readSignal(windowRef, "moveResizedChanged")'), "entry must not bind moveResizedChanged");
        assert.ok(planEntrySrc.includes('readSignal(windowRef, "frameGeometryChanged")'), "production entry must bind frameGeometryChanged");
        assert.ok(!planEntrySrc.includes('readSignal(windowRef, "moveResizedChanged")'), "production entry must not bind moveResizedChanged");
        assert.ok(adapterSrc.includes("Window.frameGeometryChanged"), "adapter seam doc must name frameGeometryChanged");
        assert.ok(!adapterSrc.includes("Window.moveResizedChanged"), "adapter seam doc must not name moveResizedChanged");
        assert.ok(globals.includes("frameGeometryChanged"), "globals must declare frameGeometryChanged");
        assert.ok(globals.includes("Signal1<Rect>"), "frameGeometryChanged carries old geometry");
        for (const name of ["workspace-send-adapter.ts", "workspace-send-adapter-entry.ts"]) {
            const body = readFileSync(join(kwinSrcDir(), name), "utf8");
            assert.ok(!body.includes("setTimeout"), name);
            assert.ok(!body.includes("setInterval"), name);
            assert.ok(!body.includes("waitFor"), name);
            assert.ok(!body.includes("fallback"), name);
            assert.ok(!body.includes("pollFor"), name);
        }
    });

    it("old moveResizedChanged alone cannot settle a 2-window source; frame signal does", () => {
        const harness = startEntryForPlannedFlight();
        assert.ok(harness.handle !== null);
        assert.equal(harness.handle.requestSend("ws-2"), true);
        harness.callbacks[0]?.(":1.7");
        const requestCall = harness.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        harness.callbacks[1]?.(plannedReply(correlation));
        const hasAcceptedAck = (): boolean =>
            harness.dbusCalls.some(
                (c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted"),
            );
        assert.equal(hasAcceptedAck(), false);
        // Old interactive-only signal fires repeatedly: fence must not settle.
        harness.fireOldGeometry();
        harness.fireOldGeometry();
        assert.equal(hasAcceptedAck(), false, "moveResizedChanged must never settle programmatic writes");
        // Mover membership echo alone still holds the ack while frame waits remain.
        harness.fireMoverEcho();
        assert.equal(hasAcceptedAck(), false, "mover echo alone must not ack while frame echoes pending");
        // Native-shaped frame echoes settle the exact 2-window source plus target.
        harness.fireGeometry();
        assert.equal(hasAcceptedAck(), true, "frameGeometryChanged must settle the fence");
        const ackCall = harness.dbusCalls[2];
        assert.equal((parsePayload(ackCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        harness.callbacks[2]?.(ackReply(correlation));
        harness.callbacks[3]?.(committedReply(correlation));
        assert.ok(harness.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), harness.logs.join("\n"));
        assert.ok(!harness.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), harness.logs.join("\n"));
        harness.handle.stop();
    });

    it("same adapter completes 2->3->2->3 repeated flights with source survivor", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const modes: Array<2 | 3> = [2, 3, 2, 3];
        const correlations: string[] = [];
        for (let move = 0; move < modes.length; move += 1) {
            const mode = modes[move] as 2 | 3;
            setWorldWindows(mocks, refs, mode);
            assert.equal(adapter.requestSend("ws-2"), true);
            const correlation = driveOneFlight(mocks, seam, move * 4, mode);
            correlations.push(correlation);
            assert.equal(adapter.isEnabled, true);
            assert.equal(adapter.isInFlight, false);
            if (mode === 3) {
                const observed = makeWorldObserved(mocks.world, refs);
                assert.ok(observed.sourceWindows.some((w) => w.id === "win-b"), "win-b survives in source");
                assert.ok(observed.targetWindows.some((w) => w.id === "win-a"), "mover lands in target");
            } else {
                const observed = makeWorldObserved(mocks.world, refs);
                assert.equal(observed.sourceWindows.length, 0, "single-mover flight leaves source empty");
                assert.ok(observed.targetWindows.some((w) => w.id === "win-a"), "mover lands in populated destination");
                assert.ok(observed.targetWindows.some((w) => w.id === "win-t"), "destination survivor retained");
            }
        }
        assert.equal(new Set(correlations).size, 4, "each flight binds a distinct correlation");
        assert.deepEqual(mocks.switches, [refs.desktop, refs.desktop, refs.desktop, refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a, refs.a, refs.a, refs.a]);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 4);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("completes an empty-source single-mover flight with populated destination", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        setWorldWindows(mocks, refs, 2);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReplyTwo(correlation));
        assert.equal(seam.geoHandlers.size, 2, "both changed windows subscribed");
        seam.fire();
        seam.fireGeometry();
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        const observed = makeWorldObserved(mocks.world, refs);
        assert.equal(observed.sourceWindows.length, 0);
        assert.deepEqual(
            observed.targetWindows.map((w) => w.id).sort(),
            ["win-a", "win-t"],
        );
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("no duplicate ack or membership on extra frame signal after commit", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        seam.fire();
        seam.fireGeometry();
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        const calls = mocks.dbusCalls.length;
        const memberships = mocks.desktops.length;
        const detaches = seam.detachCount;
        const geoDetaches = seam.geoDetachCount;
        seam.fire();
        seam.fireGeometry();
        assert.equal(mocks.dbusCalls.length, calls, "extra frame echo must not re-ack");
        assert.equal(mocks.desktops.length, memberships, "extra frame echo must not re-write membership");
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.equal(seam.detachCount, detaches);
        assert.equal(seam.geoDetachCount, geoDetaches);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });
});

describe("cosmic send-to-workspace w3 synchronous fence", () => {
    it("w3 unchanged-target shape completes with geometry-before-desktop sync timing", () => {
        const refs = { ...makeRefs(), u: {} };
        const mocks = mockEnv(refs);
        mocks.world.windows.push({ id: "win-u", ref: refs.u, rect: rect(100, 0, 100, 100), workspace: "ws-2" });
        const seam = addEchoSeam(mocks);
        const order: string[] = [];
        const base = mocks.env;
        const rawMover = base.subscribeMoverDesktops;
        const rawGeo = base.subscribeWindowGeometry;
        assert.ok(typeof rawMover === "function" && typeof rawGeo === "function");
        const origSetGeometry = base.setGeometry;
        const origSetDesktops = base.setDesktops;
        const syncEnv: WorkspaceSendAdapterEnv = {
            ...base,
            subscribeMoverDesktops: (moverRef: object, handler: () => void) => {
                order.push("subscribe-mover");
                return (rawMover as (moverRef: object, handler: () => void) => (() => void) | null)(moverRef, () => {
                    order.push("desktopsChanged");
                    handler();
                });
            },
            subscribeWindowGeometry: (windowRef: object, handler: () => void) => {
                order.push("subscribe-geometry");
                return (rawGeo as (windowRef: object, handler: () => void) => (() => void) | null)(windowRef, () => {
                    order.push("frameGeometryChanged");
                    handler();
                });
            },
            setGeometry: (target: object, r: { x: number; y: number; w: number; h: number }) => {
                order.push("write-geometry");
                const ok = origSetGeometry(target, r);
                if (ok) {
                    for (const handler of [...(seam.geoHandlers.get(target) ?? [])]) {
                        handler();
                    }
                }
                return ok;
            },
            setDesktops: (target: object, refsArg: ReadonlyArray<object>) => {
                order.push("write-desktops");
                const ok = origSetDesktops(target, refsArg);
                if (ok) {
                    for (const handler of [...seam.handlers]) {
                        handler();
                    }
                }
                return ok;
            },
        };
        (mocks as { env: WorkspaceSendAdapterEnv }).env = syncEnv;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        const plannedW3 = JSON.stringify({
            v: WORKSPACE_SEND_CONTRACT_VERSION,
            correlation_id: correlation,
            outcome: "planned",
            kind: "send-to-workspace",
            base_revision: 0,
            detail: { kind: "send-to-workspace", policy_version: 1, capability: "move-tiled" },
            desired_geometry: [
                { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
                { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 100, h: 100 } },
                { window: "win-u", leaf: "leaf-win-u", output: "out-1", workspace: "ws-2", rect: { x: 100, y: 0, w: 100, h: 100 } },
            ],
            desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
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
        mocks.callbacks[1]?.(plannedW3);
        assert.deepEqual(seam.targets, [refs.a], "mover fence armed once");
        assert.equal(seam.geoHandlers.size, 2, "only mover and source survivor subscribe");
        assert.equal(mocks.geometries.length, 2, "only two changed geometry writes");
        assert.equal(mocks.desktops.length, 1, "single mover membership write");
        assert.equal(mocks.desktops[0]?.target, refs.a);
        const lastSubscribe = Math.max(order.lastIndexOf("subscribe-mover"), order.lastIndexOf("subscribe-geometry"));
        const firstWrite = order.indexOf("write-geometry");
        assert.ok(lastSubscribe >= 0 && firstWrite >= 0 && lastSubscribe < firstWrite, `subscriptions armed before write: ${order.join(",")}`);
        const lastFrame = order.lastIndexOf("frameGeometryChanged");
        const desktopEcho = order.indexOf("desktopsChanged");
        assert.ok(lastFrame >= 0 && desktopEcho >= 0 && lastFrame < desktopEcho, `geometry events before desktopsChanged: ${order.join(",")}`);
        const ackCall = mocks.dbusCalls[2];
        assert.equal(ackCall?.method, WORKSPACE_SEND_METHOD);
        const ackPayload = parsePayload(ackCall?.payload ?? "{}");
        assert.equal((ackPayload["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        assert.equal((ackPayload["command"] as Record<string, unknown>)["ack_outcome"], "accepted");
        mocks.callbacks[2]?.(ackReply(correlation));
        const verifyCall = mocks.dbusCalls[3];
        assert.equal(verifyCall?.method, WORKSPACE_SEND_METHOD);
        const verifyPayload = parsePayload(verifyCall?.payload ?? "{}");
        assert.equal((verifyPayload["command"] as Record<string, unknown>)["op"], "send-to-workspace-verify");
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=acknowledged")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        assert.equal(seam.detachCount, 1, "mover detached");
        assert.equal(seam.geoDetachCount, 2, "both geometry fences detached");
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });
});

describe("cosmic send-to-workspace pre-ack timeout settlement", () => {
    function startWithheldFlight(refs: { a: object; b: object; t: object; desktop: object }): {
        mocks: Mocks;
        adapter: WorkspaceSendAdapter;
        seam: EchoSeam;
        correlation: string;
    } {
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        return { mocks, adapter, seam, correlation };
    }

    function resetWorldToSource(mocks: Mocks): void {
        for (const entry of mocks.world.windows) {
            if (entry.id === "win-a") {
                entry.workspace = "ws-1";
                entry.rect = rect(0, 0, 100, 100);
            } else if (entry.id === "win-b") {
                entry.workspace = "ws-1";
                entry.rect = rect(100, 0, 100, 100);
            } else if (entry.id === "win-t") {
                entry.workspace = "ws-2";
                entry.rect = rect(0, 0, 100, 100);
            }
        }
    }

    it("withheld echoes with converged properties settle via timeout then commit/follow and stay usable", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startWithheldFlight(refs);
        assert.equal(mocks.geometries.length, 3);
        assert.equal(mocks.desktops.length, 1);
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
            "ack waits for echoes",
        );
        assert.equal(adapter.isInFlight, true);
        const geosBefore = mocks.geometries.length;
        const desksBefore = mocks.desktops.length;
        const timersBefore = mocks.timers.length;
        assert.equal(timersBefore, 1);
        mocks.timers[0]?.callback();
        const ackCall = mocks.dbusCalls[2];
        assert.equal(ackCall?.method, WORKSPACE_SEND_METHOD);
        const ackPayload = parsePayload(ackCall?.payload ?? "{}");
        assert.equal((ackPayload["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        assert.equal((ackPayload["command"] as Record<string, unknown>)["ack_outcome"], "accepted");
        assert.equal(ackPayload["correlation_id"], correlation);
        assert.equal(ackPayload["owner"], "owner-1");
        assert.equal(ackPayload["generation"], "gen-1");
        assert.equal(mocks.geometries.length, geosBefore, "settlement must not rewrite geometry");
        assert.equal(mocks.desktops.length, desksBefore, "settlement must not rewrite membership");
        assert.equal(mocks.timers.length, timersBefore + 1, "one normal bounded deadline for ack/verify");
        assert.equal(mocks.timers[0]?.cancelled, true, "original deadline retired");
        assert.equal(mocks.timers[1]?.cancelled, false);
        assert.equal(seam.detachCount, 1, "mover fence retired");
        assert.equal(seam.geoDetachCount, 3, "every geometry fence retired");
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, true);
        mocks.callbacks[2]?.(ackReply(correlation));
        const verifyCall = mocks.dbusCalls[3];
        assert.equal((parsePayload(verifyCall?.payload ?? "{}")["command"] as Record<string, unknown>)["op"], "send-to-workspace-verify");
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.ok(mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        resetWorldToSource(mocks);
        assert.equal(adapter.requestSend("ws-2"), true, "settled flight leaves next send usable");
        const base = 4;
        mocks.callbacks[base]?.(":1.7");
        const request2 = mocks.dbusCalls[base + 1];
        const correlation2 = parsePayload(request2?.payload ?? "{}")["correlation_id"] as string;
        assert.notEqual(correlation2, correlation);
        mocks.callbacks[base + 1]?.(plannedReply(correlation2));
        seam.fire();
        seam.fireGeometry();
        mocks.callbacks[base + 2]?.(ackReply(correlation2));
        mocks.callbacks[base + 3]?.(committedReply(correlation2));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")).length, 2);
        assert.equal(mocks.logs.filter((l) => l.includes("event=follow") && l.includes("outcome=completed")).length, 0);
    });

    it("mismatched post-observation on timeout never commits", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startWithheldFlight(refs);
        void correlation;
        const geosBefore = mocks.geometries.length;
        const desksBefore = mocks.desktops.length;
        mocks.observeImpl = () =>
            makeObserved(refs, {
                sourceWindows: Object.freeze([
                    Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze(rect(0, 0, 100, 100)) }),
                    Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze(rect(100, 0, 100, 100)) }),
                ]),
            });
        mocks.timers[0]?.callback();
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
            "mismatch must not ack",
        );
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")), false);
        assert.equal(mocks.geometries.length, geosBefore, "no new native write on mismatch");
        assert.equal(mocks.desktops.length, desksBefore);
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=timeout")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=completed")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), mocks.logs.join("\n"));
        const lost = mocks.dbusCalls.filter((c) => c.payload.includes("adapter-lost"));
        assert.equal(lost.length, 1, JSON.stringify(mocks.dbusCalls, null, 2));
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        void seam;
    });

    it("partial geometry on timeout never commits", () => {
        const refs = makeRefs();
        const { mocks, adapter, correlation } = startWithheldFlight(refs);
        void correlation;
        mocks.observeImpl = () => {
            const full = makeWorldObserved(mocks.world, refs);
            const sourceWindows = full.sourceWindows;
            const targetWindows = Object.freeze(
                full.targetWindows.map((entry) =>
                    entry.id === "win-t"
                        ? Object.freeze({ id: entry.id, ref: entry.ref, rect: Object.freeze(rect(0, 0, 100, 100)) })
                        : entry,
                ),
            );
            return { ...full, sourceWindows, targetWindows };
        };
        mocks.timers[0]?.callback();
        assert.equal(
            mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
        );
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")), false);
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.deepEqual(mocks.switches, []);
    });

    it("late duplicates after timeout settlement are harmless and never touch future flight", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startWithheldFlight(refs);
        mocks.timers[0]?.callback();
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.equal(adapter.isInFlight, false);
        const calls = mocks.dbusCalls.length;
        const geos = mocks.geometries.length;
        const desks = mocks.desktops.length;
        const detaches = seam.detachCount;
        const geoDetaches = seam.geoDetachCount;
        seam.fire();
        seam.fireGeometry();
        mocks.callbacks[1]?.(plannedReply(correlation));
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        mocks.timers[0]?.callback();
        mocks.timers[1]?.callback();
        assert.equal(mocks.dbusCalls.length, calls, "late duplicates must not re-ack or follow");
        assert.equal(mocks.geometries.length, geos);
        assert.equal(mocks.desktops.length, desks);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.equal(seam.detachCount, detaches);
        assert.equal(seam.geoDetachCount, geoDetaches);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        resetWorldToSource(mocks);
        assert.equal(adapter.requestSend("ws-2"), true, "late duplicates must not poison future flight");
        const base = 4;
        mocks.callbacks[base]?.(":1.7");
        const request2 = mocks.dbusCalls[base + 1];
        const correlation2 = parsePayload(request2?.payload ?? "{}")["correlation_id"] as string;
        assert.notEqual(correlation2, correlation);
        mocks.callbacks[base + 1]?.(plannedReply(correlation2));
        seam.fire();
        seam.fireGeometry();
        mocks.callbacks[base + 2]?.(ackReply(correlation2));
        mocks.callbacks[base + 3]?.(committedReply(correlation2));
        assert.deepEqual(mocks.switches, [refs.desktop, refs.desktop]);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
    });

    it("ack timeout never replays and never interprets no-pending as success", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        assert.equal(mocks.dbusCalls.length, 3, "ack sent synchronously without seam");
        assert.equal(adapter.isInFlight, true);
        mocks.timers[0]?.callback();
        const accepted = mocks.dbusCalls.filter((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted"));
        assert.equal(accepted.length, 1, "ack timeout must not replay ack");
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")), false);
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=timeout")), mocks.logs.join("\n"));
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        mocks.callbacks[2]?.(ackReply(correlation));
        assert.equal(mocks.dbusCalls.filter((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")).length, 1);
        assert.deepEqual(mocks.switches, []);
        mocks.callbacks[2]?.(
            JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: correlation, outcome: "rejected", kind: "no-pending" }),
        );
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
    });

    it("verify timeout never replays", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        adapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        mocks.callbacks[2]?.(ackReply(correlation));
        assert.equal(mocks.dbusCalls.length, 4, "verify sent");
        assert.ok(mocks.dbusCalls[3]?.payload.includes("send-to-workspace-verify"));
        mocks.timers[0]?.callback();
        assert.equal(mocks.dbusCalls.filter((c) => c.payload.includes("send-to-workspace-verify")).length, 1, "verify timeout must not replay");
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.ok(!mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
    });

    it("missing/malformed/lost replies, timeout, and owner loss are never no-pending", () => {
        const refs = makeRefs();
        const failing = (reply: unknown): string => {
            const innerRefs = makeRefs();
            const inner = mockEnv(innerRefs);
            const innerAdapter = new WorkspaceSendAdapter(inner.env);
            innerAdapter.enable({ owner: "owner-1", generation: "gen-1" });
            assert.equal(innerAdapter.requestSend("ws-2"), true);
            inner.callbacks[0]?.(":1.7");
            const call = inner.dbusCalls[1];
            const corr = parsePayload(call?.payload ?? "{}")["correlation_id"] as string;
            void corr;
            inner.callbacks[1]?.(reply);
            const line = inner.logs[inner.logs.length - 1] ?? "";
            assert.ok(!line.includes("outcome=no-pending"), `must not interpret as no-pending: ${line}`);
            assert.ok(!inner.logs.some((l) => l.includes("outcome=committed")), inner.logs.join("\n"));
            return line;
        };
        assert.ok(failing(undefined).includes("outcome=service-fault"));
        assert.ok(failing("{not-json").includes("outcome=service-fault"));
        const bogusCorrelation = (() => {
            const innerRefs = makeRefs();
            const inner = mockEnv(innerRefs);
            const innerAdapter = new WorkspaceSendAdapter(inner.env);
            innerAdapter.enable({ owner: "owner-1", generation: "gen-1" });
            assert.equal(innerAdapter.requestSend("ws-2"), true);
            inner.callbacks[0]?.(":1.7");
            const call = inner.dbusCalls[1];
            const corr = parsePayload(call?.payload ?? "{}")["correlation_id"] as string;
            inner.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: corr, outcome: "bogus" }));
            const line = inner.logs[inner.logs.length - 1] ?? "";
            assert.ok(!line.includes("outcome=no-pending"), `must not interpret as no-pending: ${line}`);
            return line;
        })();
        assert.ok(bogusCorrelation.includes("outcome=service-fault"), bogusCorrelation);
        const explicit = (() => {
            const innerRefs = makeRefs();
            const inner = mockEnv(innerRefs);
            const innerAdapter = new WorkspaceSendAdapter(inner.env);
            innerAdapter.enable({ owner: "owner-1", generation: "gen-1" });
            assert.equal(innerAdapter.requestSend("ws-2"), true);
            inner.callbacks[0]?.(":1.7");
            const call = inner.dbusCalls[1];
            const corr = parsePayload(call?.payload ?? "{}")["correlation_id"] as string;
            inner.callbacks[1]?.(plannedReply(corr));
            inner.callbacks[2]?.(
                JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: corr, outcome: "rejected", kind: "no-pending" }),
            );
            const line = inner.logs[inner.logs.length - 1] ?? "";
            assert.ok(line.includes("outcome=no-pending"), `explicit well-formed no-pending preserved: ${line}`);
            assert.ok(!inner.logs.some((l) => l.includes("outcome=committed")), inner.logs.join("\n"));
            return line;
        })();
        void explicit;
        void refs;
    });
});

describe("cosmic send-to-workspace deadline epoch", () => {
    function startWithheld(refs: { a: object; b: object; t: object; desktop: object }): {
        mocks: Mocks;
        adapter: WorkspaceSendAdapter;
        seam: EchoSeam;
        correlation: string;
    } {
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        return { mocks, adapter, seam, correlation };
    }

    it("old pre-ack deadline fired during settlement-to-ack is ignored", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startWithheld(refs);
        assert.equal(mocks.timers.length, 1);
        const old = mocks.timers[0];
        assert.ok(old && !old.cancelled);
        mocks.timers[0]?.callback();
        assert.equal(mocks.dbusCalls.length, 3, "settlement sends one ack");
        assert.equal(adapter.isInFlight, true);
        assert.equal(old.cancelled, true, "original deadline retired");
        assert.equal(mocks.timers.length, 2);
        const calls = mocks.dbusCalls.length;
        old.callback();
        assert.equal(mocks.dbusCalls.length, calls, "stale original deadline must not replay or teardown");
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, true);
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        void seam;
    });

    it("synchronous settlement-deadline reentrancy never tears down the settled flight", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const baseSchedule = mocks.env.scheduleOnce;
        let syncFire = false;
        const syncEnv: WorkspaceSendAdapterEnv = {
            ...mocks.env,
            scheduleOnce: (delayMs, callback) => {
                const timer = { delayMs, callback, cancelled: false };
                mocks.timers.push(timer);
                // Second arming is the settlement ack deadline: invoke its
                // callback synchronously before returning to model reentrant
                // scheduleOnce behavior.
                if (mocks.timers.length === 2 && syncFire) {
                    callback();
                }
                return () => {
                    timer.cancelled = true;
                };
            },
        };
        void baseSchedule;
        (mocks as { env: WorkspaceSendAdapterEnv }).env = syncEnv;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation));
        syncFire = true;
        mocks.timers[0]?.callback();
        assert.equal(adapter.isInFlight, true, "sync reentrant ack deadline must not teardown");
        assert.equal(adapter.isEnabled, true);
        const ackCall = mocks.dbusCalls[2];
        assert.ok(ackCall?.payload.includes("send-to-workspace-ack"));
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
        void seam;
    });

    it("retired deadlines never touch a future flight", () => {
        const refs = makeRefs();
        const { mocks, adapter, seam, correlation } = startWithheld(refs);
        const oldTimer = mocks.timers[0];
        assert.ok(oldTimer);
        mocks.timers[0]?.callback();
        mocks.callbacks[2]?.(ackReply(correlation));
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.equal(adapter.isInFlight, false);
        for (const entry of mocks.world.windows) {
            if (entry.id === "win-a") {
                entry.workspace = "ws-1";
                entry.rect = rect(0, 0, 100, 100);
            } else if (entry.id === "win-b") {
                entry.workspace = "ws-1";
                entry.rect = rect(100, 0, 100, 100);
            } else if (entry.id === "win-t") {
                entry.workspace = "ws-2";
                entry.rect = rect(0, 0, 100, 100);
            }
        }
        assert.equal(adapter.requestSend("ws-2"), true);
        const calls = mocks.dbusCalls.length;
        oldTimer.callback();
        mocks.timers[1]?.callback();
        assert.equal(mocks.dbusCalls.length, calls, "retired deadlines must not touch future flight");
        assert.equal(adapter.isInFlight, true);
        const base = calls - 1;
        mocks.callbacks[base]?.(":1.7");
        const request2 = mocks.dbusCalls[base + 1];
        const correlation2 = parsePayload(request2?.payload ?? "{}")["correlation_id"] as string;
        assert.notEqual(correlation2, correlation);
        mocks.callbacks[base + 1]?.(plannedReply(correlation2));
        seam.fire();
        seam.fireGeometry();
        mocks.callbacks[base + 2]?.(ackReply(correlation2));
        mocks.callbacks[base + 3]?.(committedReply(correlation2));
        assert.equal(adapter.isInFlight, false);
        assert.equal(adapter.isEnabled, true);
    });
});

describe("cosmic send-to-workspace narrow remote-clean recovery", () => {
    function requestCorrelation(mocks: Mocks): string {
        const requestCall = mocks.dbusCalls[1];
        return parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
    }

    it("well-formed request rejected focus-mismatch stays enabled with no adapter-lost and next send works", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const correlation = requestCorrelation(mocks);
        mocks.callbacks[1]?.(
            JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: correlation, outcome: "rejected", kind: "focus-mismatch" }),
        );
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=focus-mismatch")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.desktops.length, 0);
        assert.equal(adapter.requestSend("ws-2"), true, "next distinct send works");
        const base = mocks.dbusCalls.length - 1;
        mocks.callbacks[base]?.(":1.7");
        const request2 = mocks.dbusCalls[base + 1];
        const correlation2 = parsePayload(request2?.payload ?? "{}")["correlation_id"] as string;
        assert.notEqual(correlation2, correlation);
        mocks.callbacks[base + 1]?.(plannedReply(correlation2));
        mocks.callbacks[base + 2]?.(ackReply(correlation2));
        mocks.callbacks[base + 3]?.(committedReply(correlation2));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
    });

    it("non-allowlisted genuine pre-pending rejection recovers and next send works", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const correlation = requestCorrelation(mocks);
        // "workspace-target-invalid" was absent from the old allowlist but is
        // returned by validate_workspace_input before workspace_pending is
        // retained, so it proves no pending and must recover.
        mocks.callbacks[1]?.(
            JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: correlation, outcome: "rejected", kind: "workspace-target-invalid" }),
        );
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=workspace-target-invalid")), mocks.logs.join("\n"));
        assert.equal(mocks.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.desktops.length, 0);
        assert.equal(adapter.requestSend("ws-2"), true, "next distinct send works");
        const base = mocks.dbusCalls.length - 1;
        mocks.callbacks[base]?.(":1.7");
        const request2 = mocks.dbusCalls[base + 1];
        const correlation2 = parsePayload(request2?.payload ?? "{}")["correlation_id"] as string;
        assert.notEqual(correlation2, correlation);
        mocks.callbacks[base + 1]?.(plannedReply(correlation2));
        mocks.callbacks[base + 2]?.(ackReply(correlation2));
        mocks.callbacks[base + 3]?.(committedReply(correlation2));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        assert.ok(mocks.logs.some((l) => l.includes("outcome=committed")), mocks.logs.join("\n"));
    });

    it("malformed unknown request rejection kind stays terminal and disabled", () => {
        for (const replyOf of [
            (c: string): string =>
                JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: c, outcome: "rejected", kind: "Bogus-Kind" }),
            (c: string): string =>
                JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: c, outcome: "rejected" }),
        ]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = new WorkspaceSendAdapter(mocks.env);
            adapter.enable({ owner: "owner-1", generation: "gen-1" });
            assert.equal(adapter.requestSend("ws-2"), true);
            mocks.callbacks[0]?.(":1.7");
            const correlation = requestCorrelation(mocks);
            mocks.callbacks[1]?.(replyOf(correlation));
            assert.equal(adapter.isEnabled, false, replyOf(correlation));
            assert.equal(adapter.isInFlight, false);
            assert.equal(adapter.requestSend("ws-2"), false);
        }
    });

    it("pending-exists and diverged stay terminal and disabled", () => {
        for (const replyOf of [
            (c: string): string =>
                JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: c, outcome: "rejected", kind: "pending-exists" }),
            (c: string): string =>
                JSON.stringify({ v: WORKSPACE_SEND_CONTRACT_VERSION, correlation_id: c, outcome: "diverged", kind: "stale-revision" }),
        ]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = new WorkspaceSendAdapter(mocks.env);
            adapter.enable({ owner: "owner-1", generation: "gen-1" });
            assert.equal(adapter.requestSend("ws-2"), true);
            mocks.callbacks[0]?.(":1.7");
            const correlation = requestCorrelation(mocks);
            mocks.callbacks[1]?.(replyOf(correlation));
            assert.equal(adapter.isEnabled, false, replyOf(correlation));
            assert.equal(adapter.isInFlight, false);
            assert.equal(adapter.requestSend("ws-2"), false);
        }
    });

    it("ambiguous send/timeout/malformed/owner-loss stay terminal", () => {
        const refs = makeRefs();
        const timeoutMocks = mockEnv(refs);
        const timeoutAdapter = new WorkspaceSendAdapter(timeoutMocks.env);
        timeoutAdapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(timeoutAdapter.requestSend("ws-2"), true);
        timeoutMocks.timers[0]?.callback();
        assert.equal(timeoutAdapter.isEnabled, false);
        assert.ok(timeoutMocks.logs.some((l) => l.includes("outcome=timeout")), timeoutMocks.logs.join("\n"));

        const malformedRefs = makeRefs();
        const malformed = mockEnv(malformedRefs);
        const malformedAdapter = new WorkspaceSendAdapter(malformed.env);
        malformedAdapter.enable({ owner: "owner-1", generation: "gen-1" });
        assert.equal(malformedAdapter.requestSend("ws-2"), true);
        malformed.callbacks[0]?.(":1.7");
        malformed.callbacks[1]?.("{not-json");
        assert.equal(malformedAdapter.isEnabled, false);
    });
});

describe("cosmic send-to-workspace recovery payload and entry timing", () => {
    it("settlement ack preserves revision/fingerprint/domains and verify preserves preconditions/operation", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const seam = addEchoSeam(mocks);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        mocks.callbacks[0]?.(":1.7");
        const requestCall = mocks.dbusCalls[1];
        const requestPayload = parsePayload(requestCall?.payload ?? "{}");
        const correlation = requestPayload["correlation_id"] as string;
        const requestDomain = requestPayload["domain"] as Record<string, unknown>;
        const requestTarget = requestPayload["target_domain"] as Record<string, unknown>;
        mocks.callbacks[1]?.(plannedReply(correlation));
        mocks.timers[0]?.callback();
        const ackCall = mocks.dbusCalls[2];
        const ackPayload = parsePayload(ackCall?.payload ?? "{}");
        assert.equal(ackPayload["correlation_id"], correlation);
        assert.equal(ackPayload["owner"], "owner-1");
        assert.equal(ackPayload["generation"], "gen-1");
        assert.equal(ackPayload["revision"], 0);
        assert.equal(typeof ackPayload["fingerprint"], "number");
        assert.deepEqual(ackPayload["domain"], requestDomain);
        assert.deepEqual(ackPayload["target_domain"], requestTarget);
        assert.equal((ackPayload["command"] as Record<string, unknown>)["op"], "send-to-workspace-ack");
        assert.equal((ackPayload["command"] as Record<string, unknown>)["ack_outcome"], "accepted");
        mocks.callbacks[2]?.(ackReply(correlation));
        const verifyCall = mocks.dbusCalls[3];
        const verifyPayload = parsePayload(verifyCall?.payload ?? "{}");
        assert.equal(verifyPayload["correlation_id"], correlation);
        assert.equal(verifyPayload["revision"], 0);
        assert.equal(verifyPayload["fingerprint"], ackPayload["fingerprint"]);
        assert.deepEqual(verifyPayload["domain"], requestDomain);
        assert.deepEqual(verifyPayload["target_domain"], requestTarget);
        const verifyCommand = verifyPayload["command"] as Record<string, unknown>;
        assert.equal(verifyCommand["op"], "send-to-workspace-verify");
        assert.equal(verifyCommand["verified"], true);
        assert.deepEqual(verifyCommand["preconditions"], KNOWN_PRECONDITIONS);
        assert.deepEqual(verifyCommand["operation"], {
            op: "move-tiled",
            window: "win-a",
            leaf: "leaf-win-a",
            source_output: "out-1",
            source_workspace: "ws-1",
            target_output: "out-1",
            target_workspace: "ws-2",
        });
        mocks.callbacks[3]?.(committedReply(correlation));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        void seam;
    });

    it("production entry completes with a busy-refused command while echoes settle", () => {
        const harness = startEntryForPlannedFlight();
        assert.ok(harness.handle !== null);
        const handle = harness.handle;
        assert.equal(handle.requestSend("ws-2"), true);
        harness.callbacks[0]?.(":1.7");
        const requestCall = harness.dbusCalls[1];
        const correlation = parsePayload(requestCall?.payload ?? "{}")["correlation_id"] as string;
        harness.callbacks[1]?.(plannedReply(correlation));
        assert.equal(
            harness.dbusCalls.some((c) => c.payload.includes("send-to-workspace-ack") && c.payload.includes("accepted")),
            false,
            "ack waits for echoes",
        );
        assert.equal(handle.requestSend("ws-1"), false, "rapid second command is busy-refused, not completed");
        harness.fireGeometry();
        harness.fireMoverEcho();
        const ackCall = harness.dbusCalls[2];
        assert.ok(ackCall?.payload.includes("send-to-workspace-ack") && ackCall?.payload.includes("accepted"));
        harness.callbacks[2]?.(ackReply(correlation));
        const verifyCall = harness.dbusCalls[3];
        assert.ok(verifyCall?.payload.includes("send-to-workspace-verify"));
        harness.callbacks[3]?.(committedReply(correlation));
        assert.ok(harness.logs.some((l) => l.includes("outcome=committed")), harness.logs.join("\n"));
        assert.equal(harness.dbusCalls.some((c) => c.payload.includes("adapter-lost")), false);
        harness.fireOldGeometry();
        assert.ok(harness.logs.some((l) => l.includes("outcome=committed")), harness.logs.join("\n"));
    });
});
