// Explicit output send against the real Rust Planner/Engine through the
// production `startPlanAdapterEntry` route: no hand-built wire replies.
// Covers follow and stay across a vertical panel-gap topology, delayed
// output signals with no replay, source/target drift before setters with
// zero writes, floating-boundary tiled-side reflow, plus a sole-leaf
// vertical R4 cross and a local-first horizontal move with the real Engine.
// The flight-pinned source pair is what lets geometry and arrival confirm
// after the still-active mover lands on the destination: deriving the
// source from the live active window would collapse target===source and
// strand every flight.
//
// REAL parts: production `startPlanAdapterEntry` (directional + output-send
// observation and actuation) on a scripted two-output fake KWin surface;
// `Planner::evaluate` via the test-only `planner_eval` example (same
// validation and retained state as the shipped binary; only D-Bus and
// signals are stubbed). Included in `npm test`.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { WORKSPACE_SEND_TIMEOUT_MS } from "../src/workspace-send-adapter";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

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

    static start(): EngineBridge {
        return new EngineBridge(
            spawn("cargo", ["run", "--offline", "-q", "-p", "tiler-protocol", "--example", "planner_eval"], {
                cwd: repoRoot(),
                stdio: ["pipe", "pipe", "pipe"],
            }),
        );
    }

    send(request: string): Promise<string> {
        if (this.dead !== null) {
            return Promise.reject(new Error(this.dead));
        }
        if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
            return Promise.reject(new Error("planner_eval process already exited"));
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

interface FakeSignal {
    readonly handlers: Set<() => void>;
    readonly signal: {
        connect: (handler: () => void) => void;
        disconnect: (handler: () => void) => void;
    };
    fire: () => void;
}

function makeSignal(): FakeSignal {
    const handlers = new Set<() => void>();
    return {
        handlers,
        signal: {
            connect: (handler: () => void): void => {
                handlers.add(handler);
            },
            disconnect: (handler: () => void): void => {
                handlers.delete(handler);
            },
        },
        fire: (): void => {
            for (const handler of [...handlers]) {
                handler();
            }
        },
    };
}

interface FakeOutput {
    readonly name: string;
    readonly geometry: { x: number; y: number; width: number; height: number };
}

interface FakeDesktop {
    readonly id: string;
    readonly x11DesktopNumber: number;
}

interface FakeWindow extends Record<string, unknown> {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    output: FakeOutput;
    desktops: FakeDesktop[];
    internalId: string;
    frameGeometry: { x: number; y: number; width: number; height: number };
    resourceClass: string;
    desktopsChanged: { connect: (h: () => void) => void; disconnect: (h: () => void) => void };
    outputChanged: { connect: (h: () => void) => void; disconnect: (h: () => void) => void };
    frameGeometryChanged: { connect: (h: () => void) => void; disconnect: (h: () => void) => void };
    fullScreenChanged: { connect: (h: () => void) => void; disconnect: (h: () => void) => void };
    maximizedChanged: { connect: (h: () => void) => void; disconnect: (h: () => void) => void };
    desktopsSig: FakeSignal;
    outputSig: FakeSignal;
}

interface WorldOpts {
    readonly soloSource?: boolean;
    readonly twinSource?: boolean;
    // Single shared desktop shown on both outputs: distinct outputs with one
    // current workspace/desktop between them.
    readonly singleDesktop?: boolean;
    // Split the lower half into left/right candidates: the mover sits
    // right-of-centre so window-centre selection picks the non-left/top
    // bottom-right output through the production observeDirectionalDomain.
    readonly splitBottom?: boolean;
}

interface Harness {
    readonly bridge: EngineBridge;
    readonly workspace: Record<string, unknown>;
    readonly outputs: { top: FakeOutput; bottom: FakeOutput; bottomRight?: FakeOutput };
    readonly desktops: { a: FakeDesktop; b: FakeDesktop; c?: FakeDesktop };
    readonly wins: FakeWindow[];
    readonly mover: FakeWindow;
    readonly currentByOutput: Map<FakeOutput, FakeDesktop>;
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly replies: Map<number, string>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean; fired: boolean }>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; sequence: string; callback: () => void }>;
    readonly handle: NonNullable<ReturnType<typeof startPlanAdapterEntry>>;
    deferredTransfer: boolean;
    pendingTransfers: Array<{ client: FakeWindow; output: FakeOutput }>;
    flush: () => Promise<number>;
    flushAll: () => Promise<void>;
    fireTimers: (delayMs: number) => number;
    sendOps: () => string[];
    removeWindow: (win: FakeWindow) => void;
    stop: () => Promise<void>;
}

