// Minimal vertical fixture: REAL production workspace-send observer/adapter
// against the REAL Rust Engine over the Planner codec seam.
//
// REAL parts: `startWorkspaceSendAdapterEntry` (production observeNative +
// actuation) on a scripted fake KWin surface; `Planner::evaluate` via the
// test-only `planner_eval` example (same validation/retained state as the
// shipped binary; only D-Bus is stubbed). Run: `npm test`.
//
// Six pre-AR11 scenarios below. Where shipped code cannot satisfy the AR11
// contract yet, the test asserts CURRENTLY EXPECTED behavior and carries a
// FUTURE note with the exact assertion update the send slice must make.
// Overclaim warning: nothing here executes unshipped contract rows
// (observation_seq / world_windows / send-observed); claims are limited to
// what each test executes. AR11 issued/transit/met/expired/expiry-latched,
// supersession and binding-loss must be asserted after the protocol ships;
// especially target focus proof, elsewhere classification and old-generation
// baseline/flight retirement cannot be verified with the legacy wire.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    WORKSPACE_SEND_DBUS_SERVICE,
    WORKSPACE_SEND_GET_OWNER_METHOD,
    WORKSPACE_SEND_HAS_OWNER_METHOD,
    WORKSPACE_SEND_METHOD,
    WORKSPACE_SEND_START_METHOD,
} from "../src/workspace-send-adapter";
import { startWorkspaceSendAdapterEntry } from "../src/workspace-send-adapter-entry";

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
        if (this.deathReason() !== null) {
            try {
                this.proc.stdin?.destroy();
            } catch (error) {
                void error;
            }
            return;
        }
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

