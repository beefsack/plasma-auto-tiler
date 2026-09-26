// Workspace-send immediate-commit behavior: real standalone KWin send
// observer/actuation against the real Rust Engine over the Planner codec
// seam. Lean behavioral rows only: send lands/follows (immediate and
// delayed arrival), failed native converges with no follow, mid-send close,
// rapid repeated sends, stale-reply refusal with re-admission, and
// unanswered-request release with late-reply ignore. No ack/verify/cancel/
// abandon/status/orphan protocol: emitted ops are exactly one
// `send-to-workspace` per flight, and tests assert native behavior plus
// release/reuse, never removed internals.
//
// REAL parts: `startWorkspaceSendAdapterEntry` (standalone observeNative +
// actuation) on a scripted fake KWin surface; `Planner::evaluate` via the
// test-only `planner_eval` example (same validation/retained state as the
// shipped binary; only D-Bus is stubbed). Included in `npm test`.
//
// Evidence inspected is adapter-captured only: D-Bus payloads the observer
// emitted (via peekQueued/flush), Engine replies, native surface state,
// one-shot timer objects, and redacted logs. No hand-built wire beyond the
// real observer path, no cloned-payload sends, no invented
// sequence/correlation.

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
    WORKSPACE_SEND_TIMEOUT_MS,
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
    peekQueued: () => string[];
    queued: () => number;
    isInFlight: () => boolean;
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
        isInFlight: () => entry.isInFlight(),
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
                isSendActive: () => entry.isInFlight(),
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
            const call = { payload: next.payload, reply: "", delivered: true };
            calls.push(call);
            call.reply = await bridge.send(next.payload);
            next.callback(call.reply);
        },
        peekQueued: () => pending.map((item) => item.payload),
        queued: () => pending.length,
    };
}

function parseBody(call: { payload: string; reply: string; delivered?: boolean } | undefined, side: "payload" | "reply"): Record<string, unknown> {
    assert.ok(call, `expected a ${side} to exist (native observer -> Engine path broken)`);
    return JSON.parse(side === "payload" ? call.payload : call.reply) as Record<string, unknown>;
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
    const command = body["command"] as Record<string, unknown> | undefined;
    const op = command?.["op"];
    return typeof op === "string" ? op : "?";
}

function emittedOps(h: Harness): string[] {
    return h.calls.map((call) => opOf(call.payload));
}

function sendTimers(h: Harness): Array<{ delayMs: number; callback: () => void; cancelled: boolean }> {
    return h.timers.filter((item) => !item.cancelled && item.delayMs === WORKSPACE_SEND_TIMEOUT_MS);
}

function fireRequestTimeout(h: Harness): void {
    const active = sendTimers(h);
    const timer = active[0];
    assert.ok(timer, "request deadline armed");
    timer.callback();
}

function fireArrivalTimeout(h: Harness): void {
    const active = sendTimers(h);
    const timer = active[active.length - 1];
    assert.ok(timer, "arrival deadline armed");
    timer.callback();
}

// Single-flight issue: real observer request, real planned reply. The Rust
// Engine commits the planned topology synchronously and returns both-domain
// geometry plus the native assignment; the adapter writes geometry plus the
// mover membership and follows once on fresh native proof.
async function issueSend(h: Harness, target: string): Promise<Record<string, unknown>> {
    assert.equal(h.requestSend(target), true, "initial send accepted");
    await waitFor(() => h.queued() > 0, "initial observer request");
    await h.flush();
    const request = parseBody(h.calls[0], "payload");
    const planned = parseBody(h.calls[0], "reply");
    assert.equal(planned["outcome"], "planned", "initial reply is planned (model only, never native proof)");
    assert.ok(emittedOps(h).every((op) => op === "send-to-workspace"), "no ack/verify/abandon protocol");
    return request;
}

function assertLandedOn(h: Harness, target: object): void {
    assert.deepEqual(h.win.wa.desktops, [target], "mover natively on exact target, absent source");
    assert.deepEqual(h.switches, [target], "exactly one follow switch to the target");
    assert.equal(h.surface["activeWindow"], h.win.wa, "mover focused after proof");
    assert.equal(h.isInFlight(), false, "flight released after arrival");
}