async function makeHarness(opts: WorldOpts = {}): Promise<Harness> {
    // Stacked full-HD halves with 40px panel struts: FULL rectangles touch
    // at y=540 for selection while carried work areas stay panel-free.
    // splitBottom halves the lower row: out-bottom (left) plus
    // out-bottom-right (non-left/top target) for position-based selection.
    const top: FakeOutput = { name: "out-top", geometry: { x: 0, y: 0, width: 1920, height: 540 } };
    const bottom: FakeOutput =
        opts.splitBottom === true
            ? { name: "out-bottom", geometry: { x: 0, y: 540, width: 960, height: 540 } }
            : { name: "out-bottom", geometry: { x: 0, y: 540, width: 1920, height: 540 } };
    const bottomRight: FakeOutput | null =
        opts.splitBottom === true ? { name: "out-bottom-right", geometry: { x: 960, y: 540, width: 960, height: 540 } } : null;
    const wsA: FakeDesktop = { id: "ws-a", x11DesktopNumber: 1 };
    const wsB: FakeDesktop = opts.singleDesktop === true ? wsA : { id: "ws-b", x11DesktopNumber: 2 };
    const wsC: FakeDesktop =
        opts.splitBottom === true
            ? opts.singleDesktop === true
                ? wsA
                : { id: "ws-c", x11DesktopNumber: 3 }
            : wsB;
    const currentByOutput = new Map<FakeOutput, FakeDesktop>([
        [top, wsA],
        [bottom, wsB],
        ...(bottomRight !== null ? [[bottomRight, wsC] as const] : []),
    ]);
    const liveDesktops =
        opts.singleDesktop === true
            ? [wsA]
            : opts.splitBottom === true
              ? [wsA, wsB, wsC]
              : [wsA, wsB];
    const mkWin = (
        output: FakeOutput,
        desktop: FakeDesktop,
        internalId: string,
        frame: { x: number; y: number; width: number; height: number },
    ): FakeWindow => {
        const desktopsSig = makeSignal();
        const outputSig = makeSignal();
        const frameSig = makeSignal();
        const fullSig = makeSignal();
        const maxSig = makeSignal();
        return {
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: 0,
            onAllDesktops: false,
            output,
            desktops: [desktop],
            internalId,
            frameGeometry: { ...frame },
            resourceClass: "app",
            desktopsChanged: desktopsSig.signal,
            outputChanged: outputSig.signal,
            frameGeometryChanged: frameSig.signal,
            fullScreenChanged: fullSig.signal,
            maximizedChanged: maxSig.signal,
            desktopsSig,
            outputSig,
        };
    };
    const wins: FakeWindow[] = [];
    if (opts.soloSource === true) {
        // Split topology: sit right-of-centre (centre x=1200 in
        // [960,1920)) so the down selector picks bottom-right, not left/top.
        wins.push(
            opts.splitBottom === true
                ? mkWin(top, wsA, "o-win-s", { x: 1100, y: 20, width: 200, height: 100 })
                : mkWin(top, wsA, "o-win-s", { x: 20, y: 20, width: 400, height: 300 }),
        );
    } else {
        wins.push(mkWin(top, wsA, "o-win-1", { x: 20, y: 20, width: 400, height: 300 }));
        wins.push(
            opts.splitBottom === true
                ? mkWin(top, wsA, "o-win-2", { x: 1100, y: 20, width: 200, height: 100 })
                : mkWin(top, wsA, "o-win-2", { x: 440, y: 20, width: 400, height: 300 }),
        );
    }
    if (opts.twinSource === true) {
        wins.push(mkWin(top, wsA, "o-win-3", { x: 860, y: 20, width: 400, height: 300 }));
    }
    if (opts.splitBottom === true && bottomRight !== null) {
        wins.push(mkWin(bottom, wsB, "o-win-u", { x: 20, y: 600, width: 400, height: 300 }));
        wins.push(mkWin(bottomRight, wsC, "o-win-t", { x: 1000, y: 600, width: 400, height: 300 }));
    } else {
        wins.push(mkWin(bottom, wsB, "o-win-t", { x: 20, y: 600, width: 400, height: 300 }));
    }
    const mover = wins.find((win) => win.internalId === "o-win-2" || win.internalId === "o-win-s") as FakeWindow;
    const wsig = {
        windowAdded: makeSignal(),
        windowRemoved: makeSignal(),
        windowActivated: makeSignal(),
        screensChanged: makeSignal(),
        currentDesktopChanged: makeSignal(),
        desktopsChanged: makeSignal(),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: mover,
        activeScreen: top,
        screens: bottomRight !== null ? [top, bottom, bottomRight] : [top, bottom],
        desktops: liveDesktops,
        currentDesktopForScreen: (output: object): object => currentByOutput.get(output as FakeOutput) ?? wsA,
        currentDesktop: wsA,
        setCurrentDesktopForScreen: (desktop: object, output: object): void => {
            currentByOutput.set(output as FakeOutput, desktop as FakeDesktop);
        },
        clientArea: (_kind: number, output: object, _desktop: object): object => {
            if (output === top) {
                return { x: 0, y: 0, w: 1920, h: 500 };
            }
            if (bottomRight !== null && output === bottomRight) {
                return { x: 960, y: 580, w: 960, h: 500 };
            }
            if (bottomRight !== null) {
                return { x: 0, y: 580, w: 960, h: 500 };
            }
            return { x: 0, y: 580, w: 1920, h: 500 };
        },
        windowList: (): object[] => [...wins],
        sendClientToScreen: (client: object, output: object): void => {
            const win = client as FakeWindow;
            if (harness.deferredTransfer) {
                harness.pendingTransfers.push({ client: win, output: output as FakeOutput });
                return;
            }
            win.output = output as FakeOutput;
            win.outputSig.fire();
        },
        windowAdded: wsig.windowAdded.signal,
        windowRemoved: wsig.windowRemoved.signal,
        windowActivated: wsig.windowActivated.signal,
        screensChanged: wsig.screensChanged.signal,
        currentDesktopChanged: wsig.currentDesktopChanged.signal,
        desktopsChanged: wsig.desktopsChanged.signal,
    };
    const bridge = EngineBridge.start();
    const dbusCalls: Harness["dbusCalls"] = [];
    const callbacks: Harness["callbacks"] = [];
    const replies = new Map<number, string>();
    const timers: Harness["timers"] = [];
    const logs: Harness["logs"] = [];
    const shortcuts: Harness["shortcuts"] = [];
    const harness: Harness = {
        bridge,
        workspace,
        outputs: bottomRight !== null ? { top, bottom, bottomRight } : { top, bottom },
        desktops: bottomRight !== null ? { a: wsA, b: wsB, c: wsC } : { a: wsA, b: wsB },
        wins,
        mover,
        currentByOutput,
        dbusCalls,
        callbacks,
        replies,
        timers,
        logs,
        shortcuts,
        handle: null as unknown as NonNullable<ReturnType<typeof startPlanAdapterEntry>>,
        deferredTransfer: false,
        pendingTransfers: [],
        flush: async () => {
            const index = dbusCalls.findIndex((call, at) => call.method === "DescribePlan" && !replies.has(at));
            assert.ok(index >= 0, "expected a queued DescribePlan dispatch to flush to the real Engine");
            const reply = await bridge.send(dbusCalls[index]?.payload as string);
            replies.set(index, reply);
            callbacks[index]?.(reply);
            return index;
        },
        flushAll: async () => {
            for (let round = 0; round < 12; round += 1) {
                const next = dbusCalls.findIndex((call, at) => call.method === "DescribePlan" && !replies.has(at));
                if (next < 0) {
                    return;
                }
                const reply = await bridge.send(dbusCalls[next]?.payload as string);
                replies.set(next, reply);
                callbacks[next]?.(reply);
            }
            throw new Error("flushAll did not converge: planner keeps dispatching");
        },
        fireTimers: (delayMs: number): number => {
            let fired = 0;
            for (const timer of timers) {
                if (timer.delayMs === delayMs && !timer.cancelled && !timer.fired) {
                    timer.fired = true;
                    fired += 1;
                    timer.callback();
                }
            }
            return fired;
        },
        sendOps: (): string[] => {
            const ops: string[] = [];
            for (const call of dbusCalls) {
                if (call.method !== "DescribePlan") {
                    continue;
                }
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    const op = (body["command"] as Record<string, unknown> | undefined)?.["op"];
                    ops.push(typeof op === "string" ? op : "?");
                } catch {
                    ops.push("?");
                }
            }
            return ops;
        },
        removeWindow: (win: FakeWindow): void => {
            // Faithful native removal: leave the window list AND break
            // property reads, the way a removed KWin object refuses them.
            // A plain stale wrapper would otherwise still answer reads and
            // hide lifetime bugs.
            const at = wins.indexOf(win);
            if (at >= 0) {
                wins.splice(at, 1);
            }
            const record = win as Record<string, unknown>;
            delete record["output"];
            delete record["desktops"];
            delete record["frameGeometry"];
            delete record["internalId"];
            delete record["fullScreen"];
            delete record["maximizeMode"];
            delete record["onAllDesktops"];
        },
        stop: async () => {
            try {
                harness.handle?.stop();
            } catch (error) {
                void error;
            }
            await bridge.close();
        },
    };
    const handle = startPlanAdapterEntry({
        workspace,
        owner: "owner-1",
        generation: "gen-1",
        log: (message: string): void => {
            logs.push(message);
        },
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
            dbusCalls.push({ method, payload });
            callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const timer = { delayMs, callback, cancelled: false, fired: false };
            timers.push(timer);
            return (): void => {
                timer.cancelled = true;
            };
        },
        registerShortcutFn: (action, _text, sequence, callback): boolean => {
            void _text;
            shortcuts.push({ action, sequence, callback });
            return true;
        },
        readProfileFn: (): string => "cosmic",
        readWorkspaceModeFn: (): unknown => "per-output-local",
        readInnerGapFn: (): number => 8,
        readOuterGapFn: (): number => 8,
    });
    assert.notEqual(handle, null, "production entry starts on the fake surface");
    (harness as { handle: unknown }).handle = handle;
    return harness;
}

