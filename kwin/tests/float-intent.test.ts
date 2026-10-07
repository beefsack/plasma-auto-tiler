import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";

import {
    INTENT_MAX_BYTES,
    INTENT_READ_METHOD,
    INTENT_TIMEOUT_MS,
    INTENT_WRITE_METHOD,
    PLAN_DEBOUNCE_MS,
    PLAN_TIMEOUT_MS,
    PlanAdapter,
    type PlanAdapterEnv,
    type PlanObserved,
} from "../src/plan-adapter";
import {
    readCompleteIntentInventory,
    startPlanAdapterEntry,
} from "../src/plan-adapter-entry";

// Q3 settled intentional-float persistence through the real Planner for
// every plan dispatch (no fabricated plan replies) and a fixture intent
// service implementing the Rust float-intent contract (membership only,
// prune-on-read with live, degraded/rejected shapes). No actual bus or
// live KWin: the D-Bus seam is stubbed at the fixture.

// ---------------------------------------------------------------------------
// Fixture intent service (Rust contract: float_intent_store/planner_service).
// ---------------------------------------------------------------------------

type IntentMode = "auto" | "manual" | "silent";

function opaqueId(value: unknown): boolean {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 128 &&
        /^[A-Za-z0-9\-_.]+$/.test(value)
    );
}

function requestCorrelation(payload: string): string {
    try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        return typeof parsed["correlation_id"] === "string" ? (parsed["correlation_id"] as string) : "-";
    } catch (error) {
        void error;
        return "-";
    }
}

class FakeIntentStore {
    stored = new Set<string>();
    readMode: IntentMode = "auto";
    writeMode: IntentMode = "auto";
    // Scripted non-ok read terminal (null = answer from stored state).
    scriptedRead: { outcome: "degraded" | "rejected"; reason: string } | "corrupt-bytes" | null = null;
    reads: string[] = [];
    writes: string[] = [];
    readCalls = 0;
    writeCalls = 0;

    readReply(payload: string): string | null {
        this.reads.push(payload);
        this.readCalls += 1;
        if (this.scriptedRead === "corrupt-bytes") {
            return "not json{{{";
        }
        if (this.scriptedRead !== null) {
            const scripted = this.scriptedRead;
            return JSON.stringify({
                v: 1,
                correlation_id: requestCorrelation(payload),
                outcome: scripted.outcome,
                members: [],
                stored: 0,
                returned: 0,
                reason: scripted.reason,
            });
        }
        let request: Record<string, unknown>;
        try {
            request = JSON.parse(payload) as Record<string, unknown>;
        } catch (error) {
            void error;
            return JSON.stringify({ v: 1, correlation_id: "-", outcome: "rejected", members: [], reason: "invalid-request" });
        }
        const correlation = request["correlation_id"];
        if (request["v"] !== 1 || !opaqueId(correlation)) {
            return JSON.stringify({ v: 1, correlation_id: "-", outcome: "rejected", members: [], reason: "invalid-request" });
        }
        let live: Set<string> | null = null;
        if (request["live"] !== undefined) {
            const raw = request["live"];
            if (!Array.isArray(raw) || raw.length > 1024 || !raw.every(opaqueId)) {
                return JSON.stringify({
                    v: 1,
                    correlation_id: correlation,
                    outcome: "rejected",
                    members: [],
                    reason: "invalid-request",
                });
            }
            live = new Set(raw as string[]);
        }
        const returned = [...this.stored].filter((id) => live === null || live.has(id));
        return JSON.stringify({
            v: 1,
            correlation_id: correlation,
            outcome: "ok",
            members: returned,
            stored: this.stored.size,
            returned: returned.length,
        });
    }

    writeReply(payload: string): string | null {
        this.writes.push(payload);
        this.writeCalls += 1;
        let request: Record<string, unknown>;
        try {
            request = JSON.parse(payload) as Record<string, unknown>;
        } catch (error) {
            void error;
            return JSON.stringify({ v: 1, correlation_id: "-", outcome: "rejected", reason: "invalid-request" });
        }
        const correlation = request["correlation_id"];
        const members = request["members"];
        if (request["v"] !== 1 || !opaqueId(correlation)) {
            return JSON.stringify({ v: 1, correlation_id: "-", outcome: "rejected", reason: "invalid-request" });
        }
        if (!Array.isArray(members) || members.length > 1024 || !members.every(opaqueId)) {
            return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", reason: "invalid-members" });
        }
        if (new Set(members as string[]).size !== (members as string[]).length) {
            return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "rejected", reason: "invalid-members" });
        }
        this.stored = new Set(members as string[]);
        return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "stored", stored: members.length });
    }
}

// ---------------------------------------------------------------------------
// Adapter-level fixture.
// ---------------------------------------------------------------------------

function makeRefs(): { a: object; b: object } {
    return { a: {}, b: {} };
}

interface ObservedOpts {
    focusedB?: boolean;
    floatingB?: boolean;
    stickyB?: boolean;
    fullscreenB?: boolean;
    maximizedB?: boolean;
    omitB?: boolean;
    fingerprint?: string;
    driftAX?: number;
}

function makeObserved(refs: { a: object; b: object }, opts: ObservedOpts = {}): PlanObserved {
    const entries = [
        Object.freeze({
            id: "win-a",
            ref: refs.a,
            rect: { x: opts.driftAX ?? 0, y: 0, w: 600, h: 800 },
            output: "out-1",
            workspace: "ws-1",
            fullscreen: false,
            maximized: false,
            floating: false,
            sticky: false,
            resourceClass: "unknown",
        }),
    ];
    if (opts.omitB !== true) {
        entries.push(
            Object.freeze({
                id: "win-b",
                ref: refs.b,
                rect: { x: 600, y: 0, w: 600, h: 800 },
                output: "out-1",
                workspace: "ws-1",
                fullscreen: opts.fullscreenB === true,
                maximized: opts.maximizedB === true,
                floating: opts.floatingB === true,
                sticky: opts.stickyB === true,
                resourceClass: "unknown",
            }) as never,
        );
    }
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: 0,
        domainOuterGap: 0,
        focusedId: opts.focusedB === true ? "win-b" : "win-a",
        windows: Object.freeze(entries) as unknown as PlanObserved["windows"],
        activeRef: opts.focusedB === true ? refs.b : refs.a,
        fingerprint: opts.fingerprint ?? "fp-intent-1",
        revalidate: () => true,
    };
}

interface AdapterMocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly geometries: Array<{ target: object; rect: { x: number; y: number; w: number; h: number } }>;
    readonly floatingWrites: Array<{ id: string; floating: boolean }>;
    readonly activeWrites: Array<object>;
    readonly desktopToggles: Array<{ target: object; allDesktops: boolean }>;
    readonly subscribes: Array<{ kind: string; handler: (target?: object) => void }>;
    readonly hydrated: string[][];
    observeImpl: () => PlanObserved | null;
    observeHiddenImpl: () => ReadonlyArray<PlanObserved>;
    inventoryImpl: () => { complete: boolean; ids: string[] } | null;
    desktopIdsImpl: (target: object) => ReadonlyArray<string> | null;
    stickyToggleImpl: (allDesktops: boolean) => void;
    throwScheduleOnceOnce: boolean;
    throwWriteOnce: boolean;
    fireDesktopsSync: boolean;
    presenceImpl: () => boolean;
    throwReadOnce: boolean;
    readonly intent: FakeIntentStore;
    readonly env: PlanAdapterEnv;
}

function mockAdapterEnv(refs: { a: object; b: object }, withIntent: boolean): AdapterMocks {
    const state = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        geometries: [],
        floatingWrites: [],
        activeWrites: [],
        desktopToggles: [],
        subscribes: [],
        hydrated: [],
        observeImpl: (): PlanObserved | null => makeObserved(refs),
        observeHiddenImpl: (): ReadonlyArray<PlanObserved> => [],
        inventoryImpl: (): { complete: boolean; ids: string[] } | null => ({
            complete: true,
            ids: ["win-a", "win-b"],
        }),
        desktopIdsImpl: (_target: object): ReadonlyArray<string> | null => [],
        stickyToggleImpl: (_allDesktops: boolean): void => {},
        throwScheduleOnceOnce: false,
        throwWriteOnce: false,
        fireDesktopsSync: false,
        presenceImpl: (): boolean => true,
        throwReadOnce: false,
        intent: new FakeIntentStore(),
        env: null as unknown as PlanAdapterEnv,
    } as AdapterMocks;
    const answerIntent = (method: string, payload: string, callback: (reply: unknown) => void): void => {
        if (method === INTENT_READ_METHOD) {
            if (state.throwReadOnce) {
                state.throwReadOnce = false;
                throw new Error("dbus unavailable");
            }
            if (state.intent.readMode === "auto") {
                const reply = state.intent.readReply(payload);
                if (reply !== null) {
                    callback(reply);
                }
            }
            return;
        }
        if (state.intent.writeMode === "auto") {
            const reply = state.intent.writeReply(payload);
            if (reply !== null) {
                callback(reply);
            }
        }
    };
    const hooks =
        withIntent === true
            ? {
                  observeCompleteInventory: (): { complete: boolean; ids: string[] } | null => state.inventoryImpl(),
                  onIntentHydrated: (members: ReadonlyArray<string>): void => {
                      state.hydrated.push([...members]);
                  },
              }
            : {};
    const env: PlanAdapterEnv = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            void service;
            void path;
            void iface;
            if (method === "NameHasOwner") {
                callback(state.presenceImpl());
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
            state.dbusCalls.push({ method, payload });
            state.callbacks.push(callback);
            if (method === INTENT_READ_METHOD || method === INTENT_WRITE_METHOD) {
                if (method === INTENT_WRITE_METHOD && state.throwWriteOnce) {
                    state.throwWriteOnce = false;
                    throw new Error("dbus unavailable");
                }
                answerIntent(method, payload, callback);
                return;
            }
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            if (state.throwScheduleOnceOnce) {
                state.throwScheduleOnceOnce = false;
                throw new Error("timer unavailable");
            }
            const entry = { delayMs, callback, cancelled: false };
            state.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PlanObserved | null => state.observeImpl(),
        observeHidden: (): ReadonlyArray<PlanObserved> => state.observeHiddenImpl(),
        clearMaximize: (): "invoked" => "invoked",
        setGeometry: (target, rect): boolean => {
            state.geometries.push({ target, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
            return true;
        },
        setActive: (target): boolean => {
            state.activeWrites.push(target);
            return true;
        },
        active: (): object | null => refs.a,
        readKeepAbove: (): boolean => false,
        readKeepBelow: (): boolean => false,
        setKeepAbove: (): "invoked" => "invoked",
        setFloating: (id, floating): void => {
            state.floatingWrites.push({ id, floating });
        },
        setAllDesktops: (target, allDesktops): "invoked" => {
            state.desktopToggles.push({ target, allDesktops });
            try {
                state.stickyToggleImpl(allDesktops);
            } catch (error) {
                void error;
            }
            if (state.fireDesktopsSync) {
                for (const sub of state.subscribes) {
                    if (sub.kind === "desktops") {
                        sub.handler(target);
                    }
                }
            }
            return "invoked";
        },
        subscribe: (kind, handler): (() => void) => {
            state.subscribes.push({ kind, handler });
            return (): void => {};
        },
        readDesktopIds: (target: object): ReadonlyArray<string> | null => state.desktopIdsImpl(target),
        ...hooks,
    };
    (state as { env: PlanAdapterEnv }).env = env;
    return state;
}

function enableAdapter(mocks: AdapterMocks): PlanAdapter {
    const adapter = new PlanAdapter(mocks.env);
    assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1" }), true);
    return adapter;
}

function runDebounce(mocks: AdapterMocks): void {
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

function fire(mocks: AdapterMocks, kind: string, target?: object): void {
    for (const sub of mocks.subscribes) {
        if (sub.kind === kind) {
            sub.handler(target);
        }
    }
}

function pendingTimeouts(mocks: AdapterMocks): number[] {
    const out: number[] = [];
    for (let index = 0; index < mocks.timers.length; index += 1) {
        const timer = mocks.timers[index];
        if (timer !== undefined && !timer.cancelled && timer.delayMs === PLAN_TIMEOUT_MS) {
            out.push(index);
        }
    }
    return out;
}

function fireTimer(mocks: AdapterMocks, index: number): void {
    const timer = mocks.timers[index];
    assert.ok(timer !== undefined && !timer.cancelled, `timer ${index} fires`);
    timer.cancelled = true;
    timer.callback();
}

function fireSingleTimeout(mocks: AdapterMocks): void {
    const pending = pendingTimeouts(mocks);
    assert.equal(pending.length, 1, `exactly one deadline armed, got ${pending.length}`);
    fireTimer(mocks, pending[0] as number);
}

function planIndices(mocks: AdapterMocks): number[] {
    const out: number[] = [];
    for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
        if (mocks.dbusCalls[index]?.method === "DescribePlan") {
            out.push(index);
        }
    }
    return out;
}

function intentIndices(mocks: AdapterMocks, method: string): number[] {
    const out: number[] = [];
    for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
        if (mocks.dbusCalls[index]?.method === method) {
            out.push(index);
        }
    }
    return out;
}

