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
    minSize?: unknown;
    maxSize?: unknown;
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
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
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
    const geometries: Harness["geometries"] = [];
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
        geometries,
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
                readWindowConstraints: (ref) => {
                    const record = ref as Record<string, unknown>;
                    const sizeOf = (value: unknown): { w: number; h: number } | null => {
                        if (typeof value !== "object" || value === null) {
                            return null;
                        }
                        const entry = value as Record<string, unknown>;
                        const w = entry["width"] ?? entry["w"];
                        const h = entry["height"] ?? entry["h"];
                        if (typeof w !== "number" || typeof h !== "number" || !Number.isInteger(w) || !Number.isInteger(h)) {
                            return null;
                        }
                        return { w, h };
                    };
                    const min = sizeOf(record["minSize"]);
                    const max = sizeOf(record["maxSize"]);
                    if (min === null && max === null) {
                        return null;
                    }
                    return { resizeable: null, minSize: min, maxSize: max };
                },
                clearMaximize: () => "invoked",
                setGeometry: (ref, rect) => {
                    geometries.push({ target: ref, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
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

    it("stale send-away/send-back splits the MRU survivor vertically, not the output-wide root", async () => {
        // Long-edge repair through the real KDE send route against the
        // persistent Rust Engine (planner_eval): ws-1 holds three tiles,
        // the mover leaves for an empty workspace and returns immediately
        // with NO ws-1 reconcile in between. The stale remembered leaf
        // (departed mover) must fall back to the valid domain MRU survivor
        // (vertical split sharing one column), never the output-wide root
        // wrap (mover as a full-height separate column).
        const h = await makeHarness();
        try {
            h.win.wt.desktops = [h.desk.d1];
            assert.deepEqual(h.win.wt.desktops, [h.desk.d1], "third tile joins ws-1, leaving ws-2 empty");
            async function sendTo(target: string): Promise<Record<string, unknown>> {
                assert.equal(h.requestSend(target), true, `send to ${target} accepted`);
                await waitFor(() => h.queued() > 0, `observer request to ${target}`);
                await h.flush();
                const reply = parseBody(h.calls[h.calls.length - 1], "reply");
                assert.equal(reply["outcome"], "planned", `reply to ${target} is planned`);
                assert.ok(
                    emittedOps(h).every((op) => op === "send-to-workspace"),
                    "no ack/verify/abandon protocol",
                );
                await settle(100);
                return reply;
            }
            h.setActive(h.win.wb);
            h.setCurrent(h.desk.d1);
            await sendTo("ws-2");
            assert.deepEqual(h.win.wb.desktops, [h.desk.d2], "setup mover natively on ws-2");
            await sendTo("ws-1");
            assert.deepEqual(h.win.wb.desktops, [h.desk.d1], "setup mover returns to ws-1");
            h.setActive(h.win.wt);
            h.setCurrent(h.desk.d1);
            await sendTo("ws-4");
            assert.deepEqual(h.win.wt.desktops, [h.desk.d4], "mover away lands on empty ws-4");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "first survivor stays on ws-1");
            assert.deepEqual(h.win.wb.desktops, [h.desk.d1], "MRU survivor stays on ws-1");
            const back = await sendTo("ws-1");
            assert.equal(back["outcome"], "planned", "send-back commits");
            const geometry = back["desired_geometry"] as Array<Record<string, unknown>>;
            const ws1 = geometry.filter((entry) => entry["workspace"] === "ws-1");
            assert.equal(ws1.length, 3, `ws-1 geometry covers all three, got ${JSON.stringify(geometry)}`);
            const rectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                const entry = ws1.find((item) => item["window"] === id);
                assert.ok(entry, `ws-1 geometry covers ${id}`);
                return entry?.["rect"] as { x: number; y: number; w: number; h: number };
            };
            const ra = rectOf("n-win-a");
            const rb = rectOf("n-win-b");
            const rt = rectOf("n-win-t");
            assert.equal(rb.x, rt.x, "MRU survivor and arrival share one column (stale remembered falls back to MRU, not root)");
            assert.equal(rb.w, rt.w, "shared column has equal width");
            const stacked = rb.y + rb.h + 8 === rt.y || rt.y + rt.h + 8 === rb.y;
            assert.ok(stacked, `MRU column stacks vertically with gap 8, got b=${JSON.stringify(rb)} t=${JSON.stringify(rt)}`);
            assert.ok(
                ra.x + ra.w + 8 === rb.x && ra.x + ra.w + 8 === rt.x,
                `other survivor sits left of the MRU column, got a=${JSON.stringify(ra)} b=${JSON.stringify(rb)} t=${JSON.stringify(rt)}`,
            );
            assert.ok(
                !h.logs.some((line) => line.includes("outcome=committed")),
                "never claims native commit",
            );
            assert.deepEqual(h.win.wt.desktops, [h.desk.d1], "mover natively on exact target, absent source");
            assert.deepEqual(h.win.wa.desktops, [h.desk.d1], "both-domain membership keeps first survivor");
            assert.deepEqual(h.win.wb.desktops, [h.desk.d1], "both-domain membership keeps MRU survivor");
            assert.deepEqual(h.switches, [h.desk.d2, h.desk.d1, h.desk.d4, h.desk.d1], "exactly one follow per arrival");
            assert.equal(h.surface["activeWindow"], h.win.wt, "mover focused after proof");
            assert.equal(h.isInFlight(), false, "flight released after arrival");
        } finally {
            h.stop();
            await h.bridge.close();
        }
    });

    it("send into a new destination inherits the carried outer gap on retained reconcile", async () => {
        // Outer-gap inheritance (Engine e3e0c32) through the real KDE send
        // route against the persistent Rust Engine (planner_eval): ws-4
        // starts empty and unretained, the flight carries nonzero outer gap
        // 8 on both domains, and a retained reconcile on the adopted target
        // must plan with that same gap instead of refusing domain-mismatch.
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            assert.equal(h.requestSend("ws-4"), true, "send to new destination accepted");
            await waitFor(() => h.queued() > 0, "observer request to new destination");
            await h.flush();
            const sendPayload = parseBody(h.calls[h.calls.length - 1], "payload");
            assert.equal((sendPayload["domain"] as Record<string, unknown>)["outer_gap"], 8, "carried source outer gap nonzero");
            assert.equal((sendPayload["target_domain"] as Record<string, unknown>)["outer_gap"], 8, "carried target outer gap nonzero");
            const sendReply = parseBody(h.calls[h.calls.length - 1], "reply");
            assert.equal(sendReply["outcome"], "planned", "send to new destination plans");
            const sendGeometry = sendReply["desired_geometry"] as Array<Record<string, unknown>>;
            const mover = sendGeometry.find((entry) => entry["window"] === "n-win-a");
            assert.ok(mover !== undefined && mover["workspace"] === "ws-4", "actual projection covers the mover on the new target");
            const moverRect = mover?.["rect"] as { x: number; y: number; w: number; h: number };
            await settle(100);
            assert.deepEqual(h.win.wa.desktops, [h.desk.d4], "mover natively on exact new target, absent source");
            assert.deepEqual(h.switches, [h.desk.d4], "exactly one follow switch to the new target");
            assert.equal(h.surface["activeWindow"], h.win.wa, "mover focused after proof");
            assert.deepEqual(
                { ...h.win.wa.frameGeometry },
                { x: moverRect.x, y: moverRect.y, width: moverRect.w, height: moverRect.h },
                "native readback matches the Engine projection on the new target",
            );
            // Retained reconcile on the adopted target with the same carried
            // gap: foreground returns to ws-1 so ws-4 reconciles hidden.
            h.setActive(h.win.wb);
            h.setCurrent(h.desk.d1);
            plan.requestResync();
            for (const timer of h.timers.filter((item) => item.delayMs === PLAN_DEBOUNCE_MS && !item.cancelled)) {
                timer.callback();
            }
            const wsOfPayload = (payload: string): string | null => {
                const body = tryParse(payload);
                const domain = body?.["domain"] as Record<string, unknown> | undefined;
                const ws = domain?.["workspace"];
                return typeof ws === "string" ? ws : null;
            };
            // The round dispatches the changed source first and chains the
            // adopted target as replies are processed; drain fully, then
            // read the ws-4 reconcile from the retained Engine replies.
            const reconcilesFrom = h.calls.length;
            await waitFor(() => h.queued() > 0, "retained reconcile dispatch");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const targetCalls = h.calls.slice(reconcilesFrom).filter((call) => wsOfPayload(call.payload) === "ws-4");
            assert.ok(targetCalls.length >= 1, "adopted target reconciles");
            const retained = targetCalls[targetCalls.length - 1] as { payload: string; reply: string };
            assert.equal((tryParse(retained.payload)?.["domain"] as Record<string, unknown>)?.["outer_gap"], 8, "retained reconcile carries the inherited gap");
            const retainedReply = tryParse(retained.reply);
            assert.equal(retainedReply?.["outcome"], "planned", "inherited gap avoids outer-gap mismatch");
            const retainedGeometry = (retainedReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.ok(
                retainedGeometry.some((entry) => entry["window"] === "n-win-a"),
                "retained projection still covers the adopted mover",
            );
            assert.ok(
                !h.logs.some((line) => line.includes("outer gap does not match retained state")),
                "no outer-gap mismatch refusal",
            );
            assert.deepEqual(h.win.wa.desktops, [h.desk.d4], "retained reconcile keeps adopted membership");
        } finally {
            plan.disable();
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

    it("centre-cut cascade declines to the deterministic sequential seed with native readback", async () => {
        // Startup-fit decline (Engine 2c918d3) through the real KDE adoption
        // path: native observation -> PlanAdapter -> protocol/Engine ->
        // native apply. Three overlapping cascade frames on fresh ws-4 need
        // centre splits, so the Engine declines the recursive-cut fit to the
        // deterministic sequential seed (focus-last: the spatial-first
        // anchor lands last). Proves identity/topology/geometry, not a Rust
        // unit pin: the request carries native frames with no hints, the
        // reply leaves are seed leaves, and native frames become the Engine
        // tiles.
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const c1 = makeWindow("n-win-c1", h.win.wa.output, h.desk.d4);
            const c2 = makeWindow("n-win-c2", h.win.wa.output, h.desk.d4);
            const c3 = makeWindow("n-win-c3", h.win.wa.output, h.desk.d4);
            c1.frameGeometry = { x: 8, y: 8, width: 600, height: 600 };
            c2.frameGeometry = { x: 208, y: 58, width: 600, height: 600 };
            c3.frameGeometry = { x: 408, y: 108, width: 600, height: 600 };
            h.addWindow(c1);
            h.addWindow(c2);
            h.addWindow(c3);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "cascade baseline dispatch");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            // The first round dispatches ws-1 and chains ws-2 then ws-4 as
            // each reply is processed; drain fully, then read the ws-4
            // adoption from the retained Engine replies.
            const targetCalls = h.calls.filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(targetCalls.length >= 1, "fresh cascade domain adopts");
            const target = targetCalls[targetCalls.length - 1] as { payload: string; reply: string };
            const requestBody = tryParse(target.payload);
            assert.equal(requestBody?.["focused_window"], "n-win-c1", "hidden anchor is the spatial-first cascade member");
            const requestWindows = (requestBody?.["windows"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.equal(requestWindows.length, 3, "complete observation carries the cascade");
            for (const entry of requestWindows) {
                assert.ok(!("min_size" in entry), "hintless natives ride without min_size");
            }
            const reply = tryParse(target.reply);
            assert.equal(reply?.["outcome"], "planned", "cascade adoption plans through the seed");
            const geometry = (reply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.equal(geometry.length, 3, "seed geometry covers the cascade");
            const rectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                const entry = geometry.find((item) => item["window"] === id);
                assert.ok(entry !== undefined, `seed geometry covers ${id}`);
                return entry?.["rect"] as { x: number; y: number; w: number; h: number };
            };
            // Deterministic sequential seed with focus-last anchor c1:
            // c2 keeps the full-height half, c3/c1 stack the other column.
            assert.deepEqual(rectOf("n-win-c2"), { x: 8, y: 8, w: 588, h: 784 }, "seed keeps first tile full-height");
            assert.deepEqual(rectOf("n-win-c3"), { x: 604, y: 8, w: 588, h: 388 }, "seed stacks second tile top-right");
            assert.deepEqual(rectOf("n-win-c1"), { x: 604, y: 404, w: 588, h: 388 }, "focus-last anchor lands bottom-right");
            for (const entry of geometry) {
                assert.ok(String(entry["leaf"] as string).startsWith("leaf-"), "seed topology leaves, never fitted leaves");
                assert.ok(!("overconstrained" in entry), "unhinted seed carries no flags");
            }
            const focus = reply?.["desired_focus"] as Record<string, unknown> | undefined;
            const focusTile = geometry.find((entry) => entry["window"] === "n-win-c1");
            assert.equal(focus?.["leaf"], focusTile?.["leaf"], "focus lands on the anchor leaf");
            assert.deepEqual(
                { ...c1.frameGeometry },
                { x: 604, y: 404, width: 588, height: 388 },
                "native readback applies the seed tile over the overlapping input",
            );
            assert.deepEqual(
                { ...c2.frameGeometry },
                { x: 8, y: 8, width: 588, height: 784 },
                "native readback applies the full-height seed tile",
            );
            assert.deepEqual(
                { ...c3.frameGeometry },
                { x: 604, y: 8, width: 588, height: 388 },
                "native readback applies the stacked seed tile",
            );
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("min-infeasible clean fit declines with origin-plus-minimum writes while feasible retains fit", async () => {
        // Same side-by-side frames, distinguished only by native minSize:
        // 700-wide minimums decline to the seed but still write origin plus
        // minimum (B6), 100-wide minimums retain the fit (identity, applied).
        for (const [tag, minW, expectFallback] of [["infeasible", 700, true], ["feasible", 100, false]] as const) {
            const h = await makeHarness();
            const plan = h.makePlan();
            try {
                await backgroundWs1(h);
                const left = makeWindow("n-win-m1", h.win.wa.output, h.desk.d4);
                const right = makeWindow("n-win-m2", h.win.wa.output, h.desk.d4);
                left.frameGeometry = { x: 8, y: 8, width: 588, height: 784 };
                right.frameGeometry = { x: 604, y: 8, width: 588, height: 784 };
                left.minSize = { width: minW, height: 100 };
                right.minSize = { width: minW, height: 100 };
                h.addWindow(left);
                h.addWindow(right);
                plan.requestResync();
                firePlan(h);
                await waitFor(() => h.queued() > 0, `ws-4 ${tag} baseline dispatch`);
                for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                    await h.flush();
                }
                // The first round dispatches the changed ws-1 first and
                // chains ws-2 then ws-4 as replies are processed; drain
                // fully, then read the ws-4 adoption from the replies.
                const targetCalls = h.calls.filter((call) => wsOf(call.payload) === "ws-4");
                assert.ok(targetCalls.length >= 1, `fresh ${tag} domain adopts`);
                const target = targetCalls[targetCalls.length - 1] as { payload: string; reply: string };
                const requestBody = tryParse(target.payload);
                const requestWindows = (requestBody?.["windows"] as Array<Record<string, unknown>> | undefined) ?? [];
                assert.equal(requestWindows.length, 2, "complete observation carries both members");
                for (const entry of requestWindows) {
                    assert.deepEqual(entry["min_size"], { w: minW, h: 100 }, "native minSize rides the wire");
                }
                const reply = tryParse(target.reply);
                assert.equal(reply?.["outcome"], "planned", `${tag} adoption plans`);
                const geometry = (reply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
                assert.equal(geometry.length, 2, `${tag} geometry covers both members`);
                if (expectFallback) {
                    const rectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                        const entry = geometry.find((item) => item["window"] === id);
                        assert.ok(entry !== undefined, `seed geometry covers ${id}`);
                        return entry?.["rect"] as { x: number; y: number; w: number; h: number };
                    };
                    // Focus-last seed reverses the two IDs: m2 takes the left
                    // half, the m1 anchor lands right.
                    assert.deepEqual(rectOf("n-win-m2"), { x: 8, y: 8, w: 588, h: 784 }, "seed assigns left half to m2");
                    assert.deepEqual(rectOf("n-win-m1"), { x: 604, y: 8, w: 588, h: 784 }, "seed assigns right half to the anchor");
                    for (const entry of geometry) {
                        assert.equal(entry["overconstrained"], true, "declined seed flags both tiles overconstrained");
                    }
                    // B6: each flagged tile writes its planned origin with
                    // the violated width raised to the declared minimum; the
                    // satisfied height axis is untouched.
                    const appliedTo = (target: object): Array<{ x: number; y: number; w: number; h: number }> =>
                        h.geometries.filter((call) => call.target === target).map((call) => call.rect);
                    assert.deepEqual(
                        appliedTo(right),
                        [{ x: 8, y: 8, w: 700, h: 784 }],
                        "left tile writes origin plus minimum",
                    );
                    assert.deepEqual(
                        appliedTo(left),
                        [{ x: 604, y: 8, w: 700, h: 784 }],
                        "anchor tile writes origin plus minimum",
                    );
                    assert.ok(
                        h.logs.some((line) => line.includes("minimum-placed")),
                        "adapter logs the minimum placement",
                    );
                    assert.ok(
                        !h.logs.some((line) => line.includes("overconstrained-skipped")),
                        "no skip remains on the minimum path",
                    );
                } else {
                    for (const entry of geometry) {
                        assert.ok(!("overconstrained" in entry), "retained fit carries no flags");
                        assert.ok(!("client_clamped" in entry), "retained fit carries no clamp");
                    }
                    const rectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                        const entry = geometry.find((item) => item["window"] === id);
                        assert.ok(entry !== undefined, `fitted geometry covers ${id}`);
                        return entry?.["rect"] as { x: number; y: number; w: number; h: number };
                    };
                    assert.deepEqual(rectOf("n-win-m1"), { x: 8, y: 8, w: 588, h: 784 }, "retained fit keeps left identity");
                    assert.deepEqual(rectOf("n-win-m2"), { x: 604, y: 8, w: 588, h: 784 }, "retained fit keeps right identity");
                    // Fitted output equals the adopted frames, so the round
                    // writes nothing; drift both natively and reconcile again
                    // so the retained projection must reassert each member.
                    left.frameGeometry = { x: 8, y: 8, width: 500, height: 784 };
                    right.frameGeometry = { x: 516, y: 8, width: 676, height: 784 };
                    const adoptedCalls = h.calls.length;
                    plan.requestResync();
                    firePlan(h);
                    await waitFor(
                        () => h.peekQueued().some((payload) => wsOf(payload) === "ws-4"),
                        "ws-4 feasible drift dispatch",
                    );
                    for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                        await h.flush();
                    }
                    const driftCalls = h.calls.slice(adoptedCalls).filter((call) => wsOf(call.payload) === "ws-4");
                    assert.ok(driftCalls.length >= 1, "drifted feasible domain reconciles");
                    const driftReply = tryParse(driftCalls[driftCalls.length - 1]?.reply ?? "");
                    assert.equal(driftReply?.["outcome"], "planned", "drift reconcile plans");
                    const driftGeometry = (driftReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
                    const driftRectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                        const entry = driftGeometry.find((item) => item["window"] === id);
                        assert.ok(entry !== undefined, `reasserted geometry covers ${id}`);
                        return entry?.["rect"] as { x: number; y: number; w: number; h: number };
                    };
                    assert.deepEqual(driftRectOf("n-win-m1"), { x: 8, y: 8, w: 588, h: 784 }, "reassert keeps left identity");
                    assert.deepEqual(driftRectOf("n-win-m2"), { x: 604, y: 8, w: 588, h: 784 }, "reassert keeps right identity");
                    const appliedTo = (target: object): Array<{ x: number; y: number; w: number; h: number }> =>
                        h.geometries.filter((call) => call.target === target).map((call) => call.rect);
                    assert.ok(
                        appliedTo(left).some((rect) => rect.x === 8 && rect.y === 8 && rect.w === 588 && rect.h === 784),
                        "fitted left tile is natively applied",
                    );
                    assert.ok(
                        appliedTo(right).some((rect) => rect.x === 604 && rect.y === 8 && rect.w === 588 && rect.h === 784),
                        "fitted right tile is natively applied",
                    );
                    assert.deepEqual(
                        { ...left.frameGeometry },
                        { x: 8, y: 8, width: 588, height: 784 },
                        "native readback keeps the fitted left tile",
                    );
                    assert.deepEqual(
                        { ...right.frameGeometry },
                        { x: 604, y: 8, width: 588, height: 784 },
                        "native readback keeps the fitted right tile",
                    );
                    assert.ok(
                        !h.logs.some((line) => line.includes("overconstrained-skipped")),
                        "retained fit skips nothing",
                    );
                }
            } finally {
                plan.disable();
                h.stop();
                await h.bridge.close();
            }
        }
    });

    it("R-MIN-01 newcomer minimum exceeds shares flags only the newcomer with origin-plus-minimum", async () => {
        // Authentic R-MIN-01 journey (real observer + real Engine): ws-4
        // holds two feasible 500-minimum tiles, then a 700-minimum newcomer
        // arrives. The Engine keeps the proportional fit for the feasible
        // siblings and flags only the newcomer overconstrained; B6 writes
        // the newcomer at its planned origin raised to its minimum while
        // the reflowed sibling writes its fitted share. Hidden domain stays
        // background throughout (no send, no follow).
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const m1 = makeWindow("n-win-n1", h.win.wa.output, h.desk.d4);
            const m2 = makeWindow("n-win-n2", h.win.wa.output, h.desk.d4);
            m1.frameGeometry = { x: 8, y: 8, width: 588, height: 784 };
            m2.frameGeometry = { x: 604, y: 8, width: 588, height: 784 };
            m1.minSize = { width: 500, height: 100 };
            m2.minSize = { width: 500, height: 100 };
            h.addWindow(m1);
            h.addWindow(m2);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "feasible baseline dispatch");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const baseCalls = h.calls.filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(baseCalls.length >= 1, "feasible baseline adopts");
            const baseReply = tryParse(baseCalls[baseCalls.length - 1]?.reply ?? "");
            assert.equal(baseReply?.["outcome"], "planned", "baseline plans");
            for (const entry of (baseReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? []) {
                assert.ok(!("overconstrained" in entry), "feasible baseline flags nothing");
            }
            const from = h.calls.length;
            const m3 = makeWindow("n-win-n3", h.win.wa.output, h.desk.d4);
            m3.frameGeometry = { x: 8, y: 8, width: 300, height: 300 };
            m3.minSize = { width: 700, height: 100 };
            h.addWindow(m3);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "newcomer dispatch");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const targetCalls = h.calls.slice(from).filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(targetCalls.length >= 1, "newcomer domain reconciles");
            const target = targetCalls[targetCalls.length - 1] as { payload: string; reply: string };
            const body = tryParse(target.payload);
            assert.equal(body?.["focused_window"], "n-win-n3", "newcomer is the hidden structural anchor");
            const requestWindows = (body?.["windows"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.equal(requestWindows.length, 3, "complete observation carries the populated tree plus newcomer");
            assert.deepEqual(
                requestWindows.find((entry) => entry["window"] === "n-win-n3")?.["min_size"],
                { w: 700, h: 100 },
                "newcomer minimum rides the wire",
            );
            const reply = tryParse(target.reply);
            assert.equal(reply?.["outcome"], "planned", "newcomer infeasibility still plans");
            const geometry = (reply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.equal(geometry.length, 3, "projection covers the tree plus newcomer");
            for (const entry of geometry) {
                if (entry["window"] === "n-win-n3") {
                    assert.equal(entry["overconstrained"], true, "only the newcomer is flagged");
                } else {
                    assert.ok(!("overconstrained" in entry), "feasible siblings keep their fit unflagged");
                }
                assert.ok(!("client_clamped" in entry), "minimum path carries no clamp");
            }
            const rectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                const entry = geometry.find((item) => item["window"] === id);
                assert.ok(entry !== undefined, `geometry covers ${id}`);
                return entry?.["rect"] as { x: number; y: number; w: number; h: number };
            };
            assert.deepEqual(rectOf("n-win-n1"), { x: 8, y: 8, w: 588, h: 388 }, "reflowed sibling keeps its fitted share");
            assert.deepEqual(rectOf("n-win-n3"), { x: 8, y: 404, w: 588, h: 388 }, "newcomer planned share with gap 8");
            const appliedTo = (ref: object): Array<{ x: number; y: number; w: number; h: number }> =>
                h.geometries.filter((call) => call.target === ref).map((call) => call.rect);
            assert.ok(
                appliedTo(m3).some((rect) => rect.x === 8 && rect.y === 404 && rect.w === 700 && rect.h === 388),
                "newcomer writes planned origin raised to its minimum",
            );
            assert.ok(
                appliedTo(m1).some((rect) => rect.x === 8 && rect.y === 8 && rect.w === 588 && rect.h === 388),
                "reflowed sibling writes its fitted share",
            );
            assert.ok(
                h.logs.some((line) => line.includes("minimum-placed") && line.includes("window=n-win-n3")),
                "adapter logs the newcomer minimum placement",
            );
            assert.ok(
                !h.logs.some((line) => line.includes("minimum-placed") && line.includes("window=n-win-n1")),
                "feasible siblings are never minimum-placed",
            );
            assert.ok(
                !h.logs.some((line) => line.includes("overconstrained-skipped")),
                "no skip remains on the minimum path",
            );
            assert.deepEqual(m1.desktops, [h.desk.d4], "hidden ownership keeps first sibling");
            assert.deepEqual(m3.desktops, [h.desk.d4], "hidden ownership admits the newcomer");
            assert.equal(h.surface["activeWindow"], h.win.wc, "foreground focus never moves");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("R-MIN-02 shrink makes members infeasible then grow recovers to fit", async () => {
        // Authentic R-MIN-02 wide-row journey (real observer + real Engine):
        // two 600-minimum tiles fit the wide 1400 area, the shrink to 1080
        // makes both infeasible (528 shares), and growing back to 1400
        // recovers the fit. Bounds ride each payload; B6 writes origin plus
        // minimum on the shrink and the fitted shares on recovery.
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            (h.surface as Record<string, unknown>)["clientArea"] = () => ({ x: 0, y: 0, width: 1400, height: 800 });
            const m1 = makeWindow("n-win-s1", h.win.wa.output, h.desk.d4);
            const m2 = makeWindow("n-win-s2", h.win.wa.output, h.desk.d4);
            m1.frameGeometry = { x: 8, y: 8, width: 688, height: 784 };
            m2.frameGeometry = { x: 704, y: 8, width: 688, height: 784 };
            m1.minSize = { width: 600, height: 100 };
            m2.minSize = { width: 600, height: 100 };
            h.addWindow(m1);
            h.addWindow(m2);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "wide baseline dispatch");
            for (let index = 0; index < 12 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const wideCalls = h.calls.filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(wideCalls.length >= 1, "wide domain adopts");
            const wideReply = tryParse(wideCalls[wideCalls.length - 1]?.reply ?? "");
            assert.equal(wideReply?.["outcome"], "planned", "wide baseline plans");
            for (const entry of (wideReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? []) {
                assert.ok(!("overconstrained" in entry), "wide shares fit, nothing flagged");
            }
            const narrowFrom = h.calls.length;
            (h.surface as Record<string, unknown>)["clientArea"] = () => ({ x: 0, y: 0, width: 1080, height: 800 });
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "shrink dispatch");
            for (let index = 0; index < 12 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const narrowCalls = h.calls.slice(narrowFrom).filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(narrowCalls.length >= 1, "shrunk domain reconciles");
            const narrow = narrowCalls[narrowCalls.length - 1] as { payload: string; reply: string };
            assert.deepEqual(
                (tryParse(narrow.payload)?.["domain"] as Record<string, unknown>)?.["bounds"],
                { x: 0, y: 0, w: 1080, h: 800 },
                "shrink payload carries the narrowed bounds",
            );
            const narrowReply = tryParse(narrow.reply);
            assert.equal(narrowReply?.["outcome"], "planned", "shrink infeasibility still plans");
            const narrowGeometry = (narrowReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.equal(narrowGeometry.length, 2, "shrink projection keeps both members");
            for (const entry of narrowGeometry) {
                assert.equal(entry["overconstrained"], true, "shrunk shares flag both members");
            }
            const narrowRectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                const entry = narrowGeometry.find((item) => item["window"] === id);
                assert.ok(entry !== undefined, `shrink geometry covers ${id}`);
                return entry?.["rect"] as { x: number; y: number; w: number; h: number };
            };
            assert.deepEqual(narrowRectOf("n-win-s1"), { x: 8, y: 8, w: 528, h: 784 }, "shrunk left share");
            assert.deepEqual(narrowRectOf("n-win-s2"), { x: 544, y: 8, w: 528, h: 784 }, "shrunk right share");
            const appliedTo = (ref: object): Array<{ x: number; y: number; w: number; h: number }> =>
                h.geometries.filter((call) => call.target === ref).map((call) => call.rect);
            assert.ok(
                appliedTo(m1).some((rect) => rect.x === 8 && rect.y === 8 && rect.w === 600 && rect.h === 784),
                "shrunk left tile writes origin plus minimum",
            );
            assert.ok(
                appliedTo(m2).some((rect) => rect.x === 544 && rect.y === 8 && rect.w === 600 && rect.h === 784),
                "shrunk right tile writes origin plus minimum",
            );
            assert.ok(h.logs.some((line) => line.includes("minimum-placed")), "adapter logs the shrink placement");
            assert.ok(
                !h.logs.some((line) => line.includes("overconstrained-skipped")),
                "no skip remains on the shrink path",
            );
            const growFrom = h.calls.length;
            (h.surface as Record<string, unknown>)["clientArea"] = () => ({ x: 0, y: 0, width: 1400, height: 800 });
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "grow dispatch");
            for (let index = 0; index < 12 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const growCalls = h.calls.slice(growFrom).filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(growCalls.length >= 1, "grown domain reconciles");
            const growReply = tryParse(growCalls[growCalls.length - 1]?.reply ?? "");
            assert.equal(growReply?.["outcome"], "planned", "grow recovery plans");
            const growGeometry = (growReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            for (const entry of growGeometry) {
                assert.ok(!("overconstrained" in entry), "recovered shares flag nothing");
            }
            assert.ok(
                appliedTo(m1).some((rect) => rect.x === 8 && rect.y === 8 && rect.w === 688 && rect.h === 784),
                "recovered left tile writes its fitted share",
            );
            assert.ok(
                appliedTo(m2).some((rect) => rect.x === 704 && rect.y === 8 && rect.w === 688 && rect.h === 784),
                "recovered right tile writes its fitted share",
            );
            assert.deepEqual(
                { ...m1.frameGeometry },
                { x: 8, y: 8, width: 688, height: 784 },
                "native readback recovers the fitted left tile",
            );
            for (const call of h.calls) {
                assert.equal(tryParse(call.reply)?.["outcome"], "planned", "no rejection churn across shrink and recovery");
            }
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("R-MIN-03 oversized sole writes origin plus minimum on an offset background domain", async () => {
        // Authentic R-MIN-03 journey (real observer + real Engine): a single
        // 1300-minimum tile is admitted on an empty hidden domain whose
        // usable area starts at a nonzero output origin. The Engine projects
        // the sole leaf and flags it; B6 writes the planned origin (offset +
        // outer gap) raised to the minimum. A quiet repeat proves no
        // write-fighting, and a 1px drift proves the next op reasserts the
        // same effective target without rejection churn.
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            (h.surface as Record<string, unknown>)["clientArea"] = () => ({ x: 100, y: 50, width: 1200, height: 800 });
            const sole = makeWindow("n-win-sole", h.win.wa.output, h.desk.d4);
            sole.frameGeometry = { x: 108, y: 58, width: 1184, height: 784 };
            sole.minSize = { width: 1300, height: 500 };
            h.addWindow(sole);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "sole dispatch");
            for (let index = 0; index < 12 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const targetCalls = h.calls.filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(targetCalls.length >= 1, "sole domain adopts");
            const target = targetCalls[targetCalls.length - 1] as { payload: string; reply: string };
            assert.deepEqual(
                (tryParse(target.payload)?.["domain"] as Record<string, unknown>)?.["bounds"],
                { x: 100, y: 50, w: 1200, h: 800 },
                "offset background bounds ride the wire",
            );
            const reply = tryParse(target.reply);
            assert.equal(reply?.["outcome"], "planned", "oversized sole still plans");
            const geometry = (reply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.equal(geometry.length, 1, "sole projection covers the admitted tile");
            assert.equal(geometry[0]?.["overconstrained"], true, "violated sole minimum is flagged");
            assert.ok(!("client_clamped" in (geometry[0] ?? {})), "minimum path carries no clamp");
            assert.deepEqual(
                geometry[0]?.["rect"],
                { x: 108, y: 58, w: 1184, h: 784 },
                "sole leaf starts at the offset origin with gaps",
            );
            const appliedTo = (): Array<{ x: number; y: number; w: number; h: number }> =>
                h.geometries.filter((call) => call.target === sole).map((call) => call.rect);
            assert.deepEqual(appliedTo(), [{ x: 108, y: 58, w: 1300, h: 784 }], "sole writes offset origin plus minimum");
            assert.deepEqual(
                { ...sole.frameGeometry },
                { x: 108, y: 58, width: 1300, height: 784 },
                "native readback matches the effective target",
            );
            assert.ok(h.logs.some((line) => line.includes("minimum-placed") && line.includes("window=n-win-sole")), "adapter logs the sole placement");
            assert.ok(
                !h.logs.some((line) => line.includes("overconstrained-skipped")),
                "no skip remains on the sole path",
            );
            // Quiet repeat at the effective target: no new native writes
            // before the next reply is processed (no write-fighting).
            const geomsBefore = h.geometries.length;
            plan.requestResync();
            firePlan(h);
            await settle(50);
            assert.equal(h.geometries.length, geomsBefore, "repeat observation at effective writes nothing");
            for (let index = 0; index < 12 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            assert.ok(
                appliedTo().every((rect) => rect.w === 1300 && rect.x === 108 && rect.y === 58),
                "repeat never grows beyond the effective target",
            );
            // Explicit subsequent op: a 1px origin drift reconciles back to
            // the same effective target with no rejection.
            sole.frameGeometry = { x: 108, y: 59, width: 1300, height: 784 };
            const driftFrom = h.calls.length;
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "drift dispatch");
            for (let index = 0; index < 12 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const driftCalls = h.calls.slice(driftFrom).filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(driftCalls.length >= 1, "drifted sole reconciles");
            const driftReply = tryParse(driftCalls[driftCalls.length - 1]?.reply ?? "");
            assert.equal(driftReply?.["outcome"], "planned", "drift reconcile plans");
            assert.equal(
                (driftReply?.["desired_geometry"] as Array<Record<string, unknown>>)?.[0]?.["overconstrained"],
                true,
                "drift keeps the sole flag",
            );
            assert.deepEqual(appliedTo()[appliedTo().length - 1], { x: 108, y: 58, w: 1300, h: 784 }, "drift reasserts the effective origin");
            for (const call of h.calls) {
                assert.equal(tryParse(call.reply)?.["outcome"], "planned", "no rejection churn around the sole journey");
            }
            assert.ok(!h.logs.some((line) => line.includes("parked") || line.includes("rejected")), "no park or rejection is retained");
            assert.deepEqual(sole.desktops, [h.desk.d4], "hidden ownership keeps the sole tile");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("Ghostty-like max shortfall accepts the client clamp with no rewrite and bounded quiet", async () => {
        // Real-Engine client-clamp journey (not the feasible-minimum path):
        // two tiles adopt cleanly, then the right tile's client reports a
        // real maximum of 700 high and renders exactly there. The Engine
        // retains the full desired truth but flags client_clamped; the
        // adapter honors the clamp (no rewrite, clamp-accepted) and a repeat
        // of the same short frame stays bounded with no park or rejection.
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const g1 = makeWindow("n-win-g1", h.win.wa.output, h.desk.d4);
            const g2 = makeWindow("n-win-g2", h.win.wa.output, h.desk.d4);
            g1.frameGeometry = { x: 8, y: 8, width: 588, height: 784 };
            g2.frameGeometry = { x: 604, y: 8, width: 588, height: 784 };
            h.addWindow(g1);
            h.addWindow(g2);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "baseline dispatch");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            g2.maxSize = { width: 2000, height: 700 };
            g2.frameGeometry = { x: 604, y: 8, width: 588, height: 700 };
            const driftFrom = h.calls.length;
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "short-frame dispatch");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const driftCalls = h.calls.slice(driftFrom).filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(driftCalls.length >= 1, "short frame reconciles");
            const drift = driftCalls[driftCalls.length - 1] as { payload: string; reply: string };
            const driftBody = tryParse(drift.payload);
            const driftWindows = (driftBody?.["windows"] as Array<Record<string, unknown>> | undefined) ?? [];
            assert.deepEqual(
                driftWindows.find((entry) => entry["window"] === "n-win-g2")?.["max_size"],
                { w: 2000, h: 700 },
                "observed clamp bound rides the wire",
            );
            const driftReply = tryParse(drift.reply);
            assert.equal(driftReply?.["outcome"], "planned", "clamped short frame still plans");
            const driftGeometry = (driftReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            const clamped = driftGeometry.find((entry) => entry["window"] === "n-win-g2");
            assert.equal(clamped?.["client_clamped"], true, "short frame is accepted as client-clamped");
            assert.ok(!("overconstrained" in (clamped ?? {})), "clamp needs no minimum flag");
            assert.deepEqual(clamped?.["rect"], { x: 604, y: 8, w: 588, h: 784 }, "desired truth is retained");
            assert.equal(
                h.geometries.filter((call) => call.target === g2).length,
                0,
                "clamped member is never rewritten",
            );
            assert.ok(h.logs.some((line) => line.includes("clamp-accepted") && line.includes("window=n-win-g2")), "adapter logs clamp acceptance");
            assert.ok(!h.logs.some((line) => line.includes("minimum-placed")), "clamp path never minimum-places");
            // Bounded quiet: repeating the identical short frame writes
            // nothing new and retains the clamp without parking.
            const geomsBefore = h.geometries.length;
            const repeatFrom = h.calls.length;
            plan.requestResync();
            firePlan(h);
            await settle(50);
            assert.equal(h.geometries.length, geomsBefore, "repeat short frame writes nothing");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const repeatCalls = h.calls.slice(repeatFrom).filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(repeatCalls.length <= 2, `repeat stays bounded, got ${String(repeatCalls.length)}`);
            for (const call of repeatCalls) {
                const repeatReply = tryParse(call.reply);
                assert.equal(repeatReply?.["outcome"], "planned", "repeat still plans");
                const repeatClamped = ((repeatReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? []).find(
                    (entry) => entry["window"] === "n-win-g2",
                );
                assert.equal(repeatClamped?.["client_clamped"], true, "repeat retains the clamp");
            }
            assert.equal(
                h.geometries.filter((call) => call.target === g2).length,
                0,
                "repeat never refights the clamped member",
            );
            for (const call of h.calls) {
                assert.equal(tryParse(call.reply)?.["outcome"], "planned", "no rejection churn around the clamp");
            }
            assert.ok(!h.logs.some((line) => line.includes("parked") || line.includes("rejected")), "explained clamp never parks");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

    it("short minimum readback rewrites boundedly then accepts with no churn", async () => {
        // Real-Engine minimum-shortfall journey (contained, never overflow):
        // a 900-minimum tile is planned at 588 but the host holds every
        // 900-wide write at 700. The adapter reasserts the effective target
        // across repeated reconciles, then the existing bounded acceptance
        // adopts the held rect and stays quiet: no rejection, no park, no
        // ping-pong, and the feasible sibling is never rewritten.
        const h = await makeHarness();
        const plan = h.makePlan();
        try {
            await backgroundWs1(h);
            const m1 = makeWindow("n-win-h1", h.win.wa.output, h.desk.d4);
            const m2 = makeWindow("n-win-h2", h.win.wa.output, h.desk.d4);
            m1.frameGeometry = { x: 8, y: 8, width: 588, height: 784 };
            m2.frameGeometry = { x: 604, y: 8, width: 588, height: 784 };
            m1.minSize = { width: 900, height: 100 };
            h.addWindow(m1);
            h.addWindow(m2);
            plan.requestResync();
            firePlan(h);
            await waitFor(() => h.queued() > 0, "shortfall baseline dispatch");
            for (let index = 0; index < 10 && h.queued() > 0; index += 1) {
                await h.flush();
            }
            const writesOf = (target: object, w: number): number =>
                h.geometries.filter((call) => call.target === target && call.rect.w === w).length;
            const writesFor = (target: object): Array<{ x: number; y: number; w: number; h: number }> =>
                h.geometries.filter((call) => call.target === target).map((call) => call.rect);
            const baseCalls = h.calls.filter((call) => wsOf(call.payload) === "ws-4");
            assert.ok(baseCalls.length >= 1, "shortfall baseline adopts");
            const baseReply = tryParse(baseCalls[baseCalls.length - 1]?.reply ?? "");
            const baseGeometry = (baseReply?.["desired_geometry"] as Array<Record<string, unknown>> | undefined) ?? [];
            const baseRectOf = (id: string): { x: number; y: number; w: number; h: number } => {
                const entry = baseGeometry.find((item) => item["window"] === id);
                assert.ok(entry !== undefined, `baseline geometry covers ${id}`);
                return entry?.["rect"] as { x: number; y: number; w: number; h: number };
            };
            const plannedM1 = baseRectOf("n-win-h1");
            const plannedM2 = baseRectOf("n-win-h2");
            const effectiveM1 = { x: plannedM1.x, y: plannedM1.y, w: 900, h: plannedM1.h };
            assert.deepEqual(writesFor(m1), [effectiveM1], "admission writes the effective minimum once");
            const siblingBaselineWrites = writesFor(m2).length;
            assert.ok(
                writesFor(m2).every((rect) => rect.x === plannedM2.x && rect.y === plannedM2.y && rect.w === plannedM2.w && rect.h === plannedM2.h),
                "sibling writes at most its baseline reflow share",
            );
            // Host holds the minimum short: every effective write reads back
            // 700 wide at the planned origin. Cycle resync rounds until the
            // domain stays quiet.
            const short = { x: plannedM1.x, y: plannedM1.y, width: 700, height: plannedM1.h };
            m1.frameGeometry = { ...short };
            let rounds = 0;
            for (; rounds < 6; rounds += 1) {
                plan.requestResync();
                firePlan(h);
                await settle(50);
                if (h.queued() === 0) {
                    break;
                }
                for (let index = 0; index < 12 && h.queued() > 0; index += 1) {
                    await h.flush();
                }
                const last = h.geometries.filter((call) => call.target === m1).map((call) => call.rect).pop();
                assert.deepEqual(
                    last,
                    effectiveM1,
                    `round ${String(rounds)} reasserts the effective target`,
                );
                assert.equal(
                    writesFor(m2).length,
                    siblingBaselineWrites,
                    `round ${String(rounds)} never rewrites the feasible sibling`,
                );
                m1.frameGeometry = { ...short };
            }
            assert.equal(writesOf(m1, 900), 4, "one admission plus exactly three bounded reasserts");
            assert.ok(
                h.logs.some((line) => line.includes("reconcile-accepted") && line.includes("cause=stable-drift")),
                "bounded acceptance adopts the held rect",
            );
            // Settled quiet: further resyncs dispatch nothing and write
            // nothing, with no rejection, park, or ping-pong growth.
            for (let quiet = 0; quiet < 2; quiet += 1) {
                const geomsBefore = h.geometries.length;
                plan.requestResync();
                firePlan(h);
                await settle(50);
                assert.equal(h.queued(), 0, `quiet cycle ${String(quiet)} dispatches nothing`);
                assert.equal(h.geometries.length, geomsBefore, `quiet cycle ${String(quiet)} writes nothing`);
            }
            assert.deepEqual({ ...m1.frameGeometry }, short, "held frame never grows beyond the short readback");
            for (const call of h.calls) {
                assert.equal(tryParse(call.reply)?.["outcome"], "planned", "no rejection churn around the shortfall");
            }
            assert.ok(!h.logs.some((line) => line.includes("parked") || line.includes("rejected")), "shortfall never parks");
            assert.deepEqual(m1.desktops, [h.desk.d4], "hidden ownership keeps the held tile");
        } finally {
            plan.disable();
            h.stop();
            await h.bridge.close();
        }
    });

});
