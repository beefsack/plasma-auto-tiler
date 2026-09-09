import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    FOCUS_CONTRACT_VERSION,
    FOCUS_DBUS_INTERFACE,
    FOCUS_DBUS_OBJECT,
    FOCUS_DBUS_SERVICE,
    FOCUS_GET_OWNER_METHOD,
    FOCUS_INTERFACE,
    FOCUS_METHOD,
    FOCUS_OBJECT,
    FOCUS_SERVICE,
    FOCUS_START_ALREADY,
    FOCUS_START_FLAGS,
    FOCUS_START_METHOD,
    FOCUS_START_PRIMARY,
    FocusAdapter,
    FocusAdapterEnv,
    FocusObserved,
} from "../src/focus-adapter";
import { startFocusAdapterEntry } from "../src/focus-adapter-entry";

function makeRefs(): { a: object; b: object; c: object } {
    return { a: {}, b: {}, c: {} };
}

function makeObserved(
    refs: { a: object; b: object; c: object },
    active: object,
    fingerprint = "fp-1",
): FocusObserved {
    const windows = Object.freeze([
        Object.freeze({ id: "win-a", ref: refs.a }),
        Object.freeze({ id: "win-b", ref: refs.b }),
        Object.freeze({ id: "win-c", ref: refs.c }),
    ]);
    return {
        domainOutput: "focus-output",
        domainWorkspace: "focus-workspace",
        focusedId: active === refs.a ? "win-a" : active === refs.b ? "win-b" : "win-c",
        windows,
        activeRef: active,
        fingerprint,
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{
        service: string;
        path: string;
        iface: string;
        method: string;
        payload: string;
    }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly subscribes: string[];
    readonly unsubscribes: number[];
    writes: number;
    lastTarget: object | null;
    observeImpl: () => FocusObserved | null;
    activeImpl: () => object | null;
    authorityImpl: () => boolean;
    env: FocusAdapterEnv;
}

function mockEnv(refs: { a: object; b: object; c: object }): Mocks {
    const state: Mocks = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        subscribes: [],
        unsubscribes: [],
        writes: 0,
        lastTarget: null,
        observeImpl: () => makeObserved(refs, refs.a),
        activeImpl: () => refs.a,
        authorityImpl: () => true,
        env: null as unknown as FocusAdapterEnv,
    };
    const env: FocusAdapterEnv = {
        callDbus: (
            service: string,
            path: string,
            iface: string,
            method: string,
            payload: string,
            callback: (reply: unknown) => void,
        ): void => {
            state.dbusCalls.push({ service, path, iface, method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (delayMs: number, callback: () => void): (() => void) => {
            void delayMs;
            const entry = { callback, cancelled: false };
            state.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message: string): void => {
            state.logs.push(message);
        },
        observe: (): FocusObserved | null => state.observeImpl(),
        setActive: (target: object): boolean => {
            state.writes += 1;
            state.lastTarget = target;
            return true;
        },
        active: (): object | null => state.activeImpl(),
        hasExclusiveFocusAuthority: (): boolean => state.authorityImpl(),
        subscribe: (kind: string, _handler: () => void): (() => void) => {
            state.subscribes.push(kind);
            return (): void => {
                state.unsubscribes.push(1);
            };
        },
    };
    state.env = env;
    return state;
}

function kwinSrcDir(): string {
    const override = process.env["KWIN_SRC_DIR"];
    if (typeof override === "string" && override.length > 0) {
        try {
            if (existsSync(join(override, "entry.ts"))) {
                return override;
            }
        } catch (error) {
            void error;
        }
    }
    const candidates: string[] = [];
    try {
        const here: unknown = typeof __dirname === "string" ? __dirname : process.cwd();
        if (typeof here === "string") {
            candidates.push(resolve(here, "..", "..", "src"));
            candidates.push(resolve(here, "..", "src"));
            candidates.push(resolve(here, "src"));
        }
    } catch (error) {
        void error;
    }
    candidates.push(resolve(process.cwd(), "src"));
    candidates.push(resolve(process.cwd(), "kwin", "src"));
    for (const dir of candidates) {
        try {
            if (existsSync(join(dir, "entry.ts"))) {
                return dir;
            }
        } catch (error) {
            void error;
        }
    }
    return resolve(process.cwd(), "src");
}

function plannedReply(
    correlation: string,
    baseRevision: number,
    toWindow = "win-b",
    fromWindow = "win-a",
    direction = "right",
): string {
    return JSON.stringify({
        v: FOCUS_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: baseRevision,
        capability: "directional-focus",
        preconditions: [
            "focused-leaf-occupied-by-focused-window",
            "target-leaf-occupied",
            "focus-targets-same-domain",
            "adapter-must-verify-postconditions",
        ],
        operation: {
            domain_output: "focus-output",
            domain_workspace: "focus-workspace",
            from_leaf: "leaf-a",
            to_leaf: "leaf-b",
            from_window: fromWindow,
            to_window: toWindow,
            direction,
            route: ["leaf-a", "leaf-b"],
        },
        to_window: toWindow,
    });
}

function ackReply(correlation: string, baseRevision: number): string {
    return JSON.stringify({
        v: FOCUS_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "acknowledged",
        base_revision: baseRevision,
    });
}

function enableAdapter(mocks: Mocks): FocusAdapter {
    const adapter = new FocusAdapter(mocks.env);
    assert.equal(adapter.isEnabled, false);
    const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
    assert.equal(ok, true);
    assert.equal(adapter.isEnabled, true);
    return adapter;
}

function firstPayload(mocks: Mocks): Record<string, unknown> {
    const planner = mocks.dbusCalls.find((call) => call.method === FOCUS_METHOD);
    assert.ok(planner !== undefined);
    return JSON.parse(planner.payload) as Record<string, unknown>;
}

const PINNED_OWNER = ":1.42";

// Drives the initial GetNameOwner phase with a present unique owner, so the
// next D-Bus call is the pinned planner request with no service activation.
function driveOwnerPresent(mocks: Mocks, owner: string = PINNED_OWNER): void {
    assert.ok(mocks.callbacks[0] !== undefined);
    mocks.callbacks[0]?.(owner);
}

describe("focus adapter disabled default", () => {
    it("rejects requests while disabled with no write and no bus call", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = new FocusAdapter(mocks.env);
        assert.equal(adapter.isEnabled, false);
        adapter.requestFocus("right");
        assert.ok(mocks.logs.some((line) => line.includes("focus-disabled")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.writes, 0);
    });
});

describe("focus adapter exclusive conflict", () => {
    it("rejects before mutation when authority is false", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.authorityImpl = () => false;
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        assert.ok(mocks.logs.some((line) => line.includes("focus-exclusive-conflict")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.writes, 0);
        assert.equal(adapter.isEnabled, false);
    });
});

describe("focus adapter one-flight and dedup", () => {
    it("rejects a second request while one is in flight", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        adapter.requestFocus("left");
        assert.ok(mocks.logs.some((line) => line.includes("focus-busy")));
        assert.equal(mocks.dbusCalls.length, 1);
    });

    it("dedups an identical fingerprint and direction without sending", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        driveOwnerPresent(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        // Complete the first flight as noop so a second identical request can dedup.
        mocks.callbacks[1]?.(JSON.stringify({ v: 1, correlation_id: firstPayload(mocks)["correlation_id"], outcome: "noop", kind: "unchanged", message: "no change" }));
        assert.equal(adapter.isInFlight, false);
        adapter.requestFocus("right");
        assert.ok(mocks.logs.some((line) => line.includes("focus-dedup")));
        assert.equal(mocks.dbusCalls.length, 2);
    });
});

describe("focus adapter mapping and one write max", () => {
    it("writes exactly the mapped target once then acks and verifies", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, refs.a);
        mocks.activeImpl = () => refs.a;
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        // Request carries an exact deterministic numeric fingerprint, never zero.
        assert.equal(typeof payload["fingerprint"], "number");
        assert.notEqual(payload["fingerprint"], 0);
        // First request binds exactly to the normalized membership size N.
        assert.equal(payload["revision"], 3);
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        // Ack flight started.
        assert.equal(mocks.dbusCalls.length, 3);
        const ackPayload = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(ackPayload["action"], "acknowledge");
        assert.equal(mocks.writes, 1);
        assert.equal(mocks.lastTarget, refs.b);
        mocks.callbacks[2]?.(ackReply(correlation, 3));
        assert.equal(mocks.dbusCalls.length, 4);
        const verifyPayload = JSON.parse((mocks.dbusCalls[3] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(verifyPayload["action"], "verify");
        assert.equal((verifyPayload["verified_operation"] as Record<string, unknown>)["to_window"], "win-b");
        assert.equal(typeof verifyPayload["fingerprint"], "number");
        assert.notEqual(verifyPayload["fingerprint"], 0);
        mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: 4 }));
        assert.ok(mocks.logs.some((line) => line.includes("focus:applied")));
        assert.equal(mocks.writes, 1);
    });

    it("performs no write when the mapped target is already active", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        mocks.observeImpl = () => makeObserved(refs, refs.b);
        mocks.activeImpl = () => refs.b;
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b", "win-b"));
        assert.equal(mocks.writes, 0);
        assert.equal(mocks.dbusCalls.length, 3);
    });

    it("treats a service noop with zero writes", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(
            JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "noop", kind: "unchanged", message: "no change" }),
        );
        assert.equal(mocks.writes, 0);
        assert.equal(mocks.dbusCalls.length, 2);
        assert.ok(mocks.logs.some((line) => line.includes("focus:noop")));
    });
});

