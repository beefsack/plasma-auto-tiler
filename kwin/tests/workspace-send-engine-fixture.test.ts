// Workspace-send fixture: real standalone KWin send observer/actuation against
// the real Rust Engine over the Planner codec seam. Thirteen active abandon
// rows exercise the 2026-09-25 incremental recovery contract, plus three
// skipped option-B rows (orphan retirement, displaced-owner recovery, bounded
// fallback) parked as expected-red until production. The ten skipped
// AR11 rows below are parked reference for the superseded full expectation
// design, not gates for this implementation.
//
// REAL parts: `startWorkspaceSendAdapterEntry` (standalone observeNative +
// actuation) on a scripted fake KWin surface; `Planner::evaluate` via the
// test-only `planner_eval` example (same validation/retained state as the
// shipped binary; only D-Bus is stubbed). Included in `npm test`.
//
// The AR11 rows inspect only adapter-captured evidence:
// D-Bus payloads the standalone observer actually emitted (via
// flush/peekQueued), Engine replies to those payloads, native surface state,
// the real one-shot timer objects, and redacted logs. No hand-built wire, no
// cloned-payload send-observed, no invented sequence/correlation, no direct
// bridge.send of synthetic requests (the tamper test rewrites an
// adapter-emitted payload at the transport seam only, still
// observer-produced).
//
// AR11 requirements are asserted positively as a parked design exercise;
// they are intentionally skipped. Nothing there depends on the existing
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
// The skipped AR11 rows are incompatible with the shipped adapter, which
// emits only send-to-workspace/-ack/-verify with a singular base_revision and
// never send-observed; the Engine never replies converged/waiting/expired/
// uncertain/rejected-to-observed. This does not describe the active abandon
// rows; no native host or live KWin session is involved.

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
import { PlanAdapter, PLAN_DEBOUNCE_MS } from "../src/plan-adapter";
import { observeHiddenDomains } from "../src/plan-adapter-entry";

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
    // Share one real Engine across two real adapter observer paths so an
    // older-generation pending can be orphaned on the Engine while a current
    // generation observer acts. The borrower never closes the shared bridge;
    // the owner closes it once.
    readonly sharedBridge?: EngineBridge;
}

interface Harness {
    readonly win: { wa: FakeWindow; wb: FakeWindow; wt: FakeWindow; wc: FakeWindow; wd: FakeWindow };
    readonly desk: { d1: object; d2: object; d3: object; d4: object };
    readonly surface: Record<string, unknown>;
    readonly calls: Array<{ payload: string; reply: string; delivered: boolean }>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
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
    flushDrop: () => Promise<void>;
    deliverLate: () => void;
    lateCount: () => number;
    peekQueued: () => string[];
    queued: () => number;
    committed: () => boolean;
    engineCommitted: () => boolean;
    blocksPlan: () => boolean;
    isEnabled: () => boolean;
    addWindow: (window: FakeWindow) => void;
    makePlan: () => PlanAdapter;
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
    const extra: FakeWindow[] = [];
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
            return [wa, wb, wt, wc, wd, ...extra];
        },
    };
    const bridge = opts.sharedBridge ?? EngineBridge.start();
    const calls: Harness["calls"] = [];
    const timers: Harness["timers"] = [];
    const logs: string[] = [];
    const switches: object[] = [];
    const pending: Array<{ payload: string; callback: (reply: unknown) => void }> = [];
    const late: Array<() => void> = [];
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
        scheduleOnce: (delayMs, callback) => {
            const timer = { delayMs, callback, cancelled: false };
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
        blocksPlan: () => entry.blocksPlan(),
        isEnabled: () => entry.isEnabled(),
        addWindow: (window) => extra.push(window),
        makePlan: () => {
            const cache = new Map<string, string>();
            const floating = new Set<string>();
            const plan = new PlanAdapter({
                callDbus: (service, _path, _iface, method, payload, callback) => {
                    if (service === WORKSPACE_SEND_DBUS_SERVICE && method === WORKSPACE_SEND_HAS_OWNER_METHOD) {
                        callback(true);
                    } else if (service === WORKSPACE_SEND_DBUS_SERVICE && method === WORKSPACE_SEND_GET_OWNER_METHOD) {
                        callback(":1.7");
                    } else if (service === WORKSPACE_SEND_DBUS_SERVICE && method === WORKSPACE_SEND_START_METHOD) {
                        callback(1);
                    } else if (method === WORKSPACE_SEND_METHOD) {
                        pending.push({ payload, callback });
                    } else {
                        callback(undefined);
                    }
                },
                scheduleOnce: (delayMs, callback) => {
                    const timer = { delayMs, callback, cancelled: false };
                    timers.push(timer);
                    return () => { timer.cancelled = true; };
                },
                log: (message) => { logs.push(message); },
                isSendActive: () => entry.blocksPlan(),
                observe: () => null,
                observeHidden: () => observeHiddenDomains(surface, cache, floating, { innerGap: 8, outerGap: 8 }),
                clearMaximize: () => "invoked",
                setGeometry: (ref, rect) => {
                    (ref as FakeWindow).frameGeometry = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
                    return true;
                },
                setActive: (ref) => { surface["activeWindow"] = ref; return true; },
                active: () => surface["activeWindow"] as object,
                subscribe: () => () => {},
            });
            assert.equal(plan.enable({ owner: opts.owner ?? "owner-1", generation: opts.generation ?? "gen-1" }), true);
            return plan;
        },
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
            const call = { payload: next.payload, reply: "", delivered: true };
            calls.push(call);
            const outgoing = rewrite !== undefined ? rewrite(index, next.payload) : next.payload;
            call.reply = await bridge.send(outgoing);
            next.callback(call.reply);
        },
        flushDrop: async () => {
            const next = pending.shift();
            if (next === undefined) {
                return;
            }
            const index = calls.length;
            const call = { payload: next.payload, reply: "", delivered: false };
            calls.push(call);
            const outgoing = rewrite !== undefined ? rewrite(index, next.payload) : next.payload;
            call.reply = await bridge.send(outgoing);
            late.push(() => {
                call.delivered = true;
                next.callback(call.reply);
            });
        },
        deliverLate: () => { late.shift()?.(); },
        lateCount: () => late.length,
        peekQueued: () => pending.map((item) => item.payload),
        queued: () => pending.length,
        committed: () =>
            calls.some((call) => {
                if (!call.delivered) {
                    return false;
                }
                try {
                    return (JSON.parse(call.reply) as Record<string, unknown>)["outcome"] === "committed";
                } catch (error) {
                    void error;
                    return false;
                }
            }),
        engineCommitted: () =>
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

