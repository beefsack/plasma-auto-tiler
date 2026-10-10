import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PlanAdapter,
    type PlanAdapterEnv,
    type PlanObserved,
} from "../src/plan-adapter";
import {
    WORKSPACE_TILING_TOGGLE_ACTION,
    startPlanAdapterEntry,
    type PlanEntryOverrides,
} from "../src/plan-adapter-entry";
import { TRAY_SCHEMA, TrayPublisher } from "../src/tray-publisher";
import {
    DEFAULT_TILED,
    WorkspaceNativeAdapter,
    parseDefaultTiled,
} from "../src/workspace-native";

function fakeSignal(): {
    readonly handlers: Array<() => void>;
    readonly signal: { connect: (handler: () => void) => void; disconnect: (handler: () => void) => void };
} {
    const handlers: Array<() => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: () => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: () => void): void => {
                const at = handlers.indexOf(handler);
                if (at >= 0) {
                    handlers.splice(at, 1);
                }
            },
        },
    };
}

interface RichWorld {
    readonly workspace: Record<string, unknown>;
    readonly output: Record<string, unknown>;
    readonly desktops: Record<string, unknown>[];
    readonly wins: Record<string, unknown>[];
    readonly logs: string[];
    readonly fire: (name: string) => void;
}

function richWorld(desktopIds: string[], windowCount: number): RichWorld {
    const logs: string[] = [];
    const output: Record<string, unknown> = { name: "out-1", manufacturer: "m", model: "d", serialNumber: "s" };
    const desktops = desktopIds.map((id) => ({ id }));
    const wins: Record<string, unknown>[] = [];
    for (let index = 0; index < windowCount; index += 1) {
        const geo = fakeSignal();
        wins.push({
            normalWindow: true,
            internalId: `win-${String(index + 1)}`,
            resourceClass: "test-app",
            output,
            desktops: [desktops[0]],
            frameGeometry: { x: index * 600, y: 0, width: 600, height: 800 },
            frameGeometryChanged: geo.signal,
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: fakeSignal().signal,
            maximizeMode: 0,
            desktopsChanged: fakeSignal().signal,
            onAllDesktops: false,
            keepAbove: false,
            keepBelow: false,
            setMaximize: (): void => {},
        });
    }
    const added = fakeSignal();
    const removed = fakeSignal();
    const activated = fakeSignal();
    const screensChanged = fakeSignal();
    const desktopChanged = fakeSignal();
    const fired: Record<string, Array<() => void>> = {
        windowAdded: added.handlers,
        windowRemoved: removed.handlers,
        windowActivated: activated.handlers,
        screensChanged: screensChanged.handlers,
        currentDesktopChanged: desktopChanged.handlers,
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins[0] ?? null,
        activeScreen: output,
        windowList: (): unknown[] => [...wins],
        screens: [output],
        desktops,
        currentDesktop: desktops[0],
        currentDesktopForScreen: (): unknown => desktops[0],
        setCurrentDesktopForScreen: (): void => {},
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowAdded: added.signal,
        windowRemoved: removed.signal,
        windowActivated: activated.signal,
        screensChanged: screensChanged.signal,
        currentDesktopChanged: desktopChanged.signal,
        createDesktop: (_position: unknown, _name: unknown): void => {
            const fresh = { id: `ws-new-${String(desktops.length + 1)}` };
            desktops.push(fresh);
            workspace["desktops"] = desktops;
        },
        removeDesktop: (): void => {},
    };
    void logs;
    const fire = (name: string): void => {
        for (const handler of fired[name] ?? []) {
            handler();
        }
    };
    return { workspace, output, desktops, wins, logs, fire };
}

function nativeAdapter(world: RichWorld, mode: unknown = "per-output-local", tilingDefault: unknown = true): WorkspaceNativeAdapter {
    const logs: string[] = [];
    const adapter = new WorkspaceNativeAdapter({
        getWorkspace: () => world.workspace,
        readWorkspaceMode: () => mode,
        readTilingDefault: () => tilingDefault,
        log: (message) => logs.push(message),
    });
    adapter.enable();
    return adapter;
}