function answerIntentAt(mocks: AdapterMocks, index: number): void {
    const call = mocks.dbusCalls[index];
    assert.ok(call !== undefined, `intent call ${index} exists`);
    const store = mocks.intent;
    const reply =
        call.method === INTENT_READ_METHOD ? store.readReply(call.payload) : store.writeReply(call.payload);
    assert.ok(reply !== null, `fixture answers ${call.method}`);
    mocks.callbacks[index]?.(reply);
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

async function flushPlanAt(mocks: AdapterMocks, engine: EngineBridge, index: number): Promise<Record<string, unknown>> {
    const call = mocks.dbusCalls[index];
    assert.ok(call !== undefined && call.method === "DescribePlan", `plan dispatch ${index} exists`);
    const replyText = await engine.send(call.payload);
    mocks.callbacks[index]?.(replyText);
    return JSON.parse(replyText) as Record<string, unknown>;
}

function intentPayloadAt(mocks: AdapterMocks, index: number): Record<string, unknown> {
    const call = mocks.dbusCalls[index];
    assert.ok(call !== undefined, `intent call ${index} exists`);
    return JSON.parse(call.payload) as Record<string, unknown>;
}

function intentReadLog(mocks: AdapterMocks): string | undefined {
    return mocks.logs.find((entry) => entry.includes(":intent-read "));
}

function intentWriteLogs(mocks: AdapterMocks): string[] {
    return mocks.logs.filter((entry) => entry.includes(":intent-write "));
}

describe("float-intent contract identity", () => {
    it("pins the Planner1 intent methods and bounds", () => {
        assert.equal(INTENT_READ_METHOD, "ReadFloatIntent");
        assert.equal(INTENT_WRITE_METHOD, "WriteFloatIntent");
        assert.equal(INTENT_MAX_BYTES, 256 * 1024);
        assert.equal(INTENT_TIMEOUT_MS, 2000);
        assert.ok(INTENT_TIMEOUT_MS === PLAN_TIMEOUT_MS, "bounded deadline mirrors the plan route");
    });

    it("decodes a complete unscoped inventory", () => {
        const output: Record<string, unknown> = { name: "out-1" };
        const winA: Record<string, unknown> = { normalWindow: true, internalId: "win-a", output };
        const winB: Record<string, unknown> = { normalWindow: true, internalId: "win-b", output };
        const panel: Record<string, unknown> = { normalWindow: false, internalId: "panel-1", output };
        const numeric: Record<string, unknown> = { normalWindow: true, internalId: 42, output };
        const workspace = { windowList: (): unknown[] => [winA, winB, panel, numeric] };
        const inventory = readCompleteIntentInventory(workspace);
        assert.equal(inventory.complete, true);
        assert.deepEqual([...inventory.ids].sort(), ["42", "panel-1", "win-a", "win-b"]);
    });

    it("fails closed on structural inventory faults", () => {
        const output: Record<string, unknown> = { name: "out-1" };
        assert.equal(readCompleteIntentInventory({}).complete, false);
        assert.equal(
            readCompleteIntentInventory({ windowList: (): unknown[] => [null] }).complete,
            false,
        );
        assert.equal(
            readCompleteIntentInventory({
                windowList: (): unknown[] => {
                    throw new Error("unreadable");
                },
            }).complete,
            false,
        );
        const badNormal: Record<string, unknown> = { normalWindow: true, internalId: "has space", output };
        assert.equal(
            readCompleteIntentInventory({ windowList: (): unknown[] => [badNormal] }).complete,
            false,
        );
        // Strict proof: a missing id fails the whole inventory even for
        // non-normal windows; per-type skipping would hide partial
        // evidence from pruning.
        const badPanel: Record<string, unknown> = { normalWindow: false, output };
        assert.equal(
            readCompleteIntentInventory({ windowList: (): unknown[] => [badPanel] }).complete,
            false,
        );
        const throwingId: Record<string, unknown> = { normalWindow: true, output };
        Object.defineProperty(throwingId, "internalId", {
            get: (): unknown => {
                throw new Error("unreadable");
            },
            enumerable: true,
            configurable: true,
        });
        assert.equal(
            readCompleteIntentInventory({ windowList: (): unknown[] => [throwingId] }).complete,
            false,
        );
    });

    it("never consults normalWindow readability for the proof", () => {
        const output: Record<string, unknown> = { name: "out-1" };
        // A throwing normalWindow flag with a usable id still completes:
        // the proof rests on ids alone, never on type assumptions.
        const opaque: Record<string, unknown> = { internalId: "win-a", output };
        Object.defineProperty(opaque, "normalWindow", {
            get: (): unknown => {
                throw new Error("unreadable");
            },
            enumerable: true,
            configurable: true,
        });
        const inventory = readCompleteIntentInventory({ windowList: (): unknown[] => [opaque] });
        assert.equal(inventory.complete, true);
        assert.deepEqual([...inventory.ids], ["win-a"]);
        // The same throwing flag with a bad id fails on the id alone.
        const badOpaque: Record<string, unknown> = { internalId: "has space", output };
        Object.defineProperty(badOpaque, "normalWindow", {
            get: (): unknown => {
                throw new Error("unreadable");
            },
            enumerable: true,
            configurable: true,
        });
        assert.equal(
            readCompleteIntentInventory({ windowList: (): unknown[] => [badOpaque] }).complete,
            false,
        );
    });

    it("registers exact refs into owners including on the partial path", () => {
        const output: Record<string, unknown> = { name: "out-1" };
        const winA: Record<string, unknown> = { normalWindow: true, internalId: "win-a", output };
        const owners = new Map<string, object>();
        const inventory = readCompleteIntentInventory({ windowList: (): unknown[] => [winA] }, owners);
        assert.equal(inventory.complete, true);
        assert.equal(owners.get("win-a"), winA);
        // Partial scans still register every id read live, but omit live
        // so nothing prunes on the incomplete evidence.
        const partialOwners = new Map<string, object>();
        const bad: Record<string, unknown> = { normalWindow: true, internalId: "has space", output };
        const partial = readCompleteIntentInventory({ windowList: (): unknown[] => [winA, bad] }, partialOwners);
        assert.equal(partial.complete, false);
        assert.deepEqual([...partial.ids], []);
        assert.equal(partialOwners.get("win-a"), winA);
    });
});

describe("float-intent bootstrap", () => {
    it("gates first admission, prunes to complete live, then hydrates", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.intent.stored = new Set(["win-a", "win-gone"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.equal(adapter.startIntentBootstrap(), false);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        assert.equal(reads.length, 1);
        const payload = intentPayloadAt(mocks, reads[0] as number);
        assert.deepEqual([...(payload["live"] as string[])].sort(), ["win-a", "win-b"]);
        // First admission waits: an auto signal dispatches nothing.
        fire(mocks, "added");
        runDebounce(mocks);
        assert.deepEqual(planIndices(mocks), []);
        assert.ok(mocks.logs.some((entry) => entry.includes("intent-bootstrap-deferred")));
        // The pruned read settles: only the live member hydrates.
        answerIntentAt(mocks, reads[0] as number);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(mocks.hydrated, [["win-a"]]);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("outcome=ok"));
        assert.ok(line.includes("stored=2") && line.includes("returned=1"), line);
        assert.ok(!line.includes("win-"), line);
        // Catch-up resync admits the first plan after hydration.
        runDebounce(mocks);
        assert.equal(planIndices(mocks).length, 1);
    });

    it("omits live when the inventory is unproven", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.inventoryImpl = () => null;
        mocks.intent.stored = new Set(["win-x"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        assert.equal(reads.length, 1);
        const payload = intentPayloadAt(mocks, reads[0] as number);
        assert.ok(!("live" in payload), "unproven inventory never prunes");
        answerIntentAt(mocks, reads[0] as number);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(mocks.hydrated, [["win-x"]]);
    });

    it("degraded reads proceed empty with fixed reason and counts", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.scriptedRead = { outcome: "degraded", reason: "corrupt" };
        mocks.intent.stored = new Set(["win-a"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(mocks.hydrated, [[]]);
        assert.deepEqual(adapter.getIntentMembers(), []);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("outcome=degraded"));
        assert.ok(line.includes("reason=corrupt"), line);
        assert.ok(line.includes("stored=0") && line.includes("returned=0"), line);
        fire(mocks, "added");
        runDebounce(mocks);
        assert.equal(planIndices(mocks).length, 1);
    });

    it("corrupt bytes proceed empty as malformed", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.scriptedRead = "corrupt-bytes";
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.equal(adapter.isIntentReady(), true);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("reason=malformed"));
    });

    it("silent transport times out and proceeds", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "silent";
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.equal(adapter.isIntentReady(), false);
        fireSingleTimeout(mocks);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(adapter.getIntentMembers(), []);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("reason=timeout"));
    });

    it("thrown transport degrades without blocking admission", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.throwReadOnce = true;
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.equal(adapter.isIntentReady(), true);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("reason=transport"));
        fire(mocks, "added");
        runDebounce(mocks);
        assert.equal(planIndices(mocks).length, 1);
    });

    it("rejected reads proceed empty", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.scriptedRead = { outcome: "rejected", reason: "not-kwin-owner" };
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(adapter.getIntentMembers(), []);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("outcome=rejected"));
        assert.ok(line.includes("reason=not-kwin-owner"), line);
    });

    it("late replies after shutdown are discarded", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.intent.stored = new Set(["win-a"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        adapter.disable();
        answerIntentAt(mocks, reads[0] as number);
        assert.equal(adapter.isIntentReady(), false);
        assert.deepEqual(mocks.hydrated, []);
        assert.equal(intentReadLog(mocks), undefined);
    });

    it("stale replies never adopt", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "silent";
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        fireSingleTimeout(mocks);
        assert.equal(adapter.isIntentReady(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        const stale = mocks.intent.readReply(intentPayloadAt(mocks, reads[0] as number)["correlation_id"] as string);
        void stale;
        // A late reply carrying the settled correlation lands discarded.
        const call = mocks.dbusCalls[reads[0] as number];
        assert.ok(call !== undefined);
        const late = mocks.intent.readReply(call.payload);
        assert.ok(late !== null);
        mocks.callbacks[reads[0] as number]?.(late);
        assert.deepEqual(adapter.getIntentMembers(), []);
        assert.equal(mocks.logs.filter((entry) => entry.includes(":intent-read ")).length, 1);
    });

    it("correlation mismatch fails closed without adoption", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.intent.stored = new Set(["win-a"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        assert.equal(reads.length, 1);
        const mismatch = JSON.stringify({
            v: 1,
            correlation_id: "gen-1-i999",
            outcome: "ok",
            members: ["win-a"],
            stored: 1,
            returned: 1,
        });
        mocks.callbacks[reads[0] as number]?.(mismatch);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(adapter.getIntentMembers(), []);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("reason=malformed"));
    });
});