function parseBody(call: { payload: string; reply: string; delivered?: boolean } | undefined, side: "payload" | "reply"): Record<string, unknown> {
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

// Abandon-recovery rows (accepted 2026-09-25): every adapter-emitted payload
// in calls plus every still-queued payload whose op is the proposed
// `send-to-workspace-abandon`. Test-only helper; the op name itself is a
// design proposal for review.
function abandonPayloads(h: Harness): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    const payloads = [...h.calls.map((call) => call.payload), ...h.peekQueued()];
    for (const payload of payloads) {
        if (opOf(payload) !== "send-to-workspace-abandon") {
            continue;
        }
        const body = tryParse(payload);
        if (body !== null) {
            out.push(body);
        }
    }
    return out;
}

function fireEchoes(h: Harness): void {
    for (const w of [h.win.wa, h.win.wb, h.win.wt, h.win.wc, h.win.wd]) {
        w.desktopsChanged.fire();
        w.frameGeometryChanged.fire();
    }
}

function fireActiveDeadline(h: Harness): void {
    const active = h.timers.filter((item) => !item.cancelled && item.delayMs !== PLAN_DEBOUNCE_MS);
    const timer = active[active.length - 1];
    assert.ok(timer, "one active send deadline");
    timer.callback();
}

function noPendingOutcome(outcome: unknown): boolean {
    return outcome === "abandoned" || outcome === "no-pending-unknown";
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

describe("workspace-send abandon recovery", () => {
    // Accepted 2026-09-25: one fenced correlated Planner abandon operation
    // (`send-to-workspace-abandon`) retires the exact workspace-send pending
    // without claiming commit; per-domain Engine sessions and Plan baselines
    // are preserved; on definitive ack the adapter unblocks Plan, stays
    // enabled, and ordinary Plan handles the observed facts; exact commit is
    // unchanged; failed/unanswered abandon retries on a later valid
    // observation, never permanently disables; no setter replay. Simplicity:
    // one op plus one reply, no receipts, no new retained send state.
    // Resilience: unreadable waits, later valid observations retry, late
    // ack/verify after abandon are ignored, never disable.
    //
    // Same real observer/actuation seam and Engine as the parked rows above.
    // All thirteen abandon rows run offline. Blocked-ness is proven through
    // the entry's blocksPlan edge and an ordinary Plan dispatch after the
    // definitive ack. The real PlanAdapter uses observeHiddenDomains against
    // the same native surface and real Engine, without hand-built wire JSON.
    // A correlated no-pending-unknown reply after an already retired pending
    // is sufficient; a lost planned reply must actually retire its still-live
    // exact pending. The ten AR11 rows above remain skipped for reference.

    it("abandon-source: stuck mover at deadline emits one correlated abandon, blocks then unblocks, no commit", async () => {
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
            const firstPayload = parseBody(h.calls[0], "payload");
            const planned = parseBody(h.calls[0], "reply");
            assert.equal(h.requestSend("ws-3"), false, "abandon: second send refused while the flight blocks Plan");
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            const abandon = abandonPayloads(h);
            assert.equal(abandon.length, 1, "abandon: exactly one abandon op after the post-actuation deadline");
            const body = abandon[0];
            assert.ok(body !== undefined, "abandon payload present");
            assert.equal(body["correlation_id"], firstPayload["correlation_id"], "abandon: binds the exact flight correlation");
            assert.equal(body["owner"], firstPayload["owner"], "abandon: binds the exact owner");
            assert.equal(body["generation"], firstPayload["generation"], "abandon: binds the exact generation");
            assert.equal(body["revision"], planned["base_revision"], "abandon: echoes the seeded base revision");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "abandon: mover still source, no setter replay");
            assert.deepEqual(h.switches, [], "abandon: no follow switch");
            assert.ok(!h.committed(), "abandon: never claims commit");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["correlation_id"], firstPayload["correlation_id"], "abandon: ack echoes the exact correlation");
            assert.equal(reply["outcome"], "abandoned", "abandon: Engine definitively retires the exact pending");
            assert.equal(reply["kind"], "send-to-workspace", "abandon: ack names the retired route, never a commit");
            assert.ok(h.logs.some((line) => line.includes(`correlation=${String(firstPayload["correlation_id"])}`) && line.includes("abandon") && line.includes("requested")), "abandon: correlated request logged");
            assert.ok(h.logs.some((line) => line.includes(`correlation=${String(firstPayload["correlation_id"])}`) && line.includes("abandon") && line.includes("replied")), "abandon: correlated definitive reply logged");
            assert.ok(!h.committed(), "abandon: retired flight never committed");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d1);
            assert.equal(h.requestSend("ws-3"), true, "abandon: Plan unblocked, send reusable after definitive ack");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-third-domain: ws-3 escape at deadline emits one correlated abandon, no commit", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            const followsBeforeEscape = h.switches.length;
            h.win.wa.desktops = [h.desk.d3];
            const firstPayload = parseBody(h.calls[0], "payload");
            fireActiveDeadline(h);
            await settle(250);
            const abandon = abandonPayloads(h);
            assert.equal(abandon.length, 1, "abandon: exactly one abandon op on third-domain escape");
            const body = abandon[0];
            assert.ok(body !== undefined, "abandon payload present");
            assert.equal(body["correlation_id"], firstPayload["correlation_id"], "abandon: binds the exact flight correlation");
            assert.equal(h.switches.length, followsBeforeEscape, "abandon: escape adds no follow switch");
            assert.ok(!h.committed(), "abandon: escape never commits");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-on-target-non-exact: geometry drift on target emits abandon, at most the one legitimate follow", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            const firstPayload = parseBody(h.calls[0], "payload");
            const frame = h.win.wa.frameGeometry;
            h.win.wa.frameGeometry = { x: frame.x + 1, y: frame.y, width: frame.width, height: frame.height };
            fireEchoes(h);
            await settle(250);
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            const abandon = abandonPayloads(h);
            assert.ok(abandon.length >= 1, "abandon: non-exact target proof retires via abandon");
            const body = abandon[0];
            assert.ok(body !== undefined, "abandon payload present");
            assert.equal(body["correlation_id"], firstPayload["correlation_id"], "abandon: binds the exact flight correlation");
            assert.ok(h.switches.length <= 1, "abandon: at most the one legitimate pre-divergence follow, no replay");
            assert.ok(!h.committed(), "abandon: non-exact proof never commits");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-closed: absent mover at deadline emits one correlated abandon, no commit", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            const followsBeforeClose = h.switches.length;
            const firstPayload = parseBody(h.calls[0], "payload");
            h.win.wa.desktops = [];
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            const abandon = abandonPayloads(h);
            assert.equal(abandon.length, 1, "abandon: exactly one abandon op when the mover is absent");
            const body = abandon[0];
            assert.ok(body !== undefined, "abandon payload present");
            assert.equal(body["correlation_id"], firstPayload["correlation_id"], "abandon: binds the exact flight correlation");
            assert.equal(h.switches.length, followsBeforeClose, "abandon: close adds no follow switch");
            assert.ok(!h.committed(), "abandon: absent mover never commits");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-unreadable-then-valid: no abandon without observation, then exactly one; never disables", async () => {
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
            const firstPayload = parseBody(h.calls[0], "payload");
            h.breakReads();
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            assert.equal(abandonPayloads(h).length, 0, "abandon: unreadable observation sends nothing");
            assert.ok(!h.committed(), "abandon: no commit without observation");
            assert.deepEqual(h.switches, [], "abandon: no follow without observation");
            // The flight must NOT have disabled: the next valid observation
            // retries the abandon on the same correlation.
            h.restoreReads();
            fireEchoes(h);
            await settle(250);
            const abandon = abandonPayloads(h);
            assert.equal(abandon.length, 1, "abandon: next valid observation retries exactly once");
            const body = abandon[0];
            assert.ok(body !== undefined, "abandon payload present");
            assert.equal(body["correlation_id"], firstPayload["correlation_id"], "abandon: retry keeps the exact flight correlation");
            assert.ok(!h.committed(), "abandon: retry never claims commit");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-unanswered-retry: a second valid observation re-sends abandon on the same correlation", async () => {
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
            const firstPayload = parseBody(h.calls[0], "payload");
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            assert.equal(abandonPayloads(h).length, 1, "abandon: first abandon queued");
            // Leave the first abandon unanswered, then observe again: the
            // design re-arms a one-shot mover echo as the retry trigger.
            fireEchoes(h);
            await settle(250);
            const abandon = abandonPayloads(h);
            assert.equal(abandon.length, 2, "abandon: unanswered abandon retries on the next valid observation");
            assert.equal(abandon[1]?.["correlation_id"], firstPayload["correlation_id"], "abandon: retry keeps the exact flight correlation");
            assert.deepEqual(h.switches, [], "abandon: retries replay no setter");
            assert.ok(!h.committed(), "abandon: retries never claim commit");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-ack-unblocks: definitive ack unblocks Plan, send stays enabled and reusable, commit untouched", async () => {
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            const sourceDesktops = h.win.wa.desktops;
            Object.defineProperty(h.win.wa, "desktops", {
                get: () => sourceDesktops,
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            await issueSend(h, "ws-2");
            const firstPayload = parseBody(h.calls[0], "payload");
            assert.equal(h.requestSend("ws-3"), false, "abandon: flight blocks Plan before ack");
            assert.equal(h.blocksPlan(), true, "abandon: Plan guard holds during send");
            assert.equal(h.isEnabled(), true, "abandon: send stays enabled during flight");
            plan.requestResync();
            for (const timer of h.timers.filter((item) => item.delayMs === PLAN_DEBOUNCE_MS && !item.cancelled)) {
                timer.callback();
            }
            assert.equal(h.queued(), 0, "abandon: ordinary Plan dispatch blocked during flight");
            fireActiveDeadline(h);
            await settle(250);
            assert.equal(abandonPayloads(h).length, 1, "abandon: abandon queued before ack");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["outcome"], "abandoned", "abandon: Engine definitively retires the exact pending");
            assert.equal(reply["kind"], "send-to-workspace", "abandon: ack names the retired route, never a commit");
            assert.ok(!h.committed(), "abandon: the retired flight never committed");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "abandon: observed facts intact, mover still source");
            assert.equal(h.blocksPlan(), false, "abandon: definitive reply clears Plan guard");
            assert.equal(h.isEnabled(), true, "abandon: definitive reply keeps send enabled");
            h.setActive(h.win.wc);
            h.setCurrent(h.desk.d3);
            h.addWindow(makeWindow("n-win-new", h.win.wa.output, h.desk.d1));
            plan.requestResync();
            for (const timer of h.timers.filter((item) => item.delayMs === PLAN_DEBOUNCE_MS && !item.cancelled)) {
                timer.callback();
            }
            await waitFor(() => h.queued() > 0, "ordinary Plan observer dispatch after abandon");
            const observed = tryParse(h.peekQueued()[0] ?? "");
            assert.equal(opOf(h.peekQueued()[0] ?? ""), "reconcile", "abandon: ordinary Plan reconciles complete observation from native observation");
            assert.equal((observed?.["domain"] as Record<string, unknown>)?.["workspace"], "ws-1");
            assert.ok(JSON.stringify(observed?.["windows"]).includes("n-win-new"), "abandon: ordinary observation includes newly admitted member");
            assert.ok(JSON.stringify(observed?.["windows"]).includes("n-win-a"), "abandon: complete observation retains survivors");
            assert.ok(h.logs.some((line) => line.includes(`correlation=${String(firstPayload["correlation_id"])}`) && line.includes("abandon-handoff") && line.includes("resync-requested")), "abandon: automatic resync handoff logged without new native signal");
            assert.notEqual(observed?.["correlation_id"], firstPayload["correlation_id"], "abandon: Plan owns a new correlation");
            await h.flush();
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "planned", "abandon: Engine accepts ordinary Plan after retire");
            assert.ok(!h.committed(), "abandon: handoff never fabricates send commit");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-dropped-reply-retry: first abandon reply lost, retry on next observation accepted no-pending", async () => {
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
            const firstPayload = parseBody(h.calls[0], "payload");
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            assert.equal(abandonPayloads(h).length, 1, "abandon: first abandon queued");
            await h.flushDrop();
            assert.equal(h.lateCount(), 1, "abandon: first reply dropped, still awaiting");
            assert.equal(h.requestSend("ws-3"), false, "abandon: still blocked while the dropped reply is outstanding");
            fireEchoes(h);
            await settle(250);
            assert.equal(abandonPayloads(h).length, 2, "abandon: next valid observation retries on the same correlation");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["correlation_id"], firstPayload["correlation_id"], "abandon: retry ack echoes the exact correlation");
            // The first abandon already retired the pending on the Engine, so
            // the retry finds no pending: a correlated no-pending reply is
            // sufficient (never a commit).
            assert.ok(noPendingOutcome(reply["outcome"]), "abandon: retry accepted as correlated no-pending");
            assert.equal(reply["kind"], "send-to-workspace", "abandon: retry ack names the retired route, never a commit");
            assert.ok(!h.committed(), "abandon: dropped-plus-retry never claims commit");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d1);
            assert.equal(h.requestSend("ws-3"), true, "abandon: reusable after retry ack");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-verify-committed-lost: Engine committed but reply lost, abandon reports no-pending without commit claim", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            const firstPayload = parseBody(h.calls[0], "payload");
            await settle(100);
            fireEchoes(h);
            await settle(250);
            // The mover reached the exact target natively, so the post-proof
            // ack/verify path runs: deliver the ack, then LOSE the verify's
            // committed reply. The Engine committed; the adapter never saw it.
            await h.flush();
            assert.equal(opOf(h.calls[h.calls.length - 1]?.payload ?? ""), "send-to-workspace-ack", "abandon: proof ack dispatched");
            await h.flushDrop();
            assert.equal(opOf(h.calls[h.calls.length - 1]?.payload ?? ""), "send-to-workspace-verify", "abandon: verify dispatched and lost");
            assert.ok(h.engineCommitted(), "abandon: Engine committed on its verify path");
            assert.ok(!h.committed(), "abandon: adapter-observed commits stay empty while the verify reply is lost");
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            assert.ok(abandonPayloads(h).length >= 1, "abandon: verify-uncertain flight retires via abandon");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["correlation_id"], firstPayload["correlation_id"], "abandon: ack echoes the exact correlation");
            assert.notEqual(reply["outcome"], "committed", "abandon: KWin never claims commit from the abandon ack");
            assert.ok(noPendingOutcome(reply["outcome"]), "abandon: already-committed flight retires as correlated no-pending");
            assert.ok(!h.committed(), "abandon: adapter-observed commits stay empty after a lost verify commit");
            assert.ok(h.engineCommitted(), "abandon: Engine-side commit stays visible, never re-claimed by KWin");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d2);
            assert.equal(h.requestSend("ws-1"), true, "abandon: reusable after no-pending ack");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-late-ignored: queued/late ack or verify after abandon causes no commit, no replay, stays reusable", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            const firstPayload = parseBody(h.calls[0], "payload");
            await settle(100);
            fireEchoes(h);
            await settle(250);
            // Stage a late original: drop the proof ack on the wire, then run
            // the deadline so abandon is emitted while the ack is outstanding.
            await h.flushDrop();
            assert.equal(opOf(h.calls[h.calls.length - 1]?.payload ?? ""), "send-to-workspace-ack", "abandon: original ack staged late");
            assert.equal(h.lateCount(), 1, "abandon: original ack held late");
            const deadline = h.timers[0];
            assert.ok(deadline, "one-shot deadline armed");
            deadline.callback();
            await settle(250);
            assert.equal(abandonPayloads(h).length, 1, "abandon: abandon queued while the original is late");
            // Hold the abandon reply too so the late original arrives first.
            await h.flushDrop();
            h.deliverLate();
            await settle(100);
            // The late original ack/verify must be fenced: no commit, no
            // setter replay from a stale reply.
            assert.ok(!h.committed(), "abandon: late ack/verify never commits");
            assert.equal(h.queued(), 0, "abandon: late original ack cannot dispatch verify");
            assert.ok(h.switches.length <= 1, "abandon: late arrivals replay no setter");
            h.deliverLate();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["correlation_id"], firstPayload["correlation_id"], "abandon: definitive ack echoes the exact correlation");
            assert.ok(noPendingOutcome(reply["outcome"]), "abandon: definitive ack retires the pending");
            assert.ok(!h.committed(), "abandon: retired flight never commits");
            assert.ok(h.switches.length <= 1, "abandon: definitive ack replays no setter");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d2);
            assert.equal(h.requestSend("ws-3"), true, "abandon: stays reusable after late arrivals");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-lost-planned: planned reply lost on the wire retires via abandon, never disables", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true, "initial send accepted");
            await waitFor(() => h.queued() > 0, "initial observer request");
            await h.flushDrop();
            assert.equal(h.lateCount(), 1, "abandon: planned reply lost on the wire");
            const firstPayload = parseBody(h.calls[0], "payload");
            fireActiveDeadline(h);
            await settle(250);
            assert.ok(abandonPayloads(h).length >= 1, "abandon: lost planned emits abandon, not disable");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["correlation_id"], firstPayload["correlation_id"], "abandon: ack echoes the exact correlation");
            assert.equal(reply["outcome"], "abandoned", "abandon: lost planned reply retires the still-pending exact send");
            assert.equal(reply["kind"], "send-to-workspace", "abandon: ack names the retired route, never a commit");
            assert.ok(!h.committed(), "abandon: lost-planned path never claims commit");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d1);
            assert.equal(h.requestSend("ws-3"), true, "abandon: never disables, reusable after lost-planned retire");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-ack-timeout: lost ack reply retires via abandon, never disables", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            const firstPayload = parseBody(h.calls[0], "payload");
            await settle(100);
            fireEchoes(h);
            await settle(250);
            // Lose the proof ack on the wire, then run every armed timer as
            // the ack timeout.
            await h.flushDrop();
            assert.equal(opOf(h.calls[h.calls.length - 1]?.payload ?? ""), "send-to-workspace-ack", "abandon: ack staged and lost");
            fireActiveDeadline(h);
            await settle(250);
            assert.ok(abandonPayloads(h).length >= 1, "abandon: ack timeout emits abandon, not disable");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["correlation_id"], firstPayload["correlation_id"], "abandon: ack echoes the exact correlation");
            assert.ok(noPendingOutcome(reply["outcome"]), "abandon: ack-timeout path accepted as correlated no-pending");
            assert.equal(reply["kind"], "send-to-workspace", "abandon: ack names the retired route, never a commit");
            assert.ok(!h.committed(), "abandon: ack-timeout path never claims commit");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d2);
            assert.equal(h.requestSend("ws-3"), true, "abandon: never disables, reusable after ack-timeout retire");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("abandon-verify-timeout: lost verify reply retires via abandon, never disables", async () => {
        const h = await makeHarness();
        try {
            await issueSend(h, "ws-2");
            const firstPayload = parseBody(h.calls[0], "payload");
            await settle(100);
            fireEchoes(h);
            await settle(250);
            // Deliver the ack, lose the verify's committed reply, then run
            // every armed timer as the verify timeout.
            await h.flush();
            assert.equal(opOf(h.calls[h.calls.length - 1]?.payload ?? ""), "send-to-workspace-ack", "abandon: ack delivered");
            await h.flushDrop();
            assert.equal(opOf(h.calls[h.calls.length - 1]?.payload ?? ""), "send-to-workspace-verify", "abandon: verify staged and lost");
            assert.ok(h.engineCommitted(), "abandon: Engine committed on its verify path");
            assert.ok(!h.committed(), "abandon: adapter-observed commits stay empty while the verify reply is lost");
            fireActiveDeadline(h);
            await settle(250);
            assert.ok(abandonPayloads(h).length >= 1, "abandon: verify timeout emits abandon, not disable");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["correlation_id"], firstPayload["correlation_id"], "abandon: ack echoes the exact correlation");
            assert.notEqual(reply["outcome"], "committed", "abandon: KWin never claims commit from the abandon ack");
            assert.ok(noPendingOutcome(reply["outcome"]), "abandon: verify-timeout path accepted as correlated no-pending");
            assert.ok(!h.committed(), "abandon: verify-timeout path never claims commit");
            assert.ok(h.engineCommitted(), "abandon: Engine-side commit stays visible, never re-claimed by KWin");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d2);
            assert.equal(h.requestSend("ws-1"), true, "abandon: never disables, reusable after verify-timeout retire");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });
});