function sendPayloads(harness: Harness): Array<{ index: number; body: Record<string, unknown> }> {
    const out: Array<{ index: number; body: Record<string, unknown> }> = [];
    harness.dbusCalls.forEach((call, index) => {
        if (call.method !== "DescribePlan") {
            return;
        }
        try {
            const body = JSON.parse(call.payload) as Record<string, unknown>;
            if (((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "send-to-output") {
                out.push({ index, body });
            }
        } catch {
            return;
        }
    });
    return out;
}

function frameOf(win: FakeWindow): { x: number; y: number; w: number; h: number } {
    const frame = win.frameGeometry as { x: number; y: number; width: number; height: number };
    return { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
}

function winByStableId(harness: Harness, id: string): FakeWindow {
    const found = harness.wins.find((win) => win.internalId === id);
    assert.ok(found !== undefined, `window ${id} exists on the fake surface`);
    return found as FakeWindow;
}

async function settlePlan(harness: Harness): Promise<void> {
    // Settle plan-adapter flights from mode toggles: fire debounce rounds
    // and flush every dispatch until quiescent, so later routes observe an
    // idle single-flight.
    for (let round = 0; round < 10; round += 1) {
        harness.fireTimers(PLAN_DEBOUNCE_MS);
        const before = harness.dbusCalls.length;
        await harness.flushAll();
        harness.fireTimers(PLAN_DEBOUNCE_MS);
        await harness.flushAll();
        if (harness.dbusCalls.length === before) {
            return;
        }
    }
    throw new Error("plan flights did not settle");
}

function followCount(harness: Harness): number {
    return harness.logs.filter((line) => line.includes("follow") && line.includes("state-confirmed")).length;
}

describe("output-send against the real Engine (production entry route)", () => {
    it("follows down across the panel gap with both-domain geometry and forced reconcile", async () => {
        const h = await makeHarness();
        try {
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1, "exactly one send-to-output dispatch, no replay at dispatch");
            const sent = sendPayloads(h)[0]?.body as Record<string, unknown>;
            assert.equal((sent["command"] as Record<string, unknown>)["op"], "send-to-output");
            assert.equal((sent["command"] as Record<string, unknown>)["follow"], true);
            assert.equal((sent["target_domain"] as Record<string, unknown>)["output"], "out-bottom");
            assert.equal((sent["target_domain"] as Record<string, unknown>)["workspace"], "ws-b");
            await h.flush();
            const sendCall = sendPayloads(h)[0];
            assert.ok(sendCall !== undefined);
            const reply = JSON.parse(h.replies.get(sendCall.index) as string) as Record<string, unknown>;
            assert.equal(reply["outcome"], "planned", `real Engine plans the output send, got ${JSON.stringify(reply).slice(0, 200)}`);
            assert.equal(reply["kind"], "send-to-output");
            // Both-domain geometry actually written, matching the Engine plan.
            appliedMatchesReply(h, reply);
            // Mover natively on the exact destination, absent the source.
            assert.equal(h.mover.output.name, "out-bottom");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-b"],
            );
            // Follow confirmed with no desktop switch: the source output
            // still shows its workspace and the mover holds focus.
            assert.equal(h.workspace["activeWindow"], h.mover);
            assert.equal(h.currentByOutput.get(h.outputs.top)?.id, "ws-a");
            assert.equal(followCount(h), 1, "exactly one follow, no replay");
            // Flight released plus forced reconcile: firing the plan
            // debounce surfaces follow-up DescribePlan work that the real
            // Engine also plans.
            const before = h.dbusCalls.length;
            h.fireTimers(PLAN_DEBOUNCE_MS);
            const followUps = h.dbusCalls.slice(before).filter((call) => call.method === "DescribePlan");
            assert.ok(followUps.length >= 1, "settlement forces a Plan refresh");
            await h.flushAll();
            // No replay: still exactly one send-to-output dispatch, and
            // firing the bounded arrival deadline is a no-op post-settlement.
            assert.equal(sendPayloads(h).length, 1);
            h.fireTimers(WORKSPACE_SEND_TIMEOUT_MS);
            assert.equal(sendPayloads(h).length, 1);
            assert.equal(followCount(h), 1);
        } finally {
            await h.stop();
        }
    });

    it("sends across outputs sharing a single desktop with the real Engine", async () => {
        // Distinct outputs may share one current workspace/desktop: no
        // last-desktop gate on the output-send route.
        const h = await makeHarness({ singleDesktop: true });
        try {
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1, "exactly one send-to-output dispatch");
            const sent = sendPayloads(h)[0]?.body as Record<string, unknown>;
            assert.equal((sent["target_domain"] as Record<string, unknown>)["output"], "out-bottom");
            assert.equal((sent["target_domain"] as Record<string, unknown>)["workspace"], "ws-a");
            await h.flush();
            const sendCall = sendPayloads(h)[0];
            assert.ok(sendCall !== undefined);
            const reply = JSON.parse(h.replies.get(sendCall.index) as string) as Record<string, unknown>;
            assert.equal(reply["outcome"], "planned", "real Engine plans the shared-desktop send");
            appliedMatchesReply(h, reply);
            assert.equal(h.mover.output.name, "out-bottom");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-a"],
            );
            assert.equal(h.workspace["activeWindow"], h.mover, "follow focuses the mover");
            assert.equal(sendPayloads(h).length, 1, "no replay");
        } finally {
            await h.stop();
        }
    });

    it("fails a follow flight when the source view switches mid-flight", async () => {
        // Explicit output follow never reselects the source: a switched-away
        // source refuses with zero writes even for follow.
        const h = await makeHarness();
        try {
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1);
            h.currentByOutput.set(h.outputs.top, h.desktops.b);
            const framesBefore = new Map(h.wins.map((win) => [win.internalId, { ...win.frameGeometry }]));
            await h.flush();
            assert.equal(h.mover.output.name, "out-top", "no output transfer on source drift");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-a"],
                "no membership write on source drift",
            );
            for (const win of h.wins) {
                assert.deepEqual({ ...win.frameGeometry }, framesBefore.get(win.internalId), `no geometry write on ${win.internalId}`);
            }
            assert.equal(h.workspace["activeWindow"], h.mover, "no focus setter on source drift");
            assert.equal(sendPayloads(h).length, 1, "no replay after stale settle");
        } finally {
            await h.stop();
        }
    });

    it("sends across outputs sharing a single desktop with the real Engine", async () => {
        // Distinct outputs may share one current workspace/desktop: no
        // last-desktop gate on the output-send route.
        const h = await makeHarness({ singleDesktop: true });
        try {
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1, "exactly one send-to-output dispatch");
            const sent = sendPayloads(h)[0]?.body as Record<string, unknown>;
            assert.equal((sent["target_domain"] as Record<string, unknown>)["output"], "out-bottom");
            assert.equal((sent["target_domain"] as Record<string, unknown>)["workspace"], "ws-a");
            await h.flush();
            const sendCall = sendPayloads(h)[0];
            assert.ok(sendCall !== undefined);
            const reply = JSON.parse(h.replies.get(sendCall.index) as string) as Record<string, unknown>;
            assert.equal(reply["outcome"], "planned", "real Engine plans the shared-desktop send");
            appliedMatchesReply(h, reply);
            assert.equal(h.mover.output.name, "out-bottom");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-a"],
            );
            assert.equal(h.workspace["activeWindow"], h.mover, "follow focuses the mover");
            assert.equal(sendPayloads(h).length, 1, "no replay");
        } finally {
            await h.stop();
        }
    });

    it("stays on the source MRU survivor with no switch", async () => {
        const h = await makeHarness();
        try {
            // Seed source focus history through the real Engine so the stay
            // reply names the MRU survivor: focus win-1, then the mover.
            h.workspace["activeWindow"] = winByStableId(h, "o-win-1");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = h.mover;
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.handle.requestSendToOutput("down", false);
            assert.equal(sendPayloads(h).length, 1);
            await h.flush();
            const sendCall = sendPayloads(h)[0];
            assert.ok(sendCall !== undefined);
            const reply = JSON.parse(h.replies.get(sendCall.index) as string) as Record<string, unknown>;
            assert.equal(reply["outcome"], "planned", "real Engine plans the output stay");
            assert.equal((reply["operation"] as Record<string, unknown>)["follow"], false);
            appliedMatchesReply(h, reply);
            const survivor = winByStableId(h, "o-win-1");
            assert.equal(h.mover.output.name, "out-bottom");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-b"],
            );
            assert.equal(h.workspace["activeWindow"], survivor, "source MRU survivor keeps focus");
            assert.equal(h.currentByOutput.get(h.outputs.top)?.id, "ws-a", "source stays selected");
            assert.equal(sendPayloads(h).length, 1, "no replay");
        } finally {
            await h.stop();
        }
    });

    it("waits for delayed output arrival, follows once, never replays", async () => {
        const h = await makeHarness();
        try {
            h.deferredTransfer = true;
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1);
            await h.flush();
            // Transfer recorded but not yet applied: membership and geometry
            // applied around it, arrival unproven, no follow yet.
            assert.equal(h.pendingTransfers.length, 1, "transfer initiated exactly once");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-b"],
                "membership applied while output lags",
            );
            assert.equal(h.mover.output.name, "out-top", "output still lagging");
            assert.equal(followCount(h), 0, "no follow before arrival proof");
            // Delayed native output lands with its signal: exactly one
            // follow, then settlement.
            const [pending] = h.pendingTransfers;
            assert.ok(pending !== undefined);
            pending.client.output = pending.output;
            pending.client.outputSig.fire();
            assert.equal(h.mover.output.name, "out-bottom");
            assert.equal(h.workspace["activeWindow"], h.mover);
            assert.equal(followCount(h), 1, "exactly one follow after delayed arrival");
            // Late duplicate signals never replay.
            const mover = h.mover;
            mover.outputSig.fire();
            mover.desktopsSig.fire();
            assert.equal(followCount(h), 1, "no replay on duplicate signals");
            assert.equal(sendPayloads(h).length, 1, "no replay dispatch");
            h.fireTimers(WORKSPACE_SEND_TIMEOUT_MS);
            assert.equal(sendPayloads(h).length, 1, "deadline post-settlement is a no-op");
        } finally {
            await h.stop();
        }
    });

    it("stops with zero subsequent setters when the mover closes reentrantly during transfer", async () => {
        // The output signal fires synchronously inside the transfer setter;
        // the reentrant close must stop membership, geometry, and follow,
        // then settle with a forced reconcile and no replay.
        const h = await makeHarness();
        try {
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1);
            const mover = h.mover;
            mover.outputSig.handlers.add(() => {
                h.removeWindow(mover);
            });
            const framesBefore = new Map(h.wins.map((win) => [win.internalId, { ...win.frameGeometry }]));
            await h.flush();
            assert.equal(sendPayloads(h).length, 1, "transfer initiated once, never replayed");
            const survivor = winByStableId(h, "o-win-1");
            assert.deepEqual({ ...survivor.frameGeometry }, framesBefore.get("o-win-1"), "no survivor geometry after close");
            const target = winByStableId(h, "o-win-t");
            assert.deepEqual({ ...target.frameGeometry }, framesBefore.get("o-win-t"), "no target geometry after close");
            assert.equal(followCount(h), 0, "no follow for a closed mover");
            // Forced reconcile still converges the surviving domains through
            // the real Engine.
            h.fireTimers(PLAN_DEBOUNCE_MS);
            const followUps = h.dbusCalls.filter((call) => call.method === "DescribePlan");
            assert.ok(followUps.length >= 1, "settlement forces a Plan refresh");
            await h.flushAll();
            assert.equal(sendPayloads(h).length, 1, "no replay after settlement");
        } finally {
            await h.stop();
        }
    });

    it("settles a delayed close with zero follow through the arrival deadline", async () => {
        // Transfer recorded but output lagging, membership and geometry
        // applied; then the mover closes with fully readable properties
        // (no throwing getters, no deleted props). Placement and live-mover
        // proofs must fail on window-list identity alone: zero follow, then
        // the bounded arrival deadline settles with a forced reconcile.
        const h = await makeHarness();
        try {
            h.deferredTransfer = true;
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1);
            await h.flush();
            assert.equal(h.pendingTransfers.length, 1, "transfer initiated exactly once");
            assert.equal(followCount(h), 0, "no follow before arrival proof");
            const mover = h.mover;
            const at = h.wins.indexOf(mover);
            assert.ok(at >= 0);
            h.wins.splice(at, 1);
            // The removed wrapper stays fully readable: lifetime must come
            // from window-list identity, never from property values.
            assert.equal(typeof mover.output.name, "string");
            h.fireTimers(WORKSPACE_SEND_TIMEOUT_MS);
            assert.equal(followCount(h), 0, "zero follow for a closed mover");
            assert.equal(sendPayloads(h).length, 1, "deadline settles without replay");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            assert.equal(sendPayloads(h).length, 1, "no replay after settlement");
        } finally {
            await h.stop();
        }
    });

    it("settles a delayed replacement with zero follow through the arrival deadline", async () => {
        // Same stable id, new live object while the output lags: the
        // retained ref no longer resolves in the window list, so neither
        // placement values (read off the stale wrapper) nor follow may
        // proceed.
        const h = await makeHarness();
        try {
            h.deferredTransfer = true;
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1);
            await h.flush();
            assert.equal(h.pendingTransfers.length, 1, "transfer initiated exactly once");
            assert.equal(followCount(h), 0, "no follow before arrival proof");
            const mover = h.mover;
            const at = h.wins.indexOf(mover);
            assert.ok(at >= 0);
            h.wins.splice(at, 1);
            const freshDesktops = makeSignal();
            const freshOutput = makeSignal();
            const freshFrame = makeSignal();
            const freshFull = makeSignal();
            const freshMax = makeSignal();
            h.wins.push({
                normalWindow: true,
                managed: true,
                minimized: false,
                fullScreen: false,
                maximizeMode: 0,
                onAllDesktops: false,
                output: h.outputs.top,
                desktops: [h.desktops.a],
                internalId: "o-win-2",
                frameGeometry: { x: 440, y: 20, width: 400, height: 300 },
                resourceClass: "app",
                desktopsChanged: freshDesktops.signal,
                outputChanged: freshOutput.signal,
                frameGeometryChanged: freshFrame.signal,
                fullScreenChanged: freshFull.signal,
                maximizedChanged: freshMax.signal,
                desktopsSig: freshDesktops,
                outputSig: freshOutput,
            });
            h.fireTimers(WORKSPACE_SEND_TIMEOUT_MS);
            assert.equal(followCount(h), 0, "zero follow for a replaced mover");
            assert.equal(sendPayloads(h).length, 1, "deadline settles without replay");
            assert.notEqual(h.workspace["activeWindow"], h.wins.find((win) => win.internalId === "o-win-2"), "never focuses by stable id alone");
        } finally {
            await h.stop();
        }
    });

    it("drifts before setters settle with zero writes", async () => {
        // Source view switch on a stay flight: the stay fence refuses before
        // any native setter.
        const stay = await makeHarness();
        try {
            stay.handle.requestSendToOutput("down", false);
            assert.equal(sendPayloads(stay).length, 1);
            stay.currentByOutput.set(stay.outputs.top, stay.desktops.b);
            const framesBefore = new Map(stay.wins.map((win) => [win.internalId, { ...win.frameGeometry }]));
            await stay.flush();
            assert.equal(stay.mover.output.name, "out-top", "no output transfer on drift");
            assert.deepEqual(
                stay.mover.desktops.map((entry) => entry.id),
                ["ws-a"],
                "no membership write on drift",
            );
            for (const win of stay.wins) {
                assert.deepEqual({ ...win.frameGeometry }, framesBefore.get(win.internalId), `no geometry write on ${win.internalId}`);
            }
            assert.equal(sendPayloads(stay).length, 1, "no replay after stale settle");
        } finally {
            await stay.stop();
        }
        // Target current drift: the frozen destination no longer matches the
        // live target, so the reply fence refuses with zero writes.
        const drift = await makeHarness();
        try {
            drift.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(drift).length, 1);
            drift.currentByOutput.set(drift.outputs.bottom, drift.desktops.a);
            const framesBefore = new Map(drift.wins.map((win) => [win.internalId, { ...win.frameGeometry }]));
            await drift.flush();
            assert.equal(drift.mover.output.name, "out-top", "no output transfer on target drift");
            assert.deepEqual(
                drift.mover.desktops.map((entry) => entry.id),
                ["ws-a"],
                "no membership write on target drift",
            );
            for (const win of drift.wins) {
                assert.deepEqual({ ...win.frameGeometry }, framesBefore.get(win.internalId), `no geometry write on ${win.internalId}`);
            }
        } finally {
            await drift.stop();
        }
    });

    it("moves membership-only across a floating boundary and reflows only tiled sides", async () => {
        const h = await makeHarness();
        try {
            h.handle.requestWorkspaceTilingToggle();
            await settlePlan(h);
            const framesBefore = new Map(h.wins.map((win) => [win.internalId, { ...win.frameGeometry }]));
            h.handle.requestSendToOutput("down", true);
            // No Rust send crosses a floating boundary.
            assert.equal(sendPayloads(h).length, 0, "membership-only path dispatches nothing");
            assert.equal(h.mover.output.name, "out-bottom", "output transferred natively");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-b"],
                "membership transferred natively",
            );
            assert.deepEqual({ ...h.mover.frameGeometry }, framesBefore.get(h.mover.internalId), "float frame unchanged");
            assert.equal(h.workspace["activeWindow"], h.mover, "follow focuses the mover");
            // Tiled-side reflow: the forced refresh reconciles the tiled
            // target domain through the real Engine while the floating
            // source receives no geometry.
            h.fireTimers(PLAN_DEBOUNCE_MS);
            const refresh = h.dbusCalls.filter((call) => call.method === "DescribePlan");
            assert.ok(refresh.length >= 1, "tiled-side refresh dispatched");
            await h.flushAll();
            for (const win of h.wins) {
                if (win.output.name === "out-top") {
                    assert.deepEqual({ ...win.frameGeometry }, framesBefore.get(win.internalId), `floating side untouched: ${win.internalId}`);
                }
            }
        } finally {
            await h.stop();
        }
    });

    it("crosses a sole root leaf down with the real Engine (R4 edge landing)", async () => {
        // Item 5.1: local rules win first, but a sole root leaf with an
        // adjacent output crosses. Seeded through two foreground reconciles
        // so both domains are retained, then the directional move goes down.
        const h = await makeHarness({ soloSource: true });
        try {
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = winByStableId(h, "o-win-t");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = winByStableId(h, "o-win-s");
            h.handle.requestMove("down");
            const moves = h.dbusCalls.filter((call) => {
                if (call.method !== "DescribePlan") {
                    return false;
                }
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    return ((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "move";
                } catch {
                    return false;
                }
            });
            assert.equal(moves.length, 1, "exactly one directional move dispatch");
            const moveBody = JSON.parse(moves[0]?.payload as string) as Record<string, unknown>;
            assert.equal((moveBody["domains"] as Array<unknown>).length, 2, "two-domain evidence rides the move");
            await h.flushAll();
            const moveIndex = h.dbusCalls.findIndex((call, at) => {
                if (call.method !== "DescribePlan" || !h.replies.has(at)) {
                    return false;
                }
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    return ((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "move";
                } catch {
                    return false;
                }
            });
            assert.ok(moveIndex >= 0, "move reply delivered");
            const moveReply = JSON.parse(h.replies.get(moveIndex) as string) as Record<string, unknown>;
            assert.equal(moveReply["outcome"], "planned", "real Engine plans the sole-leaf cross");
            assert.equal((moveReply["detail"] as Record<string, unknown>)["rule"], "R4", "sole root leaf crosses via R4");
            const mover = winByStableId(h, "o-win-s");
            assert.equal(mover.output.name, "out-bottom", "sole leaf crossed outputs");
            assert.deepEqual(
                mover.desktops.map((entry) => entry.id),
                ["ws-b"],
                "sole leaf lands in the destination workspace",
            );
            // R4 edge landing: the applied mover frame is exactly the
            // Engine-planned target rect.
            const planned = moveReply["desired_geometry"] as Array<Record<string, unknown>>;
            const moverPlanned = planned.find((entry) => entry["window"] === "o-win-s");
            assert.ok(moverPlanned !== undefined, "Engine plans the crossing mover on the target");
            assert.equal(moverPlanned["output"], "out-bottom");
            assert.deepEqual(frameOf(mover), moverPlanned["rect"], "applied landing matches the R4 plan");
            assert.equal(h.workspace["activeWindow"], mover, "follow keeps the crossing mover focused");
        } finally {
            await h.stop();
        }
    });

    it("crosses down to the non-left/top candidate with the real Engine (position-based R4)", async () => {
        // Multi-candidate integration: production observeDirectionalDomain
        // ranks two FULL down candidates by mover-centre x, selecting
        // out-bottom-right (centre x=1200 in [960,1920), not left/top).
        // The resolved pair rides a real Planner::evaluate R4; placement
        // uses the target WORK AREA, never FULL bounds; fences unchanged.
        const h = await makeHarness({ soloSource: true, splitBottom: true });
        try {
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = winByStableId(h, "o-win-u");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = winByStableId(h, "o-win-t");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            const leftBefore = { ...winByStableId(h, "o-win-u").frameGeometry };
            h.workspace["activeWindow"] = winByStableId(h, "o-win-s");
            h.handle.requestMove("down");
            const moves = h.dbusCalls.filter((call) => {
                if (call.method !== "DescribePlan") {
                    return false;
                }
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    return ((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "move";
                } catch {
                    return false;
                }
            });
            assert.equal(moves.length, 1, "exactly one directional move dispatch");
            const moveBody = JSON.parse(moves[0]?.payload as string) as Record<string, unknown>;
            const domains = moveBody["domains"] as Array<Record<string, unknown>>;
            assert.equal(domains.length, 2, "two-domain evidence rides the move");
            assert.equal(domains[0]?.["output"], "out-top");
            assert.equal(domains[1]?.["output"], "out-bottom-right", "mover-centre selects the non-left/top target");
            assert.equal(domains[1]?.["workspace"], "ws-c");
            assert.deepEqual(domains[0]?.["adjacent"], { down: "out-bottom-right" });
            assert.deepEqual(domains[1]?.["adjacent"], { up: "out-top" });
            // Carried bounds are per-desktop WORK AREAS, never FULL rects.
            assert.deepEqual(domains[1]?.["bounds"], { x: 960, y: 580, w: 960, h: 500 });
            await h.flushAll();
            const moveIndex = h.dbusCalls.findIndex((call, at) => {
                if (call.method !== "DescribePlan" || !h.replies.has(at)) {
                    return false;
                }
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    return ((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "move";
                } catch {
                    return false;
                }
            });
            assert.ok(moveIndex >= 0, "move reply delivered");
            const moveReply = JSON.parse(h.replies.get(moveIndex) as string) as Record<string, unknown>;
            assert.equal(moveReply["outcome"], "planned", "real Engine plans the position-based cross");
            assert.equal((moveReply["detail"] as Record<string, unknown>)["rule"], "R4", "cross uses R4");
            appliedMatchesReply(h, moveReply);
            const mover = winByStableId(h, "o-win-s");
            assert.equal(mover.output.name, "out-bottom-right", "mover natively on the chosen target");
            assert.deepEqual(
                mover.desktops.map((entry) => entry.id),
                ["ws-c"],
                "mover lands in the chosen target workspace",
            );
            const planned = moveReply["desired_geometry"] as Array<Record<string, unknown>>;
            const moverPlanned = planned.find((entry) => entry["window"] === "o-win-s");
            assert.ok(moverPlanned !== undefined, "Engine plans the crossing mover on the target");
            assert.equal(moverPlanned["output"], "out-bottom-right");
            const rect = moverPlanned["rect"] as { x: number; y: number; w: number; h: number };
            assert.ok(rect.x >= 960 && rect.y >= 580 && rect.x + rect.w <= 1920 && rect.y + rect.h <= 1080, `planned rect inside target work area, got ${JSON.stringify(rect)}`);
            assert.ok(!(rect.y === 540 && rect.h === 540), "planned rect is not FULL bounds");
            assert.deepEqual(frameOf(mover), moverPlanned["rect"], "applied landing matches the R4 plan");
            // Unchosen left candidate untouched: no transfer, membership, geometry.
            const left = winByStableId(h, "o-win-u");
            assert.equal(left.output.name, "out-bottom");
            assert.deepEqual(
                left.desktops.map((entry) => entry.id),
                ["ws-b"],
            );
            assert.deepEqual({ ...left.frameGeometry }, leftBefore);
            assert.equal(h.workspace["activeWindow"], mover, "follow keeps the crossing mover focused");
        } finally {
            await h.stop();
        }
    });

    it("sends down to the non-left/top candidate with the real Engine (position-based send)", async () => {
        // Same split topology on the explicit send route: the mover sits
        // right-of-centre, so requestSendToOutput resolves out-bottom-right.
        const h = await makeHarness({ splitBottom: true });
        try {
            h.handle.requestSendToOutput("down", true);
            assert.equal(sendPayloads(h).length, 1, "exactly one send-to-output dispatch, no replay at dispatch");
            const sent = sendPayloads(h)[0]?.body as Record<string, unknown>;
            assert.equal((sent["target_domain"] as Record<string, unknown>)["output"], "out-bottom-right", "mover-centre selects the non-left/top target");
            assert.equal((sent["target_domain"] as Record<string, unknown>)["workspace"], "ws-c");
            await h.flush();
            const sendCall = sendPayloads(h)[0];
            assert.ok(sendCall !== undefined);
            const reply = JSON.parse(h.replies.get(sendCall.index) as string) as Record<string, unknown>;
            assert.equal(reply["outcome"], "planned", `real Engine plans the position-based send, got ${JSON.stringify(reply).slice(0, 200)}`);
            assert.equal(reply["kind"], "send-to-output");
            appliedMatchesReply(h, reply);
            assert.equal(h.mover.output.name, "out-bottom-right");
            assert.deepEqual(
                h.mover.desktops.map((entry) => entry.id),
                ["ws-c"],
            );
            assert.equal(h.workspace["activeWindow"], h.mover);
            assert.equal(followCount(h), 1, "exactly one follow, no replay");
            const left = winByStableId(h, "o-win-u");
            assert.equal(left.output.name, "out-bottom");
            assert.deepEqual(
                left.desktops.map((entry) => entry.id),
                ["ws-b"],
            );
            assert.equal(sendPayloads(h).length, 1, "no replay");
        } finally {
            await h.stop();
        }
    });

    it("stops an R4 cross with zero subsequent setters when the mover closes reentrantly", async () => {
        // Same homeless-half class on the R4 route: the mover closes inside
        // the transfer setter, so the inter-setter lifetime proof fails
        // before membership with no geometry or follow. The removed wrapper
        // stays fully readable and writable here (no throwing getters, no
        // deleted props): lifetime must come from window-list identity,
        // never from retained property values.
        const h = await makeHarness({ soloSource: true });
        try {
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = winByStableId(h, "o-win-t");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            const mover = winByStableId(h, "o-win-s");
            h.workspace["activeWindow"] = mover;
            mover.outputSig.handlers.add(() => {
                const at = h.wins.indexOf(mover);
                if (at >= 0) {
                    h.wins.splice(at, 1);
                }
            });
            const targetFrameBefore = { ...winByStableId(h, "o-win-t").frameGeometry };
            h.handle.requestMove("down");
            await h.flushAll();
            const target = winByStableId(h, "o-win-t");
            assert.deepEqual(
                target.desktops.map((entry) => entry.id),
                ["ws-b"],
                "no membership side effects on the target",
            );
            assert.deepEqual({ ...target.frameGeometry }, targetFrameBefore, "no R4 geometry after close");
            const r4Follows = h.logs.filter((line) => line.includes("r4-followed")).length;
            assert.equal(r4Follows, 0, "no R4 follow after close");
            assert.ok(
                h.logs.some((line) => line.includes("stale-scope")),
                "inter-setter lifetime failure settles terminal",
            );
        } finally {
            await h.stop();
        }
    });

    it("stops an R4 cross with zero follow when the mover is replaced reentrantly", async () => {
        // Same stable id, new live object inside the transfer setter: the
        // retained ref no longer resolves in the window list, so membership,
        // geometry, and follow all refuse.
        const h = await makeHarness({ soloSource: true });
        try {
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = winByStableId(h, "o-win-t");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            const mover = winByStableId(h, "o-win-s");
            h.workspace["activeWindow"] = mover;
            mover.outputSig.handlers.add(() => {
                const at = h.wins.indexOf(mover);
                if (at >= 0) {
                    h.wins.splice(at, 1);
                }
                const freshDesktops = makeSignal();
                const freshOutput = makeSignal();
                const freshFrame = makeSignal();
                const freshFull = makeSignal();
                const freshMax = makeSignal();
                h.wins.push({
                    normalWindow: true,
                    managed: true,
                    minimized: false,
                    fullScreen: false,
                    maximizeMode: 0,
                    onAllDesktops: false,
                    output: h.outputs.top,
                    desktops: [h.desktops.a],
                    internalId: "o-win-s",
                    frameGeometry: { x: 20, y: 20, width: 400, height: 300 },
                    resourceClass: "app",
                    desktopsChanged: freshDesktops.signal,
                    outputChanged: freshOutput.signal,
                    frameGeometryChanged: freshFrame.signal,
                    fullScreenChanged: freshFull.signal,
                    maximizedChanged: freshMax.signal,
                    desktopsSig: freshDesktops,
                    outputSig: freshOutput,
                });
            });
            const targetFrameBefore = { ...winByStableId(h, "o-win-t").frameGeometry };
            h.handle.requestMove("down");
            await h.flushAll();
            const target = winByStableId(h, "o-win-t");
            assert.deepEqual({ ...target.frameGeometry }, targetFrameBefore, "no R4 geometry after replace");
            const r4Follows = h.logs.filter((line) => line.includes("r4-followed")).length;
            assert.equal(r4Follows, 0, "no R4 follow after replace");
            assert.ok(
                h.logs.some((line) => line.includes("stale-scope")),
                "inter-setter lifetime failure settles terminal",
            );
        } finally {
            await h.stop();
        }
    });

    it("keeps a horizontal move local with the real Engine (local first)", async () => {
        // No right-hand candidate exists on the stacked pair, so the move
        // stays local: no output transfer, local geometry only.
        const h = await makeHarness({ twinSource: true });
        try {
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            h.workspace["activeWindow"] = winByStableId(h, "o-win-t");
            h.fireTimers(PLAN_DEBOUNCE_MS);
            await h.flushAll();
            const first = winByStableId(h, "o-win-1");
            h.workspace["activeWindow"] = first;
            h.handle.requestMove("right");
            await h.flushAll();
            const localReplies: Record<string, unknown>[] = [];
            for (const [at, call] of h.dbusCalls.entries()) {
                if (call.method !== "DescribePlan" || !h.replies.has(at)) {
                    continue;
                }
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    if (((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "move") {
                        localReplies.push(JSON.parse(h.replies.get(at) as string) as Record<string, unknown>);
                    }
                } catch {
                    continue;
                }
            }
            assert.ok(localReplies.length >= 1, "local move dispatched");
            const localReply = localReplies[localReplies.length - 1] as Record<string, unknown>;
            assert.equal(localReply["outcome"], "planned", "real Engine plans the local move");
            assert.ok(
                localReply["operation"] === null || localReply["operation"] === undefined,
                "local plan carries no cross operation",
            );
            for (const win of h.wins) {
                assert.ok(win.output.name === "out-top" || win.internalId === "o-win-t", `no output transfer for ${win.internalId}`);
            }
            const moved = winByStableId(h, "o-win-1");
            assert.equal(moved.output.name, "out-top", "mover stays on the source output");
            const replies: Record<string, unknown>[] = [];
            for (const call of h.dbusCalls) {
                if (call.method !== "DescribePlan") {
                    continue;
                }
                try {
                    const body = JSON.parse(call.payload) as Record<string, unknown>;
                    if (((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "move") {
                        replies.push(body);
                    }
                } catch {
                    continue;
                }
            }
            assert.ok(replies.length >= 1, "local move dispatched");
        } finally {
            await h.stop();
        }
    });
});

// Applied-geometry assertion keyed off a delivered Engine reply: every
// desired_geometry entry must be natively present with the planned output.
function appliedMatchesReply(harness: Harness, reply: Record<string, unknown>): void {
    const geometry = reply["desired_geometry"] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(geometry) && geometry.length > 0, "real reply carries both-domain geometry");
    for (const entry of geometry) {
        const win = winByStableId(harness, entry["window"] as string);
        assert.deepEqual(frameOf(win), entry["rect"], `native frame of ${entry["window"]} matches the Engine plan`);
        assert.equal(win.output.name, entry["output"], `native output of ${entry["window"]} matches the Engine plan`);
    }
}