describe("focus adapter stale and signal invalidation", () => {
    it("fails closed on stale revalidation with no write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const stale = makeObserved(refs, refs.a);
        (stale as { revalidate: () => boolean }).revalidate = () => false;
        let calls = 0;
        mocks.observeImpl = () => {
            calls += 1;
            return calls === 1 ? makeObserved(refs, refs.a) : stale;
        };
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, 3, "win-b"));
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-stale-revalidate")));
        assert.equal(adapter.isEnabled, false);
    });

    it("invalidates on a minimal signal before the write", () => {
        const refs = makeRefs();
        const handlers = new Map<string, () => void>();
        const mocks = mockEnv(refs);
        const env: FocusAdapterEnv = {
            ...mocks.env,
            subscribe: (kind, handler) => {
                mocks.subscribes.push(kind);
                handlers.set(kind, handler);
                return () => {
                    mocks.unsubscribes.push(1);
                };
            },
        };
        const adapter = new FocusAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        assert.deepEqual([...mocks.subscribes].sort(), ["active", "added", "desktop", "output", "removed"]);
        adapter.requestFocus("right");
        handlers.get("active")?.();
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, 3, "win-b"));
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-signal-invalid")));
    });
});

describe("focus adapter service fault fail-close", () => {
    it("disables on malformed reply with no write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        mocks.callbacks[1]?.("not-json");
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-service-fault")));
        assert.equal(adapter.isEnabled, false);
    });

    it("disconnects all minimal subscriptions on disable", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        assert.equal(mocks.subscribes.length, 5);
        adapter.disable();
        assert.equal(mocks.unsubscribes.length, 5);
    });
});

