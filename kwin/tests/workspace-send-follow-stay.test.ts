import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import {
    startPlanAdapterEntry,
    type PlanEntryHandle,
} from "../src/plan-adapter-entry";
import {
    WORKSPACE_SEND_CONTRACT_VERSION,
    WORKSPACE_SEND_GET_OWNER_METHOD,
    WORKSPACE_SEND_HAS_OWNER_METHOD,
    WORKSPACE_SEND_METHOD,
    WorkspaceSendAdapter,
    type WorkspaceSendAdapterEnv,
    type WorkspaceSendObserved,
} from "../src/workspace-send-adapter";
import {
    WorkspaceNativeAdapter,
    workspaceShortcutCatalog,
} from "../src/workspace-native";

// R-WS-01 / R-WS-14 item 2: explicit follow/stay through every tiled send,
// the shared scoped relative ring, and the repaired floating-boundary path.
// Offline only: no live KWin, no D-Bus, no installs.

// ---- Standalone send-adapter flight harness (mirrors the isolated core
// conventions: primitive worlds, stubbed D-Bus, redacted logs). ----

function makeRefs(): { a: object; b: object; c: object; t: object; desktop: object } {
    return { a: {}, b: {}, c: {}, t: {}, desktop: {} };
}

function rect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
    return { x, y, w, h };
}

interface FlightWindow {
    readonly id: string;
    readonly ref: object;
    rect: { x: number; y: number; w: number; h: number };
    workspace: string;
}

interface FlightWorld {
    readonly windows: FlightWindow[];
    activeRef: object | null;
    desktopCount: number;
    targetExists: boolean;
    // Actual current workspace on the recording output. Tests drive view
    // switches through this field; the default keeps the dispatch source
    // selected so existing fences pass.
    currentWorkspace: string;
}

function flightWorld(refs: { a: object; b: object; c: object; t: object; desktop: object }): FlightWorld {
    return {
        windows: [
            { id: "win-a", ref: refs.a, rect: rect(0, 0, 100, 100), workspace: "ws-1" },
            { id: "win-b", ref: refs.b, rect: rect(100, 0, 100, 100), workspace: "ws-1" },
            { id: "win-t", ref: refs.t, rect: rect(0, 0, 100, 100), workspace: "ws-2" },
        ],
        activeRef: refs.a,
        desktopCount: 2,
        targetExists: true,
        currentWorkspace: "ws-1",
    };
}

// Three-window source: win-b is the core MRU survivor, win-c the decoy
// that native automatic focus may prefer.
function flightWorldDecoy(refs: { a: object; b: object; c: object; t: object; desktop: object }): FlightWorld {
    return {
        windows: [
            { id: "win-a", ref: refs.a, rect: rect(0, 0, 100, 100), workspace: "ws-1" },
            { id: "win-b", ref: refs.b, rect: rect(100, 0, 100, 100), workspace: "ws-1" },
            { id: "win-c", ref: refs.c, rect: rect(200, 0, 100, 100), workspace: "ws-1" },
            { id: "win-t", ref: refs.t, rect: rect(0, 0, 100, 100), workspace: "ws-2" },
        ],
        activeRef: refs.a,
        desktopCount: 2,
        targetExists: true,
        currentWorkspace: "ws-1",
    };
}

function flightObserved(world: FlightWorld, refs: { a: object; b: object; c: object; t: object; desktop: object }): WorkspaceSendObserved {
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
    const activeId = world.windows.find((entry) => entry.ref === world.activeRef)?.id ?? "";
    const focused = sourceWindows.some((entry) => entry.id === activeId) ? activeId : "";
    const moverEntry = sourceWindows.find((entry) => entry.id === activeId);
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
        currentWorkspace: world.currentWorkspace,
    };
}

interface FlightMocks {
    readonly dbusCalls: Array<{ service: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object }>;
    readonly moverWrites: object[];
    readonly switches: object[];
    readonly focuses: object[];
    readonly world: FlightWorld;
    settled: number;
    focusResult: boolean;
    // When non-null, the membership write refocuses this ref, simulating
    // KWin automatic focus as a side effect of the arrival write.
    decoyRef: object | null;
    observeImpl: () => WorkspaceSendObserved | null;
    readonly env: WorkspaceSendAdapterEnv;
}

function flightEnv(refs: { a: object; b: object; c: object; t: object; desktop: object }): FlightMocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        logs: [],
        geometries: [],
        moverWrites: [],
        switches: [],
        focuses: [],
        world: flightWorld(refs),
        settled: 0,
        focusResult: true,
        decoyRef: null,
        observeImpl: null as unknown as FlightMocks["observeImpl"],
        env: null as unknown as WorkspaceSendAdapterEnv,
    } as FlightMocks;
    state.observeImpl = () => flightObserved(state.world, refs);
    (state as { env: WorkspaceSendAdapterEnv }).env = {
        callDbus: (service, _path, _iface, method, payload, callback) => {
            if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                callback(true);
                return;
            }
            state.dbusCalls.push({ service, method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (): (() => void) => (): void => {},
        log: (message) => {
            state.logs.push(message);
        },
        observe: () => state.observeImpl(),
        onSettled: () => {
            state.settled += 1;
        },
        setGeometry: (target, r) => {
            state.geometries.push({ target });
            for (const entry of state.world.windows) {
                if (entry.ref === target) {
                    entry.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
                }
            }
            return true;
        },
        setDesktops: (target, refsArg) => {
            void refsArg;
            state.moverWrites.push(target);
            for (const entry of state.world.windows) {
                if (entry.ref === target) {
                    entry.workspace = "ws-2";
                }
            }
            if (state.decoyRef !== null) {
                state.world.activeRef = state.decoyRef;
            }
            return true;
        },
        switchToTarget: (desktopRef) => {
            state.switches.push(desktopRef);
            return true;
        },
        focusWindow: (windowRef) => {
            state.focuses.push(windowRef);
            if (state.focusResult) {
                state.world.activeRef = windowRef;
            }
            return state.focusResult;
        },
    };
    return state;
}

function flightReply(
    correlation: string,
    follow: boolean | null,
    focus: unknown,
    extraGeometry: ReadonlyArray<Record<string, unknown>> = [],
): string {
    const operation: Record<string, unknown> = {
        op: "move-tiled",
        window: "win-a",
        leaf: "leaf-win-a",
        source_output: "out-1",
        source_workspace: "ws-1",
        target_output: "out-1",
        target_workspace: "ws-2",
    };
    if (follow !== null) {
        operation["follow"] = follow;
    }
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
            ...extraGeometry,
        ],
        desired_focus: focus,
        preconditions: ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"],
        operation,
    });
}

