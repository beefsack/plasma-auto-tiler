import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { startPlanAdapterEntry, type PlanEntryOverrides } from "../src/plan-adapter-entry";

// Q2 fixed-size admission through the real production entry: real
// observeNative/observeHiddenDomains classification, real workspace
// floating enable/disable with confirmed release and markTiledAndResync
// retile, and the real Planner over the stubbed D-Bus seam. No fabricated
// replies: every dispatch flushes to planner_eval and every assertion
// inspects the applied native state plus the accepted terminal.

interface FakeSignal {
    handlers: Array<() => void>;
    signal: { connect: (handler: () => void) => void; disconnect: (handler: () => void) => void };
}

function fakeSignal(): FakeSignal {
    const handlers: Array<() => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: () => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: () => void): void => {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
            },
        },
    };
}

interface FakeWorld {
    readonly workspace: Record<string, unknown>;
    wins: Array<Record<string, unknown>>;
    readonly output: Record<string, unknown>;
    readonly desktop: Record<string, unknown>;
    readonly desktop2: Record<string, unknown>;
    readonly added: FakeSignal;
    readonly winMax: Map<object, FakeSignal>;
    readonly winGeometry: Map<object, FakeSignal>;
    readonly maximizeClears: object[];
}

function fakeWorld(): FakeWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const desktop2: Record<string, unknown> = { id: "ws-2" };
    const added = fakeSignal();
    const removed = fakeSignal();
    const activated = fakeSignal();
    const screensChanged = fakeSignal();
    const desktopChanged = fakeSignal();
    const winMax = new Map<object, FakeSignal>();
    const winGeometry = new Map<object, FakeSignal>();
    const world: FakeWorld = {
        output,
        desktop,
        desktop2,
        added,
        winMax,
        winGeometry,
        maximizeClears: [],
        wins: [],
        workspace: {},
    };
    const makeWin = (
        id: string,
        x: number,
        home: object,
        fixed: boolean,
    ): Record<string, unknown> => {
        const geo = fakeSignal();
        const max = fakeSignal();
        const desktopsChanged = fakeSignal();
        const win: Record<string, unknown> = {
            normalWindow: true,
            internalId: id,
            resourceClass: id === "win-b" ? "game-app" : "test-app",
            output,
            desktops: [home],
            frameGeometry: { x, y: 0, width: 600, height: 800 },
            frameGeometryChanged: geo.signal,
            fullScreenChanged: fakeSignal().signal,
            fullScreen: false,
            maximizedChanged: max.signal,
            maximizeMode: 0,
            desktopsChanged: desktopsChanged.signal,
            onAllDesktops: false,
            keepAbove: false,
            keepBelow: false,
        };
        if (fixed) {
            win["resizeable"] = false;
            win["minSize"] = { width: 640, height: 480 };
            win["maxSize"] = { width: 640, height: 480 };
        }
        win["setMaximize"] = (vertically: unknown, horizontally: unknown): void => {
            if (vertically !== false || horizontally !== false) {
                return;
            }
            world.maximizeClears.push(win);
            win["maximizeMode"] = 0;
            for (const handler of max.handlers) {
                handler();
            }
        };
        winMax.set(win, max);
        winGeometry.set(win, geo);
        return win;
    };
    const winA = makeWin("win-a", 0, desktop, false);
    const winB = makeWin("win-b", 600, desktop, true);
    const winC = makeWin("win-c", 0, desktop2, true);
    world.wins = [winA, winB, winC];
    world.workspace["activeWindow"] = winA;
    world.workspace["windowList"] = (): unknown[] => [...world.wins];
    world.workspace["screens"] = [output];
    world.workspace["desktops"] = [desktop, desktop2];
    world.workspace["currentDesktopForScreen"] = (): unknown => desktop;
    world.workspace["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    world.workspace["windowAdded"] = added.signal;
    world.workspace["windowRemoved"] = removed.signal;
    world.workspace["windowActivated"] = activated.signal;
    world.workspace["screensChanged"] = screensChanged.signal;
    world.workspace["currentDesktopChanged"] = desktopChanged.signal;
    return world;
}

interface EntryMocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; sequence: string; callback: () => void }>;
}

function startEntry(
    world: FakeWorld,
    overrides: PlanEntryOverrides = {},
): { handle: ReturnType<typeof startPlanAdapterEntry>; mocks: EntryMocks } {
    const mocks: EntryMocks = { dbusCalls: [], callbacks: [], timers: [], logs: [], shortcuts: [] };
    const handle = startPlanAdapterEntry({
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
        ...overrides,
    });
    return { handle, mocks };
}