describe("focus adapter source hygiene and production isolation", () => {
    it("uses the narrow focus route and redacted logs only", () => {
        assert.equal(FOCUS_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(FOCUS_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(FOCUS_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(FOCUS_METHOD, "DescribeFocus");
    });

    it("emits no raw identity in logs", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, 3, "win-b"));
        mocks.callbacks[2]?.(ackReply(payload["correlation_id"] as string, 3));
        mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "committed", revision: 4 }));
        for (const line of mocks.logs) {
            assert.ok(!line.includes("win-a"));
            assert.ok(!line.includes("win-b"));
            assert.ok(!line.includes("owner-1"));
        }
    });

    it("source performs no forbidden mutations", () => {
        const src = readFileSync(join(kwinSrcDir(), "focus-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "focus-adapter-entry.ts"), "utf8");
        for (const body of [src, entry]) {
            assert.ok(!body.includes("rootTile"));
            assert.ok(!body.includes("relativeGeometry"));
            assert.ok(!body.includes("frameGeometry"));
            assert.ok(!body.includes("registerShortcut"));
            assert.ok(!body.includes("registerSessionShortcut"));
            assert.ok(!body.includes("readConfig"));
            assert.ok(!body.includes("writeConfig"));
            assert.ok(!body.includes("createDesktop"));
            assert.ok(!body.includes("removeDesktop"));
            assert.ok(!body.includes("showOutline"));
            assert.ok(!body.includes("setTimeout"));
            assert.ok(!body.includes("setInterval"));
        }
    });

    it("production startup activates the adapter only through the mode-gated dispatcher", () => {
        const entry = readFileSync(join(kwinSrcDir(), "entry.ts"), "utf8");
        assert.ok(!entry.includes("focus-adapter"));
        assert.ok(!entry.includes("FocusAdapter"));
        assert.ok(!entry.includes("startFocusAdapterEntry"));
        const authority = readFileSync(join(kwinSrcDir(), "engine-authority.ts"), "utf8");
        assert.ok(authority.includes("focus-adapter-entry"));
        assert.ok(authority.includes("startFocusAdapterEntry"));
    });

    it("explicit entry requires exclusive authority and fails closed", () => {
        const handle = startFocusAdapterEntry({
            workspace: {},
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
        });
        assert.equal(handle, null);
    });

    it("routes the focus slice only through the mode-gated dispatcher", () => {
        const dir = kwinSrcDir();
        for (const name of ["controller.ts", "controller-input-actions.ts", "controller-interactive-drag.ts"]) {
            const body = readFileSync(join(dir, name), "utf8");
            assert.ok(!body.includes("focus-adapter"));
            assert.ok(!body.includes("FocusAdapter"));
            assert.ok(!body.includes("DescribeFocus"));
            assert.ok(!body.includes("startFocusAdapterEntry"));
        }
        const controller = readFileSync(join(dir, "controller.ts"), "utf8");
        assert.ok(controller.includes("engine-authority"));
        assert.ok(controller.includes("isRustAuthorityActive"));
        const authority = readFileSync(join(dir, "engine-authority.ts"), "utf8");
        assert.ok(authority.includes("focus-adapter-entry"));
        assert.ok(authority.includes("startFocusAdapterEntry"));
    });
});