describe("observation-convergence (complete observation, test-first)", () => {
    // Authorized 2026-09-25 (docs/changes/archive/observation-convergence.md):
    // converge retained membership/floating to the complete observation
    // before the ordinary operation; missing removed via current
    // post-removal observation, new admitted via normal placement, floating
    // adopted, unreadable quarantines. Real observer + real Engine only; the
    // floating/post-removal rows drive ordinary Plan from native observation
    // (no hand-built wire) and fail pre-implementation. Foreground quarantine
    // lives in the ordinary Plan fixture (plan-adapter.test.ts), whose
    // signal-rich fake world can start the real production entry; this
    // fixture's send-path fakes cannot. The minimized row documents the
    // unchanged path (minimized stays observed, never quarantined).
    // Overlay (fullscreen/maximized) protection is already proven by
    // hidden-evidence-retirement (fullscreen/maximized/sticky/floating
    // retention rows) and background-review-fixes (exception-only domains
    // never plan); exact-match revision semantics are pinned by the Rust
    // Engine exact-match row.

    async function backgroundWs1(h: Harness): Promise<void> {
        h.setActive(h.win.wc);
        h.setCurrent(h.desk.d3);
    }

    function firePlan(h: Harness): void {
        for (const timer of h.timers.filter((item) => item.delayMs === PLAN_DEBOUNCE_MS && !item.cancelled)) {
            timer.callback();
        }
    }

    function wsOf(payload: string): string | null {
        const body = tryParse(payload);
        const domain = body?.["domain"] as Record<string, unknown> | undefined;
        const ws = domain?.["workspace"];
        return typeof ws === "string" ? ws : null;
    }

    it("sticky-floating skew converges then ordinary admit proceeds", async () => {
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const extra = makeWindow("n-win-float", h.win.wa.output, h.desk.d1);
            h.addWindow(extra);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "admit new member");
            await h.flush();
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "planned", "baseline admit planned");
            while (h.queued() > 0) {
                await h.flush();
            }
            // Sticky maps to floating via the existing KWin mapping; the
            // complete observation now carries the skew.
            (extra as { onAllDesktops: boolean }).onAllDesktops = true;
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "converged ordinary dispatch after floating skew");
            const payload = h.peekQueued()[0] ?? "";
            const skewBody = tryParse(payload);
            assert.equal(
                (skewBody?.["command"] as Record<string, unknown>)?.["op"],
                "reconcile",
                "floating skew converges through ordinary reconcile on the home domain, never an admit",
            );
            assert.equal(wsOf(payload), "ws-1", "home domain converges the skew, no foreign admit");
            const skewWindows = (skewBody?.["windows"] as Array<Record<string, unknown>> | undefined) ?? [];
            const skewed = skewWindows.find((entry) => entry["window"] === "n-win-float");
            assert.ok(skewed !== undefined, "current observation carries the skewed member");
            assert.equal(skewed?.["floating"], true, "skewed member rides as floating evidence");
            assert.ok(JSON.stringify(payload).includes("n-win-float"), "current observation carries the skewed member");
            await h.flush();
            const skewReply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(skewReply["outcome"], "planned", "floating skew converges then ordinary command proceeds");
            const skewGeometry = JSON.stringify(skewReply["desired_geometry"] ?? skewReply);
            assert.ok(
                skewGeometry.includes("n-win-a") && skewGeometry.includes("n-win-b"),
                "converged geometry covers the survivors",
            );
            assert.ok(!skewGeometry.includes("n-win-float"), "converged float absent from tiled geometry");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("all-float domain never seeds a float; tiled newcomer converges with the float retained as exception", async () => {
        // First all-float, then normal newcomer (real observer + real Engine).
        // An all-float domain dispatches nothing and sticky multi-homing
        // admits nowhere foreign. When a tiled member later arrives, the seed
        // admit must name it (never the float) with the complete observation
        // authoritative. The Engine converges the mixed seed through the same
        // Session primitive: tiled-only geometry, valid focus, and the float
        // retained as an exception. Opaque test ids only, no native identifiers.
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const extra = makeWindow("n-win-float", h.win.wa.output, h.desk.d1);
            h.addWindow(extra);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "baseline admit");
            await h.flush();
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "planned", "baseline admit planned");
            while (h.queued() > 0) {
                await h.flush();
            }
            (extra as { onAllDesktops: boolean }).onAllDesktops = true;
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "skew converge");
            while (h.queued() > 0) {
                await h.flush();
            }
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "planned", "skew converges");
            // All-float ws-4 converges via reconcile carrying the complete
            // floating observation; sticky multi-homing admits the float into
            // no foreign domain and never tiles it.
            const ws4Calls = h.calls.filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(ws4Calls.length >= 1, "all-float domain converges via reconcile");
            for (const call of ws4Calls) {
                const body = tryParse(call.payload);
                assert.equal((body?.["command"] as Record<string, unknown> | undefined)?.["op"], "reconcile", "all-float domain converges through reconcile, never admit/remove");
                const windows = (body?.["windows"] as Array<Record<string, unknown>> | undefined) ?? [];
                const floatEntry = windows.find((entry) => entry["window"] === "n-win-float");
                assert.ok(floatEntry !== undefined, "complete observation carries the float");
                assert.equal(floatEntry?.["floating"], true, "float rides as floating evidence, not a tile");
            }
            for (const call of ws4Calls) {
                const reply = tryParse(call.reply);
                assert.equal(reply?.["outcome"], "planned", "all-float converge settles planned");
                assert.ok(!JSON.stringify(reply?.["desired_geometry"] ?? reply).includes("n-win-float"), "float absent from tiled geometry, never tiled");
            }
            assert.ok(
                !h.calls.some((call) => {
                    const body = tryParse(call.payload);
                    const command = body?.["command"] as Record<string, unknown> | undefined;
                    return command?.["op"] === "admit" && command?.["window"] === "n-win-float";
                }),
                "sticky multi-home never admits the float anywhere",
            );
            // Tiled newcomer on ws-4, rect sorting after the float so the
            // structural anchor stays floating: the seed must still name the
            // tiled member with the complete observation authoritative.
            const fresh = makeWindow("n-win-zed", h.win.wa.output, h.desk.d4);
            fresh.frameGeometry = { x: 10, y: 50, width: 500, height: 300 };
            h.addWindow(fresh);
            plan.requestResync();
            firePlan(h);
            await waitFor(
                () => h.peekQueued().some((payload) => wsOf(payload) === "ws-4"),
                "ws-4 seed dispatch",
            );
            const seedPayload = h.peekQueued().find((item) => wsOf(item) === "ws-4") ?? "";
            const seedBody = tryParse(seedPayload);
            const seedCommand = seedBody?.["command"] as Record<string, unknown> | undefined;
            assert.equal(seedCommand?.["op"], "reconcile", "new domain converges through reconcile carrying complete observation");
            const seedWindows = (seedBody?.["windows"] as Array<Record<string, unknown>> | undefined) ?? [];
            const seedFloat = seedWindows.find((entry) => entry["window"] === "n-win-float");
            assert.ok(seedFloat !== undefined, "complete observation carries the float");
            assert.equal(seedFloat?.["floating"], true, "float rides as floating evidence, not a tile");
            assert.ok(
                seedWindows.some((entry) => entry["window"] === "n-win-zed" && entry["floating"] !== true),
                "newcomer rides tiled",
            );
            await h.flush();
            const seedReply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(seedBody?.["focused_window"], "n-win-zed", "mixed hidden anchor names the spatial-first tiled newcomer, never the float");
            assert.equal(seedReply["outcome"], "planned", "mixed seed converges through the shared primitive");
            const seedGeometry = JSON.stringify(seedReply["desired_geometry"] ?? seedReply);
            assert.ok(seedGeometry.includes("n-win-zed"), "converged geometry covers the admitted tile");
            assert.ok(!seedGeometry.includes("n-win-float"), "float absent from tiled geometry, never tiled");
            const seedFocus = seedReply["desired_focus"] as Record<string, unknown> | undefined;
            assert.ok(seedFocus !== undefined && seedFocus !== null, "converged seed carries valid focus");
            // The float stays tracked as an exception: later drift on the
            // same domain reconverges against the complete observation and
            // still projects only the tile.
            fresh.frameGeometry = { x: 11, y: 50, width: 500, height: 300 };
            plan.requestResync();
            firePlan(h);
            await waitFor(
                () => h.peekQueued().some((payload) => wsOf(payload) === "ws-4"),
                "ws-4 drift dispatch",
            );
            const driftPayload = h.peekQueued().find((item) => wsOf(item) === "ws-4") ?? "";
            assert.equal(
                (tryParse(driftPayload)?.["command"] as Record<string, unknown> | undefined)?.["op"],
                "reconcile",
                "follow-up runs the ordinary reconcile",
            );
            await h.flush();
            const driftReply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(driftReply["outcome"], "planned", "exception retention reconverges");
            const driftGeometry = JSON.stringify(driftReply["desired_geometry"] ?? driftReply);
            assert.ok(driftGeometry.includes("n-win-zed"), "retained geometry still covers the tile");
            assert.ok(!driftGeometry.includes("n-win-float"), "retained float still absent from tiled geometry");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("current post-removal observation omits departed member and geometry covers survivors", async () => {
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const extra = makeWindow("n-win-gone", h.win.wa.output, h.desk.d1);
            h.addWindow(extra);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "baseline admit");
            await h.flush();
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "planned", "baseline admit planned");
            while (h.queued() > 0) {
                await h.flush();
            }
            // Native close: departed member absent from the current observation.
            (extra as { desktops: object[] }).desktops = [];
            plan.requestResync();
            firePlan(h);
            await waitFor(
                () => h.peekQueued().some((payload) => wsOf(payload) === "ws-1"),
                "current post-removal dispatch",
            );
            const payload = h.peekQueued().find((item) => wsOf(item) === "ws-1") ?? "";
            const body = tryParse(payload);
            const observedWindows = JSON.stringify(body?.["windows"] ?? body);
            assert.ok(!observedWindows.includes("n-win-gone"), "current observation windows omit the departed member");
            await h.flush();
            const reply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(reply["outcome"], "planned", "removal converges then projects survivors");
            const geometry = JSON.stringify(reply["desired_geometry"] ?? reply);
            assert.ok(geometry.includes("n-win-a") && geometry.includes("n-win-b"), "geometry covers converged survivors");
            assert.ok(!geometry.includes("n-win-gone"), "removed member absent from converged geometry");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("minimized member remains observed", async () => {
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const extra = makeWindow("n-win-min", h.win.wa.output, h.desk.d1);
            h.addWindow(extra);
            (extra as { minimized: boolean }).minimized = true;
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "minimized dispatch");
            const payload = h.peekQueued()[0] ?? "";
            assert.ok(JSON.stringify(payload).includes("n-win-min"), "minimized member remains observed");
            await h.flush();
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "planned", "minimized observation proceeds");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

});