describe("workspace tiling defaults and scope", () => {
    it("parses the new default key as Tiled unless explicitly floating", () => {
        assert.equal(parseDefaultTiled(undefined), true);
        assert.equal(parseDefaultTiled(null), true);
        assert.equal(parseDefaultTiled(true), true);
        assert.equal(parseDefaultTiled("true"), true);
        assert.equal(parseDefaultTiled(false), false);
        assert.equal(parseDefaultTiled("false"), false);
        assert.equal(parseDefaultTiled("garbage"), true);
        assert.equal(DEFAULT_TILED, true);
    });

    it("initializes every existing workspace from the startup default", () => {
        const world = richWorld(["ws-1", "ws-2"], 0);
        const adapter = nativeAdapter(world, "per-output-local", true);
        assert.equal(adapter.isTiled("ws-1"), true);
        assert.equal(adapter.isTiled("ws-2"), true);
        assert.equal(adapter.currentScopeId(), "ws-1");
    });

    it("initializes floating defaults and isolates per-workspace toggles", () => {
        const world = richWorld(["ws-1", "ws-2"], 0);
        const adapter = nativeAdapter(world, "per-output-local", false);
        assert.equal(adapter.isTiled("ws-1"), false);
        adapter.setTiled("ws-1", true);
        assert.equal(adapter.isTiled("ws-1"), true);
        assert.equal(adapter.isTiled("ws-2"), false);
    });

    it("newly discovered ids use the current default after configChanged; existing retain", () => {
        const world = richWorld(["ws-1"], 0);
        const adapter = nativeAdapter(world, "per-output-local", true);
        assert.equal(adapter.isTiled("ws-1"), true);
        adapter.setTiled("ws-1", false);
        assert.equal(adapter.setDefaultTiled(false), true);
        world.desktops.push({ id: "ws-2" });
        world.workspace["desktops"] = world.desktops;
        adapter.handleTopologySignal();
        assert.equal(adapter.isTiled("ws-2"), false);
        assert.equal(adapter.isTiled("ws-1"), false);
        assert.equal(adapter.setDefaultTiled(false), false);
    });

    it("prunes deleted ids on topology signals", () => {
        const world = richWorld(["ws-1", "ws-2"], 0);
        const adapter = nativeAdapter(world, "per-output-local", true);
        adapter.setTiled("ws-2", false);
        world.desktops.splice(1, 1);
        world.workspace["desktops"] = world.desktops;
        adapter.handleTopologySignal();
        assert.equal(adapter.isTiled("ws-1"), true);
    });

    it("shared mode reports the shared current scope", () => {
        const world = richWorld(["ws-1", "ws-2"], 0);
        const adapter = nativeAdapter(world, "shared", true);
        assert.equal(adapter.currentScopeId(), "ws-1");
    });
});

function mockPlanEnv(refs: { a: object; b: object }, isTiled: (output: string, workspace: string) => boolean): {
    env: PlanAdapterEnv;
    calls: Array<{ method: string; payload: string }>;
    callbacks: Array<(reply: unknown) => void>;
    geometries: object[];
    logs: string[];
    timers: Array<{ callback: () => void; cancelled: boolean }>;
    flushTimers: () => void;
} {
    const calls: Array<{ method: string; payload: string }> = [];
    const callbacks: Array<(reply: unknown) => void> = [];
    const geometries: object[] = [];
    const logs: string[] = [];
    const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
    const observed: PlanObserved = {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: 8,
        domainOuterGap: 8,
        focusedId: "win-a",
        windows: Object.freeze([
            Object.freeze({ id: "win-a", ref: refs.a, rect: { x: 0, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, resourceClass: "test" }),
            Object.freeze({ id: "win-b", ref: refs.b, rect: { x: 600, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, resourceClass: "test" }),
        ]),
        activeRef: refs.a,
        fingerprint: "fp-1",
        revalidate: () => true,
    };
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
            calls.push({ method, payload });
            callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            void delayMs;
            const entry = { callback, cancelled: false };
            timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            logs.push(message);
        },
        observe: (): PlanObserved | null => observed,
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target): boolean => {
            geometries.push(target);
            return true;
        },
        setActive: (): boolean => true,
        active: () => refs.a,
        subscribe: (): (() => void) => (): void => {},
        isDomainTiled: (output, workspace) => isTiled(output, workspace),
    };
    const flushTimers = (): void => {
        for (const entry of timers.splice(0)) {
            if (!entry.cancelled) {
                entry.callback();
            }
        }
    };
    return { env, calls, callbacks, geometries, logs, timers, flushTimers };
}