function staySourceFocus(): Record<string, string> {
    return { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-win-b" };
}

function followTargetFocus(): Record<string, string> {
    return { domain_output: "out-1", domain_workspace: "ws-2", leaf: "leaf-win-a" };
}

function dispatchFlight(mocks: FlightMocks, adapter: WorkspaceSendAdapter, follow?: unknown): string {
    assert.equal(adapter.requestSend("ws-2", 2, follow), true);
    assert.deepEqual(adapter.pendingWorkspaces, ["ws-1", "ws-2"]);
    assert.equal(mocks.dbusCalls[0]?.method, WORKSPACE_SEND_GET_OWNER_METHOD);
    mocks.callbacks[0]?.(":1.7");
    const requestCall = mocks.dbusCalls[1];
    assert.equal(requestCall?.method, WORKSPACE_SEND_METHOD);
    const body = JSON.parse(requestCall?.payload ?? "{}") as Record<string, unknown>;
    const command = body["command"] as Record<string, unknown>;
    assert.equal(command["op"], "send-to-workspace");
    return body["correlation_id"] as string;
}

function requestCommand(mocks: FlightMocks): Record<string, unknown> {
    const requestCall = mocks.dbusCalls[1];
    const body = JSON.parse(requestCall?.payload ?? "{}") as Record<string, unknown>;
    return body["command"] as Record<string, unknown>;
}

function assertFlightRedacted(mocks: FlightMocks): void {
    for (const line of mocks.logs) {
        assert.ok(line.startsWith("omnitiler:route-diag component=cosmic-send "), line);
        for (const raw of ["win-a", "win-b", "win-t", "ws-1", "ws-2", "out-1", ":1.7", "owner-1"]) {
            assert.ok(!line.includes(raw), `${raw} leaked in:\n${line}`);
        }
    }
}

describe("send flight follow/stay selection", () => {
    it("stay sends follow=false, writes, then focuses the bound MRU survivor with no switch", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        assert.equal(requestCommand(mocks)["follow"], false);
        mocks.callbacks[1]?.(flightReply(correlation, false, staySourceFocus()));
        assert.equal(mocks.geometries.length, 3);
        assert.equal(mocks.moverWrites.length, 1);
        assert.deepEqual(mocks.switches, [], "stay never switches desktops");
        assert.deepEqual(mocks.focuses, [refs.b], "stay focuses the core MRU survivor, never the mover");
        assert.equal(mocks.world.activeRef, refs.b);
        assert.ok(
            mocks.logs.some((l) => l.includes("stage=follow") && l.includes("event=follow") && l.includes("outcome=stay-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.ok(mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=arrived")), mocks.logs.join("\n"));
        assertFlightRedacted(mocks);
        assert.equal(mocks.settled, 1);
        assert.equal(adapter.isInFlight, false);
        assert.deepEqual(adapter.pendingWorkspaces, []);
    });

    it("stay picks the core MRU over the native automatic focus choice", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        mocks.world.windows.length = 0;
        for (const entry of flightWorldDecoy(refs).windows) {
            mocks.world.windows.push(entry);
        }
        mocks.world.activeRef = refs.a;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        // Native automatic focus prefers the decoy as a side effect of the
        // arrival write; core MRU names win-b instead.
        mocks.decoyRef = refs.c;
        mocks.callbacks[1]?.(
            flightReply(correlation, false, staySourceFocus(), [
                { window: "win-c", leaf: "leaf-win-c", output: "out-1", workspace: "ws-1", rect: { x: 200, y: 0, w: 600, h: 800 } },
            ]),
        );
        assert.equal(mocks.geometries.length, 4);
        assert.equal(mocks.moverWrites.length, 1);
        assert.deepEqual(mocks.switches, [], "stay never switches desktops");
        assert.deepEqual(mocks.focuses, [refs.b], "stay applies the core MRU, not the native decoy choice");
        assert.equal(mocks.world.activeRef, refs.b);
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=stay-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assert.equal(adapter.isInFlight, false);
        assertFlightRedacted(mocks);
    });

    it("stay accepts null focus with survivors present and writes no focus", () => {
        // MRU-less source: survivors exist but core names no MRU. Survivors
        // never imply non-null; the null-focus rule touches nothing.
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        mocks.world.windows.length = 0;
        for (const entry of flightWorldDecoy(refs).windows) {
            mocks.world.windows.push(entry);
        }
        mocks.world.activeRef = refs.a;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        const reply = JSON.parse(
            flightReply(correlation, false, staySourceFocus(), [
                { window: "win-c", leaf: "leaf-win-c", output: "out-1", workspace: "ws-1", rect: { x: 200, y: 0, w: 600, h: 800 } },
            ]),
        ) as Record<string, unknown>;
        reply["desired_focus"] = null;
        mocks.callbacks[1]?.(JSON.stringify(reply));
        assert.equal(mocks.geometries.length, 4);
        assert.equal(mocks.moverWrites.length, 1);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, [], "null focus runs zero focus setters with survivors present");
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=stay-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });

    it("null-focus stay needs no focus hook", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const hookingEnv: WorkspaceSendAdapterEnv = { ...mocks.env };
        delete (hookingEnv as { focusWindow?: unknown }).focusWindow;
        const adapter = new WorkspaceSendAdapter(hookingEnv);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        const reply = JSON.parse(flightReply(correlation, false, staySourceFocus())) as Record<string, unknown>;
        reply["desired_focus"] = null;
        // Source keeps a survivor: null still binds (MRU-less), no hook needed.
        mocks.callbacks[1]?.(JSON.stringify(reply));
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=stay-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.ok(
            !mocks.logs.some((l) => l.includes("outcome=hooks-unavailable")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });

    it("rejects stay focus that binds to no source geometry and writes nothing", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        mocks.callbacks[1]?.(
            flightReply(correlation, false, { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-ghost" }),
        );
        assert.equal(mocks.geometries.length, 0, "unbindable focus rejects before any native write");
        assert.equal(mocks.moverWrites.length, 0);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.ok(
            mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=precondition-mismatch")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });

    it("refuses stay focus when the survivor leaves before confirmation", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        // The survivor closes after the membership write lands (the first
        // post-write observation), so the stay confirmation re-proof finds
        // no survivor to focus.
        const baseObserve = mocks.observeImpl;
        mocks.observeImpl = () => {
            if (mocks.moverWrites.length > 0) {
                const at = mocks.world.windows.findIndex((entry) => entry.id === "win-b");
                if (at >= 0) {
                    mocks.world.windows.splice(at, 1);
                }
            }
            return baseObserve();
        };
        mocks.callbacks[1]?.(flightReply(correlation, false, staySourceFocus()));
        assert.equal(mocks.moverWrites.length, 1, "the validated transfer still actuated");
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, [], "a departed survivor is never focused");
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=arrival-unconfirmed")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });

    it("stay focus failure reports focus-unconfirmed without switching", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        mocks.focusResult = false;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        mocks.callbacks[1]?.(flightReply(correlation, false, staySourceFocus()));
        assert.equal(mocks.moverWrites.length, 1);
        assert.deepEqual(mocks.switches, [], "failed stay focus never switches");
        assert.deepEqual(mocks.focuses, [refs.b], "the survivor focus was attempted once");
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=focus-unconfirmed")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });
});

describe("stay source-visibility freshness", () => {
    it("follow proceeds with unreadable current workspace", () => {
        // The visibility fence is stay-only: follow re-selects the view
        // itself, so a null current never gates it.
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        mocks.world.currentWorkspace = null as unknown as string;
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter);
        mocks.callbacks[1]?.(flightReply(correlation, null, followTargetFocus()));
        assert.equal(mocks.geometries.length, 3);
        assert.equal(mocks.moverWrites.length, 1);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });

    for (const switched of ["ws-2", "ws-3"] as const) {
        it(`external switch to ${switched} before reply runs zero writes and reports stale`, () => {
            const refs = makeRefs();
            const mocks = flightEnv(refs);
            const adapter = new WorkspaceSendAdapter(mocks.env);
            assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
            const correlation = dispatchFlight(mocks, adapter, false);
            // Same pinned source membership, but the live view moved away:
            // pinned identity proves nothing about visibility.
            mocks.world.currentWorkspace = switched;
            mocks.callbacks[1]?.(flightReply(correlation, false, staySourceFocus()));
            assert.equal(mocks.geometries.length, 0, "switched source runs zero geometry writes");
            assert.equal(mocks.moverWrites.length, 0, "switched source runs zero membership writes");
            assert.deepEqual(mocks.switches, []);
            assert.deepEqual(mocks.focuses, [], "stale source never focuses");
            assert.ok(
                mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=stale-revision")),
                mocks.logs.join("\n"),
            );
            assert.equal(mocks.settled, 1);
            assert.equal(adapter.isInFlight, false);
            assertFlightRedacted(mocks);
        });
    }

    for (const focus of ["bound", "null"] as const) {
        it(`external switch after write reports arrival-unconfirmed with zero focus setters (${focus} focus)`, () => {
            const refs = makeRefs();
            const mocks = flightEnv(refs);
            const adapter = new WorkspaceSendAdapter(mocks.env);
            assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
            const correlation = dispatchFlight(mocks, adapter, false);
            // The view switches after the membership write lands: arrival
            // membership still verifies, but the source is no longer
            // selected, so no survivor focus runs - including for null
            // focus, which must also see the source still selected.
            const baseObserve = mocks.observeImpl;
            mocks.observeImpl = () => {
                if (mocks.moverWrites.length > 0) {
                    mocks.world.currentWorkspace = "ws-2";
                }
                return baseObserve();
            };
            const reply = JSON.parse(flightReply(correlation, false, staySourceFocus())) as Record<string, unknown>;
            if (focus === "null") {
                reply["desired_focus"] = null;
            }
            mocks.callbacks[1]?.(JSON.stringify(reply));
            assert.equal(mocks.geometries.length, 3, "the verified transfer stands");
            assert.equal(mocks.moverWrites.length, 1);
            assert.deepEqual(mocks.switches, []);
            assert.deepEqual(mocks.focuses, [], "stale source runs zero focus setters");
            assert.ok(
                mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=arrival-unconfirmed")),
                mocks.logs.join("\n"),
            );
            assert.equal(mocks.settled, 1);
            assertFlightRedacted(mocks);
        });
    }

    it("source-empty stay with a switched source runs zero writes and never selects the target", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        mocks.world.windows.splice(1, 1);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        mocks.world.currentWorkspace = "ws-2";
        const reply = JSON.parse(flightReply(correlation, false, staySourceFocus())) as Record<string, unknown>;
        reply["desired_focus"] = null;
        reply["desired_geometry"] = [
            { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ];
        mocks.callbacks[1]?.(JSON.stringify(reply));
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.moverWrites.length, 0);
        assert.deepEqual(mocks.switches, [], "source-empty stay never selects the target");
        assert.deepEqual(mocks.focuses, []);
        assert.ok(
            mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=stale-revision")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });
});

describe("send flight follow/stay selection (focus shapes)", () => {
    it("stay of the sole source window accepts null focus and settles arrived", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        mocks.world.windows.splice(1, 1);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        const reply = JSON.parse(flightReply(correlation, false, staySourceFocus())) as Record<string, unknown>;
        reply["desired_focus"] = null;
        reply["desired_geometry"] = [
            { window: "win-a", leaf: "leaf-win-a", output: "out-1", workspace: "ws-2", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-t", leaf: "leaf-win-t", output: "out-1", workspace: "ws-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ];
        mocks.callbacks[1]?.(JSON.stringify(reply));
        assert.equal(mocks.geometries.length, 2);
        assert.equal(mocks.moverWrites.length, 1);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=stay-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assert.equal(adapter.isInFlight, false);
        assertFlightRedacted(mocks);
    });

    it("rejects a stay reply with target-bound (malicious) focus and writes nothing", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        mocks.callbacks[1]?.(flightReply(correlation, false, followTargetFocus()));
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.moverWrites.length, 0);
        assert.deepEqual(mocks.switches, []);
        assert.deepEqual(mocks.focuses, []);
        assert.ok(
            mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=precondition-mismatch")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assert.equal(adapter.isInFlight, false);
        assertFlightRedacted(mocks);
    });

    it("rejects a stay reply naming the mover leaf in the source", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter, false);
        mocks.callbacks[1]?.(
            flightReply(correlation, false, { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-win-a" }),
        );
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.moverWrites.length, 0);
        assert.ok(
            mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=precondition-mismatch")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });

    it("rejects a follow reply with stale source focus", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter);
        assert.equal(requestCommand(mocks)["follow"], true, "omitted selection defaults to follow");
        mocks.callbacks[1]?.(flightReply(correlation, true, staySourceFocus()));
        assert.equal(mocks.geometries.length, 0);
        assert.equal(mocks.moverWrites.length, 0);
        assert.deepEqual(mocks.switches, []);
        assert.ok(
            mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=precondition-mismatch")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });

    it("rejects cross-selection echoes between flight and reply", () => {
        for (const [flightFollow, replyFollow, replyFocus] of [
            [false, true, followTargetFocus()],
            [true, false, staySourceFocus()],
        ] as const) {
            const refs = makeRefs();
            const mocks = flightEnv(refs);
            const adapter = new WorkspaceSendAdapter(mocks.env);
            assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
            const correlation = dispatchFlight(mocks, adapter, flightFollow);
            mocks.callbacks[1]?.(flightReply(correlation, replyFollow, replyFocus));
            assert.equal(mocks.geometries.length, 0, `flight=${String(flightFollow)} reply=${String(replyFollow)}`);
            assert.equal(mocks.moverWrites.length, 0);
            assert.ok(
                mocks.logs.some((l) => l.includes("stage=release") && l.includes("outcome=precondition-mismatch")),
                mocks.logs.join("\n"),
            );
            assert.equal(mocks.settled, 1);
            assertFlightRedacted(mocks);
        }
    });

    it("accepts a legacy reply without echoed follow and follows once", () => {
        const refs = makeRefs();
        const mocks = flightEnv(refs);
        const adapter = new WorkspaceSendAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
        const correlation = dispatchFlight(mocks, adapter);
        mocks.callbacks[1]?.(flightReply(correlation, null, followTargetFocus()));
        assert.equal(mocks.geometries.length, 3);
        assert.equal(mocks.moverWrites.length, 1);
        assert.deepEqual(mocks.switches, [refs.desktop]);
        assert.deepEqual(mocks.focuses, [refs.a]);
        assert.ok(
            mocks.logs.some((l) => l.includes("event=follow") && l.includes("outcome=state-confirmed")),
            mocks.logs.join("\n"),
        );
        assert.equal(mocks.settled, 1);
        assertFlightRedacted(mocks);
    });
});

// ---- Native scoped relative ring (item 1 foundation, item 2 send use). ----

interface RingOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
}

interface RingDesktop {
    id: string;
    x11DesktopNumber?: number;
}

interface RingSignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: {
        connect: (handler: (payload?: unknown) => void) => void;
        disconnect: (handler: (payload?: unknown) => void) => void;
    };
}

function ringSignal(): RingSignal {
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

interface RingWindow {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    internalId: string;
    resourceClass: string;
    output: RingOutput;
    desktops: RingDesktop[];
    frameGeometry: { x: number; y: number; width: number; height: number };
}

interface RingWorld {
    workspace: Record<string, unknown>;
    outputs: RingOutput[];
    desktops: RingDesktop[];
    wins: RingWindow[];
    currentByOutput: Map<RingOutput, RingDesktop>;
    globalCurrent: RingDesktop;
    created: number;
}

function ringOutput(name: string): RingOutput {
    return { name, manufacturer: "m", model: "d", serialNumber: "s" };
}

function ringWorld(outputNames: string[], desktopIds: string[]): RingWorld {
    const outputs = outputNames.map((name) => ringOutput(name));
    const desktops = desktopIds.map((id, index) => ({ id, x11DesktopNumber: index + 1 }) as RingDesktop);
    const currentByOutput = new Map<RingOutput, RingDesktop>();
    for (const output of outputs) {
        const first = desktops[0];
        if (first !== undefined) {
            currentByOutput.set(output, first);
        }
    }
    const firstDesktop = desktops[0];
    if (firstDesktop === undefined) {
        throw new Error("ring world needs desktops");
    }
    const world: RingWorld = {
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
        world.currentByOutput.get(output as RingOutput) ?? null;
    ws["currentDesktop"] = world.globalCurrent;
    ws["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        world.currentByOutput.set(output as RingOutput, desktop as RingDesktop);
        world.globalCurrent = desktop as RingDesktop;
        ws["currentDesktop"] = desktop;
    };
    ws["createDesktop"] = (): void => {
        world.created += 1;
        const maxNum = world.desktops.reduce((best, entry) => Math.max(best, entry.x11DesktopNumber ?? 0), 0);
        world.desktops.push({ id: `ws-new-${String(world.created)}`, x11DesktopNumber: maxNum + 1 });
        ws["desktops"] = world.desktops;
    };
    ws["removeDesktop"] = (desktop: unknown): void => {
        const at = world.desktops.indexOf(desktop as RingDesktop);
        if (at >= 0) {
            world.desktops.splice(at, 1);
        }
        ws["desktops"] = world.desktops;
    };
    ws["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    ws["windowList"] = (): unknown[] => [...world.wins];
    for (const name of ["windowActivated", "desktopsChanged", "currentDesktopChanged", "screensChanged", "windowAdded", "windowRemoved"] as const) {
        const sig = ringSignal();
        ws[name] = sig.signal;
    }
    return world;
}

function ringAddWindow(world: RingWorld, id: string, desktop: RingDesktop, output?: RingOutput): RingWindow {
    const out = output ?? world.outputs[0];
    if (out === undefined) {
        throw new Error("no output");
    }
    const win: RingWindow = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        internalId: id,
        resourceClass: "test-app",
        output: out,
        desktops: [desktop],
        frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
    };
    world.wins.push(win);
    return win;
}

function startRingNative(world: RingWorld, mode: unknown): { adapter: WorkspaceNativeAdapter; logs: string[] } {
    const logs: string[] = [];
    const adapter = new WorkspaceNativeAdapter({
        getWorkspace: () => world.workspace,
        readWorkspaceMode: () => mode,
        log: (message) => {
            logs.push(message);
        },
    });
    assert.equal(adapter.enable(), true);
    return { adapter, logs };
}

function ringSetCurrent(world: RingWorld, output: RingOutput, desktop: RingDesktop): void {
    world.currentByOutput.set(output, desktop);
    world.globalCurrent = desktop;
    (world.workspace as Record<string, unknown>)["currentDesktop"] = desktop;
}

function ringFocusOutput(world: RingWorld, output: RingOutput): void {
    (world.workspace as Record<string, unknown>)["activeScreen"] = output;
    (world.workspace as Record<string, unknown>)["activeWindow"] = null;
}

function occupiedRingWorld(mode: unknown): { world: RingWorld; adapter: WorkspaceNativeAdapter; out: RingOutput; trailing: RingDesktop } {
    const ids: string[] = [];
    for (let n = 1; n <= 10; n += 1) {
        ids.push(`ws-${String(n)}`);
    }
    ids.push("ws-e");
    const world = ringWorld(["out-1"], ids);
    for (const desktop of world.desktops) {
        if (desktop.id !== "ws-e") {
            ringAddWindow(world, `win-${desktop.id}`, desktop);
        }
    }
    const { adapter } = startRingNative(world, mode);
    const out = world.outputs[0] as RingOutput;
    const trailing = world.desktops[world.desktops.length - 1] as RingDesktop;
    assert.equal(trailing.id, "ws-e");
    return { world, adapter, out, trailing };
}

describe("relative send target over the scoped ring", () => {
    for (const mode of ["per-output-local", "global-unique", "shared"] as const) {
        it(`resolves ordinal steps with wrap including trailing empty and ordinals beyond 9 (${mode})`, () => {
            const { world, adapter, out, trailing } = occupiedRingWorld(mode);
            const ws1 = world.desktops[0] as RingDesktop;
            const ws10 = world.desktops.find((entry) => entry.id === "ws-10") as RingDesktop;
            assert.ok(ws10 !== undefined);
            ringSetCurrent(world, out, ws10);
            adapter.handleTopologySignal();
            const createdBefore = world.created;
            assert.equal(adapter.resolveRelativeMoveTarget(1), trailing.id, "next from last occupied fills the trailing empty");
            assert.equal(world.created, createdBefore, "resolution creates nothing");
            ringSetCurrent(world, out, trailing);
            adapter.handleTopologySignal();
            assert.equal(adapter.resolveRelativeMoveTarget(1), ws1.id, "next wraps from the trailing last to the first");
            ringSetCurrent(world, out, ws1);
            adapter.handleTopologySignal();
            assert.equal(adapter.resolveRelativeMoveTarget(-1), trailing.id, "previous wraps from the first to the trailing last");
            assert.equal(adapter.resolveRelativeMoveTarget(0), null);
            assert.equal(adapter.resolveRelativeMoveTarget(2), null);
            assert.equal(world.created, createdBefore, "invalid deltas create nothing");
            adapter.disable();
            assert.equal(adapter.resolveRelativeMoveTarget(1), null);
        });
    }

    it("reads the active output current on its own scoped ring", () => {
        const world = ringWorld(["out-L", "out-R"], ["ws-1", "ws-2", "ws-3"]);
        for (const desktop of world.desktops) {
            ringAddWindow(world, `win-${desktop.id}`, desktop);
        }
        const { adapter } = startRingNative(world, "per-output-local");
        const outL = world.outputs[0] as RingOutput;
        const outR = world.outputs[1] as RingOutput;
        const ws1 = world.desktops[0] as RingDesktop;
        const ws2 = world.desktops[1] as RingDesktop;
        ringSetCurrent(world, outL, ws1);
        ringFocusOutput(world, outL);
        adapter.handleTopologySignal();
        assert.equal(adapter.resolveRelativeMoveTarget(1), ws2.id, "L current steps within the L scope");
        // Each output scope owns its trailing spare (lifecycle appends one
        // per key at enable), so R already has a single-id ring unlike L.
        ringFocusOutput(world, outR);
        adapter.handleTopologySignal();
        const spare = world.desktops[world.desktops.length - 1] as RingDesktop;
        assert.notEqual(spare.id, ws1.id);
        ringSetCurrent(world, outR, spare);
        adapter.handleTopologySignal();
        const createdAtResolve = world.created;
        assert.equal(adapter.resolveRelativeMoveTarget(1), spare.id, "R resolves inside its own single-id ring");
        assert.equal(adapter.resolveRelativeMoveTarget(-1), spare.id, "single-id ring wraps to itself");
        ringFocusOutput(world, outL);
        assert.equal(adapter.resolveRelativeMoveTarget(1), ws2.id, "L scope is unaffected by the R spare");
        assert.equal(world.created, createdAtResolve, "resolution itself creates nothing");
        adapter.disable();
    });

    it("resolves from an empty source and sees the lifecycle spare after the trailing fills", () => {
        const world = ringWorld(["out-1"], ["ws-1", "ws-2", "ws-e"]);
        const ws1 = world.desktops[0] as RingDesktop;
        const ws2 = world.desktops[1] as RingDesktop;
        const wse = world.desktops[2] as RingDesktop;
        ringAddWindow(world, "win-2", ws2);
        const { adapter } = startRingNative(world, "shared");
        const out = world.outputs[0] as RingOutput;
        // ws-1 is the visible (hence retained) empty source.
        ringSetCurrent(world, out, ws1);
        (world.workspace as Record<string, unknown>)["currentDesktop"] = ws1;
        adapter.handleTopologySignal();
        assert.equal(adapter.resolveRelativeMoveTarget(1), ws2.id, "next from the empty source reaches the occupant");
        assert.equal(adapter.resolveRelativeMoveTarget(-1), wse.id, "previous from the empty source wraps to the trailing empty");
        // Fill the trailing empty: lifecycle appends the next spare, which
        // the next resolution observes without creating anything itself.
        ringAddWindow(world, "win-e", wse);
        const createdBefore = world.created;
        adapter.handleTopologySignal();
        assert.ok(world.created > createdBefore, "lifecycle supplies the next spare once the trailing fills");
        const spare = world.desktops[world.desktops.length - 1] as RingDesktop;
        assert.notEqual(spare.id, wse.id);
        ringSetCurrent(world, out, wse);
        (world.workspace as Record<string, unknown>)["currentDesktop"] = wse;
        adapter.handleTopologySignal();
        const createdAtResolve = world.created;
        assert.equal(adapter.resolveRelativeMoveTarget(1), spare.id, "next from the filled trailing reaches the new spare");
        assert.equal(world.created, createdAtResolve, "resolution itself creates nothing");
        adapter.disable();
    });

    it("verified follow records history while stay records no spurious switch", () => {
        const world = ringWorld(["out-1"], ["ws-1", "ws-2"]);
        const ws1 = world.desktops[0] as RingDesktop;
        const ws2 = world.desktops[1] as RingDesktop;
        const winA = ringAddWindow(world, "win-a", ws1);
        ringAddWindow(world, "win-b", ws1);
        ringAddWindow(world, "win-t", ws2);
        const { adapter } = startRingNative(world, "per-output-local");
        const out = world.outputs[0] as RingOutput;
        ringSetCurrent(world, out, ws1);
        adapter.handleTopologySignal();
        // Verified follow producer: mover arrives plus the view follows.
        winA.desktops = [ws2];
        ringSetCurrent(world, out, ws2);
        adapter.handleTopologySignal();
        assert.equal(adapter.selectPrevious(), true, "follow records a toggleable previous");
        assert.equal((world.currentByOutput.get(out) as RingDesktop).id, ws1.id);
        adapter.handleTopologySignal();
        // Stay producer: membership moves but the view never switches, so no
        // spurious switch is recorded.
        winA.desktops = [ws1];
        ringSetCurrent(world, out, ws1);
        adapter.handleTopologySignal();
        const snapBefore = adapter.previousSnapshot();
        winA.desktops = [ws2];
        adapter.handleTopologySignal();
        assert.deepEqual(adapter.previousSnapshot(), snapBefore, "stay records nothing without a view change");
        adapter.disable();
    });
});

describe("item 2 shortcut catalog rows", () => {
    it("binds relative follow, leaves every stay row unbound", () => {
        const catalog = workspaceShortcutCatalog();
        assert.equal(catalog.length, 75);
        const byAction = new Map(catalog.map((row) => [row.action, row]));
        const expectedFollow: ReadonlyArray<[string, string, -1 | 1]> = [
            ["omnitiler-send-prev-h", "Meta+Ctrl+Shift+H", -1],
            ["omnitiler-send-prev-k", "Meta+Ctrl+Shift+K", -1],
            ["omnitiler-send-prev-left-arrow", "Meta+Ctrl+Shift+Left", -1],
            ["omnitiler-send-prev-up-arrow", "Meta+Ctrl+Shift+Up", -1],
            ["omnitiler-send-next-j", "Meta+Ctrl+Shift+J", 1],
            ["omnitiler-send-next-l", "Meta+Ctrl+Shift+L", 1],
            ["omnitiler-send-next-down-arrow", "Meta+Ctrl+Shift+Down", 1],
            ["omnitiler-send-next-right-arrow", "Meta+Ctrl+Shift+Right", 1],
        ];
        for (const [action, sequence, delta] of expectedFollow) {
            const row = byAction.get(action);
            assert.ok(row !== undefined, action);
            assert.equal(row.sequence, sequence);
            assert.equal(row.kind, "send-relative");
            assert.equal(row.delta, delta);
        }
        const expectedStayPrev = [
            "omnitiler-send-stay-prev-h",
            "omnitiler-send-stay-prev-k",
            "omnitiler-send-stay-prev-left-arrow",
            "omnitiler-send-stay-prev-up-arrow",
        ];
        const expectedStayNext = [
            "omnitiler-send-stay-next-j",
            "omnitiler-send-stay-next-l",
            "omnitiler-send-stay-next-down-arrow",
            "omnitiler-send-stay-next-right-arrow",
        ];
        for (const action of [...expectedStayPrev, ...expectedStayNext]) {
            const row = byAction.get(action);
            assert.ok(row !== undefined, action);
            assert.equal(row.sequence, "", `${action} stays unbound`);
            assert.equal(row.kind, "send-relative-stay");
        }
        for (let index = 1; index <= 9; index += 1) {
            for (const action of [
                `omnitiler-stay-workspace-${String(index)}`,
                `omnitiler-stay-workspace-${String(index)}-symbol`,
            ]) {
                const row = byAction.get(action);
                assert.ok(row !== undefined, action);
                assert.equal(row.sequence, "", `${action} stays unbound`);
                assert.equal(row.kind, "move-stay");
                assert.equal(row.index, index);
            }
        }
        for (const action of ["omnitiler-stay-workspace-append", "omnitiler-stay-workspace-append-symbol"]) {
            const row = byAction.get(action);
            assert.ok(row !== undefined, action);
            assert.equal(row.sequence, "", `${action} stays unbound`);
            assert.equal(row.kind, "move-stay");
            assert.equal(row.index, 0);
        }
        // Numbered follow keeps its chords and shifted-symbol aliases.
        for (let index = 1; index <= 9; index += 1) {
            assert.equal(byAction.get(`omnitiler-move-workspace-${String(index)}`)?.sequence, `Meta+Shift+${String(index)}`);
            assert.equal(byAction.get(`omnitiler-move-workspace-${String(index)}`)?.kind, "move");
        }
        assert.equal(byAction.get("omnitiler-move-workspace-append")?.sequence, "Meta+Shift+0");
        // Action ids stay unique across the full catalog.
        assert.equal(byAction.size, catalog.length);
    });
});

// ---- Production entry routing: shortcuts resolve once and carry follow. ----

interface EntrySignal {
    readonly handlers: Array<(payload?: unknown) => void>;
    readonly signal: {
        connect: (handler: (payload?: unknown) => void) => void;
        disconnect: (handler: (payload?: unknown) => void) => void;
    };
}

function entrySignal(): EntrySignal {
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

interface EntryDesktop {
    id: string;
    x11DesktopNumber?: number;
}

interface EntryOutput {
    name: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
}

interface EntryWindow extends Record<string, unknown> {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    internalId: string;
    resourceClass: string;
    output: EntryOutput;
    desktops: EntryDesktop[];
    frameGeometry: { x: number; y: number; width: number; height: number };
}

interface EntryWorld {
    workspace: Record<string, unknown>;
    outputs: EntryOutput[];
    desktops: EntryDesktop[];
    wins: EntryWindow[];
    currentByOutput: Map<EntryOutput, EntryDesktop>;
    // Every setCurrentDesktopForScreen call lands here for follow-output
    // assertions (desktop id plus output name per call).
    readonly switchRecords: Array<{ desktop: string; output: string }>;
}

function entryWorld(outputNames: string[] = ["out-1"]): EntryWorld {
    const outputs: EntryOutput[] = outputNames.map((name) => ({
        name,
        manufacturer: "m",
        model: "d",
        serialNumber: `s-${name}`,
    }));
    const desktops: EntryDesktop[] = [
        { id: "ws-1", x11DesktopNumber: 1 },
        { id: "ws-2", x11DesktopNumber: 2 },
        // Trailing empty: lifecycle appends nothing at startup, so relative
        // wraps stay deterministic (next to ws-2, previous wraps to ws-e).
        { id: "ws-e", x11DesktopNumber: 3 },
    ];
    const currentByOutput = new Map<EntryOutput, EntryDesktop>();
    for (const output of outputs) {
        currentByOutput.set(output, desktops[0] as EntryDesktop);
    }
    const switchRecords: Array<{ desktop: string; output: string }> = [];
    const world: EntryWorld = { workspace: {}, outputs, desktops, wins: [], currentByOutput, switchRecords };
    const ws = world.workspace;
    ws["screens"] = outputs;
    ws["desktops"] = desktops;
    ws["activeWindow"] = null;
    ws["activeScreen"] = outputs[0];
    ws["currentDesktopForScreen"] = (output: unknown): unknown => currentByOutput.get(output as EntryOutput) ?? null;
    ws["currentDesktop"] = desktops[0];
    ws["setCurrentDesktopForScreen"] = (desktop: unknown, output: unknown): void => {
        currentByOutput.set(output as EntryOutput, desktop as EntryDesktop);
        ws["currentDesktop"] = desktop;
        switchRecords.push({
            desktop: (desktop as EntryDesktop).id,
            output: (output as EntryOutput).name,
        });
    };
    ws["createDesktop"] = (): void => {
        const maxNum = desktops.reduce((best, entry) => Math.max(best, entry.x11DesktopNumber ?? 0), 0);
        desktops.push({ id: `ws-new-${String(desktops.length + 1)}`, x11DesktopNumber: maxNum + 1 });
        ws["desktops"] = desktops;
    };
    ws["removeDesktop"] = (desktop: unknown): void => {
        const at = desktops.indexOf(desktop as EntryDesktop);
        if (at >= 0) {
            desktops.splice(at, 1);
        }
        ws["desktops"] = desktops;
    };
    ws["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    ws["windowList"] = (): unknown[] => [...world.wins];
    for (const name of ["windowAdded", "windowRemoved", "windowActivated", "screensChanged", "currentDesktopChanged", "desktopsChanged"] as const) {
        ws[name] = entrySignal().signal;
    }
    return world;
}

interface EntryMocks {
    readonly dbusCalls: Array<{ service: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; sequence: string; callback: () => void }>;
    readonly answeredOwners: Set<number>;
}

function startSendEntry(world: EntryWorld): { handle: PlanEntryHandle | null; mocks: EntryMocks } {
    const mocks: EntryMocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [], answeredOwners: new Set<number>() };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (service, _path, _iface, method, payload, callback): void => {
            if (method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                callback(true);
                return;
            }
            mocks.dbusCalls.push({ service, method, payload });
            mocks.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            mocks.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            mocks.logs.push(message);
        },
        owner: "owner-1",
        generation: "gen-1",
        registerShortcutFn: (action, _text, sequence, callback): boolean => {
            mocks.shortcuts.push({ action, sequence, callback });
            return true;
        },
        readProfileFn: (): string => "cosmic",
        readWorkspaceModeFn: (): unknown => "per-output-local",
    });
    return { handle, mocks };
}

function entryDrainOwners(mocks: EntryMocks): void {
    for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
        if (mocks.dbusCalls[index]?.method !== "GetNameOwner") {
            continue;
        }
        if (mocks.answeredOwners.has(index)) {
            continue;
        }
        mocks.answeredOwners.add(index);
        mocks.callbacks[index]?.(":1.7");
    }
}

function entryRunDebounce(mocks: EntryMocks): void {
    const pending = [...mocks.timers];
    mocks.timers.length = 0;
    for (const timer of pending) {
        if (timer.cancelled) {
            continue;
        }
        if (timer.delayMs === PLAN_DEBOUNCE_MS) {
            timer.callback();
        } else {
            mocks.timers.push(timer);
        }
    }
    entryDrainOwners(mocks);
}

function entryCommandOf(payload: string): Record<string, unknown> {
    return (JSON.parse(payload) as Record<string, unknown>)["command"] as Record<string, unknown>;
}

function dumpEntryCalls(mocks: EntryMocks, from: number): string {
    return mocks.dbusCalls
        .slice(from)
        .map((call) => {
            let op = "?";
            try {
                op = entryCommandOf(call.payload)["op"] as string;
            } catch {
                op = `method=${call.method}`;
            }
            return `${call.method}:${op}`;
        })
        .join("\n");
}

function entrySendPayloads(mocks: EntryMocks): Array<{ payload: Record<string, unknown> }> {
    const out: Array<{ payload: Record<string, unknown> }> = [];
    for (const call of mocks.dbusCalls) {
        if (call.method !== WORKSPACE_SEND_METHOD) {
            continue;
        }
        let payload: Record<string, unknown> | null = null;
        try {
            payload = JSON.parse(call.payload) as Record<string, unknown>;
        } catch {
            continue;
        }
        if (entryCommandOf(call.payload)["op"] === "send-to-workspace") {
            out.push({ payload });
        }
    }
    return out;
}

interface EntryFixture {
    world: EntryWorld;
    handle: PlanEntryHandle | null;
    mocks: EntryMocks;
    winSignals: Map<string, { desktopsChanged: EntrySignal }>;
}

function setupEntrySendFixture(): EntryFixture {
    const world = entryWorld();
    const ws1 = world.desktops[0] as EntryDesktop;
    const ws2 = world.desktops[1] as EntryDesktop;
    const output = world.outputs[0] as EntryOutput;
    const winSignals = new Map<string, { desktopsChanged: EntrySignal }>();
    const mkWin = (id: string, desktop: EntryDesktop, x: number): EntryWindow => {
        const desktopsChanged = entrySignal();
        const win = {
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
            frameGeometry: { x, y: 0, width: 100, height: 100 },
            desktopsChanged: desktopsChanged.signal,
            frameGeometryChanged: entrySignal().signal,
            moveResizedChanged: entrySignal().signal,
            fullScreenChanged: entrySignal().signal,
            maximizedChanged: entrySignal().signal,
        } as unknown as EntryWindow;
        world.wins.push(win);
        winSignals.set(id, { desktopsChanged });
        return win;
    };
    const winA = mkWin("win-a", ws1, 0);
    mkWin("win-b", ws1, 100);
    mkWin("win-c", ws1, 200);
    mkWin("win-t", ws2, 0);
    world.workspace["activeWindow"] = winA;
    const { handle, mocks } = startSendEntry(world);
    assert.ok(handle !== null);
    entryRunDebounce(mocks);
    entryDrainOwners(mocks);
    settleEntryPlans(mocks);
    return { world, handle, mocks, winSignals };
}

// Answer every non-send planner call with an echoed planned reply until
// the entry goes idle (no unanswered calls remain). Settles the initial
// Plan admit (and only that; send flights are answered by their own tests).
function settleEntryPlans(mocks: EntryMocks): void {
    const answered = new Set<number>();
    for (let round = 0; round < 20; round += 1) {
        entryDrainOwners(mocks);
        const pending = mocks.dbusCalls
            .map((call, index) => ({ call, index }))
            .filter(({ call, index }) => {
                if (call.method !== WORKSPACE_SEND_METHOD) {
                    return false;
                }
                if (answered.has(index)) {
                    return false;
                }
                try {
                    return entryCommandOf(call.payload)["op"] !== "send-to-workspace";
                } catch {
                    return false;
                }
            });
        if (pending.length === 0) {
            break;
        }
        for (const { call, index } of pending) {
            answered.add(index);
            const payload = JSON.parse(call.payload) as Record<string, unknown>;
            const windows = payload["windows"] as Array<Record<string, unknown>>;
            mocks.callbacks[index]?.(
                JSON.stringify({
                    v: 1,
                    correlation_id: payload["correlation_id"],
                    outcome: "planned",
                    desired_geometry: windows.map((entry) => ({
                        window: entry["window"],
                        leaf: entry["window"],
                        output: entry["output"],
                        workspace: entry["workspace"],
                        rect: entry["rect"],
                    })),
                }),
            );
        }
    }
}

function fireShortcut(mocks: EntryMocks, action: string): void {
    const row = mocks.shortcuts.find((entry) => entry.action === action);
    assert.ok(row !== undefined, `shortcut registered: ${action}`);
    row.callback();
    entryDrainOwners(mocks);
}

function fireEntrySignal(signal: EntrySignal): void {
    for (const handler of [...signal.handlers]) {
        handler();
    }
}

function flushEntryTimers(mocks: EntryMocks): void {
    for (let round = 0; round < 10; round += 1) {
        entryDrainOwners(mocks);
        const pending = mocks.timers.filter((timer) => !timer.cancelled);
        if (pending.length === 0) {
            break;
        }
        mocks.timers.length = 0;
        for (const timer of pending) {
            timer.callback();
        }
    }
    entryDrainOwners(mocks);
}

// Run only Plan debounce timers (plus owner answers) until quiescent,
// never firing reply-deadline timers: dispatches scheduled reconciles so
// their replies still land on live flights.
function flushDebounceOnly(mocks: EntryMocks): void {
    for (let round = 0; round < 10; round += 1) {
        entryDrainOwners(mocks);
        const pending = mocks.timers.filter((timer) => !timer.cancelled && timer.delayMs === PLAN_DEBOUNCE_MS);
        if (pending.length === 0) {
            break;
        }
        mocks.timers.splice(0, mocks.timers.length, ...mocks.timers.filter((timer) => timer.cancelled || timer.delayMs !== PLAN_DEBOUNCE_MS));
        for (const timer of pending) {
            timer.callback();
        }
    }
    entryDrainOwners(mocks);
}

function entryReconciles(mocks: EntryMocks): Array<{ index: number; payload: Record<string, unknown> }> {    const out: Array<{ index: number; payload: Record<string, unknown> }> = [];
    mocks.dbusCalls.forEach((call, index) => {
        if (call.method !== WORKSPACE_SEND_METHOD) {
            return;
        }
        let payload: Record<string, unknown> | null = null;
        try {
            payload = JSON.parse(call.payload) as Record<string, unknown>;
        } catch {
            return;
        }
        if (entryCommandOf(call.payload)["op"] === "reconcile") {
            out.push({ index, payload });
        }
    });
    return out;
}

// Float the target workspace through the tiling toggle, then restore the
// source view with the mover active. Mirrors the workspace-tiling floating
// fixture conventions.
function floatEntryTarget(fixture: EntryFixture, targetId: string, sourceId: string): void {
    const { world, handle } = fixture;
    const out = world.outputs[0] as EntryOutput;
    const target = world.desktops.find((entry) => entry.id === targetId) as EntryDesktop;
    const source = world.desktops.find((entry) => entry.id === sourceId) as EntryDesktop;
    assert.ok(target !== undefined && source !== undefined);
    world.currentByOutput.set(out, target);
    world.workspace["currentDesktop"] = target;
    handle?.requestWorkspaceTilingToggle();
    assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
    world.currentByOutput.set(out, source);
    world.workspace["currentDesktop"] = source;
}

function workspaceMoveOutcome(mocks: EntryMocks): string {
    const lines = mocks.logs.filter((line) => line.includes("event=workspace-move") && line.includes("outcome=native-moved"));
    assert.equal(lines.length, 1, `exactly one native-moved line:\n${mocks.logs.join("\n")}`);
    return lines[0] as string;
}

// Answer pending release-domain calls with the contract release reply so
// the toggle-to-floating handshake settles and workspace routes go idle.
// Real-planner behavior; never answers send flights.
function answerReleaseDomains(mocks: EntryMocks): void {
    mocks.dbusCalls.forEach((call, index) => {
        if (call.method !== WORKSPACE_SEND_METHOD) {
            return;
        }
        let payload: Record<string, unknown> | null = null;
        try {
            payload = JSON.parse(call.payload) as Record<string, unknown>;
        } catch {
            return;
        }
        if (entryCommandOf(call.payload)["op"] !== "release-domain") {
            return;
        }
        mocks.callbacks[index]?.(
            JSON.stringify({
                v: 1,
                correlation_id: payload["correlation_id"],
                outcome: "released",
                kind: "release-domain",
                detail: { kind: "release-domain" },
            }),
        );
    });
    entryDrainOwners(mocks);
}

describe("entry send follow/stay routing", () => {
    it("registers every item 2 row after the legacy rows in catalog order", () => {
        const fixture = setupEntrySendFixture();
        const actions = fixture.mocks.shortcuts.map((row) => row.action);
        const legacyTail = actions.indexOf("omnitiler-workspace-next-right-arrow");
        assert.ok(legacyTail >= 0);
        const expectedNew = [
            "omnitiler-send-prev-h",
            "omnitiler-send-prev-k",
            "omnitiler-send-prev-left-arrow",
            "omnitiler-send-prev-up-arrow",
            "omnitiler-send-next-j",
            "omnitiler-send-next-l",
            "omnitiler-send-next-down-arrow",
            "omnitiler-send-next-right-arrow",
            "omnitiler-stay-workspace-1",
            "omnitiler-stay-workspace-1-symbol",
            "omnitiler-stay-workspace-2",
            "omnitiler-stay-workspace-2-symbol",
            "omnitiler-stay-workspace-3",
            "omnitiler-stay-workspace-3-symbol",
            "omnitiler-stay-workspace-4",
            "omnitiler-stay-workspace-4-symbol",
            "omnitiler-stay-workspace-5",
            "omnitiler-stay-workspace-5-symbol",
            "omnitiler-stay-workspace-6",
            "omnitiler-stay-workspace-6-symbol",
            "omnitiler-stay-workspace-7",
            "omnitiler-stay-workspace-7-symbol",
            "omnitiler-stay-workspace-8",
            "omnitiler-stay-workspace-8-symbol",
            "omnitiler-stay-workspace-9",
            "omnitiler-stay-workspace-9-symbol",
            "omnitiler-stay-workspace-append",
            "omnitiler-stay-workspace-append-symbol",
            "omnitiler-send-stay-prev-h",
            "omnitiler-send-stay-prev-k",
            "omnitiler-send-stay-prev-left-arrow",
            "omnitiler-send-stay-prev-up-arrow",
            "omnitiler-send-stay-next-j",
            "omnitiler-send-stay-next-l",
            "omnitiler-send-stay-next-down-arrow",
            "omnitiler-send-stay-next-right-arrow",
        ];
        assert.deepEqual(actions.slice(legacyTail + 1, legacyTail + 1 + expectedNew.length), expectedNew);
        fixture.handle?.stop();
    });

    it("routes absolute follow and stay into the payload selection", () => {
        for (const [action, follow] of [
            ["omnitiler-move-workspace-2", true],
            ["omnitiler-stay-workspace-2", false],
        ] as const) {
            const fixture = setupEntrySendFixture();
            fireShortcut(fixture.mocks, action);
            const sends = entrySendPayloads(fixture.mocks);
            assert.equal(sends.length, 1, `${action} dispatches exactly one send`);
            const command = sends[0]?.payload["command"] as Record<string, unknown>;
            assert.equal(command["target_workspace"], "ws-2");
            assert.equal(command["follow"], follow, `${action} carries follow=${String(follow)}`);
            fixture.handle?.stop();
        }
    });

    it("resolves relative targets once and routes follow versus stay", () => {
        for (const [action, follow, expectedTarget] of [
            ["omnitiler-send-next-l", true, "ws-2"],
            ["omnitiler-send-stay-next-l", false, "ws-2"],
            ["omnitiler-send-prev-h", true, "ws-e"],
        ] as const) {
            const fixture = setupEntrySendFixture();
            const currentBefore = (fixture.world.workspace["currentDesktop"] as EntryDesktop).id;
            assert.equal(currentBefore, "ws-1");
            fireShortcut(fixture.mocks, action);
            const sends = entrySendPayloads(fixture.mocks);
            assert.equal(sends.length, 1, `${action} dispatches exactly one send`);
            const command = sends[0]?.payload["command"] as Record<string, unknown>;
            // Next steps to ws-2; previous wraps from the first to the
            // trailing empty. The target is fixed before transfer.
            assert.equal(command["target_workspace"], expectedTarget, `${action} resolves the ring target once`);
            assert.equal(command["follow"], follow, `${action} carries follow=${String(follow)}`);
            // The view is untouched at dispatch: follow/stay applies on the
            // verified transfer, never during resolution.
            assert.equal((fixture.world.workspace["currentDesktop"] as EntryDesktop).id, "ws-1");
            fixture.handle?.stop();
        }
    });
});

describe("entry floating-boundary follow/stay", () => {
    it("floating follow addresses the pre-write output when KWin refocuses elsewhere", () => {
        const world = entryWorld(["out-1", "out-2"]);
        const ws1 = world.desktops[0] as EntryDesktop;
        const ws2 = world.desktops[1] as EntryDesktop;
        const out1 = world.outputs[0] as EntryOutput;
        const out2 = world.outputs[1] as EntryOutput;
        const mkWin = (id: string, desktop: EntryDesktop, output: EntryOutput): EntryWindow => {
            const win = {
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
                desktopsChanged: entrySignal().signal,
                frameGeometryChanged: entrySignal().signal,
                moveResizedChanged: entrySignal().signal,
                fullScreenChanged: entrySignal().signal,
                maximizedChanged: entrySignal().signal,
            } as unknown as EntryWindow;
            world.wins.push(win);
            return win;
        };
        const mover = mkWin("win-a", ws1, out1);
        mkWin("win-b", ws1, out1);
        // Other-output survivor on the target: occupies ws-2 so lifecycle
        // keeps it, and gives KWin a cross-output refocus candidate.
        const otherOutputWin = mkWin("win-o", ws2, out2);
        world.workspace["activeWindow"] = mover;
        const { handle, mocks } = startSendEntry(world);
        assert.ok(handle !== null);
        entryRunDebounce(mocks);
        entryDrainOwners(mocks);
        settleEntryPlans(mocks);
        // KWin refocuses the other-output survivor as a side effect of the
        // membership write; follow must still address the pre-write output.
        let members: unknown[] = [ws1];
        Object.defineProperty(mover, "desktops", {
            configurable: true,
            get: () => members,
            set: (value: unknown) => {
                members = value as unknown[];
                world.workspace["activeWindow"] = otherOutputWin;
            },
        });
        floatEntryTarget({ world, handle, mocks, winSignals: new Map() }, "ws-2", "ws-1");
        world.workspace["activeWindow"] = mover;
        world.switchRecords.length = 0;
        // The toggle-to-floating release handshake settles first so the
        // transfer below is not refused as busy-plan.
        flushEntryTimers(mocks);
        answerReleaseDomains(mocks);
        flushEntryTimers(mocks);
        fireShortcut(mocks, "omnitiler-move-workspace-2");
        assert.deepEqual(members, [ws2], `membership lands on the target:\n${mocks.logs.join("\n")}`);
        assert.deepEqual(
            world.switchRecords,
            [{ desktop: "ws-2", output: "out-1" }],
            "follow switches the pre-write output, never the refocused one",
        );
        assert.equal(world.workspace["activeWindow"], mover, "follow focuses the mover back");
        assert.ok(workspaceMoveOutcome(mocks).includes("follow=followed"), mocks.logs.join("\n"));
        assert.equal(entrySendPayloads(mocks).length, 0, "no Rust send crosses a floating boundary");
        handle?.stop();
    });

    it("floating follow refuses the switch on stale arrival without setters", () => {
        const fixture = setupEntrySendFixture();
        floatEntryTarget(fixture, "ws-2", "ws-1");
        const { world, mocks } = fixture;
        const mover = world.wins[0] as EntryWindow;
        const ws1 = world.desktops[0] as EntryDesktop;
        const wsE = world.desktops[2] as EntryDesktop;
        // The membership reads stale between the post-write readback and
        // the pre-switch arrival proof (first post-write read wins).
        let members: unknown[] = [ws1];
        let armed = false;
        let postReads = 0;
        Object.defineProperty(mover, "desktops", {
            configurable: true,
            get: () => {
                if (!armed) {
                    return members;
                }
                postReads += 1;
                return postReads === 1 ? members : [wsE];
            },
            set: (value: unknown) => {
                members = value as unknown[];
                armed = true;
            },
        });
        world.switchRecords.length = 0;
        const activeBefore = world.workspace["activeWindow"];
        fireShortcut(mocks, "omnitiler-move-workspace-2");
        const line = workspaceMoveOutcome(mocks);
        assert.ok(line.includes("follow=arrival-unconfirmed"), line);
        assert.deepEqual(world.switchRecords, [], "stale arrival never switches");
        assert.equal(world.workspace["activeWindow"], activeBefore, "stale arrival never focuses");
        handleStop(fixture);
    });

    it("floating follow reproves arrival immediately before focus", () => {
        const fixture = setupEntrySendFixture();
        floatEntryTarget(fixture, "ws-2", "ws-1");
        const { world, mocks } = fixture;
        const mover = world.wins[0] as EntryWindow;
        const ws1 = world.desktops[0] as EntryDesktop;
        const wsE = world.desktops[2] as EntryDesktop;
        // Membership reads fresh through the write, the pre-switch arrival
        // proof, then goes stale before the pre-focus re-proof: the
        // verified switch stands, but focus is refused without a setter.
        let members: unknown[] = [ws1];
        let armed = false;
        let postReads = 0;
        Object.defineProperty(mover, "desktops", {
            configurable: true,
            get: () => {
                if (!armed) {
                    return members;
                }
                postReads += 1;
                return postReads <= 2 ? members : [wsE];
            },
            set: (value: unknown) => {
                members = value as unknown[];
                armed = true;
            },
        });
        world.switchRecords.length = 0;
        fireShortcut(mocks, "omnitiler-move-workspace-2");
        const line = workspaceMoveOutcome(mocks);
        assert.ok(line.includes("follow=arrival-unconfirmed"), line);
        assert.deepEqual(
            world.switchRecords,
            [{ desktop: "ws-2", output: "out-1" }],
            "the verified switch stands while focus is refused",
        );
        assert.equal(world.workspace["activeWindow"], mover, "stale re-proof refuses focus without a setter");
        handleStop(fixture);
    });

    it("floating stay reflows the tiled source with membership-only transfer", () => {
        const fixture = setupEntrySendFixture();
        floatEntryTarget(fixture, "ws-2", "ws-1");
        const { world, mocks } = fixture;
        const mover = world.wins[0] as EntryWindow;
        const geoBefore = { ...(mover.frameGeometry as { x: number; y: number; width: number; height: number }) };
        world.switchRecords.length = 0;
        fireShortcut(mocks, "omnitiler-stay-workspace-2");
        assert.deepEqual(
            (mover.desktops as unknown[]).map((entry) => (entry as EntryDesktop).id),
            ["ws-2"],
            "membership-only transfer lands on the target",
        );
        assert.deepEqual(world.switchRecords, [], "stay never switches");
        assert.equal(world.workspace["activeWindow"], mover, "stay preserves focus");
        assert.equal((world.workspace["currentDesktop"] as EntryDesktop).id, "ws-1", "stay preserves the source view");
        assert.ok(workspaceMoveOutcome(mocks).includes("follow=stayed"), mocks.logs.join("\n"));
        assert.equal(entrySendPayloads(mocks).length, 0, "no Rust send crosses a floating boundary");
        assert.deepEqual(
            mover.frameGeometry,
            geoBefore,
            "the floating side receives no geometry",
        );
        // With focus still on the departed mover, foreground observation is
        // null by the existing active-in-domain rule, so the resync observes
        // nothing and dispatches nothing: fail-closed, no phantom reflow.
        const quietBefore = mocks.dbusCalls.length;
        flushDebounceOnly(mocks);
        assert.equal(
            mocks.dbusCalls.length,
            quietBefore,
            "no resync dispatches while focus sits off-domain",
        );
        // KWin refocuses a source survivor (here the decoy win-c): the mover
        // membership signal re-observes, and the tiled source reflows
        // through the ordinary resync reconcile. Debounce-only flush: the
        // reconcile reply below must land on a live flight, never after a
        // fired reply deadline.
        const decoy = world.wins.find((entry) => entry.internalId === "win-c") as EntryWindow;
        assert.ok(decoy !== undefined);
        world.workspace["activeWindow"] = decoy;
        const moverSignals = fixture.winSignals.get("win-a");
        assert.ok(moverSignals !== undefined);
        fireEntrySignal(moverSignals.desktopsChanged);
        const reflowBefore = mocks.dbusCalls.length;
        flushDebounceOnly(mocks);
        const reconciles = entryReconciles(mocks).filter((entry) => entry.index >= reflowBefore);
        assert.ok(reconciles.length >= 1, `the tiled side reflows through a resync reconcile:\n${dumpEntryCalls(mocks, reflowBefore)}`);
        const sourceReconcile = reconciles.find(
            (entry) => (entry.payload["domain"] as Record<string, unknown>)?.["workspace"] === "ws-1",
        );
        assert.ok(sourceReconcile !== undefined, "the reconcile covers the tiled source");
        // The existing core-removal route converges source focus: a
        // core-shaped MRU focus reply on the resync reconcile actuates
        // through the ordinary Plan focus path (leaf-bound, no switch),
        // overriding the decoy native choice with the MRU survivor.
        const survivor = world.wins.find((entry) => entry.internalId === "win-b") as EntryWindow;
        assert.ok(survivor !== undefined);
        const sentWindows = sourceReconcile.payload["windows"] as Array<Record<string, unknown>>;
        mocks.callbacks[sourceReconcile.index]?.(
            JSON.stringify({
                v: 1,
                correlation_id: sourceReconcile.payload["correlation_id"],
                outcome: "planned",
                desired_geometry: sentWindows.map((entry) => ({
                    window: entry["window"],
                    leaf: entry["window"],
                    output: entry["output"],
                    workspace: entry["workspace"],
                    rect: entry["rect"],
                })),
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "win-b" },
            }),
        );
        assert.equal(
            world.workspace["activeWindow"],
            survivor,
            "the resync reconcile applies the core MRU survivor",
        );
        assert.equal(
            (world.workspace["currentDesktop"] as EntryDesktop).id,
            "ws-1",
            "MRU convergence switches no desktop",
        );
        handleStop(fixture);
    });
});

function handleStop(fixture: EntryFixture): void {
    fixture.handle?.stop();
}