async function waitFor(condition: () => boolean, label: string): Promise<void> {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > 45000) {
            throw new Error(`timeout: ${label}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

interface FakeSignal {
    connect: (handler: () => void) => void;
    disconnect: (handler: () => void) => void;
    fire: () => void;
    armed: () => boolean;
}

function makeSignal(): FakeSignal {
    const handlers = new Set<() => void>();
    return {
        connect: (handler) => {
            handlers.add(handler);
        },
        disconnect: (handler) => {
            handlers.delete(handler);
        },
        fire: () => {
            for (const handler of [...handlers]) {
                handler();
            }
        },
        armed: () => handlers.size > 0,
    };
}

interface FakeWindow {
    normalWindow: boolean;
    managed: boolean;
    minimized: boolean;
    fullScreen: boolean;
    maximizeMode: number;
    onAllDesktops: boolean;
    output: { name: string };
    desktops: Array<object>;
    internalId: string;
    frameGeometry: { x: number; y: number; width: number; height: number };
    desktopsChanged: FakeSignal;
    frameGeometryChanged: FakeSignal;
}

function makeWindow(id: string, output: { name: string }, desktop: object): FakeWindow {
    return {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        output,
        desktops: [desktop],
        internalId: id,
        frameGeometry: { x: 10, y: 10, width: 500, height: 300 },
        desktopsChanged: makeSignal(),
        frameGeometryChanged: makeSignal(),
    };
}

interface Harness {
    readonly win: { wa: FakeWindow; wb: FakeWindow; wt: FakeWindow; wc: FakeWindow; wd: FakeWindow };
    readonly desk: { d1: object; d2: object; d3: object; d4: object };
    readonly surface: Record<string, unknown>;
    readonly calls: Array<{ payload: string; reply: string }>;
    readonly timers: Array<{ callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly switches: object[];
    readonly bridge: EngineBridge;
    readonly requestSend: (target: unknown) => boolean;
    readonly stop: () => void;
    readonly breakReads: () => void;
    readonly setActive: (window: FakeWindow) => void;
    readonly setCurrent: (desktop: object) => void;
    flush: () => Promise<void>;
    queued: () => number;
    committed: () => boolean;
}

async function makeHarness(rewrite?: (index: number, payload: string) => string): Promise<Harness> {
    const out = { name: "out-1" };
    const d1 = { id: "ws-1" };
    const d2 = { id: "ws-2" };
    const d3 = { id: "ws-3" };
    const d4 = { id: "ws-4" };
    const wa = makeWindow("n-win-a", out, d1);
    const wb = makeWindow("n-win-b", out, d1);
    const wt = makeWindow("n-win-t", out, d2);
    // Independently scoped second domain for the disjoint-send probe: its own
    // source (ws-3), target (ws-4), and focused mover share nothing with the
    // ws-1 -> ws-2 flight.
    const wc = makeWindow("n-win-c", out, d3);
    const wd = makeWindow("n-win-d", out, d3);
    let current: object = d1;
    let failReads = false;
    // Identity matters: the observer, the echo fence, and the entry's native
    // writes all operate on these exact objects, so the test observes every
    // mutation the REAL adapter performs.
    const surface: Record<string, unknown> = {
        activeWindow: wa,
        currentDesktop: d1,
        screens: [out],
        desktops: [d1, d2, d3, d4],
        currentDesktopForScreen: (): object => current,
        setCurrentDesktopForScreen: (desktop: object): void => {
            current = desktop;
        },
        clientArea: (): object => ({ x: 0, y: 0, width: 1200, height: 800 }),
        windowList: (): Array<object> => {
            if (failReads) {
                throw new Error("windowList unavailable");
            }
            return [wa, wb, wt, wc, wd];
        },
    };
    const bridge = EngineBridge.start();
    const calls: Harness["calls"] = [];
    const timers: Harness["timers"] = [];
    const logs: string[] = [];
    const switches: object[] = [];
    const pending: Array<{ payload: string; callback: (reply: unknown) => void }> = [];
    const entry = startWorkspaceSendAdapterEntry({
        workspace: surface,
        callDbus: (service, _path, _iface, method, payload, callback) => {
            if (service === WORKSPACE_SEND_DBUS_SERVICE && method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                callback(true);
                return;
            }
            if (service === WORKSPACE_SEND_DBUS_SERVICE && method === WORKSPACE_SEND_GET_OWNER_METHOD) {
                callback(":1.7");
                return;
            }
            if (service === WORKSPACE_SEND_DBUS_SERVICE && method === WORKSPACE_SEND_START_METHOD) {
                callback(1);
                return;
            }
            if (method === WORKSPACE_SEND_METHOD) {
                pending.push({ payload, callback });
                return;
            }
            callback(undefined);
        },
        scheduleOnce: (_delayMs, callback) => {
            const timer = { callback, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
        log: (message) => {
            logs.push(message);
        },
        owner: "owner-1",
        generation: "gen-1",
        readInnerGapFn: () => 8,
        readOuterGapFn: () => 8,
    });
    if (entry === null) {
        await bridge.close();
        throw new Error("entry failed to start");
    }
    const rawSwitch = surface["setCurrentDesktopForScreen"] as (desktop: object) => void;
    surface["setCurrentDesktopForScreen"] = (desktop: object): void => {
        switches.push(desktop);
        rawSwitch(desktop);
    };
    return {
        win: { wa, wb, wt, wc, wd },
        desk: { d1, d2, d3, d4 },
        surface,
        calls,
        timers,
        logs,
        switches,
        bridge,
        requestSend: (target) => entry.requestSend(target),
        stop: () => entry.stop(),
        breakReads: () => {
            failReads = true;
        },
        setActive: (window) => {
            surface["activeWindow"] = window;
        },
        setCurrent: (desktop) => {
            current = desktop;
        },
        flush: async () => {
            const next = pending.shift();
            if (next === undefined) {
                return;
            }
            const index = calls.length;
            const call = { payload: next.payload, reply: "" };
            calls.push(call);
            const outgoing = rewrite !== undefined ? rewrite(index, next.payload) : next.payload;
            call.reply = await bridge.send(outgoing);
            next.callback(call.reply);
        },
        queued: () => pending.length,
        committed: () =>
            calls.some((call) => {
                try {
                    return (JSON.parse(call.reply) as Record<string, unknown>)["outcome"] === "committed";
                } catch (error) {
                    void error;
                    return false;
                }
            }),
    };
}

function fireEchoes(h: Harness): void {
    for (const w of [h.win.wa, h.win.wb, h.win.wt, h.win.wc, h.win.wd]) {
        w.desktopsChanged.fire();
        w.frameGeometryChanged.fire();
    }
}

// Drives one full send through REAL observer -> REAL Engine -> REAL actuation.
// Fails if any link (observation, planning, echo fence, ack/verify, follow)
// breaks, in either direction.
async function driveSend(h: Harness): Promise<void> {
    assert.equal(h.requestSend("ws-2"), true);
    await waitFor(() => h.queued() > 0, "request");
    await h.flush();
    await waitFor(() => h.win.wa.desktopsChanged.armed(), "echo fence armed");
    fireEchoes(h);
    await waitFor(() => h.queued() > 0, "ack");
    await h.flush();
    await waitFor(() => h.queued() > 0, "verify");
    await h.flush();
    await waitFor(() => h.committed(), "commit");
}

describe("workspace-send vertical fixture", () => {
    it("pre-AR11 happy path commits with legacy one-shot target follow", async () => {
        const h = await makeHarness();
        try {
            await driveSend(h);
            const request = JSON.parse(h.calls[0]?.payload ?? "") as Record<string, unknown>;
            // Observer fidelity: exact source/target membership and mover.
            assert.equal((request["command"] as Record<string, unknown>)["window"], "n-win-a");
            assert.equal(request["focused_window"], "n-win-a");
            assert.deepEqual(
                (request["windows"] as Array<Record<string, unknown>>).map((w) => w["window"]).sort(),
                ["n-win-a", "n-win-b"],
            );
            assert.deepEqual(
                (request["target_windows"] as Array<Record<string, unknown>>).map((w) => w["window"]),
                ["n-win-t"],
            );
            const planned = JSON.parse(h.calls[0]?.reply ?? "") as Record<string, unknown>;
            assert.equal(planned["outcome"], "planned");
            assert.equal(
                (planned["operation"] as Record<string, unknown>)["target_workspace"],
                "ws-2",
            );
            // Target native proof: mover off source, on exact target, with the
            // follow switching to that target and focusing the mover, once.
            assert.deepEqual(h.win.wa.desktops, [h.desk.d2]);
            assert.deepEqual(h.switches, [h.desk.d2]);
            assert.equal(h.surface["activeWindow"], h.win.wa);
            // CURRENTLY EXPECTED: this is legacy pre-commit follow. FUTURE
            // (AR11 met): assert target focus proof is observable from the
            // complete world index and follow happens after converged proof,
            // while preserving unrelated user focus. Today focus resolves
            // source-only.
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("pre-AR11 third-workspace escape fails closed on the real deadline", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true);
            await waitFor(() => h.queued() > 0, "request");
            await h.flush();
            await waitFor(() => h.win.wa.desktopsChanged.armed(), "echo fence armed");
            // Exactly one valid follow happened on real pre-escape proof.
            assert.deepEqual(h.switches, [h.desk.d2]);
            // Mover escapes to a same-output third workspace; echoes withheld.
            h.win.wa.desktops = [h.desk.d3];
            // The legacy observer has only the pair: an elsewhere mover is
            // invisible in both scoped lists, not classified nonexclusive.
            const deadline = h.timers[0];
            assert.ok(deadline, "deadline armed");
            deadline.callback();
            await waitFor(
                () => h.logs.some((line) => line.includes("timeout-request")),
                "deadline terminal",
            );
            // Expiry evidence: post-plan proof against ws-3 fails, the flight
            // terminates, the adapter disables, nothing commits, and no follow
            // fires after the escape.
            assert.ok(h.logs.some((line) => line.includes("verify-failed")));
            assert.ok(!h.committed());
            assert.deepEqual(h.switches, [h.desk.d2]);
            assert.equal(h.requestSend("ws-2"), false);
            // FUTURE (AR11 expired): assert complete world observation
            // explicitly identifies ws-3, never calls it nonexclusive or
            // closed, and send-observed with deadline attestation reconciles
            // the pair without terminal disable.
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("pre-AR11 failed setter leaves mover on source without fabricated commit", async () => {
        const h = await makeHarness();
        try {
            // Native fault at the exact seam the production entry writes: the
            // desktops setter swallows the write, so the REAL observer keeps
            // reporting the mover on source while the adapter believes it
            // dispatched. Everything downstream is production code.
            const sourceDesktops = h.win.wa.desktops;
            Object.defineProperty(h.win.wa, "desktops", {
                get: () => sourceDesktops,
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            assert.equal(h.requestSend("ws-2"), true);
            await waitFor(() => h.queued() > 0, "request");
            await h.flush();
            await waitFor(() => h.win.wa.desktopsChanged.armed(), "echo fence armed");
            // Geometry echoes arrive; the membership echo never does (native
            // never moved). The flight is in transit, mover still source.
            h.win.wb.desktopsChanged.fire();
            h.win.wt.desktopsChanged.fire();
            for (const w of [h.win.wa, h.win.wb, h.win.wt, h.win.wc, h.win.wd]) {
                w.frameGeometryChanged.fire();
            }
            // Transit at the Engine seam on the captured observer wire: the
            // dispatch observation (mover on source) classifies the live
            // pending as unresolved, never committed.
            const request = JSON.parse(h.calls[0]?.payload ?? "") as Record<string, unknown>;
            const planned = JSON.parse(h.calls[0]?.reply ?? "") as Record<string, unknown>;
            const status = {
                ...request,
                revision: planned["base_revision"],
                command: { op: "send-to-workspace-status" },
            };
            const statusReply = JSON.parse(await h.bridge.send(JSON.stringify(status))) as Record<
                string,
                unknown
            >;
            assert.equal(statusReply["outcome"], "status");
            assert.equal(statusReply["kind"], "unresolved");
            // Fire the original one-shot deadline.
            const deadline = h.timers[0];
            assert.ok(deadline, "deadline armed");
            deadline.callback();
            await waitFor(
                () => h.logs.some((line) => line.includes("timeout-request")),
                "deadline terminal",
            );
            // CURRENTLY EXPECTED: terminal teardown with no fabricated commit
            // or follow; native source membership unchanged end to end.
            assert.ok(h.logs.some((line) => line.includes("verify-failed")));
            assert.ok(!h.committed());
            assert.deepEqual(h.switches, []);
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1]);
            assert.equal(h.requestSend("ws-2"), false);
            // FUTURE (AR11 expired-source): re-admit the mover to source from
            // retained topology with a forward (monotonic) revision bound to a
            // NEW complete observation, instead of terminal disable here.
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("pre-AR11 disjoint-domain send hits the single-flight guard", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true);
            await waitFor(() => h.queued() > 0, "request");
            await h.flush();
            await waitFor(() => h.win.wa.desktopsChanged.armed(), "echo fence armed");
            // Foreground moves to an independently scoped domain: source ws-3,
            // mover n-win-c, target ws-4. Disjoint from the live ws-1 -> ws-2
            // flight in source, target, and mover.
            h.setActive(h.win.wc);
            h.setCurrent(h.desk.d3);
            // CURRENTLY EXPECTED (shipped single-flight guard): the disjoint
            // foreground send is refused while the flight is live, with no new
            // DescribePlan dispatched. Sensitive to guard changes: a per-pair
            // interlock must flip this refusal to acceptance.
            assert.equal(h.requestSend("ws-4"), false);
            assert.ok(h.logs.some((line) => line.includes("in-flight")));
            assert.equal(h.queued(), 0);
            // The disjoint scope itself is valid: settle the first flight,
            // then the same foreground command plans with its own correlation.
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d1);
            fireEchoes(h);
            await waitFor(() => h.queued() > 0, "ack");
            await h.flush();
            await waitFor(() => h.queued() > 0, "verify");
            await h.flush();
            await waitFor(() => h.committed(), "first commit");
            h.setActive(h.win.wc);
            h.setCurrent(h.desk.d3);
            assert.equal(h.requestSend("ws-4"), true);
            await waitFor(() => h.queued() > 0, "disjoint request");
            await h.flush();
            const second = JSON.parse(h.calls[h.calls.length - 1]?.payload ?? "") as Record<string, unknown>;
            assert.equal(second["correlation_id"], "gen-1-w1");
            assert.equal((second["command"] as Record<string, unknown>)["window"], "n-win-c");
            assert.equal(
                JSON.parse(h.calls[h.calls.length - 1]?.reply ?? "")["outcome"] as unknown,
                "planned",
            );
            // FUTURE (send slice): the disjoint send above must plan while the
            // first flight is still live, under a per-pair interlock.
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("pre-AR11 unavailable deadline terminates without native mutation", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true);
            await waitFor(() => h.queued() > 0, "request queued");
            // Native read dies before any planned reply is processed.
            h.breakReads();
            const deadline = h.timers[0];
            assert.ok(deadline, "deadline armed");
            deadline.callback();
            await waitFor(() => h.logs.some((line) => line.includes("timeout-request")), "terminal");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1]);
            assert.equal(h.switches.length, 0);
            assert.ok(!h.committed());
            // FUTURE (send slice): assert the expiry latch is retained and the
            // next valid observation resolves expired/met instead of terminal
            // disable here.
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("pre-AR11 tampered post-observation cannot commit", async () => {
        // Intentional-defect demonstration: the stub rewrites the verify
        // payload's mover rect (a lying observer), the REAL Engine must refuse
        // to commit on it.
        const h = await makeHarness((index, payload) => {
            if (index !== 2) {
                return payload;
            }
            const body = JSON.parse(payload) as Record<string, unknown>;
            for (const list of ["windows", "target_windows"]) {
                for (const entry of (body[list] as Array<Record<string, unknown>>)) {
                    if (entry["window"] === "n-win-a") {
                        const rect = entry["rect"] as Record<string, unknown>;
                        rect["w"] = (rect["w"] as number) + 1;
                    }
                }
            }
            return JSON.stringify(body);
        });
        try {
            assert.equal(h.requestSend("ws-2"), true);
            await waitFor(() => h.queued() > 0, "request");
            await h.flush();
            await waitFor(() => h.win.wa.desktopsChanged.armed(), "echo fence armed");
            fireEchoes(h);
            await waitFor(() => h.queued() > 0, "ack");
            await h.flush();
            await waitFor(() => h.queued() > 0, "verify");
            await h.flush();
            // The REAL Engine answers the tampered verify with an exact
            // rejection, and the REAL adapter terminates without committing.
            const verifyReply = JSON.parse(h.calls[2]?.reply ?? "") as Record<string, unknown>;
            assert.equal(verifyReply["outcome"], "diverged");
            assert.equal(verifyReply["kind"], "postcondition-mismatch");
            assert.equal(verifyReply["correlation_id"], "gen-1-w0");
            await waitFor(
                () => h.logs.some((line) => line.includes("stage=result")),
                "terminal result",
            );
            assert.ok(!h.committed());
            assert.equal(h.requestSend("ws-2"), false);
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });
});
