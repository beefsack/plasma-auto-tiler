import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    WORKSPACE_SEND_CONTRACT_VERSION,
    WORKSPACE_SEND_HAS_OWNER_METHOD,
    WorkspaceSendAdapter,
    type WorkspaceSendAdapterEnv,
    type WorkspaceSendObserved,
} from "../src/workspace-send-adapter";
import { WorkspaceNativeAdapter } from "../src/workspace-native";

interface FakeSignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: {
        connect: (handler: (payload?: unknown) => void) => void;
        disconnect: (handler: (payload?: unknown) => void) => void;
    };
}

function fakeSignal(): FakeSignal {
    const handlers: Array<(payload?: unknown) => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: (payload?: unknown) => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: (payload?: unknown) => void): void => {
                const at = handlers.indexOf(handler);
                if (at >= 0) {
                    handlers.splice(at, 1);
                }
            },
        },
    };
}

interface FakeDesktop {
    id: string;
    x11DesktopNumber?: number;
}

interface FakeOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
}

interface FakeWindow {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    internalId: string;
    resourceClass: string;
    output: FakeOutput;
    desktops: FakeDesktop[];
    frameGeometry: { x: number; y: number; width: number; height: number };
}

interface FakeWorld {
    workspace: Record<string, unknown>;
    outputs: FakeOutput[];
    desktops: FakeDesktop[];
    wins: FakeWindow[];
    currentByOutput: Map<FakeOutput, FakeDesktop>;
    globalCurrent: FakeDesktop;
    created: number;
}

function makeOutput(name: string): FakeOutput {
    return { name, manufacturer: "m", model: "d", serialNumber: "s" };
}

function makeDesktop(id: string, num?: number): FakeDesktop {
    return num === undefined ? { id } : { id, x11DesktopNumber: num };
}

function fakeWorld(outputNames: string[], desktopIds: string[]): FakeWorld {
    const outputs = outputNames.map((name) => makeOutput(name));
    const desktops = desktopIds.map((id, index) => makeDesktop(id, index + 1));
    const currentByOutput = new Map<FakeOutput, FakeDesktop>();
    for (const output of outputs) {
        const first = desktops[0];
        if (first !== undefined) {
            currentByOutput.set(output, first);
        }
    }
    const firstDesktop = desktops[0];
    if (firstDesktop === undefined) {
        throw new Error("fake world needs desktops");
    }
    const world: FakeWorld = {
        workspace: {},
        outputs,
        desktops,
        wins: [],
        currentByOutput,
        globalCurrent: firstDesktop,
        created: desktopIds.length,
    };
    const ws = world.workspace;
    ws["screens"] = outputs;
    ws["desktops"] = desktops;
    ws["activeWindow"] = null;
    ws["activeScreen"] = outputs[0] ?? null;
    ws["currentDesktopForScreen"] = (output: unknown): unknown =>
        world.currentByOutput.get(output as FakeOutput) ?? null;
    ws["currentDesktop"] = world.globalCurrent;
    ws["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        world.currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        world.globalCurrent = desktop as FakeDesktop;
        ws["currentDesktop"] = desktop;
    };
    ws["createDesktop"] = (): void => {
        world.created += 1;
        const maxNum = world.desktops.reduce((best, entry) => Math.max(best, entry.x11DesktopNumber ?? 0), 0);
        const fresh = makeDesktop(`ws-new-${String(world.created)}`, maxNum + 1);
        world.desktops.push(fresh);
        ws["desktops"] = world.desktops;
    };
    ws["removeDesktop"] = (desktop: unknown): void => {
        const ref = desktop as FakeDesktop;
        const at = world.desktops.indexOf(ref);
        if (at >= 0) {
            world.desktops.splice(at, 1);
        }
        for (const [output, current] of world.currentByOutput) {
            if (current === ref) {
                const first = world.desktops[0];
                if (first !== undefined) {
                    world.currentByOutput.set(output, first);
                }
            }
        }
        if (world.globalCurrent === ref) {
            const first = world.desktops[0];
            if (first !== undefined) {
                world.globalCurrent = first;
                ws["currentDesktop"] = first;
            }
        }
        ws["desktops"] = world.desktops;
    };
    ws["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    ws["windowList"] = (): unknown[] => [...world.wins];
    ws["windowAdded"] = fakeSignal().signal;
    ws["windowRemoved"] = fakeSignal().signal;
    ws["desktopsChanged"] = fakeSignal().signal;
    ws["currentDesktopChanged"] = fakeSignal().signal;
    ws["screensChanged"] = fakeSignal().signal;
    return world;
}

function addWindow(world: FakeWorld, id: string, desktop: FakeDesktop): FakeWindow {
    const output = world.outputs[0];
    if (output === undefined) {
        throw new Error("no output");
    }
    const win: FakeWindow = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        internalId: id,
        resourceClass: "test-app",
        output,
        desktops: [desktop],
        frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
    };
    world.wins.push(win);
    world.workspace["activeWindow"] = win;
    return win;
}