describe("focus adapter stale, mapping, ack and post-write binding", () => {
    it("rejects stale base revision with no write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(plannedReply(payload["correlation_id"] as string, 99, "win-b"));
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-revision-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects domain and from-window mismatches before any write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        const bad = JSON.parse(plannedReply(correlation, 3, "win-b")) as Record<string, unknown>;
        const operation = { ...(bad["operation"] as Record<string, unknown>), from_window: "win-c" };
        const mismatched = JSON.stringify({ ...bad, operation });
        mocks.callbacks[1]?.(mismatched);
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-target-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects direction mismatch before any write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(
            plannedReply(payload["correlation_id"] as string, 3, "win-b", "win-a", "left"),
        );
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-target-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("requires exact complete preconditions with no duplicates", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        const bad = JSON.parse(plannedReply(correlation, 3, "win-b")) as Record<string, unknown>;
        const subset = JSON.stringify({ ...bad, preconditions: ["target-leaf-occupied"] });
        mocks.callbacks[1]?.(subset);
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-precondition-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on ack correlation mismatch with no verify", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        assert.equal(mocks.dbusCalls.length, 3);
        mocks.callbacks[2]?.(ackReply("other-corr", 0));
        // Local ack fault best-effort reports adapter-lost before disabling:
        // request + accepted ack + loss, never a verify.
        assert.equal(mocks.dbusCalls.length, 4);
        const loss = JSON.parse((mocks.dbusCalls[3] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["action"], "acknowledge");
        assert.equal(loss["outcome"], "adapter-lost");
        assert.equal(loss["correlation_id"], correlation);
        assert.ok(!mocks.dbusCalls.some((call) => call.method === FOCUS_METHOD && (JSON.parse(call.payload as string) as Record<string, unknown>)["action"] === "verify"));
        assert.ok(mocks.logs.some((line) => line.includes("focus-correlation-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on ack base revision mismatch with no verify", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        mocks.callbacks[2]?.(ackReply(correlation, 77));
        assert.equal(mocks.dbusCalls.length, 4);
        const loss = JSON.parse((mocks.dbusCalls[3] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["action"], "acknowledge");
        assert.equal(loss["outcome"], "adapter-lost");
        assert.equal(loss["correlation_id"], correlation);
        assert.equal(loss["base_revision"], 3);
        assert.ok(mocks.logs.some((line) => line.includes("focus-revision-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("invalidates across post-write verify on signal", () => {
        const refs = makeRefs();
        const handlers = new Map<string, () => void>();
        const mocks = mockEnv(refs);
        const env: FocusAdapterEnv = {
            ...mocks.env,
            subscribe: (kind, handler) => {
                mocks.subscribes.push(kind);
                handlers.set(kind, handler);
                return () => {
                    mocks.unsubscribes.push(1);
                };
            },
        };
        const adapter = new FocusAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        assert.equal(mocks.dbusCalls.length, 3);
        handlers.get("removed")?.();
        mocks.callbacks[2]?.(ackReply(correlation, 3));
        // Post-write signal fault still reports adapter-lost once.
        assert.equal(mocks.dbusCalls.length, 4);
        const loss = JSON.parse((mocks.dbusCalls[3] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["outcome"], "adapter-lost");
        assert.ok(mocks.logs.some((line) => line.includes("focus-signal-invalid")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on refused service fault with no write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        mocks.callbacks[1]?.(
            JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "rejected", kind: "snapshot-invalid", message: "bad" }),
        );
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-rejected")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on non-exact verify revision", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        mocks.callbacks[2]?.(ackReply(correlation, 3));
        assert.equal(mocks.dbusCalls.length, 4);
        mocks.callbacks[3]?.(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: 99 }));
        assert.ok(mocks.logs.some((line) => line.includes("focus-revision-mismatch")));
        assert.equal(adapter.isEnabled, false);
    });

    it("clears dedup state on disable so a retry can send", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        mocks.callbacks[1]?.(
            JSON.stringify({ v: 1, correlation_id: firstPayload(mocks)["correlation_id"], outcome: "noop", kind: "unchanged", message: "no change" }),
        );
        adapter.disable();
        const again = new FocusAdapter(mocks.env);
        again.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        again.requestFocus("right");
        assert.ok(mocks.dbusCalls.length >= 2);
        assert.ok(!mocks.logs.slice(-3).some((line) => line.includes("focus-dedup")));
    });

    it("caps the correlation sequence fail-closed", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        (adapter as unknown as { seq: number }).seq = 1000001;
        adapter.requestFocus("right");
        assert.ok(mocks.logs.some((line) => line.includes("focus-seq-exhausted")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("binds reply v exactly on ack and verify", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        mocks.callbacks[2]?.(JSON.stringify({ v: 2, correlation_id: correlation, outcome: "acknowledged", base_revision: 0 }));
        assert.ok(mocks.logs.some((line) => line.includes("focus-service-fault")));
        assert.equal(adapter.isEnabled, false);
    });
});

describe("focus adapter adapter-lost transaction correction", () => {
    it("reports adapter-lost once on local signal loss with exact binding and no second write", () => {
        const refs = makeRefs();
        const handlers = new Map<string, () => void>();
        const mocks = mockEnv(refs);
        const env: FocusAdapterEnv = {
            ...mocks.env,
            subscribe: (kind, handler) => {
                mocks.subscribes.push(kind);
                handlers.set(kind, handler);
                return () => {
                    mocks.unsubscribes.push(1);
                };
            },
        };
        const adapter = new FocusAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        handlers.get("active")?.();
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        // Request + single best-effort loss, no second focus write.
        assert.equal(mocks.writes, 0);
        assert.equal(mocks.dbusCalls.length, 3);
        const loss = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["v"], FOCUS_CONTRACT_VERSION);
        assert.equal(loss["action"], "acknowledge");
        assert.equal(loss["correlation_id"], correlation);
        assert.equal(loss["owner"], "owner-1");
        assert.equal(loss["generation"], "gen-1");
        assert.equal(loss["base_revision"], 3);
        assert.equal(loss["outcome"], "adapter-lost");
        assert.ok((mocks.dbusCalls[2] as { payload: string }).payload.length <= 64 * 1024);
        assert.ok(mocks.logs.some((line) => line.includes("focus-signal-invalid")));
        assert.equal(adapter.isEnabled, false);
        // Stray callbacks after disable cause no duplicate loss and no write.
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        if (mocks.callbacks[2] !== undefined) {
            mocks.callbacks[2]?.(ackReply(correlation, 3));
        }
        assert.equal(mocks.dbusCalls.length, 3);
        assert.equal(mocks.writes, 0);
    });

    it("reports adapter-lost on native-write fault without a second write", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const env: FocusAdapterEnv = {
            ...mocks.env,
            setActive: (_target: object): boolean => {
                mocks.writes += 1;
                return false;
            },
        };
        const adapter = new FocusAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        assert.equal(mocks.writes, 1);
        assert.equal(mocks.dbusCalls.length, 3);
        const loss = JSON.parse((mocks.dbusCalls[2] as { payload: string }).payload) as Record<string, unknown>;
        assert.equal(loss["action"], "acknowledge");
        assert.equal(loss["outcome"], "adapter-lost");
        assert.equal(loss["correlation_id"], correlation);
        assert.equal(loss["base_revision"], 3);
        assert.ok(mocks.logs.some((line) => line.includes("focus-write-failed")));
        assert.equal(adapter.isEnabled, false);
    });

    it("stays fail-closed when D-Bus itself is lost with no throw and no retry", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        let lossCalls = 0;
        const env: FocusAdapterEnv = {
            ...mocks.env,
            callDbus: (service, path, iface, method, payload, callback): void => {
                if (method === FOCUS_METHOD) {
                    const parsed = JSON.parse(payload) as Record<string, unknown>;
                    if (parsed["outcome"] === "adapter-lost") {
                        lossCalls += 1;
                        throw new Error("dbus-lost");
                    }
                }
                mocks.dbusCalls.push({ service, path, iface, method, payload });
                mocks.callbacks.push(callback);
            },
        };
        const adapter = new FocusAdapter(env);
        adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        adapter.requestFocus("right");
        driveOwnerPresent(mocks);
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        // Local revalidation fault triggers a loss attempt that itself is lost.
        const stale = makeObserved(refs, refs.a);
        (stale as unknown as { revalidate: () => boolean }).revalidate = () => false;
        mocks.observeImpl = () => stale;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        assert.equal(lossCalls, 1);
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((line) => line.includes("focus-stale-revalidate")));
        assert.equal(adapter.isEnabled, false);
    });
});

describe("focus adapter session D-Bus activation", () => {
    it("pins a present owner with no service activation and routes planner calls to the unique name", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        assert.equal(FOCUS_DBUS_SERVICE, "org.freedesktop.DBus");
        assert.equal(FOCUS_DBUS_OBJECT, "/org/freedesktop/DBus");
        assert.equal(FOCUS_DBUS_INTERFACE, "org.freedesktop.DBus");
        assert.equal(FOCUS_GET_OWNER_METHOD, "GetNameOwner");
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(
            [mocks.dbusCalls[0]?.service, mocks.dbusCalls[0]?.method, mocks.dbusCalls[0]?.payload],
            [FOCUS_DBUS_SERVICE, FOCUS_GET_OWNER_METHOD, FOCUS_SERVICE],
        );
        driveOwnerPresent(mocks, ":1.42");
        assert.equal(mocks.dbusCalls.length, 2);
        const planner = mocks.dbusCalls[1];
        assert.equal(planner?.service, ":1.42");
        assert.equal(planner?.method, FOCUS_METHOD);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === FOCUS_SERVICE));
        const payload = firstPayload(mocks);
        const correlation = payload["correlation_id"] as string;
        mocks.callbacks[1]?.(plannedReply(correlation, 3, "win-b"));
        assert.equal(mocks.dbusCalls[2]?.service, ":1.42");
        mocks.callbacks[2]?.(ackReply(correlation, 3));
        assert.equal(mocks.dbusCalls[3]?.service, ":1.42");
        mocks.callbacks[3]?.(
            JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision: 4 }),
        );
        assert.ok(mocks.logs.some((l) => l.includes("focus:applied")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === FOCUS_SERVICE));
    });

    it("activates an absent name with exactly one StartServiceByName(1) then pins", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        assert.equal(FOCUS_START_METHOD, "StartServiceByName");
        assert.equal(FOCUS_START_FLAGS, 0);
        assert.equal(FOCUS_START_PRIMARY, 1);
        assert.equal(FOCUS_START_ALREADY, 2);
        adapter.requestFocus("right");
        mocks.callbacks[0]?.("");
        assert.equal(mocks.dbusCalls.length, 2);
        const start = mocks.dbusCalls[1];
        assert.deepEqual(
            [start?.service, start?.method, start?.payload],
            [FOCUS_DBUS_SERVICE, FOCUS_START_METHOD, FOCUS_SERVICE],
        );
        mocks.callbacks[1]?.(FOCUS_START_PRIMARY);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(
            [mocks.dbusCalls[2]?.service, mocks.dbusCalls[2]?.method],
            [FOCUS_DBUS_SERVICE, FOCUS_GET_OWNER_METHOD],
        );
        mocks.callbacks[2]?.(":1.77");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.77");
        assert.equal(mocks.dbusCalls[3]?.method, FOCUS_METHOD);
        assert.equal(mocks.dbusCalls.filter((call) => call.method === FOCUS_START_METHOD).length, 1);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === FOCUS_SERVICE));
        const payload = firstPayload(mocks);
        mocks.callbacks[3]?.(plannedReply(payload["correlation_id"] as string, 3, "win-b"));
        assert.equal(mocks.writes, 1);
        assert.equal(adapter.isEnabled, true);
    });

    it("accepts AlreadyOwner(2) as already-running then resolves and pins", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        mocks.callbacks[0]?.(null);
        mocks.callbacks[1]?.(FOCUS_START_ALREADY);
        mocks.callbacks[2]?.(":1.78");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.78");
        const payload = firstPayload(mocks);
        mocks.callbacks[3]?.(plannedReply(payload["correlation_id"] as string, 3, "win-b"));
        assert.equal(mocks.writes, 1);
        assert.equal(adapter.isEnabled, true);
    });

    it("rejects malformed or unknown activation results with no planner call and disables", () => {
        for (const bad of [0, 3, 4, 99, "1", "ok", null, undefined, {}, []]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("right");
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(bad);
            assert.ok(mocks.logs.some((l) => l.includes("focus-activation-failed")));
            assert.equal(adapter.isEnabled, false);
            assert.equal(mocks.writes, 0);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === FOCUS_METHOD));
            assert.ok(!mocks.dbusCalls.some((call) => call.service === FOCUS_SERVICE));
            assert.equal(mocks.dbusCalls.filter((call) => call.method === FOCUS_START_METHOD).length, 1);
            assert.equal(mocks.dbusCalls.length, 2);
        }
    });

    it("fails closed when the post-start owner is missing with no planner call", () => {
        for (const badOwner of ["", "not-a-unique-name", null, FOCUS_SERVICE]) {
            const refs = makeRefs();
            const mocks = mockEnv(refs);
            const adapter = enableAdapter(mocks);
            adapter.requestFocus("right");
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(FOCUS_START_PRIMARY);
            mocks.callbacks[2]?.(badOwner);
            assert.ok(mocks.logs.some((l) => l.includes("focus-owner-missing")));
            assert.equal(adapter.isEnabled, false);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === FOCUS_METHOD));
            assert.equal(mocks.writes, 0);
        }
    });

    it("coalesces concurrent commands into one activation attempt with no duplicate service request", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        adapter.requestFocus("left");
        assert.ok(mocks.logs.some((l) => l.includes("focus-busy")));
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.("");
        adapter.requestFocus("left");
        assert.ok(mocks.logs.some((l) => l.includes("focus-busy")));
        assert.equal(mocks.dbusCalls.filter((call) => call.method === FOCUS_START_METHOD).length, 1);
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("times out during activation with no retry and ignores the late reply", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        assert.equal(mocks.timers.length, 1);
        mocks.timers[0]?.callback();
        assert.ok(mocks.logs.some((l) => l.includes("focus-timeout-request")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.(":1.42");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.writes, 0);
        assert.ok(!mocks.logs.some((l) => l.includes("focus:applied")));
    });

    it("refuses the Rust command with no Legacy fallback on activation failure", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        mocks.callbacks[0]?.("");
        mocks.callbacks[1]?.(0);
        assert.ok(mocks.logs.some((l) => l.includes("focus-activation-failed")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.writes, 0);
        assert.ok(mocks.logs.some((l) => l.includes("focus:disabled")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === FOCUS_SERVICE));
        const src = readFileSync(join(kwinSrcDir(), "focus-adapter.ts"), "utf8");
        assert.ok(!src.includes("fallback"));
    });

    it("allows a subsequent idle command to activate again only after state reset", () => {
        const refs = makeRefs();
        const mocks = mockEnv(refs);
        const adapter = enableAdapter(mocks);
        adapter.requestFocus("right");
        mocks.callbacks[0]?.("");
        mocks.callbacks[1]?.("bogus");
        assert.equal(adapter.isEnabled, false);
        const callsAfterFailure = mocks.dbusCalls.length;
        adapter.requestFocus("right");
        assert.ok(mocks.logs.some((l) => l.includes("focus-disabled")));
        assert.equal(mocks.dbusCalls.length, callsAfterFailure);
        const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        assert.equal(ok, true);
        adapter.requestFocus("right");
        assert.equal(mocks.dbusCalls.length, callsAfterFailure + 1);
        assert.equal(mocks.dbusCalls[mocks.dbusCalls.length - 1]?.method, FOCUS_GET_OWNER_METHOD);
    });
});

