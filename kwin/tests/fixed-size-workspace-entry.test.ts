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
    it("startup classifies foreground and hidden fixed clients, enable retiles foreground only", async () => {
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
            // Re-enable: the entry calls retile on the re-tiled domain and
            // the resync tiles the automatic with suppression, while the
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
            assert.ok(!("floating" in wireOf(retiled, "win-b")), "enabled domain retiles the automatic");
            assert.equal(wireOf(retiled, "win-b")["fixed_suppress"], true, "retile pins suppression");
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

    it("maximized fixed rides release and enable with a reserved slot and no writes", async () => {
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
            // Disable and re-enable tiling while still maximized: the
            // retiled client reserves its slot with suppression, still
            // with no clear and no target write.
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
            assert.ok(!("floating" in wireOf(resync, "win-b")), "enable tiles beneath the overlay");
            assert.equal(wireOf(resync, "win-b")["fixed_suppress"], true);
            const resyncReply = await flushAt(mocks, engine, resyncIndex);
            assert.equal(resyncReply["outcome"], "planned", `resync plans, got ${JSON.stringify(resyncReply)}`);
            const reserved = (
                resyncReply["desired_geometry"] as Array<Record<string, unknown>>
            ).find((entry) => entry["window"] === "win-b");
            assert.ok(reserved !== undefined, "retiled client reserves its slot under the overlay");
            flushed.count = resyncIndex + 1;
            await drainOutstanding(mocks, engine, flushed);
            assert.equal(
                world.maximizeClears.length,
                clearsBeforeEnable,
                "enable never clears native maximize",
            );
            assert.equal(JSON.stringify(winB["frameGeometry"]), writesBeforeEnable, "no target write under overlay");
            // Native unmaximize lands the client in its reserved slot.
            winB["maximizeMode"] = 0;
            for (const handler of [...(world.winMax.get(winB)?.handlers ?? [])]) {
                handler();
            }
            runEntryDebounce(mocks);
            await drainOutstanding(mocks, engine, flushed);
            assert.deepEqual(
                frameOf(winB),
                reserved["rect"] as { x: number; y: number; w: number; h: number },
                "unmaximize lands in the reserved slot",
            );
            assert.deepEqual(world.maximizeClears, [], "no clear around native unmaximize either");
        } finally {
            handle?.stop();
            await engine.close();
        }
    });
});