function repoRoot(): string {
    let dir = resolve(process.cwd());
    for (let depth = 0; depth < 4; depth += 1) {
        if (existsSync(join(dir, "Cargo.toml"))) {
            return dir;
        }
        dir = dirname(dir);
    }
    throw new Error("fixture root not found");
}

class EngineBridge {
    private readonly proc: ChildProcess;
    private readonly waiters: Array<{
        resolve: (reply: string) => void;
        reject: (error: Error) => void;
    }> = [];
    private dead: string | null = null;

    private constructor(proc: ChildProcess) {
        this.proc = proc;
        const stdout = proc.stdout;
        if (stdout === null || stdout === undefined) {
            throw new Error("planner_eval stdout unavailable");
        }
        createInterface({ input: stdout }).on("line", (line: string) => {
            this.waiters.shift()?.resolve(line);
        });
        proc.stderr?.resume();
        proc.on("error", (error) => {
            this.failAll(error instanceof Error ? error : new Error(String(error)));
        });
        proc.on("exit", (code) => {
            this.failAll(new Error(`planner_eval exited with code ${String(code)}`));
        });
    }

    private failAll(error: Error): void {
        if (this.dead === null) {
            this.dead = error.message;
        }
        while (this.waiters.length > 0) {
            this.waiters.shift()?.reject(error);
        }
    }

    private deathReason(): string | null {
        if (this.dead !== null) {
            return this.dead;
        }
        if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
            return "planner_eval process already exited";
        }
        return null;
    }

    static start(): EngineBridge {
        return new EngineBridge(
            spawn("cargo", ["run", "--offline", "-q", "-p", "tiler-protocol", "--example", "planner_eval"], {
                cwd: repoRoot(),
                stdio: ["pipe", "pipe", "pipe"],
            }),
        );
    }

    send(request: string): Promise<string> {
        const dead = this.deathReason();
        if (dead !== null) {
            return Promise.reject(new Error(dead));
        }
        return new Promise<string>((resolve, reject) => {
            this.waiters.push({ resolve, reject });
            try {
                this.proc.stdin?.write(request + "\n");
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    async close(): Promise<void> {
        try {
            this.proc.stdin?.end();
        } catch (error) {
            void error;
        }
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                try {
                    this.proc.kill("SIGKILL");
                } catch (error) {
                    void error;
                }
                resolve();
            }, 3000);
            this.proc.on("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
}

function runEntryDebounce(mocks: EntryMocks): void {
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
}

function fireAdded(world: FakeWorld): void {
    for (const handler of [...world.added.handlers]) {
        handler();
    }
}

function payloadAt(mocks: EntryMocks, index: number): Record<string, unknown> {
    const call = mocks.dbusCalls[index];
    assert.ok(call !== undefined, `dispatch ${index} exists`);
    return JSON.parse(call.payload) as Record<string, unknown>;
}

async function flushAt(mocks: EntryMocks, engine: EngineBridge, index: number): Promise<Record<string, unknown>> {
    const call = mocks.dbusCalls[index];
    assert.ok(call !== undefined, `dispatch ${index} exists before flushing to the real Engine`);
    const replyText = await engine.send(call.payload);
    mocks.callbacks[index]?.(replyText);
    return JSON.parse(replyText) as Record<string, unknown>;
}

// Flush every outstanding dispatch in order, including completion-chain
// follow-ups (hidden admission after a foreground apply). Bounded: the
// chain settles once all domains converge.
async function drainOutstanding(
    mocks: EntryMocks,
    engine: EngineBridge,
    flushed: { count: number },
): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        if (flushed.count >= mocks.dbusCalls.length) {
            return;
        }
        const reply = await flushAt(mocks, engine, flushed.count);
        flushed.count += 1;
        assert.ok(
            reply["outcome"] === "planned" || reply["outcome"] === "released",
            `chain reply settles, got ${JSON.stringify(reply)}`,
        );
    }
    assert.ok(flushed.count >= mocks.dbusCalls.length, "completion chain settles");
}

function wireWindows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    return payload["windows"] as Array<Record<string, unknown>>;
}

function wireOf(payload: Record<string, unknown>, id: string): Record<string, unknown> {
    const found = wireWindows(payload).find((entry) => entry["window"] === id);
    assert.ok(found !== undefined, `wire carries ${id} in ${JSON.stringify(payload["windows"])}`);
    return found;
}