function startNative(world: FakeWorld): { adapter: WorkspaceNativeAdapter; logs: string[] } {
    const logs: string[] = [];
    const adapter = new WorkspaceNativeAdapter({
        getWorkspace: () => world.workspace,
        readWorkspaceMode: () => "per-output-local",
        log: (message) => {
            logs.push(message);
        },
    });
    assert.equal(adapter.enable(), true);
    return { adapter, logs };
}

// Build a world where an owned non-trailing source becomes empty after a
// simulated send move plus follow to the target. Keeps the live adapter (and
// its owned set) so the emptied source is still owned at assertion time.
function buildOwnedSourceWorld(): {
    world: FakeWorld;
    adapter: WorkspaceNativeAdapter;
    logs: string[];
    sourceId: string;
    targetId: string;
} {
    const world = fakeWorld(["out-1"], ["ws-1", "ws-2"]);
    const ws1 = world.desktops[0] as FakeDesktop;
    const ws2 = world.desktops[1] as FakeDesktop;
    addWindow(world, "win-1", ws1);
    addWindow(world, "win-2", ws2);
    const { adapter, logs } = startNative(world);
    // Startup appends one owned trailing empty.
    assert.ok(world.desktops.length >= 3);
    const trailing = world.desktops[world.desktops.length - 1] as FakeDesktop;
    // Occupy the owned trailing so cleanup appends a newer trailing; the
    // occupied owned desktop becomes a non-trailing source candidate.
    addWindow(world, "win-source", trailing);
    adapter.handleTopologySignal();
    assert.ok(world.desktops.length >= 4);
    const sourceId = trailing.id;
    const targetId = ws1.id;
    // Simulate the send native move plus follow: mover leaves the owned
    // source for the target, and the visible desktop follows to the target.
    for (const win of world.wins) {
        if (win.internalId === "win-source") {
            win.desktops = [ws1];
        }
    }
    const output = world.outputs[0] as FakeOutput;
    world.currentByOutput.set(output, ws1);
    world.globalCurrent = ws1;
    world.workspace["currentDesktop"] = ws1;
    return { world, adapter, logs, sourceId, targetId };
}

describe("planned send transaction retention", () => {
    it("prunes an owned emptied source without retention (pre-fix behavior)", () => {
        const { world, adapter, logs, sourceId } = buildOwnedSourceWorld();
        assert.ok(adapter.ownedSnapshot().length >= 1);
        adapter.handleTopologySignal();
        assert.ok(!world.desktops.some((entry) => entry.id === sourceId), `owned source must prune without retention: ${world.desktops.map((entry) => entry.id).join(",")}`);
        assert.ok(logs.some((line) => line.includes(`workspace-cleanup-removed:${sourceId}`)), logs.join("\n"));
        adapter.disable();
    });

    it("retains pending source/target through cleanup, then resumes normal pruning", () => {
        const { world, adapter, logs, sourceId, targetId } = buildOwnedSourceWorld();
        // Occupy the current trailing so the retained source stays
        // non-trailing through the retained pass.
        const preTrailing = world.desktops[world.desktops.length - 1] as FakeDesktop;
        if (preTrailing.id !== sourceId) {
            addWindow(world, "win-fill", preTrailing);
        }
        adapter.setRetentionProvider(() => [sourceId, targetId]);
        adapter.handleTopologySignal();
        assert.ok(world.desktops.some((entry) => entry.id === sourceId), `retained source must survive: ${world.desktops.map((entry) => entry.id).join(",")}`);
        assert.ok(!logs.some((line) => line.includes(`workspace-cleanup-removed:${sourceId}`)), logs.join("\n"));
        // Transaction settle releases retention: provider empty restores
        // normal pruning on the next signal. The source is still a
        // non-trailing owned empty, so it prunes normally.
        adapter.setRetentionProvider(() => []);
        adapter.handleTopologySignal();
        assert.ok(!world.desktops.some((entry) => entry.id === sourceId), `settled source must prune normally: ${world.desktops.map((entry) => entry.id).join(",")}`);
        adapter.disable();
    });
});

// --- WorkspaceSendAdapter ack/verify failure mechanism when the source is gone ---

function rect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
    return { x, y, w, h };
}

function makeRefs(): { a: object; b: object; t: object; desktop: object } {
    return { a: {}, b: {}, t: {}, desktop: {} };
}

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