describe("floating leaves windows and stops tiling", () => {
    it("skips automatic tiling and refuses Meta+G on a floating workspace", () => {
        const refs = { a: {}, b: {} };
        const state = mockPlanEnv(refs, () => false);
        const adapter = new PlanAdapter(state.env);
        assert.equal(adapter.enable({ owner: "o", generation: "g-1" }), true);
        adapter.requestResync();
        assert.equal(state.calls.length, 0);
        adapter.requestFloat();
        assert.equal(state.calls.length, 0);
        assert.ok(state.logs.some((line) => line.includes("workspace-floating")));
        adapter.requestMove("left");
        assert.equal(state.calls.length, 0);
        adapter.disable();
    });

    it("tiles normally while the domain stays tiled", () => {
        const refs = { a: {}, b: {} };
        const state = mockPlanEnv(refs, () => true);
        const adapter = new PlanAdapter(state.env);
        assert.equal(adapter.enable({ owner: "o", generation: "g-1" }), true);
        adapter.requestResync();
        state.flushTimers();
        assert.equal(state.calls.length, 1);
        const payload = JSON.parse(state.calls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(payload["command"], { op: "reconcile" });
        adapter.disable();
    });

    it("release-domain drops applied evidence with zero geometry writes", () => {
        const refs = { a: {}, b: {} };
        const state = mockPlanEnv(refs, () => true);
        const adapter = new PlanAdapter(state.env);
        assert.equal(adapter.enable({ owner: "o", generation: "g-1" }), true);
        adapter.requestResync();
        state.flushTimers();
        assert.equal(state.calls.length, 1);
        const first = JSON.parse(state.calls[0]?.payload as string) as Record<string, unknown>;
        const correlation = first["correlation_id"] as string;
        state.callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: correlation,
                outcome: "planned",
                desired_geometry: [
                    { window: "win-a", leaf: "a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 400, h: 800 } },
                    { window: "win-b", leaf: "b", output: "out-1", workspace: "ws-1", rect: { x: 400, y: 0, w: 800, h: 800 } },
                ],
            }),
        );
        assert.equal(state.geometries.length, 2);
        adapter.requestDomainRelease(
            {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 8,
                domainOuterGap: 8,
                focusedId: "win-a",
                windows: [
                    { id: "win-a", rect: { x: 0, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, floating: false, resourceClass: "test" },
                    { id: "win-b", rect: { x: 600, y: 0, w: 600, h: 800 }, output: "out-1", workspace: "ws-1", fullscreen: false, maximized: false, floating: false, resourceClass: "test" },
                ],
                fingerprint: "fp-release",
            },
            () => {},
        );
        assert.equal(state.calls.length, 2);
        const release = JSON.parse(state.calls[1]?.payload as string) as Record<string, unknown>;
        assert.deepEqual(release["command"], { op: "release-domain" });
        const releaseCorrelation = release["correlation_id"] as string;
        const before = state.geometries.length;
        state.callbacks[1]?.(
            JSON.stringify({ v: 1, correlation_id: releaseCorrelation, outcome: "released", kind: "release-domain", detail: { kind: "release-domain" } }),
        );
        assert.equal(state.geometries.length, before);
        assert.ok(state.logs.some((line) => line.includes("released")));
        adapter.disable();
    });
});

interface ToggleMocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; sequence: string; callback: () => void }>;
    readonly tiling: Array<{ scope: string; tiled: boolean; defaultTiled: boolean }>;
    readonly timers: Array<{ callback: () => void; cancelled: boolean }>;
    readonly flushTimers: () => void;
}

function startTilingEntry(world: RichWorld, tilingDefault: unknown = true, mode: unknown = "per-output-local"): { handle: ReturnType<typeof startPlanAdapterEntry>; mocks: ToggleMocks } {
    const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
    const mocks: ToggleMocks = {
        dbusCalls: [],
        callbacks: [],
        logs: [],
        shortcuts: [],
        tiling: [],
        timers,
        flushTimers: (): void => {
            for (const entry of timers.splice(0)) {
                if (!entry.cancelled) {
                    entry.callback();
                }
            }
        },
    };
    const overrides: PlanEntryOverrides = {
        workspace: world.workspace,
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
            mocks.dbusCalls.push({ method, payload });
            mocks.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            void delayMs;
            const entry = { callback, cancelled: false };
            timers.push(entry);
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
        readWorkspaceModeFn: (): unknown => mode,
        readTilingDefaultFn: (): unknown => tilingDefault,
        onWorkspaceTilingChanged: (snapshot): void => {
            mocks.tiling.push({ ...snapshot });
        },
    };
    const handle = startPlanAdapterEntry(overrides);
    return { handle, mocks };
}

function plannedReply(correlation: string, windows: string[]): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "planned",
        desired_geometry: windows.map((window) => ({
            window,
            leaf: window,
            output: "out-1",
            workspace: "ws-1",
            rect: { x: 0, y: 0, w: 600, h: 800 },
        })),
    });
}