function domainOf(payload: Record<string, unknown>): Record<string, unknown> {
    return payload["domain"] as Record<string, unknown>;
}

function toggleWorkspaceTiling(mocks: EntryMocks): void {
    const toggle = mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-toggle-workspace-tiling");
    assert.ok(toggle !== undefined, "workspace tiling toggle registered");
    toggle.callback();
}

function frameOf(win: Record<string, unknown>): { x: number; y: number; w: number; h: number } {
    const frame = win["frameGeometry"] as { x: number; y: number; width: number; height: number };
    return { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
}

describe("fixed-size workspace entry through the real Planner", () => {
    it("startup classifies foreground and hidden fixed clients, enable keeps foreground floating", async () => {
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            // Startup admission through the production observer path.
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            const first = payloadAt(mocks, mocks.dbusCalls.length - 1);
            assert.equal(domainOf(first)["workspace"], "ws-1", "foreground dispatches first");
            const fixed = wireOf(first, "win-b");
            assert.equal(fixed["floating"], true, "foreground fixed floats");
            assert.equal(fixed["fixed_auto"], true, "foreground fixed carries origin");
            assert.deepEqual(fixed["min_size"], { w: 640, h: 480 });
            const admitIndex = mocks.dbusCalls.length - 1;
            const admitReply = await flushAt(mocks, engine, admitIndex);
            assert.equal(admitReply["outcome"], "planned", `admit plans, got ${JSON.stringify(admitReply)}`);
            const siblingSlot = (admitReply["desired_geometry"] as Array<Record<string, unknown>>).find(
                (entry) => entry["window"] === "win-a",
            );
            assert.ok(siblingSlot !== undefined, "tiled sibling keeps a slot");
            assert.deepEqual(
                frameOf(world.wins[0] as Record<string, unknown>),
                siblingSlot["rect"] as { x: number; y: number; w: number; h: number },
                "sibling applied in its planned slot",
            );
            // Drain from the admit index onward: the completion chain may
            // have appended the hidden dispatch synchronously inside the
            // admit flush above.
            flushed.count = admitIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            // The hidden domain converges through the completion chain
            // with its own automatic classification.
            const hiddenPayload = mocks.dbusCalls
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .find((payload) => domainOf(payload)["workspace"] === "ws-2");
            assert.ok(hiddenPayload !== undefined, "hidden domain dispatches");
            assert.equal(wireOf(hiddenPayload, "win-c")["floating"], true, "hidden fixed floats");
            assert.equal(wireOf(hiddenPayload, "win-c")["fixed_auto"], true, "hidden fixed carries origin");
            const winB = world.wins[1] as Record<string, unknown>;
            assert.deepEqual(
                winB["frameGeometry"],
                { x: 600, y: 0, width: 600, height: 800 },
                "automatic float never moves natively",
            );
            // Disable tiling: the domain releases with confirmation. The
            // reply flushes before the topology-signal debounce runs, so
            // the release epoch still matches at the reply boundary.
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            const releaseReply = await flushAt(mocks, engine, releaseIndex);
            assert.equal(releaseReply["outcome"], "released", `release confirms, got ${JSON.stringify(releaseReply)}`);
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            assert.ok(
                mocks.logs.some((line) => line.includes("workspace-floating") && line.includes("tiled=false")),
                "disable logs floating",
            );
            assert.ok(
                mocks.logs.some((line) => line.includes("workspace-released") && line.includes("outcome=released")),
                "release confirms",
            );
            // Re-enable: the entry resyncs the re-tiled domain and the
            // classifier keeps the automatic floating (D6), while the
            // hidden automatic keeps its membership.
            const beforeEnable = mocks.dbusCalls.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            assert.ok(
                mocks.logs.some((line) => line.includes("workspace-floating") && line.includes("tiled=true")),
                "enable logs tiled",
            );
            await drainOutstanding(mocks, engine, flushed);
            assert.ok(mocks.dbusCalls.length > beforeEnable, "enable resync dispatches");
            const retiled = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(retiled !== undefined, "foreground resync dispatches after enable");
            assert.equal(wireOf(retiled, "win-b")["floating"], true, "enabled domain keeps the automatic floating");
            assert.equal(wireOf(retiled, "win-b")["fixed_auto"], true);
            const hiddenAfter = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-2")
                .pop();
            if (hiddenAfter !== undefined) {
                assert.equal(
                    wireOf(hiddenAfter, "win-c")["floating"],
                    true,
                    "hidden automatic keeps membership across foreign enable",
                );
                assert.equal(wireOf(hiddenAfter, "win-c")["fixed_auto"], true);
            }
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("maximized fixed rides release and enable slotless with no writes", async () => {
        const world = fakeWorld();
        const winB = world.wins[1] as Record<string, unknown>;
        winB["maximizeMode"] = 3;
        winB["frameGeometry"] = { x: 0, y: 0, width: 1200, height: 800 };
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            // Born maximized: the fixed client floats beneath its native
            // overlay with origin and no reserved tile yet.
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "admission dispatches");
            const admit = payloadAt(mocks, mocks.dbusCalls.length - 1);
            assert.equal(wireOf(admit, "win-b")["floating"], true, "maximized fixed floats");
            assert.equal(wireOf(admit, "win-b")["fixed_auto"], true);
            const maxAdmitIndex = mocks.dbusCalls.length - 1;
            await flushAt(mocks, engine, maxAdmitIndex);
            flushed.count = maxAdmitIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            assert.deepEqual(world.maximizeClears, [], "admission never clears native maximize");
            assert.deepEqual(
                winB["frameGeometry"],
                { x: 0, y: 0, width: 1200, height: 800 },
                "overlay frame untouched",
            );
            // Disable and re-enable tiling while still maximized: D6
            // keeps the fixed client floating untouched with no clear
            // and no target write.
            toggleWorkspaceTiling(mocks);
            const maxReleaseIndex = mocks.dbusCalls.length - 1;
            const maxReleaseReply = await flushAt(mocks, engine, maxReleaseIndex);
            assert.equal(maxReleaseReply["outcome"], "released");
            runEntryDebounce(mocks);
            flushed.count = maxReleaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            assert.ok(
                mocks.logs.some((line) => line.includes("workspace-released") && line.includes("outcome=released")),
                "release confirms while maximized",
            );
            const writesBeforeEnable = JSON.stringify(winB["frameGeometry"]);
            const clearsBeforeEnable = world.maximizeClears.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            const resyncIndex = mocks.dbusCalls.length - 1;
            const resync = payloadAt(mocks, resyncIndex);
            assert.equal(domainOf(resync)["workspace"], "ws-1", "resync targets the enabled domain");
            assert.equal(wireOf(resync, "win-b")["floating"], true, "enable keeps fixed floating");
            assert.equal(wireOf(resync, "win-b")["fixed_auto"], true);
            const resyncReply = await flushAt(mocks, engine, resyncIndex);
            assert.equal(resyncReply["outcome"], "planned", `resync plans, got ${JSON.stringify(resyncReply)}`);
            assert.ok(
                !(resyncReply["desired_geometry"] as Array<Record<string, unknown>>).some(
                    (entry) => entry["window"] === "win-b",
                ),
                "kept float reserves no slot under the overlay",
            );
            flushed.count = resyncIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            assert.equal(
                world.maximizeClears.length,
                clearsBeforeEnable,
                "enable never clears native maximize",
            );
            assert.equal(JSON.stringify(winB["frameGeometry"]), writesBeforeEnable, "no target write under overlay");
            // Native unmaximize keeps the fixed client floating: capture
            // the pre-signal frame and clear count, then assert the real
            // invariants after the drain.
            const preUnmaxFrame = JSON.stringify(frameOf(winB));
            const preUnmaxClears = world.maximizeClears.length;
            const callsBeforeUnmax = mocks.dbusCalls.length;
            winB["maximizeMode"] = 0;
            for (const handler of [...(world.winMax.get(winB)?.handlers ?? [])]) {
                handler();
            }
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            assert.equal(
                JSON.stringify(frameOf(winB)),
                preUnmaxFrame,
                "overlay frame still untouched",
            );
            assert.equal(world.maximizeClears.length, preUnmaxClears, "no clear around native unmaximize");
            const unmaxPayloads = mocks.dbusCalls
                .slice(callsBeforeUnmax)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1");
            const lastUnmax = unmaxPayloads.pop();
            if (lastUnmax !== undefined) {
                assert.equal(wireOf(lastUnmax, "win-b")["floating"], true, "unmaximized fixed stays floating");
                assert.equal(wireOf(lastUnmax, "win-b")["fixed_auto"], true);
            }
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("pinned transfer rechecks on enable after release drops core state", async () => {
        // B1 disproof: win-b tiles ordinary (pinned), turns fixed (wire
        // suppress), and natively moves to ws-2, where the fresh core
        // admission tiles it with an override. Disable releases ws-2
        // (Engine state including the override is discarded); enable
        // then floats win-b untouched. A persisting override would tile.
        // (ws-2 starts empty so the mixed hidden focus edge stays out of
        // this row; hidden focus routing is covered by the Send suites.)
        const world = fakeWorld();
        world.wins = world.wins.slice(0, 2);
        const winB = world.wins[1] as Record<string, unknown>;
        winB["resizeable"] = true;
        winB["minSize"] = null;
        winB["maxSize"] = null;
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            flushed.count = 0;
            await drainOutstanding(mocks, engine, flushed);
            const admitted = mocks.dbusCalls
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(admitted !== undefined, "foreground admits");
            assert.ok(!("floating" in wireOf(admitted, "win-b")), "plain client tiles at startup");
            // Fixed hints arrive, then a native desktop move carries the
            // pinned client to ws-2 with suppress on the wire.
            winB["resizeable"] = false;
            winB["minSize"] = { width: 640, height: 480 };
            winB["maxSize"] = { width: 640, height: 480 };
            winB["desktops"] = [world.desktop2];
            fireAdded(world);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            const moved = mocks.dbusCalls
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-2")
                .pop();
            assert.ok(moved !== undefined, "target domain admits after move");
            assert.ok(!("floating" in wireOf(moved, "win-b")), "moved client tiles with its pin");
            assert.equal(wireOf(moved, "win-b")["fixed_suppress"], true, "pin rides suppress on the wire");
            const movedReply = mocks.dbusCalls.length - 1;
            const frameAfterMove = JSON.stringify(frameOf(winB));
            // Disable ws-2: focus must sit on the target desktop for the
            // scope switch, otherwise the toggle observes no snapshots.
            // The confirmed release discards Engine state.
            world.workspace["activeWindow"] = winB;
            world.workspace["currentDesktopForScreen"] = (): unknown => world.desktop2;
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            assert.ok(releaseIndex > movedReply, "disable dispatches release");
            assert.equal(await flushAt(mocks, engine, releaseIndex).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            const frameBeforeEnable = JSON.stringify(frameOf(winB));
            assert.equal(frameBeforeEnable, frameAfterMove, "disable writes nothing to the tile");
            // Enable rechecks: the released override is gone, so the
            // fixed client floats untouched instead of re-tiling.
            const beforeEnable = mocks.dbusCalls.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            const retiled = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-2")
                .pop();
            assert.ok(retiled !== undefined, "target resync dispatches after enable");
            assert.equal(wireOf(retiled, "win-b")["floating"], true, "released override does not block the recheck");
            assert.equal(wireOf(retiled, "win-b")["fixed_auto"], true);
            assert.equal(JSON.stringify(frameOf(winB)), frameBeforeEnable, "no geometry write to the new float");
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("move while floating keeps omitted identity on the old enable", async () => {
        // G3: both workspaces float when win-b (automatic, ws-1) natively
        // moves to ws-2 losing fixed hints. No dispatch observes the move,
        // so the adapter record stays homed on ws-1. Enabling ws-1 keys
        // its reset on CURRENT sightings (win-b absent), so the foreign
        // mark survives; enabling ws-2 afterwards resets by sighting and
        // tiles the now-plain client.
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            flushed.count = 0;
            await drainOutstanding(mocks, engine, flushed);
            // Scope switches need focus on the target desktop.
            // Disable both domains first (scope switches need focus on
            // the target desktop).
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            assert.equal(await flushAt(mocks, engine, releaseIndex).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            world.workspace["activeWindow"] = world.wins[2];
            world.workspace["currentDesktopForScreen"] = (): unknown => world.desktop2;
            toggleWorkspaceTiling(mocks);
            const releaseIndex1 = mocks.dbusCalls.length - 1;
            assert.equal(await flushAt(mocks, engine, releaseIndex1).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex1 + 1;
            await drainOutstanding(mocks, engine, flushed);
            // Move + hint loss while both float: no dispatch may observe it.
            const winB = world.wins[1] as Record<string, unknown>;
            const callsWhileFloating = mocks.dbusCalls.length;
            winB["desktops"] = [world.desktop2];
            winB["resizeable"] = true;
            winB["minSize"] = null;
            winB["maxSize"] = null;
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.equal(mocks.dbusCalls.length, callsWhileFloating, "floating observes dispatch nothing");
            // Enable the old domain (scope and focus back on ws-1): win-b
            // is not sighted there, then enable the new domain: its
            // resync sees the plain client and tiles it.
            world.workspace["activeWindow"] = world.wins[0];
            world.workspace["currentDesktopForScreen"] = (): unknown => world.desktop;
            const beforeOldEnable = mocks.dbusCalls.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            const oldResync = mocks.dbusCalls
                .slice(beforeOldEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(oldResync !== undefined, "old domain resync dispatches");
            assert.ok(!("floating" in wireOf(oldResync, "win-a")), "old domain tiles its member");
            assert.equal(
                JSON.stringify(frameOf(winB)),
                JSON.stringify({ x: 600, y: 0, w: 600, h: 800 }),
                "no write across the floating move and old enable",
            );
            world.workspace["activeWindow"] = winB;
            world.workspace["currentDesktopForScreen"] = (): unknown => world.desktop2;
            // ws-2 already holds a confirmed release from its disable, so
            // this enable resyncs directly after the sighted reset.
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            const resyncIdx = mocks.dbusCalls.length - 1;
            const resyncReply = await flushAt(mocks, engine, resyncIdx);
            assert.equal(resyncReply["outcome"], "planned", `new-domain resync plans, got ${JSON.stringify(resyncReply)}`);
            flushed.count = resyncIdx + 1;
            await drainOutstanding(mocks, engine, flushed);
            const retiled = payloadAt(mocks, resyncIdx);
            assert.equal(domainOf(retiled)["workspace"], "ws-2", "new-domain resync targets ws-2");
            assert.ok(!("floating" in wireOf(retiled, "win-b")), "sighted reset re-tiles the plain client");
            const slot = (resyncReply["desired_geometry"] as Array<Record<string, unknown>>).find(
                (entry) => entry["window"] === "win-b",
            );
            assert.ok(slot !== undefined, "re-tiled client takes a slot");
            assert.deepEqual(
                frameOf(winB),
                slot["rect"] as { x: number; y: number; w: number; h: number },
                "re-tiled client placed exactly once in its planned slot",
            );
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("enable rechecks a pinned tile that became fixed while floating", async () => {
        // D6: win-b tiles as an ordinary client, then reports fixed hints
        // while its workspace floats. Enable must float it untouched with
        // no geometry write; the plain sibling keeps its slot.
        const world = fakeWorld();
        const winB = world.wins[1] as Record<string, unknown>;
        winB["resizeable"] = true;
        winB["minSize"] = null;
        winB["maxSize"] = null;
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            const admitted = payloadAt(mocks, mocks.dbusCalls.length - 1);
            assert.ok(!("floating" in wireOf(admitted, "win-b")), "plain client tiles at startup");
            flushed.count = 0;
            await drainOutstanding(mocks, engine, flushed);
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            assert.equal(await flushAt(mocks, engine, releaseIndex).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            // Fixed hints arrive while floating: no dispatch, no writes.
            const frameBefore = JSON.stringify(frameOf(winB));
            winB["resizeable"] = false;
            winB["minSize"] = { width: 640, height: 480 };
            winB["maxSize"] = { width: 640, height: 480 };
            const beforeEnable = mocks.dbusCalls.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            assert.ok(mocks.dbusCalls.length > beforeEnable, "enable resync dispatches");
            const retiled = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(retiled !== undefined, "foreground resync dispatches after enable");
            assert.equal(wireOf(retiled, "win-b")["floating"], true, "newly fixed floats on enable");
            assert.equal(wireOf(retiled, "win-b")["fixed_auto"], true);
            assert.ok(!("floating" in wireOf(retiled, "win-a")), "plain sibling stays tiled");
            assert.equal(JSON.stringify(frameOf(winB)), frameBefore, "no geometry write to the new float");
            assert.ok(
                mocks.logs.some((line) => line.includes("fixed-size-classification")),
                "bounded classification diagnostic emitted",
            );
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("predicate switch while floating applies to the enable recheck", async () => {
        // One-axis win-b tiles under both-axes, the predicate switches to
        // either-axis while floating, and enable floats it with the new
        // predicate on the wire.
        const world = fakeWorld();
        const winB = world.wins[1] as Record<string, unknown>;
        winB["minSize"] = { width: 640, height: 100 };
        winB["maxSize"] = { width: 640, height: 480 };
        let predicate: unknown = "both-axes-fixed";
        const configHandlers: Array<() => void> = [];
        const { handle, mocks } = startEntry(world, {
            options: {
                configChanged: {
                    connect: (handler: () => void): void => { configHandlers.push(handler); },
                    disconnect: (handler: () => void): void => {
                        const index = configHandlers.indexOf(handler);
                        if (index >= 0) { configHandlers.splice(index, 1); }
                    },
                },
            },
            readFixedSizePredicateFn: (): unknown => predicate,
        });
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            const admitted = payloadAt(mocks, mocks.dbusCalls.length - 1);
            assert.ok(!("floating" in wireOf(admitted, "win-b")), "one-axis tiles by default");
            flushed.count = 0;
            await drainOutstanding(mocks, engine, flushed);
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            assert.equal(await flushAt(mocks, engine, releaseIndex).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            predicate = "either-axis-fixed";
            for (const fire of [...configHandlers]) {
                fire();
            }
            assert.ok(
                mocks.logs.some((line) => line.includes("stage=fixed-size-predicate predicate=either-axis-fixed")),
                "predicate reload logged",
            );
            const beforeEnable = mocks.dbusCalls.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            const retiled = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(retiled !== undefined, "foreground resync dispatches after enable");
            assert.equal(retiled["fixed_size_predicate"], "either-axis-fixed");
            assert.equal(wireOf(retiled, "win-b")["floating"], true, "one-axis floats under either-axis");
            assert.equal(wireOf(retiled, "win-b")["fixed_auto"], true);
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("arrivals while floating classify fixed-float versus tile on enable", async () => {
        // win-d (fixed) and win-e (plain) appear while ws-1 floats. The
        // enable resync floats win-d untouched and tiles win-e.
        const world = fakeWorld();
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        const addWin = (
            id: string,
            x: number,
            home: Record<string, unknown>,
            fixed: boolean,
        ): Record<string, unknown> => {
            const geo = fakeSignal();
            const max = fakeSignal();
            const win: Record<string, unknown> = {
                normalWindow: true,
                internalId: id,
                resourceClass: "test-app",
                output: world.output,
                desktops: [home],
                frameGeometry: { x, y: 0, width: 600, height: 800 },
                frameGeometryChanged: geo.signal,
                fullScreenChanged: fakeSignal().signal,
                fullScreen: false,
                maximizedChanged: max.signal,
                maximizeMode: 0,
                desktopsChanged: fakeSignal().signal,
                onAllDesktops: false,
                keepAbove: false,
                keepBelow: false,
            };
            if (fixed) {
                win["resizeable"] = false;
                win["minSize"] = { width: 640, height: 480 };
                win["maxSize"] = { width: 640, height: 480 };
            }
            world.winMax.set(win, max);
            world.winGeometry.set(win, geo);
            world.wins.push(win);
            return win;
        };
        try {
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            flushed.count = 0;
            await drainOutstanding(mocks, engine, flushed);
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            assert.equal(await flushAt(mocks, engine, releaseIndex).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            const callsWhileFloating = mocks.dbusCalls.length;
            const winD = addWin("win-d", 0, world.desktop as Record<string, unknown>, true);
            addWin("win-e", 600, world.desktop as Record<string, unknown>, false);
            const frameBeforeD = JSON.stringify(frameOf(winD));
            const beforeEnable = mocks.dbusCalls.length;
            assert.equal(beforeEnable, callsWhileFloating, "no dispatch for arrivals while floating");
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            const retiled = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(retiled !== undefined, "foreground resync dispatches after enable");
            assert.equal(wireOf(retiled, "win-d")["floating"], true, "fixed arrival floats");
            assert.equal(wireOf(retiled, "win-d")["fixed_auto"], true);
            assert.ok(!("floating" in wireOf(retiled, "win-e")), "plain arrival tiles");
            assert.equal(JSON.stringify(frameOf(winD)), frameBeforeD, "no geometry write to the fixed arrival");
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("explicit tile overrides survive disable and enable", async () => {
        // Unfloat win-b (explicit override), then cycle tiling off and
        // on: win-b stays tiled with suppression.
        const world = fakeWorld();
        world.workspace["activeWindow"] = world.wins[1];
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            flushed.count = 0;
            await drainOutstanding(mocks, engine, flushed);
            // Settle any chained follow-up before the explicit command so
            // it cannot busy-refuse behind a stale auto flight.
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            // Focus may have settled on the admitted tile; re-assert it
            // before the explicit command.
            world.workspace["activeWindow"] = world.wins[1];
            handle?.requestFloat();
            runEntryDebounce(mocks);
            // Flush the toggle-float itself: its reply proves the commit
            // (win-b rejoins topology). The request carries pre-apply
            // state, so the reply is the evidence.
            const toggleIndex = mocks.dbusCalls.length - 1;
            const toggleReply = await flushAt(mocks, engine, toggleIndex);
            assert.equal(toggleReply["outcome"], "planned", `unfloat plans, got ${JSON.stringify(toggleReply)}`);
            assert.ok(
                (toggleReply["desired_geometry"] as Array<Record<string, unknown>>).some(
                    (entry) => entry["window"] === "win-b",
                ),
                "override tiles on commit",
            );
            flushed.count = toggleIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            assert.equal(await flushAt(mocks, engine, releaseIndex).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            const beforeEnable = mocks.dbusCalls.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            const retiled = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(retiled !== undefined, "foreground resync dispatches after enable");
            assert.ok(!("floating" in wireOf(retiled, "win-b")), "override stays tiled across the cycle");
            assert.equal(wireOf(retiled, "win-b")["fixed_suppress"], true);
        } finally {
            handle?.stop();
            await engine.close();
        }
    });

    it("intentional floats and sticky windows survive enable untouched", async () => {
        // win-a floats intentional, win-c turns sticky: enable keeps both
        // floating without origin and writes nothing to them.
        const world = fakeWorld();
        world.workspace["activeWindow"] = world.wins[0];
        const { handle, mocks } = startEntry(world);
        assert.ok(handle !== null, "entry starts");
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            fireAdded(world);
            runEntryDebounce(mocks);
            assert.ok(mocks.dbusCalls.length > 0, "startup dispatches");
            flushed.count = 0;
            await drainOutstanding(mocks, engine, flushed);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            world.workspace["activeWindow"] = world.wins[0];
            handle?.requestFloat();
            runEntryDebounce(mocks);
            // The toggle-float reply proves the intentional commit (win-a
            // leaves topology with no origin); the request itself carries
            // pre-apply state.
            const floatIndex = mocks.dbusCalls.length - 1;
            const floatReply = await flushAt(mocks, engine, floatIndex);
            assert.equal(floatReply["outcome"], "planned", `float plans, got ${JSON.stringify(floatReply)}`);
            assert.ok(
                !(floatReply["desired_geometry"] as Array<Record<string, unknown>>).some(
                    (entry) => entry["window"] === "win-a",
                ),
                "win-a leaves topology",
            );
            flushed.count = floatIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            const winA = world.wins[0] as Record<string, unknown>;
            const winC = world.wins[2] as Record<string, unknown>;
            winC["onAllDesktops"] = true;
            const frameBeforeA = JSON.stringify(frameOf(winA));
            toggleWorkspaceTiling(mocks);
            const releaseIndex = mocks.dbusCalls.length - 1;
            assert.equal(await flushAt(mocks, engine, releaseIndex).then((r) => r["outcome"]), "released");
            runEntryDebounce(mocks);
            flushed.count = releaseIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            const beforeEnable = mocks.dbusCalls.length;
            toggleWorkspaceTiling(mocks);
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            const foreground = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .filter((payload) => domainOf(payload)["workspace"] === "ws-1")
                .pop();
            assert.ok(foreground !== undefined, "foreground resync dispatches after enable");
            assert.equal(wireOf(foreground, "win-a")["floating"], true, "intentional stays floating");
            assert.ok(!("fixed_auto" in wireOf(foreground, "win-a")), "intentional gains no origin");
            assert.equal(wireOf(foreground, "win-b")["floating"], true, "automatic stays floating");
            assert.equal(wireOf(foreground, "win-b")["fixed_auto"], true);
            assert.equal(JSON.stringify(frameOf(winA)), frameBeforeA, "no geometry write to the intentional float");
            const stickyPayload = mocks.dbusCalls
                .slice(beforeEnable)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
                .find((payload) => {
                    try {
                        const row = wireOf(payload, "win-c");
                        return row["sticky"] === true;
                    } catch (error) {
                        void error;
                        return false;
                    }
                });
            assert.ok(stickyPayload !== undefined, "sticky window dispatches");
            assert.equal(wireOf(stickyPayload, "win-c")["floating"], true, "sticky stays floating");
            assert.ok(!("fixed_auto" in wireOf(stickyPayload, "win-c")), "sticky gains no origin");
        } finally {
            handle?.stop();
            await engine.close();
        }
    });
});