function makeWorldObserved(world: World, refs: { a: object; b: object; t: object; desktop: object }): WorkspaceSendObserved {
    const sourceWindows = Object.freeze(
        world.windows
            .filter((entry) => entry.workspace === "ws-1")
            .map((entry) =>
                Object.freeze({ id: entry.id, ref: entry.ref, rect: Object.freeze({ ...entry.rect }) }),
            ),
    );
    const targetWindows = Object.freeze(
        world.windows
            .filter((entry) => entry.workspace === "ws-2")
            .map((entry) =>
                Object.freeze({ id: entry.id, ref: entry.ref, rect: Object.freeze({ ...entry.rect }) }),
            ),
    );
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

interface DbusCall {
    readonly service: string;
    readonly payload: string;
}

function plannedReply(correlation: string): string {
    return JSON.stringify({
        v: WORKSPACE_SEND_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        kind: "send-to-workspace",
        base_revision: 0,
        desired_geometry: [
            { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-b", leaf: "leaf-win-b", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1200, h: 800 } },
            { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ],
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" },
        preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
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

describe("planned send ack/verify after source pruning", () => {
    it("native-confirmed follow abandons on stale-revision when the pinned source is gone and blocks plan", () => {
        const refs = makeRefs();
        const world = defaultWorld(refs);
        const dbusCalls: DbusCall[] = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const logs: string[] = [];
        let observeImpl: () => WorkspaceSendObserved | null = () => makeWorldObserved(world, refs);
        const env: WorkspaceSendAdapterEnv = {
            callDbus: (service, _path, _iface, method, payload, callback) => {
                if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                    callback(true);
                    return;
                }
                dbusCalls.push({ service, payload });
                callbacks.push(callback);
            },
            scheduleOnce: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            observe: () => observeImpl(),
            setGeometry: (target, r) => {
                for (const entry of world.windows) {
                    if (entry.ref === target) {
                        entry.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
                    }
                }
                return true;
            },
            setDesktops: (target, _refs) => {
                for (const entry of world.windows) {
                    if (entry.ref === target) {
                        entry.workspace = "ws-2";
                    }
                }
                return true;
            },
            switchToTarget: () => true,
            focusWindow: () => true,
        };
        const adapter = new WorkspaceSendAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.equal(adapter.requestSend("ws-2"), true);
        callbacks[0]?.(":1.7");
        const correlation = (JSON.parse(dbusCalls[1]?.payload ?? "{}") as Record<string, unknown>)["correlation_id"] as string;
        // Planned reply drives native writes plus native-confirmed follow.
        callbacks[1]?.(plannedReply(correlation));
        assert.ok(logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")), `follow must natively confirm before ack:\n${logs.join("\n")}`);
        // While the flight still awaits ack/verify, cleanup removes the pinned
        // source desktop: the pinned observation goes null exactly as
        // observeSendTarget does when the source id leaves `desktops`.
        observeImpl = () => null;
        callbacks[2]?.(ackReply(correlation));
        // Exact mechanism: onAckReply re-observes before verify; null binds to
        // stale-revision (workspace-send-adapter.ts onAckReply), never sends
        // verify, and reaches abandon instead of disabling. The pruned scope
        // is unreadable, so no abandon op is emitted yet: the flight stays
        // retained and enabled for the next valid observation, still
        // blocking Plan with its bound workspaces.
        assert.ok(logs.some((l) => l.includes("cause=stale-revision")), logs.join("\n"));
        assert.equal(dbusCalls.some((c) => c.payload.includes("send-to-workspace-verify")), false);
        assert.equal(dbusCalls.filter((c) => c.payload.includes("adapter-lost")).length, 0);
        assert.equal(dbusCalls.filter((c) => c.payload.includes("send-to-workspace-abandon")).length, 0);
        assert.ok(
            logs.some((l) => l.includes("event=abandon-requested") && l.includes("cause=stale-revision")),
            logs.join("\n"),
        );
        assert.ok(
            logs.some((l) => l.includes("event=abandon-retry") && l.includes(`correlation=${correlation}`)),
            logs.join("\n"),
        );
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.blocksPlan, true);
        assert.deepEqual(adapter.pendingWorkspaces, ["ws-1", "ws-2"]);
    });

    it("exposes pending source/target only while a plan is bound", () => {
        const refs = makeRefs();
        const world = defaultWorld(refs);
        const callbacks: Array<(reply: unknown) => void> = [];
        const logs: string[] = [];
        const env: WorkspaceSendAdapterEnv = {
            callDbus: (_service, _path, _iface, method, _payload, callback) => {
                if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                    callback(true);
                    return;
                }
                callbacks.push(callback);
            },
            scheduleOnce: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            observe: () => makeWorldObserved(world, refs),
            setGeometry: (target, r) => {
                for (const entry of world.windows) {
                    if (entry.ref === target) {
                        entry.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
                    }
                }
                return true;
            },
            setDesktops: (target, _refs) => {
                for (const entry of world.windows) {
                    if (entry.ref === target) {
                        entry.workspace = "ws-2";
                    }
                }
                return true;
            },
            switchToTarget: () => true,
            focusWindow: () => true,
        };
        void logs;
        const adapter = new WorkspaceSendAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        assert.deepEqual(adapter.pendingWorkspaces, []);
        assert.equal(adapter.requestSend("ws-2"), true);
        assert.deepEqual(adapter.pendingWorkspaces, [], "request phase alone retains nothing");
        callbacks[0]?.(":1.7");
        const correlation = "gen-1-w0";
        callbacks[1]?.(plannedReply(correlation));
        assert.deepEqual(adapter.pendingWorkspaces, ["ws-1", "ws-2"]);
        adapter.disable();
        assert.deepEqual(adapter.pendingWorkspaces, []);
    });
});