describe("float-intent settled writes", () => {
    it("settled float and unfloat persist the full membership", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.equal(adapter.isIntentReady(), true);
        const engine = EngineBridge.start();
        try {
            // First admission (bootstrap catch-up) settles before the toggle
            // so no pending resync can stale-drop the explicit flight.
            runDebounce(mocks);
            const admit = planIndices(mocks);
            assert.equal(admit.length, 1);
            assert.equal((await flushPlanAt(mocks, engine, admit[0] as number))["outcome"], "planned");
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, fingerprint: "fp-float-1" });
            adapter.requestFloat();
            const plans = planIndices(mocks);
            assert.equal(plans.length, 2);
            const reply = await flushPlanAt(mocks, engine, plans[1] as number);
            assert.equal(reply["outcome"], "planned", `float plans, got ${JSON.stringify(reply)}`);
            assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
            assert.deepEqual([...mocks.intent.stored], ["win-b"]);
            const writes = intentWriteLogs(mocks);
            assert.equal(writes.length, 1);
            const writeLine = writes[0];
            assert.ok(writeLine !== undefined);
            assert.ok(writeLine.includes("outcome=stored") && writeLine.includes("stored=1"));
            // Unfloat clears through the same applied boundary.
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, floatingB: true, fingerprint: "fp-float-2" });
            adapter.requestFloat();
            const second = planIndices(mocks);
            assert.equal(second.length, 3);
            const unfloat = await flushPlanAt(mocks, engine, second[2] as number);
            assert.equal(unfloat["outcome"], "planned", `unfloat plans, got ${JSON.stringify(unfloat)}`);
            assert.deepEqual(adapter.getIntentMembers(), []);
            assert.deepEqual([...mocks.intent.stored], []);
        } finally {
            await engine.close();
        }
    });

    it("a timed-out float flight never touches durable membership", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.stored = new Set(["win-a"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.deepEqual(adapter.getIntentMembers(), ["win-a"]);
        mocks.observeImpl = () => makeObserved(refs, { focusedB: true, floatingB: true, fingerprint: "fp-t1" });
        adapter.requestFloat();
        assert.equal(planIndices(mocks).length, 1);
        fireSingleTimeout(mocks);
        assert.deepEqual(adapter.getIntentMembers(), ["win-a"]);
        assert.equal(mocks.intent.writeCalls, 0);
        assert.deepEqual(mocks.floatingWrites, []);
    });

    it("a failed write retains intent until the next settled update rewrites", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.writeMode = "silent";
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const engine = EngineBridge.start();
        try {
            runDebounce(mocks);
            const admit = planIndices(mocks);
            assert.equal(admit.length, 1);
            assert.equal((await flushPlanAt(mocks, engine, admit[0] as number))["outcome"], "planned");
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, fingerprint: "fp-w1" });
            adapter.requestFloat();
            const first = planIndices(mocks);
            assert.equal(first.length, 2);
            const reply = await flushPlanAt(mocks, engine, first[1] as number);
            assert.equal(reply["outcome"], "planned");
            assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
            assert.equal(intentIndices(mocks, INTENT_WRITE_METHOD).length, 1);
            assert.equal(mocks.intent.writeCalls, 0);
            assert.deepEqual([...mocks.intent.stored], []);
            // No automatic retry: one diagnosed terminal, store untouched.
            fireSingleTimeout(mocks);
            assert.ok(intentWriteLogs(mocks).some((line) => line.includes("reason=timeout")));
            assert.equal(mocks.intent.writeCalls, 0);
            // The next settled update sends the full current set.
            mocks.intent.writeMode = "auto";
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, floatingB: true, fingerprint: "fp-w2" });
            adapter.requestFloat();
            const second = planIndices(mocks);
            assert.equal(second.length, 3);
            const unfloat = await flushPlanAt(mocks, engine, second[2] as number);
            assert.equal(unfloat["outcome"], "planned");
            assert.equal(intentIndices(mocks, INTENT_WRITE_METHOD).length, 2);
            assert.equal(mocks.intent.writeCalls, 1);
            assert.deepEqual([...mocks.intent.stored], []);
            const lastWrite = intentPayloadAt(mocks, intentIndices(mocks, INTENT_WRITE_METHOD)[1] as number);
            assert.deepEqual(lastWrite["members"], []);
        } finally {
            await engine.close();
        }
    });

    it("overlapping settles coalesce to one latest full snapshot in order", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.writeMode = "manual";
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const engine = EngineBridge.start();
        try {
            runDebounce(mocks);
            const admit = planIndices(mocks);
            assert.equal(admit.length, 1);
            assert.equal((await flushPlanAt(mocks, engine, admit[0] as number))["outcome"], "planned");
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, fingerprint: "fp-c1" });
            adapter.requestFloat();
            const first = planIndices(mocks);
            assert.equal(first.length, 2);
            assert.equal((await flushPlanAt(mocks, engine, first[1] as number))["outcome"], "planned");
            assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
            const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
            assert.equal(writes.length, 1);
            // A second settle lands while the first write is in flight.
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, floatingB: true, fingerprint: "fp-c2" });
            adapter.requestFloat();
            const second = planIndices(mocks);
            assert.equal(second.length, 3);
            assert.equal((await flushPlanAt(mocks, engine, second[2] as number))["outcome"], "planned");
            assert.deepEqual(adapter.getIntentMembers(), []);
            assert.equal(intentIndices(mocks, INTENT_WRITE_METHOD).length, 1);
            // Answering in order sends the full snapshots without reorder.
            answerIntentAt(mocks, writes[0] as number);
            const after = intentIndices(mocks, INTENT_WRITE_METHOD);
            assert.equal(after.length, 2);
            answerIntentAt(mocks, after[1] as number);
            assert.deepEqual([...mocks.intent.stored], []);
            assert.deepEqual(intentPayloadAt(mocks, writes[0] as number)["members"], ["win-b"]);
            assert.deepEqual(intentPayloadAt(mocks, after[1] as number)["members"], []);
        } finally {
            await engine.close();
        }
    });

    it("verified close evicts and persists; foreign ids send nothing", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.stored = new Set(["win-a"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.deepEqual(adapter.getIntentMembers(), ["win-a"]);
        adapter.noteNativeRemovedId("win-a");
        assert.deepEqual(adapter.getIntentMembers(), []);
        assert.equal(mocks.intent.writeCalls, 1);
        assert.deepEqual(intentPayloadAt(mocks, intentIndices(mocks, INTENT_WRITE_METHOD)[0] as number)["members"], []);
        adapter.noteNativeRemovedId("win-unknown");
        assert.equal(mocks.intent.writeCalls, 1);
    });

    it("a close during the pending read never revives the id", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.intent.stored = new Set(["win-gone"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        assert.equal(reads.length, 1);
        // Verified close lands while the read is in flight: the empty local
        // set proves nothing, yet the full snapshot queues regardless.
        adapter.noteNativeRemovedId("win-gone");
        assert.equal(intentIndices(mocks, INTENT_WRITE_METHOD).length, 0);
        // The server still returns the id (it was live at request time);
        // the settle subtracts the fenced close instead of adopting it.
        answerIntentAt(mocks, reads[0] as number);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(adapter.getIntentMembers(), []);
        assert.deepEqual(mocks.hydrated, [[]]);
        const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(intentPayloadAt(mocks, writes[0] as number)["members"], []);
        assert.deepEqual([...mocks.intent.stored], []);
    });

    it("a close during the pending read survives an incomplete inventory", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.inventoryImpl = () => null;
        mocks.intent.stored = new Set(["win-gone"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        assert.ok(!("live" in intentPayloadAt(mocks, reads[0] as number)));
        adapter.noteNativeRemovedId("win-gone");
        answerIntentAt(mocks, reads[0] as number);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(adapter.getIntentMembers(), []);
        const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(intentPayloadAt(mocks, writes[0] as number)["members"], []);
    });

    it("settle unions mid-bootstrap mutations then subtracts fenced closes", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.intent.stored = new Set(["win-a", "win-gone"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        // A settled-lookalike mutation plus a verified close interleave
        // with the read: the union keeps live truth, the fence drops the
        // close, and exactly one corrected snapshot persists afterwards.
        adapter.noteNativeRemovedId("win-gone");
        answerIntentAt(mocks, reads[0] as number);
        assert.deepEqual(adapter.getIntentMembers(), ["win-a"]);
        assert.deepEqual(mocks.hydrated, [["win-a"]]);
        const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(intentPayloadAt(mocks, writes[0] as number)["members"], ["win-a"]);
    });

    it("scoped minimization omission never evicts settled intent", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.stored = new Set(["win-b"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
        const engine = EngineBridge.start();
        try {
            runDebounce(mocks);
            const admit = planIndices(mocks);
            assert.equal(admit.length, 1);
            assert.equal((await flushPlanAt(mocks, engine, admit[0] as number))["outcome"], "planned");
            // Minimized: the client is omitted from this scoped snapshot.
            mocks.observeImpl = () => makeObserved(refs, { omitB: true, fingerprint: "fp-hide-1" });
            fire(mocks, "added");
            runDebounce(mocks);
            const omitted = planIndices(mocks);
            assert.equal(omitted.length, 2);
            assert.equal((await flushPlanAt(mocks, engine, omitted[1] as number))["outcome"], "planned");
            assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
            assert.equal(mocks.intent.writeCalls, 0);
            // Return with the hydrated float observed: still intentional,
            // still no durable churn.
            mocks.observeImpl = () => makeObserved(refs, { floatingB: true, fingerprint: "fp-hide-2" });
            fire(mocks, "added");
            runDebounce(mocks);
            const back = planIndices(mocks);
            assert.equal(back.length, 3);
            assert.equal((await flushPlanAt(mocks, engine, back[2] as number))["outcome"], "planned");
            assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
            assert.equal(mocks.intent.writeCalls, 0);
        } finally {
            await engine.close();
        }
    });

    it("mismatched read counts fail closed without adoption", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        mocks.intent.stored = new Set(["win-a"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        assert.equal(reads.length, 1);
        const mismatched = JSON.stringify({
            v: 1,
            correlation_id: (intentPayloadAt(mocks, reads[0] as number)["correlation_id"] as string),
            outcome: "ok",
            members: ["win-a"],
            stored: 1,
            returned: 99,
        });
        mocks.callbacks[reads[0] as number]?.(mismatched);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(adapter.getIntentMembers(), []);
        const line = intentReadLog(mocks);
        assert.ok(line !== undefined);
        assert.ok(line.includes("reason=malformed"));
    });

    it("negative read counts fail closed without adoption", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.readMode = "manual";
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const reads = intentIndices(mocks, INTENT_READ_METHOD);
        const negative = JSON.stringify({
            v: 1,
            correlation_id: (intentPayloadAt(mocks, reads[0] as number)["correlation_id"] as string),
            outcome: "ok",
            members: [],
            stored: -1,
            returned: 0,
        });
        mocks.callbacks[reads[0] as number]?.(negative);
        assert.equal(adapter.isIntentReady(), true);
        assert.deepEqual(adapter.getIntentMembers(), []);
    });

    it("a mismatched store ACK never claims success", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.writeMode = "manual";
        mocks.intent.stored = new Set(["win-a", "win-b"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        adapter.noteNativeRemovedId("win-a");
        const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        const mismatch = JSON.stringify({
            v: 1,
            correlation_id: (intentPayloadAt(mocks, writes[0] as number)["correlation_id"] as string),
            outcome: "stored",
            stored: 99,
        });
        mocks.callbacks[writes[0] as number]?.(mismatch);
        const lines = intentWriteLogs(mocks);
        assert.equal(lines.length, 1);
        assert.ok((lines[0] as string).includes("outcome=unavailable"));
        assert.ok((lines[0] as string).includes("reason=malformed"));
        assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
    });

    it("a failed deadline arm never sends and never blocks the next settle", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const engine = EngineBridge.start();
        try {
            runDebounce(mocks);
            const admit = planIndices(mocks);
            assert.equal(admit.length, 1);
            assert.equal((await flushPlanAt(mocks, engine, admit[0] as number))["outcome"], "planned");
            // The deadline cannot arm: diagnosed transport terminal without
            // sending, local intent retained, bridge left unblocked. Armed
            // after the plan dispatch so the fault lands on the write.
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, fingerprint: "fp-d1" });
            adapter.requestFloat();
            const plans = planIndices(mocks);
            assert.equal(plans.length, 2);
            mocks.throwScheduleOnceOnce = true;
            assert.equal((await flushPlanAt(mocks, engine, plans[1] as number))["outcome"], "planned");
            assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
            assert.equal(intentIndices(mocks, INTENT_WRITE_METHOD).length, 0);
            const lines = intentWriteLogs(mocks);
            assert.equal(lines.length, 1);
            assert.ok((lines[0] as string).includes("reason=transport"));
            // The next settled update writes the full set normally.
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, floatingB: true, fingerprint: "fp-d2" });
            adapter.requestFloat();
            const second = planIndices(mocks);
            assert.equal(second.length, 3);
            assert.equal((await flushPlanAt(mocks, engine, second[2] as number))["outcome"], "planned");
            const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
            assert.equal(writes.length, 1);
            assert.deepEqual(intentPayloadAt(mocks, writes[0] as number)["members"], []);
            assert.deepEqual([...mocks.intent.stored], []);
        } finally {
            await engine.close();
        }
    });

    it("a thrown send still delivers only the queued newer snapshot", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.writeMode = "manual";
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        const engine = EngineBridge.start();
        try {
            runDebounce(mocks);
            const admit = planIndices(mocks);
            assert.equal((await flushPlanAt(mocks, engine, admit[0] as number))["outcome"], "planned");
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, fingerprint: "fp-q1" });
            adapter.requestFloat();
            const first = planIndices(mocks);
            assert.equal((await flushPlanAt(mocks, engine, first[1] as number))["outcome"], "planned");
            const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
            assert.equal(writes.length, 1);
            // A second settle coalesces while the first write is in flight;
            // the terminal send throws and must only fall through to the
            // queued snapshot, never retry the failed one.
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, floatingB: true, fingerprint: "fp-q2" });
            adapter.requestFloat();
            const second = planIndices(mocks);
            assert.equal((await flushPlanAt(mocks, engine, second[2] as number))["outcome"], "planned");
            mocks.throwWriteOnce = true;
            answerIntentAt(mocks, writes[0] as number);
            const after = intentIndices(mocks, INTENT_WRITE_METHOD);
            assert.equal(after.length, 2);
            assert.deepEqual(intentPayloadAt(mocks, after[1] as number)["members"], []);
            const lines = intentWriteLogs(mocks);
            assert.ok(lines.some((line) => line.includes("reason=transport")));
            // No autonomous retry of the failed snapshot: the store keeps
            // the first write until a later settled update rewrites it.
            assert.deepEqual([...mocks.intent.stored], ["win-b"]);
            answerIntentAt(mocks, after[1] as number);
            assert.deepEqual([...mocks.intent.stored], []);
        } finally {
            await engine.close();
        }
    });

    it("confirmed adopted sticky-off persists intent with sticky controls unchanged", () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.fireDesktopsSync = true;
        let stickyLive = true;
        mocks.stickyToggleImpl = (allDesktops): void => {
            if (!allDesktops) {
                stickyLive = false;
            }
        };
        mocks.observeImpl = () =>
            makeObserved(refs, {
                focusedB: true,
                floatingB: !stickyLive,
                stickyB: stickyLive,
                fingerprint: stickyLive ? "fp-s1" : "fp-s2",
            });
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        adapter.requestFloat();
        // Native sticky control went through exactly once, off.
        assert.deepEqual(mocks.desktopToggles, [{ target: refs.b, allDesktops: false }]);
        assert.deepEqual(mocks.floatingWrites, [{ id: "win-b", floating: true }]);
        assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
        const writes = intentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(intentPayloadAt(mocks, writes[0] as number)["members"], ["win-b"]);
        assert.ok(mocks.logs.some((entry) => entry.includes("sticky-adopted")));
        // The sticky-off itself dispatches no plan; only the follow-up does.
        assert.equal(planIndices(mocks).length, 1);
    });

    it("planner recovery keeps intent without rehydration", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, true);
        mocks.intent.stored = new Set(["win-b"]);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), true);
        assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            mocks.observeImpl = () => makeObserved(refs, { floatingB: true, fingerprint: "fp-r1" });
            fire(mocks, "added");
            runDebounce(mocks);
            const first = planIndices(mocks);
            assert.equal(first.length, 1);
            assert.equal((await flushPlanAt(mocks, engine, first[0] as number))["outcome"], "planned");
            flushed.count = 1;
            // Confirmed planner loss on the next dispatch recovers the
            // session. The drifted frame forces a dispatch (equal
            // observations stay quiet).
            mocks.presenceImpl = () => false;
            mocks.observeImpl = () => makeObserved(refs, { floatingB: true, fingerprint: "fp-r2", driftAX: 4 });
            fire(mocks, "added");
            runDebounce(mocks);
            assert.ok(mocks.logs.some((entry) => entry.includes("outcome=confirmed-loss")));
            assert.equal(intentIndices(mocks, INTENT_READ_METHOD).length, 1);
            assert.deepEqual(adapter.getIntentMembers(), ["win-b"]);
            // The fresh session still observes the hydrated float as intentional.
            mocks.presenceImpl = () => true;
            await drainPlanCalls(mocks, engine, flushed);
            mocks.observeImpl = () => makeObserved(refs, { floatingB: true, fingerprint: "fp-r3" });
            fire(mocks, "added");
            runDebounce(mocks);
            await drainPlanCalls(mocks, engine, flushed);
            const plans = planIndices(mocks);
            const payload = JSON.parse(mocks.dbusCalls[plans[plans.length - 1] as number]?.payload as string) as Record<
                string,
                unknown
            >;
            const row = (payload["windows"] as Array<Record<string, unknown>>).find(
                (entry) => entry["window"] === "win-b",
            );
            assert.ok(row !== undefined, "wire carries the hydrated float");
            assert.equal(row["floating"], true);
            assert.ok(!("fixed_auto" in row), "no automatic origin after recovery");
        } finally {
            await engine.close();
        }
    });

    it("without the entry hooks the bridge stays fully inert", async () => {
        const refs = makeRefs();
        const mocks = mockAdapterEnv(refs, false);
        const adapter = enableAdapter(mocks);
        assert.equal(adapter.startIntentBootstrap(), false);
        const engine = EngineBridge.start();
        try {
            mocks.observeImpl = () => makeObserved(refs, { focusedB: true, fingerprint: "fp-n1" });
            adapter.requestFloat();
            const plans = planIndices(mocks);
            assert.equal(plans.length, 1);
            assert.equal((await flushPlanAt(mocks, engine, plans[0] as number))["outcome"], "planned");
            assert.deepEqual(
                mocks.dbusCalls.filter(
                    (call) => call.method === INTENT_READ_METHOD || call.method === INTENT_WRITE_METHOD,
                ),
                [],
            );
            assert.deepEqual(adapter.getIntentMembers(), []);
        } finally {
            await engine.close();
        }
    });
});