interface Qv4Signal {
    readonly fire: () => void;
    readonly count: () => number;
}

function makeQv4Signal(): Qv4Signal & ((...args: readonly unknown[]) => void) {
    const handlers = new Set<() => void>();
    const fn = function (): void {};
    const proto = {
        connect: (handler: () => void): void => {
            handlers.add(handler);
        },
        disconnect: (handler: () => void): void => {
            handlers.delete(handler);
        },
    };
    Object.setPrototypeOf(fn, proto);
    const callable = fn as unknown as Qv4Signal & ((...args: readonly unknown[]) => void);
    (callable as unknown as Record<string, unknown>)["fire"] = (): void => {
        for (const handler of [...handlers]) {
            handler();
        }
    };
    (callable as unknown as Record<string, unknown>)["count"] = (): number => handlers.size;
    return callable;
}

function makeFocusQv4World(): {
    readonly workspace: Record<string, unknown>;
    readonly signals: Record<string, Qv4Signal & ((...args: readonly unknown[]) => void)>;
    readonly logs: string[];
} {
    const output = {};
    const desktop = {};
    const winA: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        output,
        desktops: [desktop],
        internalId: "win-a",
    };
    const winB: Record<string, unknown> = {
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        output,
        desktops: [desktop],
        internalId: "win-b",
    };
    const signals: Record<string, Qv4Signal & ((...args: readonly unknown[]) => void)> = {
        windowActivated: makeQv4Signal(),
        windowAdded: makeQv4Signal(),
        windowRemoved: makeQv4Signal(),
        screensChanged: makeQv4Signal(),
        currentDesktopChanged: makeQv4Signal(),
    };
    const logs: string[] = [];
    const workspace: Record<string, unknown> = {
        activeWindow: winA,
        windowList: (): unknown[] => [winA, winB],
        screens: [output],
        currentDesktopForScreen: (): unknown => desktop,
        ...signals,
    };
    void logs;
    return { workspace, signals, logs };
}