describe("workspace toggle end to end", () => {
    it("registers the bound project-owned workspace tiling toggle action", () => {
        const world = richWorld(["ws-1"], 2);
        const { handle, mocks } = startTilingEntry(world);
        assert.ok(handle !== null);
        const toggle = mocks.shortcuts.find((row) => row.action === WORKSPACE_TILING_TOGGLE_ACTION);
        assert.ok(toggle !== undefined);
        assert.equal(toggle.sequence, "Meta+Y");
        const snapshot = handle?.getWorkspaceTilingSnapshot();
        assert.deepEqual(snapshot, { scope: "ws-1", tiled: true, defaultTiled: true });
        handle?.stop();
    });

    it("floating leaves native geometry alone and releases the domain", () => {
        const world = richWorld(["ws-1"], 2);
        const { handle, mocks } = startTilingEntry(world);
        assert.ok(handle !== null);
        const before = (world.wins[0] as Record<string, unknown>)["frameGeometry"];
        handle?.requestWorkspaceTilingToggle();
        const snapshot = handle?.getWorkspaceTilingSnapshot();
        assert.deepEqual(snapshot, { scope: "ws-1", tiled: false, defaultTiled: true });
        assert.deepEqual((world.wins[0] as Record<string, unknown>)["frameGeometry"], before);
        const releaseCall = mocks.dbusCalls.find((call) => {
            try {
                return (JSON.parse(call.payload) as Record<string, unknown>)["command"] !== undefined &&
                    ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"] === "release-domain";
            } catch (error) {
                void error;
                return false;
            }
        });
        assert.ok(releaseCall !== undefined, "toggle dispatches release-domain with the complete observation");
        assert.ok(mocks.tiling.length >= 1, "menu snapshot emission on toggle");
        handle?.stop();
    });

    it("retile reflows with a fresh reconcile after the release confirms", () => {
        const world = richWorld(["ws-1"], 2);
        const { handle, mocks } = startTilingEntry(world);
        assert.ok(handle !== null);
        handle?.requestWorkspaceTilingToggle();
        const releaseIndex = mocks.dbusCalls.findIndex((call) => {
            try {
                return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"] === "release-domain";
            } catch (error) {
                void error;
                return false;
            }
        });
        assert.ok(releaseIndex >= 0);
        const releasePayload = JSON.parse(mocks.dbusCalls[releaseIndex]?.payload as string) as Record<string, unknown>;
        mocks.callbacks[releaseIndex]?.(
            JSON.stringify({
                v: 1,
                correlation_id: releasePayload["correlation_id"],
                outcome: "released",
                kind: "release-domain",
                detail: { kind: "release-domain" },
            }),
        );
        const callsBefore = mocks.dbusCalls.length;
        handle?.requestWorkspaceTilingToggle();
        mocks.flushTimers();
        assert.deepEqual(handle?.getWorkspaceTilingSnapshot(), { scope: "ws-1", tiled: true, defaultTiled: true });
        const fresh = mocks.dbusCalls.slice(callsBefore).map((call) => {
            try {
                return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"];
            } catch (error) {
                void error;
                return null;
            }
        });
        assert.ok(fresh.includes("reconcile"), "retile issues a fresh complete reconcile, never a synthetic empty");
        const reconcileIndex = mocks.dbusCalls.findIndex(
            (call, index) => index >= callsBefore && (() => {
                try {
                    return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"] === "reconcile";
                } catch (error) {
                    void error;
                    return false;
                }
            })(),
        );
        assert.ok(reconcileIndex >= 0);
        const reconcilePayload = JSON.parse(mocks.dbusCalls[reconcileIndex]?.payload as string) as Record<string, unknown>;
        mocks.callbacks[reconcileIndex]?.(plannedReply(reconcilePayload["correlation_id"] as string, ["win-1", "win-2"]));
        handle?.stop();
    });

    it("cross-boundary sends follow by default and preserve on explicit stay", () => {
        for (const follow of [true, false] as const) {
            const world = richWorld(["ws-1", "ws-2"], 1);
            const { handle, mocks } = startTilingEntry(world, true);
            assert.ok(handle !== null);
            // Switching setter with an id readback so the native follow can
            // confirm; the default richWorld setter is a no-op.
            let current: Record<string, unknown> = world.desktops[0] as Record<string, unknown>;
            world.workspace["currentDesktopForScreen"] = (): unknown => current;
            world.workspace["setCurrentDesktopForScreen"] = (desktop: unknown): void => {
                current = desktop as Record<string, unknown>;
                world.workspace["currentDesktop"] = desktop;
            };
            // Float the target workspace, then send across the boundary.
            world.workspace["currentDesktopForScreen"] = (): unknown => world.desktops[1];
            current = world.desktops[1] as Record<string, unknown>;
            world.workspace["currentDesktop"] = world.desktops[1];
            handle?.requestWorkspaceTilingToggle();
            assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
            world.workspace["currentDesktopForScreen"] = (): unknown => current;
            current = world.desktops[0] as Record<string, unknown>;
            world.workspace["currentDesktop"] = world.desktops[0];
            const mover = world.wins[0] as Record<string, unknown>;
            mover["desktops"] = [world.desktops[0]];
            world.workspace["activeWindow"] = mover;
            // Restore the switching reader after the toggle setup above.
            world.workspace["currentDesktopForScreen"] = (): unknown => current;
            handle?.requestWorkspaceMove(2, follow);
            const membership = mover["desktops"] as unknown[];
            assert.equal(membership.length, 1);
            assert.equal((membership[0] as Record<string, unknown>)["id"], "ws-2");
            assert.ok(
                !mocks.dbusCalls.some((call) => {
                    try {
                        const command = (JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>;
                        return command["op"] === "send-to-workspace";
                    } catch (error) {
                        void error;
                        return false;
                    }
                }),
                "no Rust two-domain tiling plan crosses a floating boundary",
            );
            if (follow) {
                assert.equal(world.workspace["activeWindow"], mover, "follow focuses the mover");
                assert.equal(
                    (world.workspace["currentDesktop"] as Record<string, unknown>)["id"],
                    "ws-2",
                    "follow switches to the target",
                );
            } else {
                assert.equal(world.workspace["activeWindow"], mover, "stay keeps native focus");
                assert.equal(
                    (world.workspace["currentDesktop"] as Record<string, unknown>)["id"],
                    "ws-1",
                    "stay preserves the source view",
                );
            }
            // Behavior, not call shape: the outcome reports the actual native
            // write (moved), never a generic native-only before the write.
            assert.ok(
                mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-moved")),
                "successful native write reports native-moved",
            );
            assert.ok(
                mocks.logs.some(
                    (line) =>
                        line.includes("event=workspace-move") &&
                        line.includes("outcome=native-moved") &&
                        line.includes(follow ? "follow=followed" : "follow=stayed"),
                ),
                `floating ${follow ? "follow" : "stay"} reports its token`,
            );
            assert.ok(
                !mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-only")),
                "no generic native-only outcome is logged",
            );
            handle?.stop();
        }
    });

    it("failed native writes report native-failed and preserve focus and visibility", () => {
        const world = richWorld(["ws-1", "ws-2"], 1);
        const { handle, mocks } = startTilingEntry(world, true);
        assert.ok(handle !== null);
        world.workspace["currentDesktopForScreen"] = (): unknown => world.desktops[1];
        world.workspace["currentDesktop"] = world.desktops[1];
        handle?.requestWorkspaceTilingToggle();
        world.workspace["currentDesktopForScreen"] = (): unknown => world.desktops[0];
        world.workspace["currentDesktop"] = world.desktops[0];
        // Mover without a desktopsChanged signal: the native write cannot
        // apply, so the outcome must report failure.
        const brokenMover: Record<string, unknown> = { normalWindow: true, internalId: "broken" };
        world.workspace["activeWindow"] = brokenMover;
        handle?.requestWorkspaceMove(2);
        assert.equal(world.workspace["activeWindow"], brokenMover, "native focus preserved on failure");
        assert.equal(world.workspace["currentDesktop"], world.desktops[0], "native visibility preserved on failure");
        assert.ok(
            mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-failed")),
            "failed native write reports native-failed",
        );
        assert.ok(
            mocks.logs.some((line) => line.includes("workspace-send-native-failed")),
            "failed native write keeps the failure detail line",
        );
        assert.ok(
            !mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-only")),
            "no generic native-only outcome is logged on failure",
        );
        handle?.stop();
    });

    it("retile waits for release confirmation instead of tiling stale topology", () => {
        const world = richWorld(["ws-1"], 2);
        const { handle, mocks } = startTilingEntry(world);
        assert.ok(handle !== null);
        handle?.requestWorkspaceTilingToggle();
        assert.deepEqual(handle?.getWorkspaceTilingSnapshot(), { scope: "ws-1", tiled: false, defaultTiled: true });
        const releaseIndex = mocks.dbusCalls.findIndex((call) => {
            try {
                return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"] === "release-domain";
            } catch (error) {
                void error;
                return false;
            }
        });
        assert.ok(releaseIndex >= 0);
        const callsBeforeRetile = mocks.dbusCalls.length;
        // Retile intent before the release confirms: must stay floating with
        // no fresh reconcile, so no stale Planner topology can apply.
        handle?.requestWorkspaceTilingToggle();
        assert.deepEqual(
            handle?.getWorkspaceTilingSnapshot(),
            { scope: "ws-1", tiled: false, defaultTiled: true },
            "retile stays floating until the exact domain release confirms",
        );
        const interimOps = mocks.dbusCalls.slice(callsBeforeRetile).map((call) => {
            try {
                return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"];
            } catch (error) {
                void error;
                return null;
            }
        });
        assert.ok(!interimOps.includes("reconcile"), "no stale reconcile before release confirmation");
        assert.ok(
            mocks.logs.some((line) => line.includes("awaiting-release=") && line.includes("pending-retile=true")),
            "retile logs the awaiting release",
        );
        // Confirm the exact domain release: now the workspace tiles and a
        // fresh complete reconcile re-adopts current geometry.
        const releasePayload = JSON.parse(mocks.dbusCalls[releaseIndex]?.payload as string) as Record<string, unknown>;
        const callsBeforeConfirm = mocks.dbusCalls.length;
        mocks.callbacks[releaseIndex]?.(
            JSON.stringify({
                v: 1,
                correlation_id: releasePayload["correlation_id"],
                outcome: "released",
                kind: "release-domain",
                detail: { kind: "release-domain" },
            }),
        );
        assert.deepEqual(handle?.getWorkspaceTilingSnapshot(), { scope: "ws-1", tiled: true, defaultTiled: true });
        mocks.flushTimers();
        const afterOps = mocks.dbusCalls.slice(callsBeforeConfirm).map((call) => {
            try {
                return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"];
            } catch (error) {
                void error;
                return null;
            }
        });
        assert.ok(afterOps.includes("reconcile"), "confirmed retile issues a fresh reconcile");
        handle?.stop();
    });

    it("transient release failure keeps floating and retries on a later event", () => {
        const world = richWorld(["ws-1"], 2);
        const { handle, mocks } = startTilingEntry(world);
        assert.ok(handle !== null);
        handle?.requestWorkspaceTilingToggle();
        const releaseIndex = mocks.dbusCalls.findIndex((call) => {
            try {
                return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"] === "release-domain";
            } catch (error) {
                void error;
                return false;
            }
        });
        assert.ok(releaseIndex >= 0);
        handle?.requestWorkspaceTilingToggle();
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
        const releasePayload = JSON.parse(mocks.dbusCalls[releaseIndex]?.payload as string) as Record<string, unknown>;
        // Transient failure: the workspace must stay floating with no
        // reconcile of the old topology.
        mocks.callbacks[releaseIndex]?.(
            JSON.stringify({
                v: 1,
                correlation_id: releasePayload["correlation_id"],
                outcome: "rejected",
                kind: "stale",
                message: "stale",
            }),
        );
        mocks.flushTimers();
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false, "failed release never marks tiled old topology");
        const callsBeforeFlush = mocks.dbusCalls.length;
        mocks.flushTimers();
        const opsAfterFailure = mocks.dbusCalls.map((call) => {
            try {
                return ((JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"];
            } catch (error) {
                void error;
                return null;
            }
        });
        assert.ok(!opsAfterFailure.slice(callsBeforeFlush).includes("reconcile"));
        const callsAfterFailure = mocks.dbusCalls.length;
        assert.ok(
            mocks.logs.some((line) => line.includes("workspace-released") && line.includes("recovery=retry-on-event")),
            "transient failure logs retry recovery",
        );
        // A later normal retile retries the release instead of tiling stale.
        handle?.requestWorkspaceTilingToggle();
        handle?.requestWorkspaceTilingToggle();
        assert.ok(
            mocks.dbusCalls.length > callsAfterFailure,
            "later retile retries the unconfirmed release",
        );
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
        handle?.stop();
    });

    it("menu snapshot carries scope, tiled, and default with schema v2", () => {
        assert.equal(TRAY_SCHEMA, 2);
        const snapshots: Array<{ schema: number; scope: string; tiled: boolean; def: boolean }> = [];
        let scope = "ws-1";
        let tiled = false;
        const publisher = new TrayPublisher({
            isEnabled: () => true,
            getScope: () => scope,
            isTiled: () => tiled,
            getDefaultTiled: () => true,
            publishSnapshot: (schema, _generation, _revision, _enabled, currentScope, currentTiled, currentDefault): void => {
                snapshots.push({ schema, scope: currentScope, tiled: currentTiled, def: currentDefault });
            },
            scheduleOnce: (): (() => void) => (): void => {},
            createGeneration: () => "menu-scope",
        });
        publisher.start();
        assert.deepEqual(snapshots[0], { schema: 2, scope: "ws-1", tiled: false, def: true });
        scope = "";
        tiled = true;
        publisher.notifyWorkspaceChanged();
        assert.deepEqual(snapshots[snapshots.length - 1], { schema: 2, scope: "", tiled: true, def: true });
        publisher.dispose();
    });
});

function releaseCallIndices(mocks: ToggleMocks): number[] {
    const out: number[] = [];
    mocks.dbusCalls.forEach((call, index) => {
        try {
            const command = (JSON.parse(call.payload) as Record<string, unknown>)["command"] as Record<string, unknown>;
            if (command["op"] === "release-domain") {
                out.push(index);
            }
        } catch (error) {
            void error;
        }
    });
    return out;
}

function releaseDomainOf(mocks: ToggleMocks, index: number): { output: string; workspace: string } {
    const body = JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
    const domain = body["domain"] as Record<string, unknown>;
    return { output: domain["output"] as string, workspace: domain["workspace"] as string };
}

function callOpOf(mocks: ToggleMocks, index: number): string | null {
    try {
        return ((JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>)["command"] as Record<string, unknown>)["op"] as string;
    } catch (error) {
        void error;
        return null;
    }
}

function failReleaseAt(mocks: ToggleMocks, index: number, replied: Set<number>): void {
    const payload = JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
    replied.add(index);
    mocks.callbacks[index]?.(
        JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "rejected", kind: "stale", message: "stale" }),
    );
}