// ---------------------------------------------------------------------------
// Production-entry fixture: real observeNative/hidden/inventory paths over a
// fake workspace, real Planner for plan dispatches, fixture intent store.
// ---------------------------------------------------------------------------

async function drainPlanCalls(mocks: AdapterMocks, engine: EngineBridge, flushed: { count: number }): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
        const indices = planIndices(mocks);
        if (flushed.count >= indices.length) {
            return;
        }
        const reply = await flushPlanAt(mocks, engine, indices[flushed.count] as number);
        flushed.count += 1;
        assert.ok(
            reply["outcome"] === "planned" || reply["outcome"] === "released",
            `chain reply settles, got ${JSON.stringify(reply)}`,
        );
    }
    assert.ok(flushed.count >= planIndices(mocks).length, "completion chain settles");
}

interface EntrySignal {
    handlers: Array<(arg?: unknown) => void>;
    signal: {
        connect: (handler: (arg?: unknown) => void) => void;
        disconnect: (handler: (arg?: unknown) => void) => void;
    };
    fire: (arg?: unknown) => void;
}

function entrySignal(): EntrySignal {
    const handlers: Array<(arg?: unknown) => void> = [];
    return {
        handlers,
        signal: {
            connect: (handler: (arg?: unknown) => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: (arg?: unknown) => void): void => {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
            },
        },
        fire: (arg?: unknown): void => {
            for (const handler of [...handlers]) {
                handler(arg);
            }
        },
    };
}