describe("workspace-send immediate-commit behavior (real Planner)", () => {
    it("send lands and follows exactly once on immediate arrival", async () => {
        const h = await makeHarness();
        try {
            const request = await issueSend(h, "ws-2");
            assert.equal((request["command"] as Record<string, unknown>)["window"], "n-win-a");
            assert.equal(request["focused_window"], "n-win-a");
            assert.ok(Array.isArray(request["windows"]) && Array.isArray(request["target_windows"]), "scoped observations present");
            await settle(100);
            assertLandedOn(h, h.desk.d2);
            assert.ok(h.logs.some((line) => line.includes("event=arrival") && line.includes("outcome=arrived")), h.logs.join("\n"));
            assert.ok(h.logs.some((line) => line.includes("event=follow") && line.includes("outcome=state-confirmed")), h.logs.join("\n"));
            assert.ok(h.logs.some((line) => line.includes("stage=release") && line.includes("outcome=arrived")), h.logs.join("\n"));
            assert.ok(!h.logs.some((line) => line.includes("outcome=committed")), "never claims native commit");
            assert.equal(h.requestSend("ws-2"), false, "same-workspace refuses after landing");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("delayed arrival follows once via the one-shot mover signal", async () => {
        const h = await makeHarness();
        try {
            const sourceDesktops = h.win.wa.desktops;
            Object.defineProperty(h.win.wa, "desktops", {
                get: () => sourceDesktops,
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            assert.equal(h.requestSend("ws-2"), true, "send accepted");
            await waitFor(() => h.queued() > 0, "observer request");
            await h.flush();
            assert.equal(parseBody(h.calls[0], "reply")["outcome"], "planned");
            await settle(100);
            assert.deepEqual(h.switches, [], "no follow before native arrival");
            assert.equal(h.isInFlight(), true, "flight waits for delayed arrival");
            Object.defineProperty(h.win.wa, "desktops", {
                value: [h.desk.d2],
                writable: true,
                enumerable: true,
                configurable: true,
            });
            h.win.wa.desktopsChanged.fire();
            await settle(100);
            assertLandedOn(h, h.desk.d2);
            assert.ok(h.logs.some((line) => line.includes("event=follow") && line.includes("outcome=state-confirmed")), h.logs.join("\n"));
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("failed native converges with no follow and releases for reuse", async () => {
        const h = await makeHarness();
        try {
            const sourceDesktops = h.win.wa.desktops;
            Object.defineProperty(h.win.wa, "desktops", {
                get: () => sourceDesktops,
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            assert.equal(h.requestSend("ws-2"), true, "send accepted");
            await waitFor(() => h.queued() > 0, "observer request");
            await h.flush();
            assert.equal(parseBody(h.calls[0], "reply")["outcome"], "planned");
            await settle(100);
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "mover never left source");
            assert.deepEqual(h.switches, [], "no follow without arrival proof");
            assert.equal(h.isInFlight(), true, "flight still pinned while waiting");
            fireArrivalTimeout(h);
            await settle(100);
            assert.equal(h.isInFlight(), false, "arrival deadline releases the pin");
            assert.deepEqual(h.switches, [], "deadline adds no follow");
            assert.ok(!h.logs.some((line) => line.includes("outcome=committed")), "no commit claim");
            assert.ok(h.logs.some((line) => line.includes("stage=release") && line.includes("outcome=arrival-timeout")), h.logs.join("\n"));
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d1);
            assert.equal(h.requestSend("ws-3"), true, "reusable after failed native");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("closed mid-send releases with no follow and no phantom", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true, "send accepted");
            await waitFor(() => h.queued() > 0, "observer request");
            h.win.wa.desktops = [];
            await h.flush();
            await settle(100);
            assert.deepEqual(h.switches, [], "close adds no follow");
            assert.equal(h.isInFlight(), false, "closed mover releases the flight");
            assert.ok(!h.logs.some((line) => line.includes("outcome=committed")), "never claims commit");
            h.setActive(h.win.wb);
            h.setCurrent(h.desk.d1);
            assert.equal(h.requestSend("ws-2"), true, "reusable after close");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("rapid second send refuses while outstanding, then succeeds with a fresh correlation", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true, "first send accepted");
            await waitFor(() => h.queued() > 0, "first observer request");
            assert.equal(h.requestSend("ws-3"), false, "second send refuses while the first is outstanding");
            await h.flush();
            await settle(100);
            assertLandedOn(h, h.desk.d2);
            const first = parseBody(h.calls[0], "payload");
            assert.equal(h.requestSend("ws-3"), true, "new send targets another workspace after arrival");
            await waitFor(() => h.queued() > 0, "second observer request");
            await h.flush();
            await settle(100);
            const second = parseBody(h.calls[1], "payload");
            assert.notEqual(second["correlation_id"], first["correlation_id"], "distinct correlation");
            assert.deepEqual(emittedOps(h), ["send-to-workspace", "send-to-workspace"], "one request per flight, no ack/verify");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d3], "second send lands");
            assert.deepEqual(h.switches, [h.desk.d2, h.desk.d3], "one follow per arrival");
            assert.equal(h.isInFlight(), false, "released after rapid sends");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("stale reply invalidates before any setter and re-admits on the next send", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true, "send accepted");
            await waitFor(() => h.queued() > 0, "observer request");
            const before = { ...h.win.wb.frameGeometry };
            h.win.wb.frameGeometry = { x: before.x + 1, y: before.y, width: before.width, height: before.height };
            await h.flush();
            await settle(100);
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "stale reply moves nothing");
            assert.deepEqual(h.switches, [], "stale reply never follows");
            assert.equal(h.isInFlight(), false, "stale scope releases");
            assert.ok(h.logs.some((line) => line.includes("cause=stale-revision") || line.includes("stale-revision") || line.includes("outcome=stale-revision")), h.logs.join("\n"));
            // The Engine already committed the first request synchronously, so
            // a second flush here would diverge without the production Plan
            // source+target refresh (covered in plan-send-coordination).
            // This fixture proves refusal, release, and reuse-acceptance.
            h.win.wb.frameGeometry = before;
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d1);
            assert.equal(h.isEnabled(), true, "stays enabled after stale refusal");
            assert.equal(h.requestSend("ws-2"), true, "re-admits after stale refusal");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("unanswered request releases on its deadline and ignores the late reply", async () => {
        const h = await makeHarness();
        try {
            assert.equal(h.requestSend("ws-2"), true, "send accepted");
            await waitFor(() => h.queued() > 0, "observer request");
            const firstPayload = tryParse(h.peekQueued()[0] ?? "");
            assert.ok(firstPayload !== null, "request queued");
            fireRequestTimeout(h);
            await settle(100);
            assert.equal(h.isInFlight(), false, "unanswered request releases");
            assert.deepEqual(h.switches, [], "no follow without a reply");
            assert.ok(h.logs.some((line) => line.includes("stage=release") && line.includes("outcome=timeout")), h.logs.join("\n"));
            await h.flush();
            await settle(100);
            assert.ok(h.logs.some((line) => line.includes("event=late-reply") && line.includes("outcome=ignored")), h.logs.join("\n"));
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "late reply never actuates");
            assert.deepEqual(h.switches, [], "late reply never follows");
            assert.equal(h.isInFlight(), false, "stays released after the late reply");
            h.setActive(h.win.wa);
            h.setCurrent(h.desk.d1);
            assert.equal(h.requestSend("ws-3"), true, "reusable after unanswered release");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("fullscreen source survivor stays observed at send dispatch", async () => {
        const h = await makeHarness();
        try {
            h.win.wb.fullScreen = true;
            const before = { ...h.win.wb.frameGeometry };
            const request = await issueSend(h, "ws-2");
            const windows = request["windows"] as Array<Record<string, unknown>>;
            const survivor = windows.find((entry) => entry["window"] === "n-win-b");
            assert.equal(survivor?.["fit_excluded"], true, "overlay survives with portable fit exclusion");
            assert.ok(!("fullscreen" in (survivor ?? {})), "native overlay flag stays local");
            const planned = parseBody(h.calls[0], "reply");
            const geometry = planned["desired_geometry"] as Array<Record<string, unknown>>;
            assert.ok(geometry.some((entry) => entry["window"] === "n-win-b"), "Engine retains the flagged source tile");
            await settle(100);
            assert.deepEqual({ ...h.win.wb.frameGeometry }, before, "send does NOT write native geometry of fullscreen survivor");
            assertLandedOn(h, h.desk.d2);
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("floating source survivor stays observed with no native geometry write", async () => {
        const h = await makeHarness();
        try {
            h.win.wb.onAllDesktops = true;
            assert.deepEqual(h.win.wb.desktops, [h.desk.d1], "exception survivor keeps exact one-source membership");
            const before = { ...h.win.wb.frameGeometry };
            const request = await issueSend(h, "ws-2");
            const windows = request["windows"] as Array<Record<string, unknown>>;
            const survivor = windows.find((entry) => entry["window"] === "n-win-b");
            assert.equal(survivor?.["floating"], true, "exception survives with portable floating");
            assert.equal(survivor?.["fit_excluded"], true, "exception survives with portable fit exclusion");
            const planned = parseBody(h.calls[0], "reply");
            assert.equal(planned["outcome"], "planned", "floating-exception send still plans");
            await settle(100);
            assert.deepEqual({ ...h.win.wb.frameGeometry }, before, "send does NOT write native geometry of floating survivor");
            assert.equal(h.win.wb.onAllDesktops, true, "exception retained as floating");
            assertLandedOn(h, h.desk.d2);
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
