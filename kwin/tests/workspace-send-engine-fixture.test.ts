// Vertical AR11 transition-contract fixture (skipped until AR11 ships): REAL
// standalone workspace-send observer/actuation against the REAL Rust Engine
// over the Planner codec seam. The foreground Plan entry has a separate
// observer and needs its own occupied-domain fixture before implementation.
//
// REAL parts: `startWorkspaceSendAdapterEntry` (standalone observeNative +
// actuation) on a scripted fake KWin surface; `Planner::evaluate` via the
// test-only `planner_eval` example (same validation/retained state as the
// shipped binary; only D-Bus is stubbed). Included in `npm test`.
//
// Ten AR11 rows. Every assertion inspects only adapter-captured evidence:
// D-Bus payloads the standalone observer actually emitted (via
// flush/peekQueued), Engine replies to those payloads, native surface state,
// the real one-shot timer objects, and redacted logs. No hand-built wire, no
// cloned-payload send-observed, no invented sequence/correlation, no direct
// bridge.send of synthetic requests (the tamper test rewrites an
// adapter-emitted payload at the transport seam only, still
// observer-produced).
//
// AR11 requirements are asserted POSITIVELY so each row fails red on main,
// and every test is GREENABLE: it must be able to pass unmodified once a
// conformant AR11 implementation ships. Nothing here depends on the legacy
// completion path (no ack/verify/committed waits, no timeout-request waits,
// no terminal-disable or in-flight-refusal pins, no echo-fence armed waits:
// AR11 removes the send echo fences). Follow-ups are driven by real native
// invalidation (signal fires) and the real one-shot timer, then observed via
// peekQueued/flush with a short settle instead of long waits on hooks that do
// not exist yet.
//
// Field names come only from the reviewed design
// (docs/changes/architecture-review-ar11-expectations.md): observation_seq,
// world_windows, send-observed, deadline_elapsed, revision, fingerprint,
// domain, target_domain, windows, target_windows, focused_window, command,
// correlation_id, owner, generation, outcome, desired_geometry, SetWorkspace,
// planned/converged/waiting/expired/rejected/uncertain, expectation-expired,
// observation-unavailable, binding-lost. Per-domain revision/fingerprint key
// names, world-entry key names, exact retained revision/fingerprint values
// and F(D,E) goldens are NOT asserted: exact retained Session values need a
// semantic bootstrap that is unresolved, and the design pins goldens in the
// protocol suite, not here.
//
// Against current main every AR11 row is EXPECTED RED: the shipped adapter
// emits only send-to-workspace/-ack/-verify with a singular base_revision and
// never send-observed; the Engine never replies converged/waiting/expired/
// uncertain/rejected-to-observed; the deadline path terminates instead of
// latching. Gaps that cannot be driven through this seam at all (core Session
// revision arithmetic, F(D,E) values, tombstones) are reported, not faked. No
// production route, host, toolchain, or live KWin changes.

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
        if (Date.now() - start > 15000) {
            throw new Error(`timeout: ${label}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

async function settle(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
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

interface HarnessOpts {
    readonly owner?: string;
    readonly generation?: string;
    readonly rewrite?: (index: number, payload: string) => string;
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
    readonly restoreReads: () => void;
    readonly setActive: (window: FakeWindow) => void;
    readonly setCurrent: (desktop: object) => void;
    flush: () => Promise<void>;
    peekQueued: () => string[];
    queued: () => number;
    committed: () => boolean;
}

async function makeHarness(opts: HarnessOpts = {}): Promise<Harness> {
    const out = { name: "out-1" };
    const d1 = { id: "ws-1" };
    const d2 = { id: "ws-2" };
    const d3 = { id: "ws-3" };
    const d4 = { id: "ws-4" };
    const wa = makeWindow("n-win-a", out, d1);
    const wb = makeWindow("n-win-b", out, d1);
    const wt = makeWindow("n-win-t", out, d2);
    const wc = makeWindow("n-win-c", out, d3);
    const wd = makeWindow("n-win-d", out, d3);
    let current: object = d1;
    let failReads = false;
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
    const rewrite = opts.rewrite;
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
        owner: opts.owner ?? "owner-1",
        generation: opts.generation ?? "gen-1",
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
        restoreReads: () => {
            failReads = false;
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
        peekQueued: () => pending.map((item) => item.payload),
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

function parseBody(call: { payload: string; reply: string } | undefined, side: "payload" | "reply"): Record<string, unknown> {
    assert.ok(call, `AR11: expected a ${side} to exist (native observer -> Engine path broken)`);
    return JSON.parse(side === "payload" ? call.payload : call.reply) as Record<string, unknown>;
}

function hasKey(value: unknown, key: string): boolean {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(value, key);
}

function tryParse(value: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

function opOf(payload: string): string {
    const body = tryParse(payload);
    if (body === null) {
        return "?";
    }
    const command = body["command"];
    if (hasKey(command, "op")) {
        const op = (command as Record<string, unknown>)["op"];
        return typeof op === "string" ? op : "?";
    }
    return "?";
}

function emittedOps(h: Harness): string[] {
    return h.calls.map((call) => opOf(call.payload));
}

function fireEchoes(h: Harness): void {
    for (const w of [h.win.wa, h.win.wb, h.win.wt, h.win.wc, h.win.wd]) {
        w.desktopsChanged.fire();
        w.frameGeometryChanged.fire();
    }
}

// AR11 issue flow shared by every row: real observer request, real planned
// reply. Greenable: the initial send-to-workspace request and planned outcome
// (model plan, not native proof) are kept by the reviewed design.
async function issueSend(h: Harness, target: string): Promise<Record<string, unknown>> {
    assert.equal(h.requestSend(target), true, "initial send accepted");
    await waitFor(() => h.queued() > 0, "initial observer request");
    await h.flush();
    const request = parseBody(h.calls[0], "payload");
    const planned = parseBody(h.calls[0], "reply");
    assert.equal(planned["outcome"], "planned", "initial reply is planned (model only)");
    return request;
}

describe("workspace-send AR11 transition contract", () => {
    // node:test has no expected-failure variant. See docs/changes/architecture-review-ar11-expectations.md
    // (Send-slice review stop); run these rows after the first-touch rule is selected.
    it.skip("issued: initial observer payload carries E(n) world index; planned reply echoes sequence with one setter", async () => {
        const h = await makeHarness();
        try {
            const request = await issueSend(h, "ws-2");
            // Legacy envelope still present (reviewed design keeps these names).
            assert.equal((request["command"] as Record<string, unknown>)["window"], "n-win-a");
            assert.equal(request["focused_window"], "n-win-a");
            assert.ok(Array.isArray(request["windows"]) && Array.isArray(request["target_windows"]), "scoped observations present");
            // AR11 red: generation-local observation sequence, complete world
            // membership index, and a single SetWorkspace on the initial reply.
            assert.ok(hasKey(request, "observation_seq"), "AR11 issued: request must carry observation_seq E(n)");
            assert.ok(hasKey(request, "world_windows"), "AR11 issued: request must carry complete world_windows index");
            // All native members present exactly once, eligible and
            // exception alike, across every output/workspace in scope.
            const worldIds = ((request["world_windows"] as Array<Record<string, unknown>>).map((entry) => entry["window"] as string)).sort();
            assert.deepEqual(worldIds, ["n-win-a", "n-win-b", "n-win-c", "n-win-d", "n-win-t"], "world index covers every native window");
            const planned = parseBody(h.calls[0], "reply");
            assert.ok(hasKey(planned, "observation_seq"), "AR11 issued: planned reply must echo E(n)");
            assert.equal(planned["observation_seq"], request["observation_seq"], "echoed sequence matches the consumed n");
            assert.ok(JSON.stringify(planned).includes("set_workspace"), "AR11 issued: initial planned reply carries one SetWorkspace");
            assert.equal((planned["set_workspace"] as Record<string, unknown>)["window"], "n-win-a", "setter names the mover once");
            assert.equal(h.timers.length, 1, "one-shot deadline armed exactly once at issue");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("transit: stuck-mover invalidation emits send-observed(false) resolving to waiting, no setter, no follow", async () => {
        const h = await makeHarness();
        try {
            const sourceDesktops = h.win.wa.desktops;
            Object.defineProperty(h.win.wa, "desktops", {
                get: () => sourceDesktops,
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            await issueSend(h, "ws-2");
            // Membership echo never arrives (native stuck on source); unrelated
            // geometry invalidations fire through the real signal seam.
            h.win.wb.desktopsChanged.fire();
            h.win.wt.desktopsChanged.fire();
            for (const w of [h.win.wa, h.win.wb, h.win.wt, h.win.wc, h.win.wd]) {
                w.frameGeometryChanged.fire();
            }
            await settle(250);
            // AR11 red: the invalidation must surface as a send-observed
            // follow-up with deadline_elapsed:false resolving to waiting.
            assert.ok(h.queued() > 0, "AR11 transit: invalidation must emit a send-observed follow-up");
            const follow = tryParse(h.peekQueued()[0] ?? "");
            assert.ok(follow !== null && opOf(h.peekQueued()[0] ?? "") === "send-observed", "AR11 transit: follow-up op is send-observed");
            const command = follow?.["command"];
            assert.ok(hasKey(command, "deadline_elapsed") && (command as Record<string, unknown>)["deadline_elapsed"] === false, "AR11 transit: follow-up carries deadline_elapsed:false");
            await h.flush();
            const waiting = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(waiting["outcome"], "waiting", "AR11 transit: Engine replies waiting while mover unresolved");
            assert.equal(waiting["disposition"], "in-transit", "waiting disposition holds the in-transit mask");
            assert.ok(!JSON.stringify(waiting).includes("set_workspace"), "AR11 transit: later reply never emits a second setter");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "mover natively still source");
            assert.ok(!h.committed(), "no commit while mover unresolved");
            assert.deepEqual(h.switches, [], "no follow on unresolved proof");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("met: exact-target proof emits send-observed resolving to converged with prompt one-shot follow", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            await settle(100);
            assert.deepEqual(h.win.wa.desktops, [h.desk.d2], "adapter dispatched membership once after planned");
            // Native target arrival observed through the real signal seam.
            fireEchoes(h);
            await settle(250);
            // AR11 red: target proof travels as send-observed and the Engine
            // replies converged; follow is prompt and proof-gated.
            assert.ok(h.queued() > 0, "AR11 met: target proof must emit a send-observed follow-up");
            assert.ok(opOf(h.peekQueued()[0] ?? "") === "send-observed", "AR11 met: follow-up op is send-observed");
            await h.flush();
            const converged = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(converged["outcome"], "converged", "AR11 met: Engine replies converged on exact-target proof");
            assert.equal(converged["disposition"], "target", "converged disposition names the exact target");
            assert.equal(converged["focus_proof"], true, "proof observation carries pinned focus on the mover");
            assert.ok(!JSON.stringify(converged).includes("set_workspace"), "AR11 met: no second setter");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d2], "mover only on exact target, absent source");
            assert.deepEqual(h.switches, [h.desk.d2], "prompt one-shot native switch after proof");
            assert.equal(h.surface["activeWindow"], h.win.wa, "mover focused after proof");
            assert.ok(h.switches.length <= 1, "at most one follow, no replay");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("expired-source: source mover at deadline emits send-observed(true) resolving to expired", async () => {
        const h = await makeHarness();
        try {
            const sourceDesktops = h.win.wa.desktops;
            Object.defineProperty(h.win.wa, "desktops", {
                get: () => sourceDesktops,
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            await issueSend(h, "ws-2");
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            // AR11 red: the original deadline callback plus a fresh complete
            // observation emits send-observed with the latched attestation,
            // resolving to expired with forward revisions and diag.
            const queued = h.peekQueued();
            assert.ok(queued.length > 0, "AR11 expired-source: deadline must emit a send-observed follow-up");
            const follow = tryParse(queued[0] ?? "");
            assert.ok(follow !== null && opOf(queued[0] ?? "") === "send-observed", "AR11 expired-source: follow-up op is send-observed");
            const command = follow?.["command"];
            assert.ok(hasKey(command, "deadline_elapsed") && (command as Record<string, unknown>)["deadline_elapsed"] === true, "AR11 expired-source: follow-up carries the latched deadline attestation");
            await h.flush();
            const expired = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(expired["outcome"], "expired", "AR11 expired-source: Engine replies expired for source disposition");
            assert.equal(expired["disposition"], "source", "expired disposition names the source");
            // Forward-only: re-admission advances monotonically from the
            // transit revisions and rebinds the actual fresh fingerprints.
            const plannedReply = parseBody(h.calls[0], "reply");
            assert.ok(
                (expired["source_accepted_revision"] as number) >= (plannedReply["source_accepted_revision"] as number),
                "source revision advances forward through expiry",
            );
            assert.ok(
                (expired["target_accepted_revision"] as number) >= (plannedReply["target_accepted_revision"] as number),
                "target revision advances forward through expiry",
            );
            assert.ok(h.logs.some((line) => line.includes("expectation-expired")), "AR11 expired-source: logs diag expectation-expired");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "mover re-admitted to source topology");
            assert.ok(!h.committed(), "no fabricated commit");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("expired-third-workspace: ws-3 escape appears in the world index while source/target stay exact", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            h.win.wa.desktops = [h.desk.d3];
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            // AR11 red: the fresh observation scopes the ws-3 escape inside
            // world_windows while the declared source/target pair stays exact,
            // resolving to other-domain expiry.
            const queued = h.peekQueued();
            assert.ok(queued.length > 0, "AR11 expired: deadline must emit a send-observed follow-up");
            const follow = tryParse(queued[0] ?? "");
            assert.ok(follow !== null && opOf(queued[0] ?? "") === "send-observed", "AR11 expired: follow-up op is send-observed");
            assert.ok(hasKey(follow, "world_windows"), "AR11 expired: follow-up carries the complete world index");
            const world = follow?.["world_windows"];
            assert.ok(Array.isArray(world) && JSON.stringify(world).includes("ws-3"), "AR11 expired: world index explicitly scopes the ws-3 escape");
            const domain = follow?.["domain"];
            const targetDomain = follow?.["target_domain"];
            assert.ok(hasKey(domain, "workspace") && (domain as Record<string, unknown>)["workspace"] === "ws-1", "AR11 expired: declared source stays exact");
            assert.ok(hasKey(targetDomain, "workspace") && (targetDomain as Record<string, unknown>)["workspace"] === "ws-2", "AR11 expired: declared target stays exact");
            await h.flush();
            const expired = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(expired["outcome"], "expired", "AR11 expired: Engine replies expired for other-domain disposition");
            assert.equal(expired["disposition"], "other", "same-output third workspace is other, never nonexclusive");
            assert.ok(!h.committed(), "no commit on escape");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("expiry-latched: failed read latches with uncertainty, then a fresh observation resolves expired/converged", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            assert.equal(h.timers.length, 1, "clock armed once and never rearmed");
            h.breakReads();
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            // AR11 red: with no complete observation available, expiry latches
            // and reports observation-unavailable uncertainty with no mutation.
            assert.ok(h.logs.some((line) => line.includes("observation-unavailable")), "AR11 expiry-latched: reports uncertainty observation-unavailable");
            assert.ok(!h.committed(), "no commit without observation");
            assert.deepEqual(h.switches, [], "no setter or follow without observation");
            // A fresh valid observation carrying the latched attestation then
            // resolves through the normal expiry/met row.
            h.restoreReads();
            fireEchoes(h);
            await settle(250);
            assert.ok(h.queued() > 0, "AR11 expiry-latched: next valid observation emits send-observed");
            assert.ok(opOf(h.peekQueued()[0] ?? "") === "send-observed", "AR11 expiry-latched: follow-up op is send-observed");
            await h.flush();
            const outcome = parseBody(h.calls[h.calls.length - 1], "reply")["outcome"];
            assert.ok(outcome === "expired" || outcome === "converged", "AR11 expiry-latched: latched flight resolves expired or converged on valid E(n)");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("disjoint scopes: ws-3 -> ws-4 plans while ws-1 -> ws-2 flight is live (per-pair interlock)", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            h.setActive(h.win.wc);
            h.setCurrent(h.desk.d3);
            // AR11 per-pair interlock: this disjoint send plans while the first
            // flight is live, with independent correlation and revisions.
            assert.equal(h.requestSend("ws-4"), true, "AR11 disjoint: unrelated-domain send plans during live flight");
            await waitFor(() => h.queued() > 0, "disjoint observer request");
            await h.flush();
            const second = parseBody(h.calls[h.calls.length - 1], "payload");
            assert.equal((second["command"] as Record<string, unknown>)["window"], "n-win-c", "second flight carries its own mover");
            assert.ok(hasKey(second, "observation_seq"), "AR11 disjoint: second flight carries its own E(n)");
            assert.notEqual(second["correlation_id"], parseBody(h.calls[0], "payload")["correlation_id"], "independent correlations");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("supersession: later command after resolution starts from a new greater observation", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true, "first send accepted");
            await waitFor(() => h.queued() > 0, "initial observer request");
            // Competitor for the same pair while the lock is live is refused
            // until the earlier expectation resolves with fresh evidence.
            assert.equal(h.requestSend("ws-2"), false, "competitor during live lock refused");
            await h.flush();
            const first = parseBody(h.calls[0], "payload");
            assert.equal(parseBody(h.calls[0], "reply")["outcome"], "planned");
            fireEchoes(h);
            await settle(250);
            // AR11 red: the first flight resolves through its own proof, then
            // the later command starts from a new greater observation.
            assert.ok(h.queued() > 0, "AR11 supersession: proof emits a send-observed follow-up");
            await h.flush();
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "converged", "AR11 supersession: first flight converges");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d2);
            assert.equal(h.requestSend("ws-1"), true, "later command accepted after resolution");
            await waitFor(() => h.queued() > 0, "later observer request");
            await h.flush();
            const bodies = h.calls.map((call) => parseBody(call, "payload"));
            const last = bodies[bodies.length - 1];
            assert.ok(last !== undefined && last["correlation_id"] === "gen-1-w1", "later command carries new correlation");
            assert.notEqual(bodies[0]?.["correlation_id"], last?.["correlation_id"], "old terminal stays under old correlation");
            const firstSeq = first["observation_seq"];
            const laterSeq = last?.["observation_seq"];
            assert.ok(typeof firstSeq === "number" && typeof laterSeq === "number" && (laterSeq as number) > (firstSeq as number), "AR11 supersession: later command starts from new E(m), m greater than n");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it.skip("generation binding: retired timer actuates nothing; new generation works from its own sequenced snapshot", async () => {
        const h1 = await makeHarness({ generation: "gen-1" });
        try {
            assert.equal(h1.requestSend("ws-2"), true, "first send accepted");
            await waitFor(() => h1.queued() > 0, "initial observer request");
            assert.equal(h1.peekQueued().length, 1, "initial observer request queued");
            const oldTimer = h1.timers[0];
            assert.ok(oldTimer, "old deadline armed");
            h1.stop();
            // Late fire of the retired binding's timer: no dispatch, follow,
            // commit, or fresh observation for the old correlation.
            oldTimer.callback();
            await settle(100);
            assert.ok(!h1.committed(), "retired binding never commits");
            assert.deepEqual(h1.switches, [], "retired timer causes no follow");
            assert.ok(!emittedOps(h1).includes("send-observed"), "retired binding emits no send-observed");
        } finally {
            h1.stop();
            await h1.bridge.close();
        }
        const h2 = await makeHarness({ generation: "gen-2" });
        try {
            const request = await issueSend(h2, "ws-2");
            assert.equal(request["generation"], "gen-2", "new generation works from its own fresh observation");
            assert.equal(request["correlation_id"], "gen-2-w0", "new commands receive their own correlation");
            // AR11 red: the new-generation snapshot carries its own sequence,
            // and the retired correlation surfaces redacted binding-lost
            // uncertainty. Neither happens on main.
            assert.ok(hasKey(request, "observation_seq"), "AR11 binding: new-generation work requires its own sequenced snapshot");
            assert.ok(h1.logs.some((line) => line.includes("binding-lost")), "AR11 binding: old correlation logs uncertainty binding-lost");
        } finally {
            h2.stop();
            await h2.bridge.close();
        }
    });

    it.skip("shared evidence: tampered send-observed fails validation with rejection and no commit", async () => {
        const h = await makeHarness({
            rewrite: (index, payload) => {
                void index;
                if (opOf(payload) !== "send-observed") {
                    return payload;
                }
                const body = tryParse(payload);
                if (body === null) {
                    return payload;
                }
                // Lying observer: shift the mover rect in the scoped lists so
                // they no longer match the world index entry.
                for (const list of ["windows", "target_windows"]) {
                    const entries = body[list];
                    if (Array.isArray(entries)) {
                        for (const entry of entries as Array<Record<string, unknown>>) {
                            if (entry["window"] === "n-win-a") {
                                const rect = entry["rect"];
                                if (hasKey(rect, "w")) {
                                    const width = (rect as Record<string, unknown>)["w"];
                                    if (typeof width === "number") {
                                        (rect as Record<string, unknown>)["w"] = width + 1;
                                    }
                                }
                            }
                        }
                    }
                }
                return JSON.stringify(body);
            },
        });
        try {
            await issueSend(h, "ws-2");
            fireEchoes(h);
            await settle(250);
            // AR11 red: the proof travels as send-observed; the tampered copy
            // must fail bidirectional validation with rejection and no commit.
            assert.ok(h.queued() > 0, "AR11 shared evidence: proof emits a send-observed follow-up");
            assert.ok(opOf(h.peekQueued()[0] ?? "") === "send-observed", "AR11 shared evidence: follow-up op is send-observed");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["outcome"], "rejected", "AR11 shared evidence: tampered scoped/world mismatch is rejected");
            assert.ok(!h.committed(), "tampered post-observation never commits");
            assert.ok(!JSON.stringify(reply).includes("set_workspace"), "rejection carries no setter");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });
});