interface FakeWorld {
    readonly workspace: Record<string, unknown>;
    wins: Array<Record<string, unknown>>;
    readonly output: Record<string, unknown>;
    readonly desktop: Record<string, unknown>;
    readonly desktop2: Record<string, unknown>;
    readonly desktop3: Record<string, unknown>;
    readonly added: EntrySignal;
    readonly removed: EntrySignal;
    // Counted native writes per window object plus workspace focus writes.
    // Tests reset after setup so only entry actuation is counted.
    readonly counts: Map<object, WinWriteCounts>;
    activeWindowWrites: number;
}

interface WinWriteCounts {
    frame: number;
    keepAbove: number;
    keepBelow: number;
    allDesktops: number;
    desktops: number;
    fullscreen: number;
    maximizeCalls: number;
}

function newWinWriteCounts(): WinWriteCounts {
    return { frame: 0, keepAbove: 0, keepBelow: 0, allDesktops: 0, desktops: 0, fullscreen: 0, maximizeCalls: 0 };
}

function bumpWinWrite(world: FakeWorld, win: Record<string, unknown>, key: keyof WinWriteCounts): void {
    let counts = world.counts.get(win);
    if (counts === undefined) {
        counts = newWinWriteCounts();
        world.counts.set(win, counts);
    }
    counts[key] += 1;
}

function winWriteCounts(world: FakeWorld, win: Record<string, unknown>): WinWriteCounts {
    return world.counts.get(win) ?? newWinWriteCounts();
}

function resetWinWriteCounts(world: FakeWorld): void {
    world.counts.clear();
    world.activeWindowWrites = 0;
}

function assertZeroWinWrites(world: FakeWorld, win: Record<string, unknown>, label: string): void {
    assert.deepEqual(winWriteCounts(world, win), newWinWriteCounts(), `${label}: no native writes to the target`);
}

function fakeWorld(): FakeWorld {
    const output: Record<string, unknown> = { name: "out-1" };
    const desktop: Record<string, unknown> = { id: "ws-1" };
    const desktop2: Record<string, unknown> = { id: "ws-2" };
    const desktop3: Record<string, unknown> = { id: "ws-3" };
    const added = entrySignal();
    const removed = entrySignal();
    const activated = entrySignal();
    const screensChanged = entrySignal();
    const currentDesktopChanged = entrySignal();
    const workspace: Record<string, unknown> = {};
    const world: FakeWorld = {
        workspace,
        wins: [],
        output,
        desktop,
        desktop2,
        desktop3,
        added,
        removed,
        counts: new Map(),
        activeWindowWrites: 0,
    };
    let activeWindow: unknown = undefined;
    Object.defineProperty(workspace, "activeWindow", {
        get: (): unknown => activeWindow,
        set: (value: unknown): void => {
            world.activeWindowWrites += 1;
            activeWindow = value;
        },
        enumerable: true,
        configurable: true,
    });
    workspace["windowList"] = (): unknown[] => [...world.wins];
    workspace["screens"] = [output];
    workspace["desktops"] = [desktop, desktop2, desktop3];
    workspace["activeScreen"] = output;
    workspace["currentDesktopForScreen"] = (): unknown => desktop;
    workspace["clientArea"] = (): unknown => ({ x: 0, y: 0, width: 1200, height: 800 });
    workspace["windowAdded"] = added.signal;
    workspace["windowRemoved"] = removed.signal;
    workspace["windowActivated"] = activated.signal;
    workspace["screensChanged"] = screensChanged.signal;
    workspace["currentDesktopChanged"] = currentDesktopChanged.signal;
    return world;
}

function addWin(
    world: FakeWorld,
    id: string,
    opts: { fixed?: boolean; sticky?: boolean; x?: number; home?: Record<string, unknown> } = {},
): Record<string, unknown> {
    const home = opts.home ?? world.desktop;
    const geo = entrySignal();
    const max = entrySignal();
    const desks = entrySignal();
    const full = entrySignal();
    const win: Record<string, unknown> = {
        normalWindow: true,
        internalId: id,
        resourceClass: "test-app",
        output: world.output,
        frameGeometryChanged: geo.signal,
        fullScreenChanged: full.signal,
        maximizedChanged: max.signal,
        maximizeMode: 0,
        desktopsChanged: desks.signal,
    };
    // Counted native setters: the entry actuates exclusively through these
    // property writes (plus setMaximize), so hydration no-touch tests can
    // assert zero writes to a recovered target instead of merely comparing
    // the last frame. Nested test mutations bypass the counters.
    let frame: { x: number; y: number; width: number; height: number } = {
        x: opts.x ?? 0,
        y: 0,
        width: 600,
        height: 800,
    };
    Object.defineProperty(win, "frameGeometry", {
        get: (): unknown => frame,
        set: (value: unknown): void => {
            bumpWinWrite(world, win, "frame");
            frame = value as { x: number; y: number; width: number; height: number };
        },
        enumerable: true,
        configurable: true,
    });
    let keepAbove = false;
    Object.defineProperty(win, "keepAbove", {
        get: (): boolean => keepAbove,
        set: (value: unknown): void => {
            bumpWinWrite(world, win, "keepAbove");
            keepAbove = value === true;
        },
        enumerable: true,
        configurable: true,
    });
    let keepBelow = false;
    Object.defineProperty(win, "keepBelow", {
        get: (): boolean => keepBelow,
        set: (value: unknown): void => {
            bumpWinWrite(world, win, "keepBelow");
            keepBelow = value === true;
        },
        enumerable: true,
        configurable: true,
    });
    let fullscreen = false;
    Object.defineProperty(win, "fullScreen", {
        get: (): boolean => fullscreen,
        set: (value: unknown): void => {
            bumpWinWrite(world, win, "fullscreen");
            fullscreen = value === true;
        },
        enumerable: true,
        configurable: true,
    });
    let desktopsVal: unknown[] = [home];
    Object.defineProperty(win, "desktops", {
        get: (): unknown[] => desktopsVal,
        set: (value: unknown): void => {
            bumpWinWrite(world, win, "desktops");
            desktopsVal = Array.isArray(value) ? [...value] : [];
        },
        enumerable: true,
        configurable: true,
    });
    if (opts.fixed === true) {
        win["resizeable"] = false;
        win["minSize"] = { width: 640, height: 480 };
        win["maxSize"] = { width: 640, height: 480 };
    }
    win["setMaximize"] = (vertically: unknown, horizontally: unknown): void => {
        bumpWinWrite(world, win, "maximizeCalls");
        if (vertically !== false || horizontally !== false) {
            return;
        }
        win["maximizeMode"] = 0;
        max.fire(win);
    };
    // KWin emits desktopsChanged synchronously from the setter: the
    // accessor models production ordering for sticky echo paths.
    let allDesktops = false;
    const applyDesktops = (value: boolean): void => {
        allDesktops = value;
        win["desktops"] = value ? [] : [home];
    };
    Object.defineProperty(win, "onAllDesktops", {
        get: (): boolean => allDesktops,
        set: (value: unknown): void => {
            bumpWinWrite(world, win, "allDesktops");
            applyDesktops(value === true);
            desks.fire(win);
        },
        enumerable: true,
        configurable: true,
    });
    applyDesktops(opts.sticky === true);
    world.wins.push(win);
    return win;
}

type EntryHandle = NonNullable<ReturnType<typeof startPlanAdapterEntry>>;

interface EntryMocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly shortcuts: Array<{ action: string; sequence: string; callback: () => void }>;
    readonly intent: FakeIntentStore;
    presenceImpl: () => boolean;
}