describe("workspace-send orphan retirement and bounded fallback (option B)", () => {
    // 2026-09-25 option B: a single abandon op may
    // retire ANY existing workspace-send pending (including an orphan from an
    // older KWin generation/other correlation), never claiming commit and
    // preserving per-domain Engine sessions. The reply distinguishes orphan
    // retirement (`orphan-abandoned`), KWin unblocks/resyncs and
    // stays enabled, and the displaced original owner recovers on its next
    // ack/verify/abandon no-pending via option A. If abandon never gets a
    // definitive reply, bounded fallback still reaches ordinary Plan on native
    // observation without waiting for a Planner restart. All three rows use
    // real adapter observer paths on one shared Engine bridge (a competing
    // second real adapter observer request, never hand-built wire JSON) and
    // are greenable under one op/reply plus handoff with no new retained
    // state. No path retries indefinitely with Plan blocked.

    it("orphan-abandon: older-generation pending retired by single abandon, orphan distinguished, sessions preserved", async () => {
        const hOld = await makeHarness({ owner: "owner-1", generation: "gen-1" });
        try {
            await issueSend(hOld, "ws-2");
            assert.ok(!hOld.committed(), "orphan: setup flight never commits");
            // The old KWin generation is gone; its live Engine pending is now
            // an orphan. The shared bridge (Planner process) survives it.
            hOld.stop();
            const hNew = await makeHarness({ owner: "owner-1", generation: "gen-2", sharedBridge: hOld.bridge });
            const plan = hNew.makePlan();
            try {
                assert.equal(hNew.requestSend("ws-2"), true, "orphan: current generation send accepted");
                await waitFor(() => hNew.queued() > 0, "current observer request");
                await hNew.flush();
                // The orphan refusal (diverged on identity loss) already drives
                // the single observer abandon synchronously; no echo or timer
                // poke is needed before counting it.
                await settle(250);
                const abandon = abandonPayloads(hNew);
                assert.equal(abandon.length, 1, "orphan: single abandon op retires the orphan pending");
                const current = parseBody(hNew.calls[0], "payload");
                const body = abandon[0];
                assert.ok(body !== undefined, "orphan abandon payload present");
                assert.equal(body["correlation_id"], current["correlation_id"], "orphan: abandon binds the current flight correlation");
                assert.equal(body["generation"], "gen-2", "orphan: abandon binds the current generation");
                await hNew.flush();
                const reply = parseBody(hNew.calls[hNew.calls.length - 1], "reply");
                assert.equal(reply["correlation_id"], current["correlation_id"], "orphan: reply echoes the current correlation");
                assert.equal(reply["outcome"], "orphan-abandoned", "orphan: reply distinguishes orphan retirement");
                assert.equal(reply["kind"], "send-to-workspace", "orphan: reply names the retired route, never a commit");
                for (const key of ["base_revision", "desired_geometry", "operation", "preconditions"]) {
                    assert.equal(hasKey(reply, key), false, `orphan: no ${key} commit evidence`);
                }
                assert.ok(!hNew.committed(), "orphan: retired flight never commits");
                assert.ok(
                    hNew.logs.some((line) => line.includes(`correlation=${String(current["correlation_id"])}`) && line.includes("abandon") && line.includes("orphan")),
                    "orphan: bounded correlated orphan retirement logged",
                );
                assert.equal(hNew.blocksPlan(), false, "orphan: definitive reply clears Plan guard");
                assert.equal(hNew.isEnabled(), true, "orphan: stays enabled");
                // Canonical Engine sessions preserved: ordinary Plan admits
                // from native observation after the handoff.
                hNew.setActive(hNew.win.wc);
                hNew.setCurrent(hNew.desk.d3);
                hNew.addWindow(makeWindow("n-win-new", hNew.win.wa.output, hNew.desk.d1));
                plan.requestResync();
                for (const timer of hNew.timers.filter((item) => item.delayMs === PLAN_DEBOUNCE_MS && !item.cancelled)) {
                    timer.callback();
                }
                await waitFor(() => hNew.queued() > 0, "ordinary Plan observer dispatch after orphan retire");
                assert.equal(opOf(hNew.peekQueued()[0] ?? ""), "reconcile", "orphan: ordinary Plan reconciles complete observation from native observation");
                assert.ok(JSON.stringify(hNew.peekQueued()[0] ?? "").includes("n-win-new"), "orphan: complete observation includes newly admitted member");
                await hNew.flush();
                assert.equal(parseBody(hNew.calls[hNew.calls.length - 1], "reply")["outcome"], "planned", "orphan: Engine accepts ordinary Plan after retire");
                assert.ok(!hNew.committed(), "orphan: handoff never fabricates send commit");
            } finally {
                plan.disable();
                hNew.stop();
            }
        } finally {
            hOld.stop();
            await hOld.bridge.close();
        }
    });

    it("orphan-displaced-late: original owner's late ack recovers via option A with no commit", async () => {
        const hOld = await makeHarness({ owner: "owner-1", generation: "gen-1" });
        try {
            await issueSend(hOld, "ws-2");
            const orphan = parseBody(hOld.calls[0], "payload");
            const hNew = await makeHarness({ owner: "owner-1", generation: "gen-2", sharedBridge: hOld.bridge });
            try {
                assert.equal(hNew.requestSend("ws-2"), true, "displaced: current generation send accepted");
                await waitFor(() => hNew.queued() > 0, "current observer request");
                await hNew.flush();
                await settle(250);
                assert.equal(abandonPayloads(hNew).length, 1, "displaced: single abandon retires the orphan");
                await hNew.flush();
                const retired = parseBody(hNew.calls[hNew.calls.length - 1], "reply");
                assert.equal(retired["outcome"], "orphan-abandoned", "displaced: orphan retired before the late arrival");
                // The displaced original owner arrives late with native proof:
                // its ack finds no pending and must never commit.
                await settle(100);
                fireEchoes(hOld);
                await settle(250);
                await hOld.flush();
                assert.equal(opOf(hOld.calls[hOld.calls.length - 1]?.payload ?? ""), "send-to-workspace-ack", "displaced: late proof ack dispatched");
                const lateAck = parseBody(hOld.calls[hOld.calls.length - 1], "reply");
                assert.equal(lateAck["outcome"], "rejected", "displaced: late ack cannot commit a retired pending");
                assert.equal(lateAck["kind"], "no-pending", "displaced: Engine reports no pending to the original ack");
                assert.equal(lateAck["correlation_id"], orphan["correlation_id"], "displaced: late ack remains correlated");
                assert.ok(!hOld.committed() && !hNew.committed(), "displaced: no KWin commit on either side");
                // Option A recovery: the displaced flight retires via its own
                // abandon, then unblocks and stays reusable.
                await settle(250);
                if (abandonPayloads(hOld).length === 0) {
                    fireEchoes(hOld);
                    await settle(250);
                    const lateActive = hOld.timers.filter((item) => !item.cancelled && item.delayMs !== PLAN_DEBOUNCE_MS);
                    const lateLast = lateActive[lateActive.length - 1];
                    if (lateLast !== undefined) {
                        lateLast.callback();
                        await settle(250);
                    }
                }
                assert.ok(abandonPayloads(hOld).length >= 1, "displaced: original owner retires via option A abandon");
                await hOld.flush();
                const settled = parseBody(hOld.calls[hOld.calls.length - 1], "reply");
                assert.equal(settled["correlation_id"], orphan["correlation_id"], "displaced: recovery echoes the original correlation");
                assert.equal(settled["outcome"], "no-pending-unknown", "displaced: option A abandon sees absent pending");
                assert.equal(settled["kind"], "send-to-workspace", "displaced: reply names send route");
                assert.ok(!hOld.committed(), "displaced: recovery never claims commit");
                hOld.setActive(hOld.win.wa);
                hOld.setCurrent(hOld.desk.d2);
                assert.equal(hOld.requestSend("ws-1"), true, "displaced: reusable after no-pending recovery");
            } finally {
                hNew.stop();
            }
        } finally {
            hOld.stop();
            await hOld.bridge.close();
        }
    });

    it("abandon-bounded-fallback: unanswered abandon unblocks ordinary Plan without Planner restart", async () => {
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            const sourceDesktops = h.win.wa.desktops;
            Object.defineProperty(h.win.wa, "desktops", {
                get: () => sourceDesktops,
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            await issueSend(h, "ws-2");
            const firstPayload = parseBody(h.calls[0], "payload");
            assert.equal(h.blocksPlan(), true, "fallback: flight blocks Plan before abandon");
            fireActiveDeadline(h);
            await settle(250);
            assert.ok(abandonPayloads(h).length >= 1, "fallback: abandon queued");
            assert.equal(
                (abandonPayloads(h)[0] as Record<string, unknown>)?.["correlation_id"],
                firstPayload["correlation_id"],
                "fallback: abandon binds the exact flight correlation",
            );
            // The pinned owner never answers: drop every abandon reply on the
            // wire and drive only bounded native/timeout opportunities on the
            // same bridge (no Planner restart, no definitive reply ever
            // delivered). No re-address seam exists on the current adapter
            // (owner pins at flight start), so this row covers the fallback.
            let rounds = 0;
            for (; rounds < 10 && h.blocksPlan(); rounds += 1) {
                while (h.queued() > 0) {
                    await h.flushDrop();
                }
                fireEchoes(h);
                await settle(150);
                if (h.blocksPlan()) {
                    fireActiveDeadline(h);
                }
                await settle(150);
            }
            while (h.queued() > 0) {
                await h.flushDrop();
            }
            assert.ok(h.lateCount() > 0, "fallback: abandon replies never definitively arrived");
            assert.ok(rounds < 10, "fallback: unblocked within bounded attempts, never an endless retry");
            assert.equal(h.blocksPlan(), false, "fallback: bounded attempts unblock Plan without a definitive reply");
            assert.equal(h.isEnabled(), true, "fallback: stays enabled");
            assert.ok(h.logs.some((line) => line.includes(`correlation=${String(firstPayload["correlation_id"])}`) && line.includes("abandon") && line.includes("unconfirmed")), "fallback: logs unconfirmed release without a commit claim");
            // No unbounded retry storm after the fallback: further native
            // observation queues no new abandon on the retired correlation.
            const retired = abandonPayloads(h).length;
            assert.ok(retired >= 1, "fallback: abandon was attempted before the fallback");
            fireEchoes(h);
            await settle(250);
            assert.equal(abandonPayloads(h).length, retired, "fallback: no new abandon after unblock");
            // Ordinary Plan reaches native observation again on the same bridge.
            h.setActive(h.win.wc);
            h.setCurrent(h.desk.d3);
            h.addWindow(makeWindow("n-win-new", h.win.wa.output, h.desk.d1));
            plan.requestResync();
            for (const timer of h.timers.filter((item) => item.delayMs === PLAN_DEBOUNCE_MS && !item.cancelled)) {
                timer.callback();
            }
            await waitFor(() => h.queued() > 0, "ordinary Plan observer dispatch after fallback");
            assert.equal(opOf(h.peekQueued()[0] ?? ""), "reconcile", "fallback: ordinary Plan reconciles complete observation from native observation");
            assert.ok(JSON.stringify(h.peekQueued()[0] ?? "").includes("n-win-new"), "fallback: complete observation includes newly admitted member");
            await h.flush();
            assert.equal(parseBody(h.calls[h.calls.length - 1], "reply")["outcome"], "planned", "fallback: Engine accepts ordinary Plan without a restart");
            assert.ok(!h.committed(), "fallback: never claims commit or retirement");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });
});
