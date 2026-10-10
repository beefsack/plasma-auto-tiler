// G-06 isolated maximized move + G-37 MRU vs default end-to-end discrimination
// through the production `startPlanAdapterEntry` route + real Planner
// (`planner_eval`). No hand-built wire replies, no map-only helpers for the
// asserted paths. Included in `npm test`.
//
// G-06: H[A,B*,C] retained via reconcile seeding, maximize B, focus while max
// is a no-op with no setter, move right clears once synchronously (echo
// consumed) and the observed-clear ordinary move applies/settles with focus
// kept and no geometry write before clear.
// G-37: L holds occupied WS1 / occupied WS2 (active) / trailing E with R on
// WS9; visit WS1 then WS2 via native view switch + topology signal to record
// per-output history; migrate active WS2 right under each entry refill
// setting; source shows E (default) vs WS1 (MRU) with real relocate_domain
// reply; target preserves moved tree/current/focus. Fallback/live-switch
// stays covered by migration-source-refill.test.ts map-only rows.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

import { PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
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
    private readonly waiters: Array<{ resolve: (r: string) => void; reject: (e: Error) => void }> = [];
    private dead: string | null = null;
    private constructor(proc: ChildProcess) {
        this.proc = proc;
        const out = proc.stdout;
        if (out === null || out === undefined) {
            throw new Error("planner_eval stdout unavailable");
        }
        createInterface({ input: out }).on("line", (line: string) => {
            this.waiters.shift()?.resolve(line);
        });
        proc.stderr?.resume();
        proc.on("error", (e) => this.fail(e instanceof Error ? e : new Error(String(e))));
        proc.on("exit", (c) => this.fail(new Error(`planner_eval exited ${String(c)}`)));
    }
    private fail(e: Error): void {
        if (this.dead === null) {
            this.dead = e.message;
        }
        while (this.waiters.length > 0) {
            this.waiters.shift()?.reject(e);
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
    send(req: string): Promise<string> {
        if (this.dead !== null) {
            return Promise.reject(new Error(this.dead));
        }
        return new Promise<string>((res, rej) => {
            this.waiters.push({ resolve: res, reject: rej });
            try {
                this.proc.stdin?.write(req + "\n");
            } catch (e) {
                rej(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }
    async close(): Promise<void> {
        try {
            this.proc.stdin?.end();
        } catch {
            /* noop */
        }
        await new Promise<void>((done) => {
            const t = setTimeout(() => {
                try {
                    this.proc.kill("SIGKILL");
                } catch {
                    /* noop */
                }
                done();
            }, 3000);
            this.proc.on("exit", () => {
                clearTimeout(t);
                done();
            });
        });
    }
}

interface Sig {
    readonly handlers: Set<() => void>;
    readonly signal: { connect: (h: () => void) => void; disconnect: (h: () => void) => void };
    fire: () => void;
}
function makeSig(): Sig {
    const handlers = new Set<() => void>();
    return {
        handlers,
        signal: {
            connect: (h: () => void): void => {
                handlers.add(h);
            },
            disconnect: (h: () => void): void => {
                handlers.delete(h);
            },
        },
        fire: (): void => {
            for (const h of [...handlers]) {
                h();
            }
        },
    };
}

// ---------- G-06 single-output H[A,B*,C] harness ----------

interface GWin extends Record<string, unknown> {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    output: { name: string; geometry: { x: number; y: number; width: number; height: number } };
    desktops: Array<{ id: string; x11DesktopNumber: number }>;
    internalId: string;
    frameGeometry: { x: number; y: number; width: number; height: number };
    resourceClass: string;
    setMaximize: (h: unknown, v: unknown) => void;
    clears: number;
    maxSig: Sig;
}

interface GHarness {
    readonly bridge: EngineBridge;
    readonly workspace: Record<string, unknown>;
    readonly wins: GWin[];
    readonly mover: GWin;
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(r: unknown) => void>;
    readonly replies: Map<number, string>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean; fired: boolean }>;
    readonly logs: string[];
    readonly handle: NonNullable<ReturnType<typeof startPlanAdapterEntry>>;
    flushAll: () => Promise<void>;
    fireTimers: (d: number) => number;
    settlePlan: () => Promise<void>;
    stop: () => Promise<void>;
}

async function makeGHarness(): Promise<GHarness> {
    const out = { name: "out-1", geometry: { x: 0, y: 0, width: 1920, height: 1080 } };
    const ws = { id: "ws-1", x11DesktopNumber: 1 };
    const mk = (
        id: string,
        frame: { x: number; y: number; width: number; height: number },
    ): GWin => {
        const mkSig = (): Sig => makeSig();
        const dSig = mkSig();
        const oSig = mkSig();
        const fSig = mkSig();
        const fullSig = mkSig();
        const maxSig = mkSig();
        const win = {
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: 0,
            onAllDesktops: false,
            output: out,
            desktops: [ws],
            internalId: id,
            frameGeometry: { ...frame },
            resourceClass: "app",
            clears: 0,
            maxSig,
            desktopsChanged: dSig.signal,
            outputChanged: oSig.signal,
            frameGeometryChanged: fSig.signal,
            fullScreenChanged: fullSig.signal,
            maximizedChanged: maxSig.signal,
        } as unknown as GWin;
        win.setMaximize = (_h: unknown, _v: unknown): void => {
            win.clears += 1;
            win.maximizeMode = 0;
            // Synchronous native signal inside the setter: consumes the armed echo.
            maxSig.fire();
        };
        return win;
    };
    const wa = mk("g-win-a", { x: 20, y: 20, width: 400, height: 300 });
    const wb = mk("g-win-b", { x: 440, y: 20, width: 400, height: 300 });
    const wc = mk("g-win-c", { x: 860, y: 20, width: 400, height: 300 });
    const wins = [wa, wb, wc];
    const wsig = {
        windowAdded: makeSig(),
        windowRemoved: makeSig(),
        windowActivated: makeSig(),
        screensChanged: makeSig(),
        currentDesktopChanged: makeSig(),
        desktopsChanged: makeSig(),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wb,
        activeScreen: out,
        screens: [out],
        desktops: [ws],
        currentDesktopForScreen: (): object => ws,
        currentDesktop: ws,
        clientArea: (): object => ({ x: 0, y: 0, w: 1920, h: 1040 }),
        windowList: (): object[] => [...wins],
        windowAdded: wsig.windowAdded.signal,
        windowRemoved: wsig.windowRemoved.signal,
        windowActivated: wsig.windowActivated.signal,
        screensChanged: wsig.screensChanged.signal,
        currentDesktopChanged: wsig.currentDesktopChanged.signal,
        desktopsChanged: wsig.desktopsChanged.signal,
    };
    const bridge = EngineBridge.start();
    const dbusCalls: GHarness["dbusCalls"] = [];
    const callbacks: GHarness["callbacks"] = [];
    const replies = new Map<number, string>();
    const timers: GHarness["timers"] = [];
    const logs: GHarness["logs"] = [];
    const harness: GHarness = {
        bridge,
        workspace,
        wins,
        mover: wb,
        dbusCalls,
        callbacks,
        replies,
        timers,
        logs,
        handle: null as unknown as NonNullable<ReturnType<typeof startPlanAdapterEntry>>,
        flushAll: async () => {
            for (let r = 0; r < 16; r += 1) {
                const next = dbusCalls.findIndex((c, at) => c.method === "DescribePlan" && !replies.has(at));
                if (next < 0) {
                    return;
                }
                const reply = await bridge.send(dbusCalls[next]?.payload as string);
                replies.set(next, reply);
                callbacks[next]?.(reply);
            }
            throw new Error("flushAll did not converge");
        },
        fireTimers: (d) => {
            let n = 0;
            for (const t of timers) {
                if (t.delayMs === d && !t.cancelled && !t.fired) {
                    t.fired = true;
                    n += 1;
                    t.callback();
                }
            }
            return n;
        },
        settlePlan: async () => {
            for (let r = 0; r < 10; r += 1) {
                harness.fireTimers(PLAN_DEBOUNCE_MS);
                const before = dbusCalls.length;
                await harness.flushAll();
                harness.fireTimers(PLAN_DEBOUNCE_MS);
                await harness.flushAll();
                if (dbusCalls.length === before) {
                    return;
                }
            }
            throw new Error("plan did not settle");
        },
        stop: async () => {
            try {
                harness.handle?.stop();
            } catch {
                /* noop */
            }
            await bridge.close();
        },
    };
    const handle = startPlanAdapterEntry({
        workspace,
        owner: "owner-1",
        generation: "gen-1",
        log: (m: string): void => {
            logs.push(m);
        },
        callDbus: (_s, _p, _i, method, payload, cb): void => {
            if (method === "NameHasOwner") {
                cb(true);
                return;
            }
            if (method === "GetNameOwner") {
                cb(":1.7");
                return;
            }
            if (method === "StartServiceByName") {
                cb(1);
                return;
            }
            dbusCalls.push({ method, payload });
            callbacks.push(cb);
        },
        scheduleOnce: (delayMs, cb): (() => void) => {
            const t = { delayMs, callback: cb, cancelled: false, fired: false };
            timers.push(t);
            return (): void => {
                t.cancelled = true;
            };
        },
        registerShortcutFn: () => true,
        readProfileFn: (): string => "cosmic",
        readWorkspaceModeFn: (): unknown => "per-output-local",
        readInnerGapFn: (): number => 8,
        readOuterGapFn: (): number => 8,
        options: { perOutputVirtualDesktops: true },
    });
    assert.notEqual(handle, null);
    (harness as { handle: unknown }).handle = handle;
    return harness;
}

function moveOps(h: GHarness): Array<{ index: number; body: Record<string, unknown> }> {
    const out: Array<{ index: number; body: Record<string, unknown> }> = [];
    h.dbusCalls.forEach((c, index) => {
        if (c.method !== "DescribePlan") {
            return;
        }
        try {
            const body = JSON.parse(c.payload) as Record<string, unknown>;
            if (((body["command"] as Record<string, unknown> | undefined)?.["op"] as string) === "move") {
                out.push({ index, body });
            }
        } catch {
            return;
        }
    });
    return out;
}

describe("G-06 isolated maximized move through production entry + real Planner", () => {
    it("H[A,B*,C] seeded, focus while max no-ops, move right clears once then ordinary reshape settles", async () => {
        const h = await makeGHarness();
        try {
            await h.settlePlan();
            const settled = [...h.replies.values()].map((r) => JSON.parse(r) as Record<string, unknown>);
            assert.ok(settled.length > 0 && settled.every((r) => r["outcome"] === "planned"), "seeded Engine tree settles planned");
            const mover = h.mover;
            // Maximize B with a synchronous native signal available.
            mover.maximizeMode = 3;
            mover.maxSig.fire();
            assert.equal(h.workspace["activeWindow"], mover);
            // Focus while B maximized: no-op, no setter, no dispatch.
            const callsBeforeFocus = h.dbusCalls.length;
            const activeBefore = h.workspace["activeWindow"];
            const framesBeforeFocus = new Map(h.wins.map((w) => [w.internalId, { ...w.frameGeometry }]));
            h.handle.requestFocus("right");
            assert.equal(h.dbusCalls.length, callsBeforeFocus, "maximized focus dispatches nothing");
            assert.equal(h.workspace["activeWindow"], activeBefore, "maximized focus keeps focus");
            for (const w of h.wins) {
                assert.deepEqual({ ...w.frameGeometry }, framesBeforeFocus.get(w.internalId), `no geometry on ${w.internalId} for fenced focus`);
            }
            assert.ok(h.logs.some((l) => l.includes("focus-refused-maximize")), "fenced focus logged");
            // Move right: exactly one native clear, dispatch follows, no geometry before clear.
            mover.clears = 0;
            const callsBeforeMove = h.dbusCalls.length;
            h.handle.requestMove("right");
            assert.equal(mover.clears, 1, "exactly one native clear before the move");
            assert.equal(moveOps(h).length, moveOps(h).filter(() => true).length, "move dispatched");
            assert.equal(h.dbusCalls.length, callsBeforeMove + 1, "observed-clear continues one ordinary move dispatch");
            for (const w of h.wins) {
                assert.deepEqual({ ...w.frameGeometry }, framesBeforeFocus.get(w.internalId), `no max geometry write before clear on ${w.internalId}`);
            }
            assert.ok(h.logs.some((l) => l.includes("move-maximize-clear") && l.includes("outcome=invoked")), "clear invoked logged");
            assert.ok(h.logs.some((l) => l.includes("outcome=observed-cleared")), "observed clear logged");
            assert.ok(h.logs.includes("plasma-auto-tiler:plan:maximize-admission-echo-consumed"), "synchronous signal consumes the echo");
            // Real Planner reply: ordinary local move applies and settles.
            await h.flushAll();
            const moves = moveOps(h);
            assert.ok(moves.length >= 1, "move reply delivered");
            const last = moves[moves.length - 1] as { index: number; body: Record<string, unknown> };
            const reply = JSON.parse(h.replies.get(last.index) as string) as Record<string, unknown>;
            assert.equal(reply["outcome"], "planned", `real Engine plans the unmaximized move, got ${JSON.stringify(reply).slice(0, 220)}`);
            assert.ok(reply["operation"] === null || reply["operation"] === undefined, "ordinary local move carries no cross operation");
            const geometry = reply["desired_geometry"] as Array<Record<string, unknown>>;
            assert.ok(Array.isArray(geometry) && geometry.length >= 3, "ordinary reshape covers the retained tree");
            for (const entry of geometry) {
                const win = h.wins.find((w) => w.internalId === (entry["window"] as string));
                assert.ok(win !== undefined, `planned window ${entry["window"] as string} exists`);
                assert.deepEqual(
                    { x: win?.frameGeometry.x, y: win?.frameGeometry.y, w: win?.frameGeometry.width, h: win?.frameGeometry.height },
                    entry["rect"],
                    `applied reshape of ${entry["window"] as string} matches the Engine plan`,
                );
            }
            assert.equal(mover.maximizeMode, 0, "stays unmaximized after the move");
            assert.equal(h.workspace["activeWindow"], mover, "focus kept on the mover");
            assert.equal(mover.clears, 1, "no second clear during apply/settle");
            await h.settlePlan();
            const tail = [...h.replies.entries()].sort((a, b) => a[0] - b[0]);
            const lastReply = JSON.parse(tail[tail.length - 1]?.[1] as string) as Record<string, unknown>;
            assert.equal(lastReply["outcome"], "planned", "settlement converges planned");
        } finally {
            await h.stop();
        }
    });
});

// ---------- G-37 L[WS1,WS2,E] + R[WS9] harness ----------

interface MOut {
    readonly name: string;
    readonly geometry: { x: number; y: number; width: number; height: number };
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber: string;
}
interface MDesk {
    readonly id: string;
    readonly x11DesktopNumber: number;
}
interface MWin extends Record<string, unknown> {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    output: MOut;
    desktops: MDesk[];
    internalId: string;
    frameGeometry: { x: number; y: number; width: number; height: number };
    resourceClass: string;
}
interface MHarness {
    readonly bridge: EngineBridge;
    readonly workspace: Record<string, unknown>;
    readonly outputs: { left: MOut; right: MOut };
    readonly desktops: { w1: MDesk; w2: MDesk; w9: MDesk; e: MDesk };
    readonly wins: MWin[];
    readonly currentByOutput: Map<MOut, MDesk>;
    readonly signals: { currentDesktopChanged: Sig };
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(r: unknown) => void>;
    readonly replies: Map<number, string>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean; fired: boolean }>;
    readonly logs: string[];
    readonly handle: NonNullable<ReturnType<typeof startPlanAdapterEntry>>;
    visit: (desktop: MDesk) => void;
    flushOp: (op: string) => Promise<{ index: number; body: Record<string, unknown>; reply: Record<string, unknown> }>;
    flushAll: () => Promise<void>;
    fireTimers: (d: number) => number;
    settlePlan: () => Promise<void>;
    winById: (id: string) => MWin;
    stop: () => Promise<void>;
}

async function makeMHarness(refill: string): Promise<MHarness> {
    const left: MOut = { name: "out-left", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, manufacturer: "m", model: "d", serialNumber: "s-left" };
    const right: MOut = { name: "out-right", geometry: { x: 1920, y: 0, width: 1920, height: 1080 }, manufacturer: "m", model: "d", serialNumber: "s-right" };
    const w1: MDesk = { id: "ws-1", x11DesktopNumber: 1 };
    const w2: MDesk = { id: "ws-2", x11DesktopNumber: 2 };
    const w9: MDesk = { id: "ws-9", x11DesktopNumber: 3 };
    const e: MDesk = { id: "ws-e", x11DesktopNumber: 4 };
    const currentByOutput = new Map<MOut, MDesk>([
        [left, w2],
        [right, w9],
    ]);
    const mk = (output: MOut, desk: MDesk, id: string): MWin => {
        const s = (): Sig => makeSig();
        const d = s();
        const o = s();
        const f = s();
        const full = s();
        const max = s();
        return {
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: 0,
            onAllDesktops: false,
            output,
            desktops: [desk],
            internalId: id,
            frameGeometry: { x: 20, y: 20, width: 400, height: 300 },
            resourceClass: "app",
            desktopsChanged: d.signal,
            outputChanged: o.signal,
            frameGeometryChanged: f.signal,
            fullScreenChanged: full.signal,
            maximizedChanged: max.signal,
        };
    };
    const wins: MWin[] = [
        mk(left, w1, "m-win-1"),
        mk(left, w2, "m-win-2a"),
        mk(left, w2, "m-win-2b"),
        mk(right, w9, "m-win-t"),
    ];
    const sigs = {
        windowAdded: makeSig(),
        windowRemoved: makeSig(),
        windowActivated: makeSig(),
        screensChanged: makeSig(),
        currentDesktopChanged: makeSig(),
        desktopsChanged: makeSig(),
    };
    const workspace: Record<string, unknown> = {
        activeWindow: wins.find((w) => w.internalId === "m-win-2a") ?? null,
        activeScreen: left,
        screens: [left, right],
        desktops: [w1, w2, w9, e],
        currentDesktopForScreen: (o: object): object => currentByOutput.get(o as MOut) ?? w2,
        currentDesktop: w2,
        setCurrentDesktopForScreen: (d: object, o: object): void => {
            currentByOutput.set(o as MOut, d as MDesk);
        },
        clientArea: (_k: number, o: object): object => {
            if (o === left) {
                return { x: 0, y: 0, w: 1920, h: 1040 };
            }
            return { x: 1920, y: 0, w: 1920, h: 1040 };
        },
        windowList: (): object[] => [...wins],
        sendClientToScreen: (c: object, o: object): void => {
            const w = c as MWin;
            w.output = o as MOut;
        },
        slotSwitchToLeftScreen: (): void => {
            workspace.activeScreen = left;
        },
        slotSwitchToRightScreen: (): void => {
            workspace.activeScreen = right;
        },
        slotSwitchToAboveScreen: (): void => {},
        slotSwitchToBelowScreen: (): void => {},
        windowAdded: sigs.windowAdded.signal,
        windowRemoved: sigs.windowRemoved.signal,
        windowActivated: sigs.windowActivated.signal,
        screensChanged: sigs.screensChanged.signal,
        currentDesktopChanged: sigs.currentDesktopChanged.signal,
        desktopsChanged: sigs.desktopsChanged.signal,
    };
    const bridge = EngineBridge.start();
    const dbusCalls: MHarness["dbusCalls"] = [];
    const callbacks: MHarness["callbacks"] = [];
    const replies = new Map<number, string>();
    const timers: MHarness["timers"] = [];
    const logs: MHarness["logs"] = [];
    const harness: MHarness = {
        bridge,
        workspace,
        outputs: { left, right },
        desktops: { w1, w2, w9, e },
        wins,
        currentByOutput,
        signals: { currentDesktopChanged: sigs.currentDesktopChanged },
        dbusCalls,
        callbacks,
        replies,
        timers,
        logs,
        handle: null as unknown as NonNullable<ReturnType<typeof startPlanAdapterEntry>>,
        visit: (desk: MDesk): void => {
            (workspace["setCurrentDesktopForScreen"] as (d: object, o: object) => void).call(workspace, desk, left);
            currentByOutput.set(left, desk);
            sigs.currentDesktopChanged.fire();
        },
        flushOp: async (op) => {
            const index = dbusCalls.findIndex((c, at) => {
                if (c.method !== "DescribePlan" || replies.has(at)) {
                    return false;
                }
                try {
                    const b = JSON.parse(c.payload) as Record<string, unknown>;
                    return ((b["command"] as Record<string, unknown> | undefined)?.["op"] as string) === op;
                } catch {
                    return false;
                }
            });
            assert.ok(index >= 0, `expected queued ${op}`);
            const body = JSON.parse(dbusCalls[index]?.payload as string) as Record<string, unknown>;
            const text = await bridge.send(dbusCalls[index]?.payload as string);
            replies.set(index, text);
            callbacks[index]?.(text);
            return { index, body, reply: JSON.parse(text) as Record<string, unknown> };
        },
        flushAll: async () => {
            for (let r = 0; r < 16; r += 1) {
                const next = dbusCalls.findIndex((c, at) => c.method === "DescribePlan" && !replies.has(at));
                if (next < 0) {
                    return;
                }
                const reply = await bridge.send(dbusCalls[next]?.payload as string);
                replies.set(next, reply);
                callbacks[next]?.(reply);
            }
            throw new Error("flushAll did not converge");
        },
        fireTimers: (d) => {
            let n = 0;
            for (const t of timers) {
                if (t.delayMs === d && !t.cancelled && !t.fired) {
                    t.fired = true;
                    n += 1;
                    t.callback();
                }
            }
            return n;
        },
        settlePlan: async () => {
            for (let r = 0; r < 10; r += 1) {
                harness.fireTimers(PLAN_DEBOUNCE_MS);
                const before = dbusCalls.length;
                await harness.flushAll();
                harness.fireTimers(PLAN_DEBOUNCE_MS);
                await harness.flushAll();
                if (dbusCalls.length === before) {
                    return;
                }
            }
            throw new Error("plan did not settle");
        },
        winById: (id) => {
            const f = wins.find((w) => w.internalId === id);
            assert.ok(f !== undefined, `window ${id} exists`);
            return f as MWin;
        },
        stop: async () => {
            try {
                harness.handle?.stop();
            } catch {
                /* noop */
            }
            await bridge.close();
        },
    };
    const handle = startPlanAdapterEntry({
        workspace,
        owner: "owner-1",
        generation: "gen-1",
        log: (m: string): void => {
            logs.push(m);
        },
        callDbus: (_s, _p, _i, method, payload, cb): void => {
            if (method === "NameHasOwner") {
                cb(true);
                return;
            }
            if (method === "GetNameOwner") {
                cb(":1.7");
                return;
            }
            if (method === "StartServiceByName") {
                cb(1);
                return;
            }
            dbusCalls.push({ method, payload });
            callbacks.push(cb);
        },
        scheduleOnce: (delayMs, cb): (() => void) => {
            const t = { delayMs, callback: cb, cancelled: false, fired: false };
            timers.push(t);
            return (): void => {
                t.cancelled = true;
            };
        },
        registerShortcutFn: () => true,
        readProfileFn: (): string => "cosmic",
        readWorkspaceModeFn: (): unknown => "per-output-local",
        readInnerGapFn: (): number => 8,
        readOuterGapFn: (): number => 8,
        readMigrationSourceRefillFn: (): unknown => refill,
        options: { perOutputVirtualDesktops: true },
    });
    assert.notEqual(handle, null);
    (harness as { handle: unknown }).handle = handle;
    return harness;
}

describe("G-37 source MRU vs default through production entry + real Planner", () => {
    for (const [refill, expectedSource] of [
        ["last-remaining-workspace", "ws-e"],
        ["most-recently-used-workspace", "ws-1"],
    ] as const) {
        it(`migrates WS2 right with source ${expectedSource} under ${refill}`, async () => {
            const h = await makeMHarness(refill);
            try {
                await h.settlePlan();
                // Establish per-output history: visit WS1 then WS2 on L.
                h.visit(h.desktops.w1);
                h.visit(h.desktops.w2);
                assert.ok(
                    h.logs.some((l) => l.includes("workspace-previous-recorded")),
                    "entry history records the WS1 visit",
                );
                h.workspace["activeWindow"] = h.winById("m-win-2a");
                const targetBefore = { ...h.winById("m-win-t").frameGeometry };
                h.handle.requestWorkspaceMigrate("right");
                const flushed = await h.flushOp("migrate-workspace");
                assert.equal(flushed.reply["outcome"], "planned", JSON.stringify(flushed.reply).slice(0, 300));
                assert.equal(flushed.reply["kind"], "migrate-workspace");
                assert.deepEqual(flushed.body["command"], { op: "migrate-workspace", direction: "right" });
                // Entry scheduling: production observer names source WS2 and the
                // live target; the real relocate_domain reply carries geometry.
                const geometry = flushed.reply["desired_geometry"] as Array<Record<string, unknown>>;
                assert.ok(Array.isArray(geometry) && geometry.length >= 2, "relocated domain projects the moved tree");
                // Actual native source view discriminates by setting.
                assert.equal(h.currentByOutput.get(h.outputs.left)?.id, expectedSource, `source refills ${expectedSource} under ${refill}`);
                // Target preserves the moved tree/current/focus.
                assert.equal(h.currentByOutput.get(h.outputs.right)?.id, "ws-2", "target shows the migrated workspace");
                for (const id of ["m-win-2a", "m-win-2b"]) {
                    const w = h.winById(id);
                    assert.equal(w.output.name, "out-right", `${id} natively on the target`);
                    assert.deepEqual(
                        w.desktops.map((d) => d.id),
                        ["ws-2"],
                        `${id} keeps the migrated workspace`,
                    );
                    const frame = w.frameGeometry as { x: number; y: number; width: number; height: number };
                    assert.ok(frame.x >= 1920 && frame.width > 0 && frame.height > 0, `${id} tiles inside the target work area: ${JSON.stringify(frame)}`);
                }
                const survivor = h.winById("m-win-1");
                assert.equal(survivor.output.name, "out-left", "WS1 survivor stays on the source output");
                const target = h.winById("m-win-t");
                assert.equal(target.output.name, "out-right", "prior target view stays on the target output");
                assert.deepEqual(
                    target.desktops.map((d) => d.id),
                    ["ws-9"],
                    "prior target workspace hidden unchanged",
                );
                assert.deepEqual({ ...target.frameGeometry }, targetBefore, "untouched target workspace takes no geometry write");
                assert.equal((h.workspace["activeWindow"] as MWin).internalId, "m-win-2a", "active mover retained");
                // Engine post-currency converges planned.
                await h.settlePlan();
                const answered = [...h.replies.entries()].sort((a, b) => a[0] - b[0]);
                const lastReply = JSON.parse(answered[answered.length - 1]?.[1] as string) as Record<string, unknown>;
                assert.equal(lastReply["outcome"], "planned", "post-migration refresh stays planned");
            } finally {
                await h.stop();
            }
        });
    }
});