function startIntentEntry(
    world: FakeWorld,
    store: FakeIntentStore,
    opts: { readMode?: IntentMode; writeMode?: IntentMode } = {},
): { handle: EntryHandle; mocks: EntryMocks } {
    store.readMode = opts.readMode ?? "auto";
    store.writeMode = opts.writeMode ?? "auto";
    const mocks: EntryMocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        shortcuts: [],
        intent: store,
        presenceImpl: () => true,
    };
    const handle = startPlanAdapterEntry({
        workspace: world.workspace,
        callDbus: (_service, _path, _iface, method, payload, callback): void => {
            if (method === "NameHasOwner") {
                callback(mocks.presenceImpl());
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
            if (method === INTENT_READ_METHOD) {
                if (store.readMode === "auto") {
                    const reply = store.readReply(payload);
                    if (reply !== null) {
                        callback(reply);
                    }
                }
                return;
            }
            if (method === INTENT_WRITE_METHOD) {
                if (store.writeMode === "auto") {
                    const reply = store.writeReply(payload);
                    if (reply !== null) {
                        callback(reply);
                    }
                }
            }
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
        floatIntent: true,
        registerShortcutFn: (action, _text, sequence, callback): boolean => {
            mocks.shortcuts.push({ action, sequence, callback });
            return true;
        },
        readProfileFn: (): string => "cosmic",
    });
    assert.ok(handle !== null, "entry starts");
    return { handle: handle as EntryHandle, mocks };
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

function entryPlanIndices(mocks: EntryMocks): number[] {
    const out: number[] = [];
    for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
        if (mocks.dbusCalls[index]?.method === "DescribePlan") {
            out.push(index);
        }
    }
    return out;
}

function entryIntentIndices(mocks: EntryMocks, method: string): number[] {
    const out: number[] = [];
    for (let index = 0; index < mocks.dbusCalls.length; index += 1) {
        if (mocks.dbusCalls[index]?.method === method) {
            out.push(index);
        }
    }
    return out;
}

function answerEntryIntent(mocks: EntryMocks, index: number): void {
    const call = mocks.dbusCalls[index];
    assert.ok(call !== undefined, `intent call ${index} exists`);
    const store = mocks.intent;
    const reply =
        call.method === INTENT_READ_METHOD ? store.readReply(call.payload) : store.writeReply(call.payload);
    assert.ok(reply !== null, `fixture answers ${call.method}`);
    mocks.callbacks[index]?.(reply);
}

function entryPendingTimeouts(mocks: EntryMocks): number[] {
    const out: number[] = [];
    for (let index = 0; index < mocks.timers.length; index += 1) {
        const timer = mocks.timers[index];
        if (timer !== undefined && !timer.cancelled && timer.delayMs === PLAN_TIMEOUT_MS) {
            out.push(index);
        }
    }
    return out;
}

async function flushEntryPlan(
    mocks: EntryMocks,
    engine: EngineBridge,
    index: number,
): Promise<Record<string, unknown>> {
    const call = mocks.dbusCalls[index];
    assert.ok(call !== undefined && call.method === "DescribePlan", `plan dispatch ${index} exists`);
    const replyText = await engine.send(call.payload);
    mocks.callbacks[index]?.(replyText);
    return JSON.parse(replyText) as Record<string, unknown>;
}

async function drainEntryPlans(mocks: EntryMocks, engine: EngineBridge, flushed: { count: number }): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        const indices = entryPlanIndices(mocks);
        if (flushed.count >= indices.length) {
            return;
        }
        const reply = await flushEntryPlan(mocks, engine, indices[flushed.count] as number);
        flushed.count += 1;
        assert.ok(
            reply["outcome"] === "planned" || reply["outcome"] === "released",
            `chain reply settles, got ${JSON.stringify(reply)}`,
        );
    }
    assert.ok(flushed.count >= entryPlanIndices(mocks).length, "completion chain settles");
}

function lastPlanPayload(mocks: EntryMocks): Record<string, unknown> {
    const indices = entryPlanIndices(mocks);
    assert.ok(indices.length > 0, "a plan dispatched");
    return JSON.parse(mocks.dbusCalls[indices[indices.length - 1] as number]?.payload as string) as Record<
        string,
        unknown
    >;
}

function wireRow(payload: Record<string, unknown>, id: string): Record<string, unknown> {
    const found = (payload["windows"] as Array<Record<string, unknown>>).find((entry) => entry["window"] === id);
    assert.ok(found !== undefined, `wire carries ${id}`);
    return found;
}