describe("focus entry QV4 callable signal startup", () => {
    it("attaches callable workspace signals and detaches exactly once", () => {
        const { workspace, signals } = makeFocusQv4World();
        const logs: string[] = [];
        for (const name of Object.keys(signals)) {
            assert.equal(typeof workspace[name], "function");
        }
        const handle = startFocusAdapterEntry({
            workspace,
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveFocusAuthority: () => true,
        });
        assert.ok(handle !== null);
        assert.ok(logs.some((line) => line.endsWith(":ready")));
        for (const signal of Object.values(signals)) {
            assert.equal(signal.count(), 1);
        }
        handle.stop();
        for (const signal of Object.values(signals)) {
            assert.equal(signal.count(), 0);
        }
        handle.stop();
        for (const signal of Object.values(signals)) {
            assert.equal(signal.count(), 0);
        }
    });

    it("fails closed with exact rollback when a required callable signal is missing", () => {
        const { workspace, signals } = makeFocusQv4World();
        workspace["windowActivated"] = {};
        const logs: string[] = [];
        const handle = startFocusAdapterEntry({
            workspace,
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveFocusAuthority: () => true,
        });
        assert.equal(handle, null);
        for (const signal of Object.values(signals)) {
            assert.equal(signal.count(), 0);
        }
    });
});