function confirmReleaseAt(mocks: ToggleMocks, index: number, replied: Set<number>): void {
    const payload = JSON.parse(mocks.dbusCalls[index]?.payload as string) as Record<string, unknown>;
    replied.add(index);
    mocks.callbacks[index]?.(
        JSON.stringify({
            v: 1,
            correlation_id: payload["correlation_id"],
            outcome: "released",
            kind: "release-domain",
            detail: { kind: "release-domain" },
        }),
    );
}

function unrepliedReleases(mocks: ToggleMocks, replied: Set<number>): number[] {
    return releaseCallIndices(mocks).filter((index) => !replied.has(index));
}

function switchCurrentTo(world: RichWorld, index: number): void {
    world.workspace["currentDesktopForScreen"] = (): unknown => world.desktops[index];
    world.workspace["currentDesktop"] = world.desktops[index];
}

describe("pending retile retry reaches original domains", () => {
    it("retries the hidden original domain after the active workspace switches", () => {
        const world = richWorld(["ws-1", "ws-2"], 2);
        const { handle, mocks } = startTilingEntry(world);
        assert.ok(handle !== null);
        const replied = new Set<number>();
        handle?.requestWorkspaceTilingToggle();
        assert.equal(unrepliedReleases(mocks, replied).length, 1);
        failReleaseAt(mocks, unrepliedReleases(mocks, replied)[0] as number, replied);
        handle?.requestWorkspaceTilingToggle();
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
        assert.equal(unrepliedReleases(mocks, replied).length, 1);
        failReleaseAt(mocks, unrepliedReleases(mocks, replied)[0] as number, replied);
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
        // Another workspace becomes active: the pending domain is now hidden.
        switchCurrentTo(world, 1);
        const before = mocks.dbusCalls.length;
        world.fire("currentDesktopChanged");
        const fresh = mocks.dbusCalls.length - before;
        assert.equal(fresh, 1, "retry dispatches exactly the pending original domain");
        assert.deepEqual(releaseDomainOf(mocks, before), { output: "out-1", workspace: "ws-1" });
        assert.ok(
            !mocks.dbusCalls.slice(before).some((_, offset) => callOpOf(mocks, before + offset) === "reconcile"),
            "retry carries no stale reconcile",
        );
        // Confirming the retried release completes the retile with a fresh reconcile.
        confirmReleaseAt(mocks, before, replied);
        assert.deepEqual(handle?.getWorkspaceTilingSnapshot(), { scope: "ws-2", tiled: true, defaultTiled: true });
        mocks.flushTimers();
        assert.ok(
            mocks.dbusCalls.slice(before + 1).some((_, offset) => callOpOf(mocks, before + 1 + offset) === "reconcile"),
            "confirmed retile issues a fresh reconcile",
        );
        handle?.stop();
    });

    it("shared retry spans every output of the originally selected workspace", () => {
        const world = sharedTwoOutputWorld();
        const { handle, mocks } = startTilingEntry(world, true, "shared");
        assert.ok(handle !== null);
        const replied = new Set<number>();
        handle?.requestWorkspaceTilingToggle();
        // Serial single-flight: the second output domain queues until the
        // first settles, so fail each head release to drain both.
        assert.equal(unrepliedReleases(mocks, replied).length, 1);
        failReleaseAt(mocks, unrepliedReleases(mocks, replied)[0] as number, replied);
        assert.equal(unrepliedReleases(mocks, replied).length, 1);
        failReleaseAt(mocks, unrepliedReleases(mocks, replied)[0] as number, replied);
        handle?.requestWorkspaceTilingToggle();
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
        assert.equal(unrepliedReleases(mocks, replied).length, 1);
        failReleaseAt(mocks, unrepliedReleases(mocks, replied)[0] as number, replied);
        assert.equal(unrepliedReleases(mocks, replied).length, 1);
        failReleaseAt(mocks, unrepliedReleases(mocks, replied)[0] as number, replied);
        switchCurrentTo(world, 1);
        const before = mocks.dbusCalls.length;
        world.fire("currentDesktopChanged");
        // Serial single-flight: the first original domain dispatches now, the
        // second follows once the first settles.
        assert.equal(mocks.dbusCalls.length - before, 1);
        assert.equal(releaseDomainOf(mocks, before).workspace, "ws-1");
        confirmReleaseAt(mocks, before, replied);
        const second = mocks.dbusCalls.length - 1;
        assert.equal(callOpOf(mocks, second), "release-domain");
        assert.equal(releaseDomainOf(mocks, second).workspace, "ws-1");
        const outputs = new Set([releaseDomainOf(mocks, before).output, releaseDomainOf(mocks, second).output]);
        assert.deepEqual([...outputs].sort(), ["out-1", "out-2"]);
        confirmReleaseAt(mocks, second, replied);
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, true);
        mocks.flushTimers();
        assert.ok(
            mocks.dbusCalls.slice(second + 1).some((_, offset) => callOpOf(mocks, second + 1 + offset) === "reconcile"),
            "confirmed shared retile issues a fresh reconcile",
        );
        handle?.stop();
    });
});