function frameOf(win: Record<string, unknown>): { x: number; y: number; w: number; h: number } {
    const frame = win["frameGeometry"] as { x: number; y: number; width: number; height: number };
    return { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
}

function toggleFloatShortcut(mocks: EntryMocks): () => void {
    const toggle = mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-toggle-float");
    assert.ok(toggle !== undefined, "float shortcut registered");
    return toggle.callback;
}

describe("float-intent through the production entry", () => {
    it("gates first admission until the read settles, then hydrates the foreground float", async () => {
        const world = fakeWorld();
        const winA = addWin(world, "win-a", { x: 0 });
        const winB = addWin(world, "win-b", { x: 600 });
        addWin(world, "win-c", { x: 0, home: world.desktop2 });
        world.workspace["activeWindow"] = winA;
        const store = new FakeIntentStore();
        store.stored = new Set(["win-b"]);
        const { mocks } = startIntentEntry(world, store, { readMode: "manual" });
        assert.equal(mocks.dbusCalls[0]?.method, INTENT_READ_METHOD);
        const live = JSON.parse(mocks.dbusCalls[0]?.payload as string) as Record<string, unknown>;
        assert.deepEqual([...(live["live"] as string[])].sort(), ["win-a", "win-b", "win-c"]);
        // First admission waits for hydration.
        world.added.fire();
        runEntryDebounce(mocks);
        assert.deepEqual(entryPlanIndices(mocks), []);
        answerEntryIntent(mocks, 0);
        runEntryDebounce(mocks);
        const payload = lastPlanPayload(mocks);
        const row = wireRow(payload, "win-b");
        assert.equal(row["floating"], true);
        assert.ok(!("fixed_auto" in row), "hydrated float rides without automatic origin");
        // Real Engine plans with no touch to the recovered float: counted
        // setters prove zero writes (a same-geometry write or transient
        // focus undo would pass a last-frame comparison).
        const engine = EngineBridge.start();
        try {
            resetWinWriteCounts(world);
            const flushed = { count: 0 };
            await drainEntryPlans(mocks, engine, flushed);
            assert.deepEqual(frameOf(winB), { x: 600, y: 0, w: 600, h: 800 });
            assertZeroWinWrites(world, winB, "foreground hydration");
            assert.equal(world.workspace["activeWindow"], winA);
            assert.equal(world.activeWindowWrites, 0, "native focus not actuated");
        } finally {
            await engine.close();
        }
    });

    it("hydrates hidden floats with no touch", async () => {
        const world = fakeWorld();
        const winA = addWin(world, "win-a", { x: 0 });
        addWin(world, "win-b", { x: 600 });
        const winC = addWin(world, "win-c", { x: 0, home: world.desktop2 });
        world.workspace["activeWindow"] = winA;
        const store = new FakeIntentStore();
        store.stored = new Set(["win-c"]);
        const { mocks } = startIntentEntry(world, store);
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            resetWinWriteCounts(world);
            world.added.fire();
            runEntryDebounce(mocks);
            await drainEntryPlans(mocks, engine, flushed);
            const hidden = mocks.dbusCalls
                .map((call) => call.payload)
                .filter((payload) => payload.includes('"workspace":"ws-2"') || payload.includes('"domain"'));
            void hidden;
            const payloads = mocks.dbusCalls
                .filter((call) => call.method === "DescribePlan")
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>);
            const hiddenPayload = payloads.find(
                (payload) => (payload["domain"] as Record<string, unknown>)["workspace"] === "ws-2",
            );
            assert.ok(hiddenPayload !== undefined, "hidden domain dispatches");
            const row = wireRow(hiddenPayload, "win-c");
            assert.equal(row["floating"], true);
            assert.ok(!("fixed_auto" in row));
            assert.deepEqual(frameOf(winC), { x: 0, y: 0, w: 600, h: 800 });
            assertZeroWinWrites(world, winC, "hidden hydration");
            assert.equal(world.activeWindowWrites, 0, "native focus not actuated");
        } finally {
            await engine.close();
        }
    });

    it("a fresh instance keeps intent over automatic while hints recompute", async () => {
        // First session floats win-f through the real toggle path.
        const world1 = fakeWorld();
        const winF1 = addWin(world1, "win-f", { x: 600 });
        addWin(world1, "win-a", { x: 0 });
        world1.workspace["activeWindow"] = winF1;
        const store = new FakeIntentStore();
        const first = startIntentEntry(world1, store);
        const engine = EngineBridge.start();
        try {
            world1.added.fire();
            runEntryDebounce(first.mocks);
            const flushed1 = { count: 0 };
            await drainEntryPlans(first.mocks, engine, flushed1);
            toggleFloatShortcut(first.mocks)();
            const plans1 = entryPlanIndices(first.mocks);
            const reply1 = await flushEntryPlan(first.mocks, engine, plans1[plans1.length - 1] as number);
            assert.equal(reply1["outcome"], "planned", `float plans, got ${JSON.stringify(reply1)}`);
            assert.deepEqual([...store.stored], ["win-f"]);
            first.handle.stop();
            // Fresh instance over the same marker state: win-f gained fixed
            // hints while stopped, win-g is a new fixed window without intent.
            const world2 = fakeWorld();
            const winF2 = addWin(world2, "win-f", { x: 600, fixed: true });
            const winG2 = addWin(world2, "win-g", { x: 0, home: world2.desktop2, fixed: true });
            addWin(world2, "win-a", { x: 0 });
            world2.workspace["activeWindow"] = world2.wins[2];
            const second = startIntentEntry(world2, store);
            resetWinWriteCounts(world2);
            world2.added.fire();
            runEntryDebounce(second.mocks);
            const payload = lastPlanPayload(second.mocks);
            const intentRow = wireRow(payload, "win-f");
            assert.equal(intentRow["floating"], true);
            assert.ok(!("fixed_auto" in intentRow), "settled intent outranks fresh automatic");
            const flushed2 = { count: 0 };
            await drainEntryPlans(second.mocks, engine, flushed2);
            const payloads = second.mocks.dbusCalls
                .filter((call) => call.method === "DescribePlan")
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>);
            const hiddenPayload = payloads.find(
                (entry) => (entry["domain"] as Record<string, unknown>)["workspace"] === "ws-2",
            );
            assert.ok(hiddenPayload !== undefined, "hidden domain dispatches");
            const autoRow = wireRow(hiddenPayload, "win-g");
            assert.equal(autoRow["floating"], true);
            assert.equal(autoRow["fixed_auto"], true);
            assert.deepEqual(frameOf(winF2), { x: 600, y: 0, w: 600, h: 800 });
            assert.deepEqual(frameOf(winG2), { x: 0, y: 0, w: 600, h: 800 });
            assertZeroWinWrites(world2, winF2, "intent over fresh automatic");
            assertZeroWinWrites(world2, winG2, "no catch-up write to the new automatic client");
            assert.equal(world2.activeWindowWrites, 0, "native focus not actuated");
            assert.deepEqual([...store.stored], ["win-f"]);
            second.handle.stop();
        } finally {
            await engine.close();
        }
    });

    it("automatic recreates from cleared hints while intent persists without writes", async () => {
        // R-RST04: intentional E plus automatic-fixed F at the first owner;
        // only E persists. While stopped both lose fixed hints; the restart
        // with the same IDs must recover E as floating with zero native
        // writes while F tiles fresh. No override is persisted either way.
        const world1 = fakeWorld();
        addWin(world1, "win-a", { x: 0 });
        const winE1 = addWin(world1, "win-e", { x: 600 });
        addWin(world1, "win-f", { x: 300, fixed: true });
        world1.workspace["activeWindow"] = winE1;
        const store = new FakeIntentStore();
        const first = startIntentEntry(world1, store);
        const engine = EngineBridge.start();
        try {
            world1.added.fire();
            runEntryDebounce(first.mocks);
            const flushed1 = { count: 0 };
            await drainEntryPlans(first.mocks, engine, flushed1);
            const admit = lastPlanPayload(first.mocks);
            assert.equal(wireRow(admit, "win-f")["floating"], true);
            assert.equal(wireRow(admit, "win-f")["fixed_auto"], true);
            toggleFloatShortcut(first.mocks)();
            const plans1 = entryPlanIndices(first.mocks);
            const reply1 = await flushEntryPlan(first.mocks, engine, plans1[plans1.length - 1] as number);
            assert.equal(reply1["outcome"], "planned", `float plans, got ${JSON.stringify(reply1)}`);
            assert.deepEqual([...store.stored], ["win-e"], "only the intentional float persists");
            first.handle.stop();
            // Restart with the same IDs but no fixed hints anywhere.
            const world2 = fakeWorld();
            addWin(world2, "win-a", { x: 0 });
            const winE2 = addWin(world2, "win-e", { x: 600 });
            addWin(world2, "win-f", { x: 300 });
            world2.workspace["activeWindow"] = world2.wins[0];
            const second = startIntentEntry(world2, store);
            resetWinWriteCounts(world2);
            world2.added.fire();
            runEntryDebounce(second.mocks);
            const payload = lastPlanPayload(second.mocks);
            const intentRow = wireRow(payload, "win-e");
            assert.equal(intentRow["floating"], true);
            assert.ok(!("fixed_auto" in intentRow), "recovered intent rides without origin");
            assert.ok(!("floating" in wireRow(payload, "win-f")), "hintless automatic tiles fresh");
            const plans2 = entryPlanIndices(second.mocks);
            const reply2 = await flushEntryPlan(second.mocks, engine, plans2[plans2.length - 1] as number);
            assert.equal(reply2["outcome"], "planned", `restart plans, got ${JSON.stringify(reply2)}`);
            const desired = (reply2["desired_geometry"] as Array<Record<string, unknown>>).map(
                (entry) => entry["window"],
            );
            assert.ok(desired.includes("win-f"), "recreated automatic rejoins the tiled topology");
            assert.ok(!desired.includes("win-e"), "recovered float takes no slot");
            assert.deepEqual(frameOf(winE2), { x: 600, y: 0, w: 600, h: 800 });
            assertZeroWinWrites(world2, winE2, "restarted intent");
            assert.equal(world2.activeWindowWrites, 0, "native focus not actuated");
            assert.deepEqual([...store.stored], ["win-e"]);
            second.handle.stop();
        } finally {
            await engine.close();
        }
    });

    it("geometry drift while stopped preserves the hydrated float", async () => {
        const world = fakeWorld();
        const winA = addWin(world, "win-a", { x: 0 });
        const winB = addWin(world, "win-b", { x: 40 });
        (winB["frameGeometry"] as Record<string, unknown>)["width"] = 560;
        world.workspace["activeWindow"] = winA;
        const store = new FakeIntentStore();
        store.stored = new Set(["win-b"]);
        const { mocks } = startIntentEntry(world, store);
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            resetWinWriteCounts(world);
            world.added.fire();
            runEntryDebounce(mocks);
            const payload = lastPlanPayload(mocks);
            assert.equal(wireRow(payload, "win-b")["floating"], true);
            await drainEntryPlans(mocks, engine, flushed);
            assert.deepEqual(frameOf(winB), { x: 40, y: 0, w: 560, h: 800 });
            assertZeroWinWrites(world, winB, "drifted hydration");
            assert.equal(world.workspace["activeWindow"], winA);
            assert.equal(world.activeWindowWrites, 0, "native focus not actuated");
        } finally {
            await engine.close();
        }
    });

    it("settled unfloat clears the store and the next instance tiles", async () => {
        const world1 = fakeWorld();
        const winB1 = addWin(world1, "win-b", { x: 600 });
        addWin(world1, "win-a", { x: 0 });
        world1.workspace["activeWindow"] = winB1;
        const store = new FakeIntentStore();
        const first = startIntentEntry(world1, store);
        const engine = EngineBridge.start();
        try {
            world1.added.fire();
            runEntryDebounce(first.mocks);
            const flushed1 = { count: 0 };
            await drainEntryPlans(first.mocks, engine, flushed1);
            toggleFloatShortcut(first.mocks)();
            const floatPlans = entryPlanIndices(first.mocks);
            assert.equal(
                (await flushEntryPlan(first.mocks, engine, floatPlans[floatPlans.length - 1] as number))["outcome"],
                "planned",
            );
            assert.deepEqual([...store.stored], ["win-b"]);
            toggleFloatShortcut(first.mocks)();
            const unfloatPlans = entryPlanIndices(first.mocks);
            assert.equal(
                (await flushEntryPlan(first.mocks, engine, unfloatPlans[unfloatPlans.length - 1] as number))["outcome"],
                "planned",
            );
            assert.deepEqual([...store.stored], []);
            const writePayloads = first.mocks.dbusCalls
                .filter((call) => call.method === INTENT_WRITE_METHOD)
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>);
            assert.deepEqual(
                writePayloads.map((entry) => entry["members"]),
                [["win-b"], []],
            );
            first.handle.stop();
            // Fresh instance tiles the unforked window.
            const world2 = fakeWorld();
            addWin(world2, "win-b", { x: 600 });
            const winA2 = addWin(world2, "win-a", { x: 0 });
            world2.workspace["activeWindow"] = winA2;
            const second = startIntentEntry(world2, store);
            world2.added.fire();
            runEntryDebounce(second.mocks);
            const payload = lastPlanPayload(second.mocks);
            assert.ok(!("floating" in wireRow(payload, "win-b")), "unfloated window tiles again");
            second.handle.stop();
        } finally {
            await engine.close();
        }
    });

    it("verified close evicts the settled set", () => {
        const world = fakeWorld();
        addWin(world, "win-a", { x: 0 });
        const winB = addWin(world, "win-b", { x: 600 });
        world.workspace["activeWindow"] = world.wins[0];
        const store = new FakeIntentStore();
        store.stored = new Set(["win-b"]);
        const { mocks } = startIntentEntry(world, store);
        assert.deepEqual([...store.stored], ["win-b"]);
        world.wins = world.wins.filter((win) => win !== winB);
        world.removed.fire(winB);
        assert.deepEqual([...store.stored], []);
        const writes = entryIntentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(
            (JSON.parse(mocks.dbusCalls[writes[0] as number]?.payload as string) as Record<string, unknown>)["members"],
            [],
        );
    });

    it("read prunes to the complete live inventory with counts", () => {
        const world = fakeWorld();
        addWin(world, "win-a", { x: 0 });
        addWin(world, "win-b", { x: 600 });
        world.workspace["activeWindow"] = world.wins[0];
        const store = new FakeIntentStore();
        store.stored = new Set(["win-a", "win-gone"]);
        const { mocks } = startIntentEntry(world, store);
        const line = mocks.logs.find((entry) => entry.includes(":intent-read "));
        assert.ok(line !== undefined);
        assert.ok(line.includes("outcome=ok"));
        assert.ok(line.includes("stored=2") && line.includes("returned=1"), line);
        world.added.fire();
        runEntryDebounce(mocks);
        const payload = lastPlanPayload(mocks);
        assert.equal(wireRow(payload, "win-a")["floating"], true);
    });

    it("missing, corrupt, and silent reads all proceed to planning", () => {
        for (const mode of ["missing", "corrupt", "silent"] as const) {
            const world = fakeWorld();
            addWin(world, "win-a", { x: 0 });
            addWin(world, "win-b", { x: 600 });
            world.workspace["activeWindow"] = world.wins[0];
            const store = new FakeIntentStore();
            if (mode === "corrupt") {
                store.scriptedRead = { outcome: "degraded", reason: "corrupt" };
            }
            const { mocks } = startIntentEntry(world, store, {
                readMode: mode === "silent" ? "silent" : "auto",
            });
            if (mode === "silent") {
                const pending = entryPendingTimeouts(mocks);
                assert.equal(pending.length, 1);
                const timer = mocks.timers[pending[0] as number];
                assert.ok(timer !== undefined);
                timer.cancelled = true;
                timer.callback();
            }
            const line = mocks.logs.find((entry) => entry.includes(":intent-read "));
            assert.ok(line !== undefined);
            if (mode === "missing") {
                // Missing content reads plain empty (ok), never degraded.
                assert.ok(line.includes("outcome=ok"), line);
                assert.ok(line.includes("stored=0") && line.includes("returned=0"), line);
            } else {
                assert.ok(line.includes("outcome=degraded"), `${mode} proceeds degraded`);
            }
            if (mode === "corrupt") {
                assert.ok(line.includes("reason=corrupt"), line);
            }
            if (mode === "silent") {
                assert.ok(line.includes("reason=timeout"), line);
            }
            world.added.fire();
            runEntryDebounce(mocks);
            assert.ok(entryPlanIndices(mocks).length > 0, `${mode} proceeds to planning`);
        }
    });

    it("a failed write is rewritten in full by the next settled update", async () => {
        const world = fakeWorld();
        const winB = addWin(world, "win-b", { x: 600 });
        addWin(world, "win-a", { x: 0 });
        world.workspace["activeWindow"] = winB;
        const store = new FakeIntentStore();
        const { mocks } = startIntentEntry(world, store, { writeMode: "silent" });
        const engine = EngineBridge.start();
        try {
            world.added.fire();
            runEntryDebounce(mocks);
            const flushed = { count: 0 };
            await drainEntryPlans(mocks, engine, flushed);
            toggleFloatShortcut(mocks)();
            const floatPlans = entryPlanIndices(mocks);
            assert.equal(
                (await flushEntryPlan(mocks, engine, floatPlans[floatPlans.length - 1] as number))["outcome"],
                "planned",
            );
            assert.equal(entryIntentIndices(mocks, INTENT_WRITE_METHOD).length, 1);
            assert.deepEqual([...store.stored], []);
            const pending = entryPendingTimeouts(mocks);
            assert.equal(pending.length, 1);
            const timer = mocks.timers[pending[0] as number];
            assert.ok(timer !== undefined);
            timer.cancelled = true;
            timer.callback();
            assert.ok(
                mocks.logs.some((entry) => entry.includes(":intent-write ") && entry.includes("reason=timeout")),
            );
            store.writeMode = "auto";
            toggleFloatShortcut(mocks)();
            const unfloatPlans = entryPlanIndices(mocks);
            assert.equal(
                (await flushEntryPlan(mocks, engine, unfloatPlans[unfloatPlans.length - 1] as number))["outcome"],
                "planned",
            );
            assert.equal(entryIntentIndices(mocks, INTENT_WRITE_METHOD).length, 2);
            assert.deepEqual([...store.stored], []);
        } finally {
            await engine.close();
        }
    });

    it("planner restart recovers without rehydration wiping local intent", async () => {
        const world = fakeWorld();
        addWin(world, "win-a", { x: 0 });
        addWin(world, "win-b", { x: 600 });
        world.workspace["activeWindow"] = world.wins[0];
        const store = new FakeIntentStore();
        store.stored = new Set(["win-b"]);
        const { mocks } = startIntentEntry(world, store);
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            world.added.fire();
            runEntryDebounce(mocks);
            await drainEntryPlans(mocks, engine, flushed);
            // Drift the tiled sibling so the next signal dispatches instead
            // of staying quiet on equal evidence.
            const driftedSib = world.wins[0];
            assert.ok(driftedSib !== undefined);
            driftedSib["frameGeometry"] = { x: 4, y: 0, width: 600, height: 800 };
            mocks.presenceImpl = () => false;
            world.added.fire();
            runEntryDebounce(mocks);
            assert.ok(mocks.logs.some((entry) => entry.includes("outcome=confirmed-loss")));
            assert.equal(entryIntentIndices(mocks, INTENT_READ_METHOD).length, 1);
            mocks.presenceImpl = () => true;
            await drainEntryPlans(mocks, engine, flushed);
            world.added.fire();
            runEntryDebounce(mocks);
            await drainEntryPlans(mocks, engine, flushed);
            const payload = lastPlanPayload(mocks);
            const row = wireRow(payload, "win-b");
            assert.equal(row["floating"], true);
            assert.ok(!("fixed_auto" in row), "recovered session keeps hydrated intent");
        } finally {
            await engine.close();
        }
    });

    it("adopted sticky-off persists the ordinary float with sticky controls unchanged", () => {
        const world = fakeWorld();
        const winA = addWin(world, "win-a", { x: 0 });
        const winB = addWin(world, "win-b", { x: 600, sticky: true });
        world.workspace["activeWindow"] = winB;
        const store = new FakeIntentStore();
        const { handle, mocks } = startIntentEntry(world, store);
        assert.equal(winB["onAllDesktops"], true);
        handle.requestSticky();
        // Native sticky control landed off; the confirmed ordinary float
        // persisted as settled intent.
        assert.equal(winB["onAllDesktops"], false);
        assert.deepEqual((winB["desktops"] as unknown[]).length, 1);
        assert.deepEqual([...store.stored], ["win-b"]);
        const writes = entryIntentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(
            (JSON.parse(mocks.dbusCalls[writes[0] as number]?.payload as string) as Record<string, unknown>)["members"],
            ["win-b"],
        );
        assert.ok(
            mocks.logs.some((entry) => entry.includes("sticky-toggle") && entry.includes("outcome=invoked")),
            "sticky control path unchanged",
        );
        world.added.fire();
        runEntryDebounce(mocks);
        const payload = lastPlanPayload(mocks);
        assert.equal(wireRow(payload, "win-b")["floating"], true);
        assert.equal(world.workspace["activeWindow"], winB);
        void winA;
        handle.stop();
    });

    it("hidden-to-hidden relocation keeps settled intent with no target writes", async () => {
        const world = fakeWorld();
        const winA = addWin(world, "win-a", { x: 0 });
        const winH = addWin(world, "win-h", { x: 0, home: world.desktop2 });
        world.workspace["activeWindow"] = winA;
        const store = new FakeIntentStore();
        store.stored = new Set(["win-h"]);
        const { mocks } = startIntentEntry(world, store);
        const engine = EngineBridge.start();
        const flushed = { count: 0 };
        try {
            world.added.fire();
            runEntryDebounce(mocks);
            await drainEntryPlans(mocks, engine, flushed);
            assert.deepEqual([...store.stored], ["win-h"]);
            // Relocate the hidden survivor to another hidden domain while
            // the foreground stays quiet. The homing flight for the new
            // domain fails first, so applied evidence still homes the
            // vacated domain when its empty step runs: that step must
            // retire per-domain evidence only, never the global membership.
            winH["desktops"] = [world.desktop3];
            world.added.fire();
            runEntryDebounce(mocks);
            const homing = entryPendingTimeouts(mocks);
            assert.equal(homing.length, 1);
            const homingTimer = mocks.timers[homing[0] as number];
            assert.ok(homingTimer !== undefined);
            homingTimer.cancelled = true;
            homingTimer.callback();
            await drainEntryPlans(mocks, engine, flushed);
            assert.deepEqual([...store.stored], ["win-h"]);
            assert.equal(
                mocks.dbusCalls.filter((call) => call.method === INTENT_WRITE_METHOD).length,
                0,
                "no settled event touches the survivor, so nothing persists",
            );
            // Recovery: the survivor still homes as intentional with no
            // geometry, focus, or membership churn of its own.
            world.added.fire();
            runEntryDebounce(mocks);
            await drainEntryPlans(mocks, engine, flushed);
            const payloads = mocks.dbusCalls
                .filter((call) => call.method === "DescribePlan")
                .map((call) => JSON.parse(call.payload) as Record<string, unknown>);
            const homed = payloads.find(
                (entry) => (entry["domain"] as Record<string, unknown>)["workspace"] === "ws-3",
            );
            assert.ok(homed !== undefined, "relocated domain homes the survivor");
            const row = wireRow(homed, "win-h");
            assert.equal(row["floating"], true);
            assert.ok(!("fixed_auto" in row), "survivor stays intentional, never re-tiled");
            assert.deepEqual(frameOf(winH), { x: 0, y: 0, w: 600, h: 800 });
            assert.equal(world.workspace["activeWindow"], winA);
        } finally {
            await engine.close();
        }
    });

    it("a close during the pending read never hydrates or persists the id", () => {
        const world = fakeWorld();
        addWin(world, "win-a", { x: 0 });
        const winB = addWin(world, "win-b", { x: 600 });
        world.workspace["activeWindow"] = world.wins[0];
        const store = new FakeIntentStore();
        store.stored = new Set(["win-b"]);
        const { mocks } = startIntentEntry(world, store, { readMode: "manual" });
        assert.equal(mocks.dbusCalls[0]?.method, INTENT_READ_METHOD);
        // Verified close lands while the read is in flight.
        world.wins = world.wins.filter((win) => win !== winB);
        world.removed.fire(winB);
        answerEntryIntent(mocks, 0);
        const writes = entryIntentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(
            (JSON.parse(mocks.dbusCalls[writes[0] as number]?.payload as string) as Record<string, unknown>)["members"],
            [],
        );
        assert.deepEqual([...store.stored], []);
        world.added.fire();
        runEntryDebounce(mocks);
        const payload = lastPlanPayload(mocks);
        assert.ok(
            !(payload["windows"] as Array<Record<string, unknown>>).some((entry) => entry["window"] === "win-b"),
            "closed id never re-enters the wire",
        );
    });

    it("closing a hydrated client excluded from observation clears its markers", () => {
        const world = fakeWorld();
        addWin(world, "win-a", { x: 0 });
        const winX = addWin(world, "win-x", { x: 600 });
        winX["normalWindow"] = false;
        world.workspace["activeWindow"] = world.wins[0];
        const store = new FakeIntentStore();
        store.stored = new Set(["win-x"]);
        const { mocks } = startIntentEntry(world, store);
        // The excluded client hydrates (its live id is inventoried) but
        // never enters ordinary observation.
        world.added.fire();
        runEntryDebounce(mocks);
        const payload = lastPlanPayload(mocks);
        assert.ok(
            !(payload["windows"] as Array<Record<string, unknown>>).some((entry) => entry["window"] === "win-x"),
        );
        // Its verified close still clears markers through the inventory
        // owner recorded while live; the dead object is never read.
        resetWinWriteCounts(world);
        world.wins = world.wins.filter((win) => win !== winX);
        world.removed.fire(winX);
        assert.deepEqual([...store.stored], []);
        const writes = entryIntentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(
            (JSON.parse(mocks.dbusCalls[writes[0] as number]?.payload as string) as Record<string, unknown>)["members"],
            [],
        );
    });

    it("a close during the pending read clears an unobservable id without actuation", () => {
        const world = fakeWorld();
        const winA = addWin(world, "win-a", { x: 0 });
        const winX = addWin(world, "win-x", { x: 600 });
        winX["normalWindow"] = false;
        world.workspace["activeWindow"] = winA;
        const store = new FakeIntentStore();
        store.stored = new Set(["win-x"]);
        const { mocks } = startIntentEntry(world, store, { readMode: "manual" });
        assert.equal(mocks.dbusCalls[0]?.method, INTENT_READ_METHOD);
        // Ordinary observation can never see win-x, yet the inventory owner
        // lets its verified close fence the pending read.
        resetWinWriteCounts(world);
        world.wins = world.wins.filter((win) => win !== winX);
        world.removed.fire(winX);
        answerEntryIntent(mocks, 0);
        assert.deepEqual([...store.stored], []);
        const writes = entryIntentIndices(mocks, INTENT_WRITE_METHOD);
        assert.equal(writes.length, 1);
        assert.deepEqual(
            (JSON.parse(mocks.dbusCalls[writes[0] as number]?.payload as string) as Record<string, unknown>)["members"],
            [],
        );
        assertZeroWinWrites(world, winA, "close path actuates nothing live");
        assert.equal(world.activeWindowWrites, 0, "native focus not actuated");
    });

    it("workspace sends refuse through the registered shortcut while bootstrapping", () => {
        const world = fakeWorld();
        const winA = addWin(world, "win-a", { x: 0 });
        addWin(world, "win-b", { x: 600 });
        world.workspace["activeWindow"] = winA;
        const store = new FakeIntentStore();
        const { mocks } = startIntentEntry(world, store, { readMode: "manual" });
        const move = mocks.shortcuts.find((row) => row.action === "plasma-auto-tiler-move-workspace-2");
        assert.ok(move !== undefined, "workspace move shortcut registered");
        const callsBefore = mocks.dbusCalls.length;
        move.callback();
        // Same bounded deferred shape as the plan dispatch gate: no send
        // dispatch and no native membership/geometry/focus writes.
        assert.ok(
            mocks.logs.some((entry) => entry.includes("intent-bootstrap-deferred") && entry.includes("kind=workspace-move")),
        );
        assert.equal(mocks.dbusCalls.length, callsBefore);
        assert.deepEqual(winA["desktops"], [world.desktop]);
        assert.equal(world.workspace["activeWindow"], winA);
        // After the read settles the same route proceeds past the gate.
        answerEntryIntent(mocks, 0);
        const deferredBefore = mocks.logs.filter((entry) => entry.includes("intent-bootstrap-deferred")).length;
        move.callback();
        assert.equal(
            mocks.logs.filter((entry) => entry.includes("intent-bootstrap-deferred")).length,
            deferredBefore,
             "settled bootstrap no longer defers the route",
         );
     });
});