function sharedTwoOutputWorld(): RichWorld {
    const out1: Record<string, unknown> = { name: "out-1", manufacturer: "m", model: "d", serialNumber: "s1" };
    const out2: Record<string, unknown> = { name: "out-2", manufacturer: "m", model: "d", serialNumber: "s2" };
    const desktops: Record<string, unknown>[] = [{ id: "ws-1" }, { id: "ws-2" }];
    const wins: Record<string, unknown>[] = [];
    const placements: Array<{ output: Record<string, unknown>; x: number }> = [
        { output: out1, x: 0 },
        { output: out2, x: 0 },
    ];
    placements.forEach((placement, index) => {
        wins.push({
            normalWindow: true,
            internalId: `shared-win-${String(index + 1)}`,
            resourceClass: "test-app",
            output: placement.output,
            desktops: [desktops[0]],
            frameGeometry: { x: placement.x, y: 0, width: 600, height: 800 },
            frameGeometryChanged: fakeSignal().signal,
            moveResizedChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: fakeSignal().signal,
            maximizeMode: 0,
            desktopsChanged: fakeSignal().signal,
            onAllDesktops: false,
            keepAbove: false,
            keepBelow: false,
            setMaximize: (): void => {},
        });
    });
    const added = fakeSignal();
    const removed = fakeSignal();
    const activated = fakeSignal();
    const screensChanged = fakeSignal();
    const desktopChanged = fakeSignal();
    const fired: Record<string, Array<() => void>> = {
        windowAdded: added.handlers,
        windowRemoved: removed.handlers,
        windowActivated: activated.handlers,
        screensChanged: screensChanged.handlers,
        currentDesktopChanged: desktopChanged.handlers,
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins[0] ?? null,
        activeScreen: out1,
        windowList: (): unknown[] => [...wins],
        screens: [out1, out2],
        desktops,
        currentDesktop: desktops[0],
        currentDesktopForScreen: (): unknown => desktops[0],
        setCurrentDesktopForScreen: (): void => {},
        clientArea: (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowAdded: added.signal,
        windowRemoved: removed.signal,
        windowActivated: activated.signal,
        screensChanged: screensChanged.signal,
        currentDesktopChanged: desktopChanged.signal,
        createDesktop: (_position: unknown, _name: unknown): void => {
            const fresh = { id: `ws-new-${String(desktops.length + 1)}` };
            desktops.push(fresh);
            workspace["desktops"] = desktops;
        },
        removeDesktop: (): void => {},
    };
    return {
        workspace,
        output: out1,
        desktops,
        wins,
        logs: [],
        fire: (name: string): void => {
            for (const handler of fired[name] ?? []) {
                handler();
            }
        },
    };
}

describe("native-only cross-boundary membership", () => {
    function floatingTargetSetup(): { world: RichWorld; handle: NonNullable<ReturnType<typeof startPlanAdapterEntry>>; mocks: ToggleMocks } {
        const world = richWorld(["ws-1", "ws-2"], 1);
        const { handle, mocks } = startTilingEntry(world, true);
        assert.ok(handle !== null);
        switchCurrentTo(world, 1);
        handle?.requestWorkspaceTilingToggle();
        assert.equal(handle?.getWorkspaceTilingSnapshot().tiled, false);
        switchCurrentTo(world, 0);
        return { world, handle: handle as NonNullable<ReturnType<typeof startPlanAdapterEntry>>, mocks };
    }

    it("refuses sticky movers without stripping onAllDesktops membership", () => {
        const { world, handle, mocks } = floatingTargetSetup();
        const mover = world.wins[0] as Record<string, unknown>;
        mover["onAllDesktops"] = true;
        mover["desktops"] = [world.desktops[0]];
        world.workspace["activeWindow"] = mover;
        const callsBefore = mocks.dbusCalls.length;
        handle.requestWorkspaceMove(2);
        assert.equal((mover["desktops"] as unknown[]).length, 1);
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.ok(
            mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-refused") && line.includes("reason=sticky")),
            "sticky refusal is logged without a membership write",
        );
        assert.ok(
            !mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-moved")),
            "no native-moved claim on refusal",
        );
        assert.equal(world.workspace["activeWindow"], mover);
        assert.equal(world.workspace["currentDesktop"], world.desktops[0]);
        handle.stop();
    });

    it("refuses multi-home movers without stripping membership", () => {
        const { world, handle, mocks } = floatingTargetSetup();
        const mover = world.wins[0] as Record<string, unknown>;
        mover["onAllDesktops"] = false;
        mover["desktops"] = [world.desktops[0], world.desktops[1]];
        world.workspace["activeWindow"] = mover;
        handle.requestWorkspaceMove(2);
        assert.equal((mover["desktops"] as unknown[]).length, 2);
        assert.ok(
            mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-refused") && line.includes("reason=multi-home")),
            "multi-home refusal is logged without a membership write",
        );
        assert.ok(
            !mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-moved")),
            "no native-moved claim on refusal",
        );
        handle.stop();
    });

    it("reports native-failed when the desktop write does not read back", () => {
        const { world, handle, mocks } = floatingTargetSetup();
        const mover = world.wins[0] as Record<string, unknown>;
        mover["onAllDesktops"] = false;
        const backing: unknown[] = [world.desktops[0]];
        Object.defineProperty(mover, "desktops", {
            configurable: true,
            enumerable: true,
            get: (): unknown[] => backing,
            set: (): void => {},
        });
        world.workspace["activeWindow"] = mover;
        handle.requestWorkspaceMove(2);
        assert.ok(
            mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-failed")),
            "ignored write reports native-failed",
        );
        assert.ok(
            !mocks.logs.some((line) => line.includes("event=workspace-move") && line.includes("outcome=native-moved")),
            "no native-moved claim without readback proof",
        );
        assert.equal(world.workspace["activeWindow"], mover);
        assert.equal(world.workspace["currentDesktop"], world.desktops[0]);
        handle.stop();
    });
});
