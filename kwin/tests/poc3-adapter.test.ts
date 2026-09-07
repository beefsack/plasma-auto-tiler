import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

import {
    POC3_CLEANUP_MODEL,
    POC3_CLOSE_CHECKS,
    POC3_CONTRACT_VERSION,
    POC3_CONVERGE_CHECKS,
    POC3_INTERFACE,
    POC3_MAX_REPLY_BYTES,
    POC3_MAX_REQUEST_BYTES,
    POC3_METHOD,
    POC3_OBJECT,
    POC3_RESTORE_CHECKS,
    POC3_SERVICE,
    POC3_TIMEOUT_MS,
    Poc3Adapter,
    parseCommandConfig,
    type Poc3AdapterEnv,
} from "../src/poc3-adapter";

// Explicit user-selected cleanup model: every start in these tests selects
// the only supported literal. Missing/other models are covered separately.
const CLEANUP = { cleanup: POC3_CLEANUP_MODEL } as const;

const OUTPUT_A = {
    geometry: { x: 0, y: 0, width: 900, height: 600 },
    name: "output-a",
    manufacturer: "test",
    model: "test",
    serialNumber: "a",
};
const OUTPUT_B = {
    geometry: { x: 900, y: 0, width: 900, height: 600 },
    name: "output-b",
    manufacturer: "test",
    model: "test",
    serialNumber: "b",
};
const DESKTOP_A = { id: "desktop-a" };
const DESKTOP_B = { id: "desktop-b" };

interface StubWindow extends Record<string, unknown> {
    internalId: string;
}

interface DbusCall {
    readonly service: string;
    readonly path: string;
    readonly dbusInterface: string;
    readonly method: string;
    readonly payload: string;
    readonly callback: (reply: unknown) => void;
}

interface TimerEntry {
    readonly delayMs: number;
    readonly callback: () => void;
    cancelled: boolean;
    fired: boolean;
}

interface Harness {
    readonly adapter: Poc3Adapter;
    readonly logs: string[];
    readonly dbus: DbusCall[];
    readonly timers: TimerEntry[];
    readonly workspace: Record<string, unknown>;
    readonly windows: StubWindow[];
    readonly closedIds: string[];
    throwOnDbus: boolean;
}

function stubWindow(id: string, overrides: Record<string, unknown> = {}): StubWindow {
    return {
        internalId: id,
        normalWindow: true,
        managed: true,
        resizeable: true,
        appletPopup: false,
        tile: null,
        frameGeometry: { x: 10, y: 10, width: 100, height: 100 },
        output: OUTPUT_A,
        desktops: [DESKTOP_A],
        onAllDesktops: false,
        fullScreen: false,
        maximizeMode: 0,
        closeable: true,
        ...overrides,
    };
}

function harnessWith(windows: StubWindow[]): Harness {
    const logs: string[] = [];
    const dbus: DbusCall[] = [];
    const timers: TimerEntry[] = [];
    const closedIds: string[] = [];
    const workspace: Record<string, unknown> = {
        activeWindow: null,
        windowList: () => windows,
        screens: [OUTPUT_A],
        currentDesktopForScreen: () => DESKTOP_A,
        clientArea: () => ({ x: 0, y: 0, width: 900, height: 600 }),
    };
    for (const window of windows) {
        if (typeof window["closeWindow"] !== "function") {
            window["closeWindow"] = () => {
                closedIds.push(window.internalId);
                const index = windows.indexOf(window);
                if (index >= 0) {
                    windows.splice(index, 1);
                }
            };
        } else {
            const original = window["closeWindow"] as () => void;
            window["closeWindow"] = () => {
                closedIds.push(window.internalId);
                original();
            };
        }
        if (window["closeable"] === undefined) {
            window["closeable"] = true;
        }
    }
    const harness: Harness = {
        adapter: undefined as unknown as Poc3Adapter,
        logs,
        dbus,
        timers,
        workspace,
        windows,
        closedIds,
        throwOnDbus: false,
    };
    const env: Poc3AdapterEnv = {
        callDbus: (service, path, dbusInterface, method, payload, callback) => {
            if (harness.throwOnDbus) {
                throw new Error("dbus-down");
            }
            dbus.push({ service, path, dbusInterface, method, payload, callback });
        },
        scheduleOnce: (delayMs, callback) => {
            const entry: TimerEntry = { delayMs, callback, cancelled: false, fired: false };
            timers.push(entry);
            return () => {
                entry.cancelled = true;
            };
        },
        log: (message) => {
            logs.push(message);
        },
        now: () => 1_700_000_000_000,
        workspace,
    };
    (harness as { adapter: Poc3Adapter }).adapter = new Poc3Adapter(env);
    return harness;
}

function harness3(): Harness {
    return harnessWith([stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c")]);
}

function payloadOf(call: DbusCall): Record<string, unknown> {
    return JSON.parse(call.payload) as Record<string, unknown>;
}

function lastLog(logs: readonly string[]): string {
    assert.ok(logs.length > 0, "expected at least one diagnostic log");
    return logs[logs.length - 1] as string;
}

function loggedToken(logs: readonly string[], token: string): boolean {
    return logs.some((line) => line.split(":")[2] === token || line.includes(`:poc3-${token}:`) || line.includes(token));
}

function defaultDesired(): Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }> {
    return [
        { id: "id-a", rect: { x: 0, y: 0, w: 446, h: 600 } },
        { id: "id-b", rect: { x: 454, y: 0, w: 446, h: 296 } },
        { id: "id-c", rect: { x: 454, y: 304, w: 446, h: 296 } },
    ];
}

function intentReply(
    startPayload: Record<string, unknown>,
    command: string,
    expectedRevision: number,
    focus: string,
): string {
    return intentReplyWith(startPayload, command, expectedRevision, focus, defaultDesired());
}

function intentReplyWith(
    startPayload: Record<string, unknown>,
    command: string,
    expectedRevision: number,
    focus: string,
    desired: Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }>,
): string {
    return JSON.stringify({
        v: POC3_CONTRACT_VERSION,
        correlation_id: startPayload["correlation_id"],
        command,
        outcome: "ok",
        revision: expectedRevision,
        intent: {
            base_revision: expectedRevision,
            next_revision: expectedRevision + 1,
            atomic: false,
            adapter_verification_required: true,
            preconditions: ["adapter-must-verify-postconditions"],
            capabilities: { untiled_asserted: true, disposable: true, restore_capable: true },
            cleanup_model: "close-disposable",
            operation: { kind: "init", rule: "INIT" },
            topology: "H[id-a,V[id-b,id-c]]",
            shares: {},
            focus,
            desired,
            rollback_required: { retain_envelopes: true, note: "adapter-only" },
        },
    });
}

function completeAppliedReply(completePayload: Record<string, unknown>, revision: number): string {
    return JSON.stringify({
        v: POC3_CONTRACT_VERSION,
        correlation_id: completePayload["correlation_id"],
        command: "complete",
        outcome: "ok",
        revision,
        completed: { result: "applied", revision, divergent: false },
    });
}

// Full start round-trip through actuation, leaving the `complete` request in
// flight. Returns the parsed start and complete payloads.
function driveStartToComplete(h: Harness): {
    startPayload: Record<string, unknown>;
    completePayload: Record<string, unknown>;
} {
    h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
    assert.equal(h.dbus.length, 1);
    const startCall = h.dbus[0] as DbusCall;
    const startPayload = payloadOf(startCall);
    startCall.callback(intentReply(startPayload, "start", 0, "id-a"));
    assert.equal(h.dbus.length, 2);
    const completeCall = h.dbus[1] as DbusCall;
    return { startPayload, completePayload: payloadOf(completeCall) };
}

function finishCompleteApplied(h: Harness, revision: number): void {
    const completeCall = h.dbus[h.dbus.length - 1] as DbusCall;
    completeCall.callback(completeAppliedReply(payloadOf(completeCall), revision));
}

function driveStarted(h: Harness): Record<string, unknown> {
    const { startPayload } = driveStartToComplete(h);
    finishCompleteApplied(h, 1);
    assert.equal(h.adapter.getState().revision, 1);
    return startPayload;
}

// Fires pending unfired timers (convergence/close polls) in order, skipping
// cancelled D-Bus timeouts. Returns the number of timers fired.
function pumpTimers(h: Harness, cap: number): number {
    let fired = 0;
    for (let n = 0; n < cap; n += 1) {
        const next = h.timers.find((timer) => !timer.cancelled && !timer.fired);
        if (next === undefined) {
            break;
        }
        next.fired = true;
        next.callback();
        fired += 1;
    }
    return fired;
}

function pumpUntilDbus(h: Harness, length: number, cap: number): void {
    for (let n = 0; n < cap; n += 1) {
        if (h.dbus.length >= length) {
            return;
        }
        assert.ok(pumpTimers(h, 1) === 1, "expected another convergence poll");
    }
    assert.ok(h.dbus.length >= length, "expected transport after convergence");
}

describe("poc3 adapter startup and non-enrollment", () => {
    it("starts disabled with no transport until an explicit manual start", () => {
        const h = harness3();
        const state = h.adapter.getState();
        assert.equal(state.started, false);
        assert.equal(state.revision, 0);
        assert.deepEqual([...state.enrolled], []);
        assert.equal(h.dbus.length, 0);
        assert.equal(h.timers.length, 0);
        assert.equal(h.logs.length, 0);
    });

    it("rejects focus/move/stop before start without transport", () => {
        const h = harness3();
        h.adapter.focus("right");
        h.adapter.move("right");
        h.adapter.stop();
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-disabled")));
        assert.equal(h.adapter.getState().started, false);
    });

    it("never infers enrollment: requires exactly three supplied ids", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b"], CLEANUP);
        h.adapter.start(["id-a", "id-b", "id-c", "id-d"], CLEANUP);
        h.adapter.start([], CLEANUP);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-window-count")));
        // Active window alone never enrolls anything.
        h.workspace["activeWindow"] = h.windows[0];
        h.adapter.start(["id-a", "id-b", "id-b"], CLEANUP);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-duplicate-id")));
    });

    it("rejects unknown or unresolvable identities without transport", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-missing"], CLEANUP);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-unknown-id")));
        h.adapter.start(["", "id-b", "id-c"], CLEANUP);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-invalid-id")));
    });
});

describe("poc3 three-window eligibility and scope", () => {
    const cases: Array<{ name: string; override: Record<string, unknown>; token: string }> = [
        { name: "tiled", override: { tile: {} }, token: "poc3-tiled" },
        { name: "fullscreen", override: { fullScreen: true }, token: "poc3-fullscreen" },
        { name: "maximized", override: { maximizeMode: 3 }, token: "poc3-maximized" },
        { name: "special", override: { normalWindow: false }, token: "poc3-special" },
        { name: "unmanaged", override: { managed: false }, token: "poc3-unmanaged" },
        { name: "unresizable", override: { resizeable: false }, token: "poc3-unresizable" },
        { name: "applet popup", override: { appletPopup: true }, token: "poc3-applet-popup" },
    ];
    for (const { name, override, token } of cases) {
        it(`rejects ${name} windows`, () => {
            const h = harnessWith([stubWindow("id-a", override), stubWindow("id-b"), stubWindow("id-c")]);
            h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
            assert.equal(h.dbus.length, 0);
            assert.ok(h.logs.some((line) => line.includes(token)), `missing ${token} in ${String(h.logs)}`);
        });
    }

    it("rejects cross-output enrollment", () => {
        const h = harnessWith([
            stubWindow("id-a"),
            stubWindow("id-b"),
            stubWindow("id-c", { output: OUTPUT_B }),
        ]);
        h.workspace["screens"] = [OUTPUT_A, OUTPUT_B];
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-cross-output")));
    });

    it("rejects cross-workspace enrollment", () => {
        const h = harnessWith([
            stubWindow("id-a"),
            stubWindow("id-b"),
            stubWindow("id-c", { desktops: [DESKTOP_B] }),
        ]);
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-cross-workspace")));
    });

    it("rejects duplicate native identities", () => {
        const h = harnessWith([stubWindow("id-a"), stubWindow("id-a"), stubWindow("id-c")]);
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        assert.equal(h.dbus.length, 0);
        const flat = h.logs.join("\n");
        assert.ok(flat.includes("poc3-unknown-id") || flat.includes("poc3-duplicate-native"), flat);
    });
});

describe("poc3 canonical intent application", () => {
    it("applies start intent with sequential geometry writes plus focus, then completes", () => {
        const h = harness3();
        const { startPayload, completePayload } = driveStartToComplete(h);
        assert.equal(startPayload["command"], "start");
        assert.equal(startPayload["v"], POC3_CONTRACT_VERSION);
        assert.equal((startPayload["windows"] as unknown[]).length, 3);
        // Opaque rollback capture travels with the start request.
        for (const window of startPayload["windows"] as Array<Record<string, unknown>>) {
            assert.ok(typeof window["rollback"] === "string" && (window["rollback"] as string).length > 0);
        }
        const first = h.windows[0] as StubWindow;
        const second = h.windows[1] as StubWindow;
        const third = h.windows[2] as StubWindow;
        assert.deepEqual(first["frameGeometry"], { x: 0, y: 0, width: 446, height: 600 });
        assert.deepEqual(second["frameGeometry"], { x: 454, y: 0, width: 446, height: 296 });
        assert.deepEqual(third["frameGeometry"], { x: 454, y: 304, width: 446, height: 296 });
        assert.equal(h.workspace["activeWindow"], first);
        // Tile associations untouched by actuation.
        assert.equal(first["tile"], null);
        assert.equal(second["tile"], null);
        assert.equal(third["tile"], null);
        assert.equal(completePayload["command"], "complete");
        assert.equal(completePayload["outcome"], "applied");
        assert.equal(completePayload["expected_revision"], 0);
        finishCompleteApplied(h, 1);
        const state = h.adapter.getState();
        assert.equal(state.started, true);
        assert.equal(state.revision, 1);
        assert.ok(lastLog(h.logs).startsWith("plasma-auto-tiler:poc3:poc3-applied:1:"));
    });

    it("dispatches focus with owner/generation/revision binding", () => {
        const h = harness3();
        driveStarted(h);
        const before = h.dbus.length;
        h.adapter.focus("right");
        assert.equal(h.dbus.length, before + 1);
        const payload = payloadOf(h.dbus[before] as DbusCall);
        assert.equal(payload["command"], "focus");
        assert.equal(payload["direction"], "right");
        assert.equal(payload["expected_revision"], 1);
        assert.ok(typeof payload["owner"] === "string" && (payload["owner"] as string).length > 0);
        assert.ok(typeof payload["generation"] === "string" && (payload["generation"] as string).length > 0);
        (h.dbus[before] as DbusCall).callback(intentReply(payload, "focus", 1, "id-b"));
        assert.equal(h.workspace["activeWindow"], h.windows[1]);
        const completeCall = h.dbus[h.dbus.length - 1] as DbusCall;
        assert.equal(payloadOf(completeCall)["outcome"], "applied");
        finishCompleteApplied(h, 2);
        assert.equal(h.adapter.getState().revision, 2);
    });

    it("reports noop without actuation or completion", () => {
        const h = harness3();
        driveStarted(h);
        const before = h.dbus.length;
        h.adapter.move("left");
        const call = h.dbus[before] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                correlation_id: payload["correlation_id"],
                command: "move",
                outcome: "noop",
                revision: 1,
                noop: { reason: "edge", revision: 1 },
            }),
        );
        assert.equal(h.dbus.length, before + 1);
        assert.ok(h.logs.some((line) => line.includes("poc3-noop")));
        assert.equal(h.adapter.getState().revision, 1);
    });

    it("refuses a second in-flight dispatch without queueing", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        assert.equal(h.dbus.length, 1);
        h.adapter.status();
        assert.equal(h.dbus.length, 1);
        assert.ok(h.logs.some((line) => line.includes("poc3-busy")));
    });
});

describe("poc3 stale reply and revision handling", () => {
    it("rejects correlation mismatches without actuation", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            intentReply({ ...payload, correlation_id: "wrong-correlation" }, "start", 0, "id-a"),
        );
        assert.equal(h.dbus.length, 1);
        assert.ok(h.logs.some((line) => line.includes("poc3-identity-mismatch")));
        assert.deepEqual((h.windows[0] as StubWindow)["frameGeometry"], {
            x: 10,
            y: 10,
            width: 100,
            height: 100,
        });
        assert.equal(h.adapter.getState().started, false);
    });

    it("rejects intent revisions that do not match the session revision", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.focus("right");
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(intentReply(payload, "focus", 99, "id-b"));
        assert.ok(h.logs.some((line) => line.includes("poc3-identity-mismatch")));
        assert.equal(h.adapter.getState().revision, 1);
    });

    it("rejects engine rejections without claiming application", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.focus("right");
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                correlation_id: payload["correlation_id"],
                command: "focus",
                outcome: "rejected",
                revision: 1,
                error: { kind: "stale-revision", message: "stale" },
            }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-rejected")));
        assert.equal(h.adapter.getState().revision, 1);
        assert.equal(h.dbus.filter((entry) => payloadOf(entry)["command"] === "complete").length, 1);
    });

    it("ignores late replies after a newer flight started", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const first = h.dbus[0] as DbusCall;
        const firstPayload = payloadOf(first);
        const timer = h.timers[0] as TimerEntry;
        timer.callback();
        assert.ok(h.logs.some((line) => line.includes("poc3-timeout")));
        const logCount = h.logs.length;
        first.callback(intentReply(firstPayload, "start", 0, "id-a"));
        assert.equal(h.logs.length, logCount);
        assert.equal(h.dbus.length, 1);
    });
});

describe("poc3 partial application and drift", () => {
    it("reports partial-application when one geometry fails readback", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        // Third window refuses geometry writes: read-only frameGeometry.
        const third = h.windows[2] as StubWindow;
        const frozen = third["frameGeometry"];
        Object.defineProperty(third, "frameGeometry", {
            configurable: true,
            enumerable: true,
            get: () => frozen,
            set: (_value: unknown) => undefined,
        });
        call.callback(intentReply(payload, "start", 0, "id-a"));
        // No early applied/complete claim: convergence must be observed first.
        assert.equal(h.dbus.length, 1);
        assert.ok(!h.logs.some((line) => line.includes("poc3-applied")));
        pumpTimers(h, POC3_CONVERGE_CHECKS + 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-converge-expired")));
        const completeCall = h.dbus[h.dbus.length - 1] as DbusCall;
        const complete = payloadOf(completeCall);
        assert.equal(complete["outcome"], "divergent");
        assert.equal(complete["reason"], "partial-application");
        assert.ok(h.logs.some((line) => line.includes("poc3-divergent:partial-application")));
    });

    it("reports window-missing when an enrolled window closes before actuation", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        h.workspace["windowList"] = () => [h.windows[0], h.windows[1]];
        call.callback(intentReply(payload, "start", 0, "id-a"));
        const completeCall = h.dbus[h.dbus.length - 1] as DbusCall;
        assert.equal(payloadOf(completeCall)["reason"], "window-missing");
    });

    it("stops on tile association drift with a divergent report", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        (h.windows[1] as StubWindow)["tile"] = {};
        call.callback(intentReply(payload, "start", 0, "id-a"));
        assert.ok(h.logs.some((line) => line.includes("poc3-tiled")));
        const completeCall = h.dbus[h.dbus.length - 1] as DbusCall;
        assert.equal(payloadOf(completeCall)["outcome"], "divergent");
    });

    it("stops on output drift before actuation", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        (h.windows[2] as StubWindow)["output"] = OUTPUT_B;
        call.callback(intentReply(payload, "start", 0, "id-a"));
        assert.ok(h.logs.some((line) => line.includes("poc3-output-drift")));
        assert.equal(payloadOf(h.dbus[h.dbus.length - 1] as DbusCall)["outcome"], "divergent");
    });

    it("stops on workspace drift before actuation", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        (h.windows[0] as StubWindow)["desktops"] = [DESKTOP_B];
        call.callback(intentReply(payload, "start", 0, "id-a"));
        assert.ok(h.logs.some((line) => line.includes("poc3-workspace-drift")));
        assert.equal(payloadOf(h.dbus[h.dbus.length - 1] as DbusCall)["outcome"], "divergent");
    });

    it("records engine divergence and exposes only the termination path", () => {
        const h = harness3();
        const { completePayload } = driveStartToComplete(h);
        const completeCall = h.dbus[h.dbus.length - 1] as DbusCall;
        completeCall.callback(
            JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                correlation_id: completePayload["correlation_id"],
                command: "complete",
                outcome: "diverged",
                revision: 0,
                completed: { result: "diverged-recorded", revision: 0, divergent: true },
            }),
        );
        assert.equal(h.adapter.getState().diverged, true);
        const before = h.dbus.length;
        h.adapter.focus("right");
        assert.equal(h.dbus.length, before);
        assert.ok(h.logs.some((line) => line.includes("poc3-diverged")));
    });
});

describe("poc3 service loss and timeout", () => {
    it("surfaces an absent service as a bounded timeout with only stop available", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        assert.equal(h.dbus.length, 1);
        const timer = h.timers[0] as TimerEntry;
        assert.equal(timer.delayMs, POC3_TIMEOUT_MS);
        timer.callback();
        assert.ok(h.logs.some((line) => line.includes("poc3-timeout:start")));
        const before = h.dbus.length;
        h.adapter.focus("right");
        assert.equal(h.dbus.length, before);
        h.adapter.stop();
        assert.equal(h.dbus.length, before + 1);
        assert.equal(payloadOf(h.dbus[before] as DbusCall)["command"], "stop");
    });

    it("treats a throwing transport as service loss without retry", () => {
        const h = harness3();
        driveStarted(h);
        h.throwOnDbus = true;
        h.adapter.focus("right");
        assert.ok(h.logs.some((line) => line.includes("poc3-dbus-failed")));
        assert.equal(h.adapter.getState().diverged, true);
        h.throwOnDbus = false;
        const before = h.dbus.length;
        h.adapter.focus("right");
        assert.equal(h.dbus.length, before);
    });

    it("times out status queries without hanging single-flight", () => {
        const h = harness3();
        h.adapter.status();
        assert.equal(h.dbus.length, 1);
        (h.timers[0] as TimerEntry).callback();
        assert.ok(h.logs.some((line) => line.includes("poc3-timeout:status")));
        h.adapter.status();
        assert.equal(h.dbus.length, 2);
    });

    it("keeps requests and replies bounded", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        for (const entry of h.dbus) {
            assert.ok(entry.payload.length <= POC3_MAX_REQUEST_BYTES);
            assert.equal(entry.service, POC3_SERVICE);
            assert.equal(entry.path, POC3_OBJECT);
            assert.equal(entry.dbusInterface, POC3_INTERFACE);
            assert.equal(entry.method, POC3_METHOD);
        }
        assert.equal(POC3_MAX_REPLY_BYTES, 64 * 1024);
    });
});

function stopReply(
    stopPayload: Record<string, unknown>,
    revision: number,
    cleanup: Record<string, unknown>,
): string {
    return JSON.stringify({
        v: POC3_CONTRACT_VERSION,
        correlation_id: stopPayload["correlation_id"],
        command: "stop",
        outcome: "ok",
        revision,
        cleanup,
    });
}

describe("poc3 cleanup directives", () => {
    it("closes exactly the three enrolled windows on close-disposable and verifies removal", () => {
        const h = harness3();
        driveStarted(h);
        const unrelated = stubWindow("id-unrelated");
        (unrelated["closeWindow"] as () => void) = () => {
            h.closedIds.push("id-unrelated");
        };
        h.windows.push(unrelated);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        assert.equal(payload["command"], "stop");
        assert.equal(payload["confirm_restore"], false);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-stopped:close-disposable")));
        assert.equal(h.adapter.getState().started, false);
        // Exactly the enrolled three were closed via the public close method;
        // the unrelated window was never touched.
        assert.deepEqual([...h.closedIds].sort(), ["id-a", "id-b", "id-c"]);
        const remaining = (h.workspace["windowList"] as () => StubWindow[])();
        assert.deepEqual(
            remaining.map((window) => window.internalId),
            ["id-unrelated"],
        );
    });

    it("never closes outside an explicit stop with close-disposable", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.focus("right");
        const focusCall = h.dbus[h.dbus.length - 1] as DbusCall;
        focusCall.callback(intentReply(payloadOf(focusCall), "focus", 1, "id-b"));
        finishCompleteApplied(h, 2);
        h.adapter.status();
        const statusCall = h.dbus[h.dbus.length - 1] as DbusCall;
        statusCall.callback(
            JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                correlation_id: payloadOf(statusCall)["correlation_id"],
                command: "status",
                outcome: "ok",
                revision: 2,
                status: { state: "active", revision: 2 },
            }),
        );
        assert.deepEqual(h.closedIds, []);
        assert.equal((h.workspace["windowList"] as () => unknown[])().length, 3);
    });

    it("refuses to close when cleanup names an unidentified window", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-x"], revision: 1 }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-mismatch")));
        assert.deepEqual(h.closedIds, []);
        assert.equal((h.workspace["windowList"] as () => unknown[])().length, 3);
        assert.equal(h.adapter.getState().started, false);
    });

    it("refuses to close a replaced window reference", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        const replacement = stubWindow("id-b");
        const index = h.windows.findIndex((window) => window.internalId === "id-b");
        h.windows[index] = replacement as StubWindow;
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        assert.ok(
            h.logs.some(
                (line) => line.includes("poc3-cleanup-mismatch") || line.includes("poc3-cleanup-failed"),
            ),
        );
        assert.ok(!h.closedIds.includes("id-a"), `must close none, got ${String(h.closedIds)}`);
        assert.ok(!h.closedIds.includes("id-c"), `must close none, got ${String(h.closedIds)}`);
        assert.equal(h.adapter.getState().started, false);
    });

    it("refuses to close when an enrolled window drifts to ineligible state", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        (h.windows[1] as StubWindow)["tile"] = {};
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        assert.ok(
            h.logs.some(
                (line) => line.includes("poc3-cleanup-mismatch") || line.includes("poc3-cleanup-failed"),
            ),
        );
        assert.deepEqual(h.closedIds, []);
        assert.equal(h.adapter.getState().started, false);
    });

    it("refuses to close without a confirmed public close method", () => {
        const h = harnessWith([stubWindow("id-a"), stubWindow("id-b"), stubWindow("id-c")]);
        for (const window of h.windows) {
            delete (window as Record<string, unknown>)["closeWindow"];
        }
        // Rebuild harness close tracking without a close method: the harness
        // default above is bypassed, so re-clear any tracking.
        h.closedIds.length = 0;
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const startCall = h.dbus[0] as DbusCall;
        const startPayload = payloadOf(startCall);
        startCall.callback(intentReply(startPayload, "start", 0, "id-a"));
        finishCompleteApplied(h, 1);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-mismatch")));
        assert.deepEqual(h.closedIds, []);
        assert.equal(h.adapter.getState().started, false);
    });

    it("refuses to close a non-user-closeable window", () => {
        const h = harnessWith([
            stubWindow("id-a"),
            stubWindow("id-b", { closeable: false }),
            stubWindow("id-c"),
        ]);
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const startCall = h.dbus[0] as DbusCall;
        const startPayload = payloadOf(startCall);
        startCall.callback(intentReply(startPayload, "start", 0, "id-a"));
        finishCompleteApplied(h, 1);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-mismatch")));
        assert.deepEqual(h.closedIds, []);
        assert.equal(h.adapter.getState().started, false);
    });

    it("reports cleanup failure when closed windows remain listed", () => {
        const h = harness3();
        for (const window of h.windows) {
            (window as Record<string, unknown>)["closeWindow"] = () => {
                h.closedIds.push((window as StubWindow).internalId);
            };
        }
        driveStarted(h);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        // No early closed claim: removal must be observed first.
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped")));
        pumpTimers(h, POC3_CLOSE_CHECKS + 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-failed")));
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped")));
        assert.deepEqual([...h.closedIds].sort(), ["id-a", "id-b", "id-c"]);
        assert.equal((h.workspace["windowList"] as () => unknown[])().length, 3);
        assert.equal(h.adapter.getState().started, false);
    });

    it("never restores without an explicit restore confirmation", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        const windows = (JSON.parse(h.dbus[0]?.payload ?? "{}") as Record<string, unknown>)["windows"];
        void windows;
        call.callback(
            stopReply(payload, 1, {
                action: "restore-enrolled",
                ids: ["id-a", "id-b", "id-c"],
                revision: 1,
                envelopes: { "id-a": "x", "id-b": "y", "id-c": "z" },
                session_envelope: "s",
            }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-mismatch")));
        assert.deepEqual(h.closedIds, []);
        assert.deepEqual((h.windows[0] as StubWindow)["frameGeometry"], {
            x: 0,
            y: 0,
            width: 446,
            height: 600,
        });
        assert.equal(h.adapter.getState().started, false);
    });

    it("never closes when restore was confirmed but the directive is closure", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop({ restore: true });
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        assert.equal(payload["confirm_restore"], true);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-mismatch")));
        assert.deepEqual(h.closedIds, []);
        assert.equal(h.adapter.getState().started, false);
    });

    it("restores exact original geometry plus focus only on byte-equal envelopes", () => {
        const h = harness3();
        (h.windows[1] as StubWindow)["frameGeometry"] = { x: 20, y: 20, width: 200, height: 200 };
        h.workspace["activeWindow"] = h.windows[1];
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const startCall = h.dbus[0] as DbusCall;
        const startPayload = payloadOf(startCall);
        startCall.callback(intentReply(startPayload, "start", 0, "id-a"));
        finishCompleteApplied(h, 1);
        h.adapter.stop({ restore: true });
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        assert.equal(payload["confirm_restore"], true);
        const windows = startPayload["windows"] as Array<Record<string, unknown>>;
        const envelopes: Record<string, unknown> = {};
        for (const window of windows) {
            envelopes[window["id"] as string] = window["rollback"];
        }
        call.callback(
            stopReply(payload, 1, {
                action: "restore-enrolled",
                ids: ["id-a", "id-b", "id-c"],
                revision: 1,
                envelopes,
                session_envelope: startPayload["session_rollback"],
            }),
        );
        // Observed restore: the first poll already observes the synchronously
        // converged natives. Pump any scheduled follow-up (no-op when done).
        pumpTimers(h, 2);
        assert.deepEqual((h.windows[0] as StubWindow)["frameGeometry"], {
            x: 10,
            y: 10,
            width: 100,
            height: 100,
        });
        assert.deepEqual((h.windows[1] as StubWindow)["frameGeometry"], {
            x: 20,
            y: 20,
            width: 200,
            height: 200,
        });
        assert.equal(h.workspace["activeWindow"], h.windows[1]);
        assert.ok(h.logs.some((line) => line.includes("poc3-stopped:restore-enrolled")));
        assert.ok(!h.logs.some((line) => line.includes("poc3-restore-failed")));
        assert.equal(h.adapter.getState().started, false);
    });

    it("waits for delayed restore geometry plus focus before reporting stopped", () => {
        const h = harness3();
        (h.windows[1] as StubWindow)["frameGeometry"] = { x: 20, y: 20, width: 200, height: 200 };
        h.workspace["activeWindow"] = h.windows[1];
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const startCall = h.dbus[0] as DbusCall;
        const startPayload = payloadOf(startCall);
        startCall.callback(intentReply(startPayload, "start", 0, "id-a"));
        finishCompleteApplied(h, 1);
        // Stage restore writes but keep reporting stale geometry/focus until
        // released: models delayed native convergence.
        for (const window of h.windows) {
            const live = window["frameGeometry"] as Record<string, unknown>;
            let reported: Record<string, unknown> = { ...live };
            let staged: Record<string, unknown> = { ...live };
            Object.defineProperty(window, "frameGeometry", {
                configurable: true,
                enumerable: true,
                get: () => ({ ...reported }),
                set: (value: unknown) => {
                    staged = { ...(value as Record<string, unknown>) };
                },
            });
            (window as Record<string, unknown>)["__release"] = () => {
                reported = { ...staged };
            };
        }
        let reportedFocus: unknown = h.windows[1];
        let stagedFocus: unknown = h.windows[1];
        Object.defineProperty(h.workspace, "activeWindow", {
            configurable: true,
            enumerable: true,
            get: () => reportedFocus,
            set: (value: unknown) => {
                stagedFocus = value;
            },
        });
        h.adapter.stop({ restore: true });
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        const windows = startPayload["windows"] as Array<Record<string, unknown>>;
        const envelopes: Record<string, unknown> = {};
        for (const window of windows) {
            envelopes[window["id"] as string] = window["rollback"];
        }
        call.callback(
            stopReply(payload, 1, {
                action: "restore-enrolled",
                ids: ["id-a", "id-b", "id-c"],
                revision: 1,
                envelopes,
                session_envelope: startPayload["session_rollback"],
            }),
        );
        // Writes are staged but not yet observed: no stopped claim yet.
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped:restore-enrolled")));
        assert.ok(!h.logs.some((line) => line.includes("poc3-restore-failed")));
        pumpTimers(h, 1);
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped:restore-enrolled")));
        // Release native convergence; the next poll observes and reports.
        for (const window of h.windows) {
            ((window as Record<string, unknown>)["__release"] as () => void)();
        }
        reportedFocus = stagedFocus;
        pumpTimers(h, POC3_RESTORE_CHECKS + 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-stopped:restore-enrolled")));
        assert.ok(!h.logs.some((line) => line.includes("poc3-restore-failed")));
        assert.equal(h.adapter.getState().started, false);
    });

    it("reports restore failure on expiry with residue, never success", () => {
        const h = harness3();
        driveStarted(h);
        // Restore writes never become visible: read-only geometry plus a
        // focus write that never sticks.
        for (const window of h.windows) {
            const frozen = (window as StubWindow)["frameGeometry"];
            Object.defineProperty(window, "frameGeometry", {
                configurable: true,
                enumerable: true,
                get: () => frozen,
                set: (_value: unknown) => undefined,
            });
        }
        Object.defineProperty(h.workspace, "activeWindow", {
            configurable: true,
            enumerable: true,
            get: () => h.windows[2],
            set: (_value: unknown) => undefined,
        });
        h.adapter.stop({ restore: true });
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        const startWindows = JSON.parse(h.dbus[0]?.payload ?? "{}") as Record<string, unknown>;
        const described = startWindows["windows"] as Array<Record<string, unknown>>;
        const envelopes: Record<string, unknown> = {};
        for (const window of described) {
            envelopes[window["id"] as string] = window["rollback"];
        }
        call.callback(
            stopReply(payload, 1, {
                action: "restore-enrolled",
                ids: ["id-a", "id-b", "id-c"],
                revision: 1,
                envelopes,
                session_envelope: startWindows["session_rollback"],
            }),
        );
        // No early success claim.
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped:restore-enrolled")));
        pumpTimers(h, POC3_RESTORE_CHECKS + 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-restore-failed")));
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped:restore-enrolled")));
        // Terminated with residue: session over but natives unconverged.
        assert.equal(h.adapter.getState().started, false);
        // Finite intervals only: restore polls plus the transport timeout.
        for (const timer of h.timers) {
            assert.ok(timer.delayMs === 50 || timer.delayMs === 2000, `bounded interval, got ${String(timer.delayMs)}`);
        }
        const restorePolls = h.timers.filter((timer) => timer.delayMs === 50).length;
        assert.ok(restorePolls <= POC3_RESTORE_CHECKS + 1, `finite polls, got ${String(restorePolls)}`);
    });

    it("stops on envelope mismatch without restoring", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop({ restore: true });
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, {
                action: "restore-enrolled",
                ids: ["id-a", "id-b", "id-c"],
                revision: 1,
                envelopes: { "id-a": "tampered", "id-b": "tampered", "id-c": "tampered" },
                session_envelope: "tampered",
            }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-restore-mismatch")));
        assert.equal(h.adapter.getState().started, false);
    });

    it("rejects cleanup naming unidentified windows", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-x"], revision: 1 }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-mismatch")));
        assert.deepEqual(h.closedIds, []);
        assert.equal(h.adapter.getState().started, false);
    });
});

describe("poc3 command input validation and no shell injection", () => {
    const injected = [
        "id-a;rm -rf /",
        "id-a$(touch /tmp/pwned)",
        "id-a`touch /tmp/pwned`",
        "id-a|cat /etc/passwd",
        "id-a&sleep 1",
        "id a",
        "id/a",
        "id'a",
        'id"a',
        "id\\a",
        "../id-a",
        "",
        "x".repeat(129),
    ];
    for (const bad of injected) {
        it(`rejects start id ${JSON.stringify(bad.slice(0, 24))} without transport`, () => {
            const h = harness3();
            h.adapter.start([bad, "id-b", "id-c"], CLEANUP);
            assert.equal(h.dbus.length, 0);
            assert.ok(
                h.logs.some((line) => line.includes("poc3-invalid-id")),
                `missing poc3-invalid-id for ${JSON.stringify(bad)}`,
            );
            assert.deepEqual(h.closedIds, []);
        });
    }

    it("rejects injected directions without transport", () => {
        const h = harness3();
        driveStarted(h);
        const before = h.dbus.length;
        for (const bad of ["right;touch", "$(right)", "RIGHT", "", "diagonal", 0, null, ["right"]]) {
            h.adapter.focus(bad);
            h.adapter.move(bad);
        }
        assert.equal(h.dbus.length, before);
        assert.ok(h.logs.some((line) => line.includes("poc3-invalid-direction")));
        assert.deepEqual(h.closedIds, []);
    });

    it("rejects invalid gap and geometry options without transport", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], { cleanup: "close-disposable", gap: "8;touch" });
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-invalid-gap")));
        h.adapter.start(["id-a", "id-b", "id-c"], {
            cleanup: "close-disposable",
            usable: { x: 0, y: 0, w: 0, h: 100 },
        });
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-invalid-geometry")));
    });

    it("sends explicit restore confirmation only when requested", () => {
        const h = harness3();
        driveStarted(h);
        h.adapter.stop();
        assert.equal(payloadOf(h.dbus[h.dbus.length - 1] as DbusCall)["confirm_restore"], false);
    });
});

describe("poc3 control reachability and exact API blocker", () => {
    it("has no obsolete separately loaded probe path", () => {
        // The superseded in-engine handle route is removed: no probe entry,
        // no probe lifecycle tool, no probe static test, no probe build
        // script. The real argument-bound per-command route below is the only
        // manual path.
        assert.equal(existsSync("src/poc3-probe-entry.ts"), false);
        assert.equal(existsSync("../scripts/poc3-manual.sh"), false);
        assert.equal(existsSync("../scripts/poc3-manual.test.sh"), false);
        const pkg = readFileSync("package.json", "utf8");
        assert.ok(!pkg.includes("build:poc3-probe"));
        assert.ok(!pkg.includes("poc3-manual.test.sh"));
        assert.ok(!pkg.includes("poc3-manual-probe"));
    });

    it("keeps the adapter control surface to start/focus/move/status/stop only", () => {
        const source = readFileSync("src/poc3-adapter.ts", "utf8");
        for (const method of [
            "start(ids",
            "focus(direction",
            "move(direction",
            "status(",
            "stop(options",
            "runCommand(config",
        ]) {
            assert.ok(source.includes(method), `missing control method ${method}`);
        }
        assert.ok(!source.includes("registerShortcut"));
        // Closure is scoped: the public close method is referenced only in
        // the stop-cleanup path, never in focus/move/status/start actuation.
        const closeUses = source.split("closeWindow").length - 1;
        assert.ok(closeUses >= 2, `expected close validation plus invocation, got ${String(closeUses)}`);
        assert.ok(source.includes("closeDisposableEnrolled"));
        // Convergence is observed only: bounded poll loop, no signal
        // subscriptions, no atomic/configure-ack claim. Restore is observed
        // the same way before any restore success claim.
        assert.ok(source.includes("POC3_CONVERGE_CHECKS"));
        assert.ok(source.includes("POC3_RESTORE_CHECKS"));
        assert.ok(source.includes("Observed convergence only"));
        assert.ok(source.includes("poc3-converge-expired"));
        assert.ok(source.includes("poc3-restore-failed"));
        assert.ok(source.includes("poc3-stopped:restore-enrolled"));
        assert.ok(source.includes("abandoned-pending-close"));
        assert.ok(source.includes("poc3-command-done"));
        // No source-text dynamic evaluation anywhere on the POC3 path.
        assert.ok(!source.includes("Function("));
        assert.ok(!source.includes("eval("));
        assert.ok(!source.includes("loadScriptFromText"));
        // Explicit cleanup model with no default.
        assert.ok(source.includes('POC3_CLEANUP_MODEL = "close-disposable"'));
        assert.ok(source.includes("poc3-cleanup-model"));
    });

    it("ships a real project-owned per-command route with no generic execution", () => {
        const entry = readFileSync("src/poc3-command-entry.ts", "utf8");
        assert.ok(entry.includes("POC3_COMMAND_CONFIG_JSON"));
        assert.ok(entry.includes("runCommand"));
        assert.ok(!entry.includes("__plasmaAutoTilerPoc3Manual"));
        assert.ok(!entry.includes("registerShortcut"));
        assert.ok(!entry.includes("loadScriptFromText"));
        assert.ok(!entry.includes("Function("));
        assert.ok(!entry.includes("eval("));
        // Closure-only route: no restore confirmation or directive handling.
        assert.ok(!entry.includes("confirm_restore"));
        assert.ok(!entry.includes("restore-enrolled"));
        const tool = readFileSync("../scripts/poc3-command.sh", "utf8");
        for (const command of ["cmd_run", "poc3-command-done:", "poc3-manual-command"]) {
            assert.ok(tool.includes(command), `missing command route piece ${command}`);
        }
        for (const forbidden of [
            "loadScriptFromText",
            "registerShortcut",
            "setShortcutKeys",
            'unloadScript s "$PRODUCTION_PLUGIN"',
            "--restore",
            "confirm_restore",
        ]) {
            assert.ok(!tool.includes(forbidden), `command tool must not contain ${forbidden}`);
        }
        // Coexistence guard refuses while production is loaded, read-only.
        assert.ok(tool.includes('PRODUCTION_PLUGIN="plasma-auto-tiler-kwin"'));
        assert.ok(tool.includes("refusing POC3 command operation"));
        const helper = readFileSync("../scripts/poc3-build-command.mjs", "utf8");
        assert.ok(!helper.includes("eval("));
        assert.ok(!helper.includes("Function("));
        assert.ok(!helper.includes("child_process"));
    });

    it("has no probe lifecycle tool; the per-command route is the only manual path", () => {
        assert.equal(existsSync("../scripts/poc3-manual.sh"), false);
        const tool = readFileSync("../scripts/poc3-command.sh", "utf8");
        for (const command of ["cmd_run", "poc3-command-done:", "poc3-manual-command"]) {
            assert.ok(tool.includes(command), `missing command route piece ${command}`);
        }
        assert.ok(!tool.includes("poc3-manual-probe"));
        assert.ok(!tool.includes("poc3-manual.sh"));
        assert.ok(!tool.includes("__plasmaAutoTilerPoc3Manual"));
    });
});

describe("poc3 mutation boundary", () => {
    it("has no Custom Tile, shortcut, or foreign mutation route in source", () => {
        for (const file of ["src/poc3-adapter.ts", "src/poc3-command-entry.ts"]) {
            const source = readFileSync(file, "utf8");
            for (const forbidden of [
                "registerShortcut",
                "registerScreenEdge",
                "relativeGeometry",
                "createDesktop",
                "removeDesktop",
                "setCurrentDesktop",
                "TrayPublisher",
                "TileController",
                "from \"./controller",
                "from \"./boundary",
                "custom-tile",
                "CustomTile",
                "readConfig",
                "autostart",
                "showOutline",
                "setMaximize",
                "tileChanged",
                "windowAdded",
                "windowRemoved",
                "outputChanged",
                "desktopsChanged",
                "activeChanged",
                "screensChanged",
                "currentDesktopChanged",
                "moveResizedChanged",
                "interactiveMoveResize",
            ]) {
                assert.ok(!source.includes(forbidden), `${file} forbidden route: ${forbidden}`);
            }
            // The only signal seam is the entry's own QTimer timeout for the
            // 2s transport timeout; no window/workspace signal is subscribed,
            // so no geometry change can generate another intent or event loop.
            const connects = source.split(".connect(").length - 1;
            const timerConnects = source.split("timeout.connect(").length - 1;
            assert.equal(connects, timerConnects, `${file} must only connect QTimer timeout`);
            assert.ok(file === "src/poc3-adapter.ts" ? connects === 0 : connects === 1, file);
            assert.ok(!source.includes("caption"), `${file} must never read captions`);
            // The single exact native app_id read (`resourceClass`) is
            // read-only re-resolution binding, never a mutation: no write to
            // it may exist.
            assert.ok(!source.includes('Reflect.set(ref, "resourceClass")'), file);
            assert.ok(!source.includes("resourceClass ="), file);
        }
        const entry = readFileSync("src/entry.ts", "utf8");
        assert.ok(!entry.includes("poc3"));
        assert.ok(!entry.includes("Poc3Adapter"));
        assert.ok(!entry.includes("__plasmaAutoTilerPoc3Manual"));
        const bundle = readFileSync("contents/code/main.js", "utf8");
        assert.ok(!bundle.includes("poc3"));
        assert.ok(!bundle.includes("EvaluatePoc3"));
        assert.ok(!bundle.includes("__plasmaAutoTilerPoc3Manual"));
    });

    it("keeps diagnostics bounded with fixed tokens and numeric stamps only", () => {
        const h = harness3();
        driveStarted(h);
        for (const line of h.logs) {
            assert.ok(line.startsWith("plasma-auto-tiler:poc3:"));
            assert.ok(line.length <= 256, line);
            assert.ok(!line.includes("id-a") || line.includes("poc3-applied"), line);
        }
        assert.ok(loggedToken(h.logs, "applied"));
    });
});

describe("poc3 per-command bundles", () => {
    const HELPER = "../scripts/poc3-build-command.mjs";
    const BUNDLE_PATH = "dist/poc3-manual-command.js";

    function buildCommand(args: readonly string[]): string {
        try {
            execFileSync("node", [HELPER, ...args, "--out", BUNDLE_PATH], { stdio: "pipe" });
        } catch (error) {
            const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
            assert.fail(`helper must succeed, got: ${stderr}`);
        }
        try {
            return readFileSync(BUNDLE_PATH, "utf8");
        } finally {
            try {
                unlinkSync(BUNDLE_PATH);
            } catch (error) {
                void error;
            }
        }
    }

    function buildCommandFails(args: readonly string[]): void {
        let failed = false;
        try {
            execFileSync("node", [HELPER, ...args, "--out", BUNDLE_PATH], { stdio: "pipe" });
        } catch (error) {
            void error;
            failed = true;
        }
        assert.ok(failed, `helper must reject: ${args.join(" ")}`);
        try {
            unlinkSync(BUNDLE_PATH);
        } catch (error) {
            void error;
        }
    }

    interface BundleWorld {
        readonly logs: string[];
        readonly dbus: Array<{ payload: string; callback: (reply: unknown) => void }>;
        readonly timers: Array<() => void>;
    }

    function runBundle(bundle: string): { world: BundleWorld; context: unknown } {
        const world: BundleWorld = { logs: [], dbus: [], timers: [] };
        class FakeQTimer {
            interval = 0;
            singleShot = false;
            private handler: (() => void) | null = null;
            readonly timeout = {
                connect: (callback: () => void): void => {
                    this.handler = callback;
                },
            };
            start(): void {
                const handler = this.handler;
                if (handler !== null) {
                    world.timers.push(handler);
                }
            }
            stop(): void {}
        }
        const closed: string[] = [];
        const windows = ["id-a", "id-b", "id-c"].map((id) => ({
            internalId: id,
            normalWindow: true,
            managed: true,
            resizeable: true,
            appletPopup: false,
            tile: null,
            frameGeometry: { x: 10, y: 10, width: 100, height: 100 },
            output: OUTPUT_A,
            desktops: [DESKTOP_A],
            onAllDesktops: false,
            fullScreen: false,
            maximizeMode: 0,
            closeable: true,
            closeWindow(this: { internalId: string }): void {
                closed.push(this.internalId);
                const at = windows.findIndex((entry) => entry.internalId === this.internalId);
                if (at >= 0) {
                    windows.splice(at, 1);
                }
            },
        }));
        const workspace = {
            activeWindow: null,
            windowList: () => windows,
            screens: [OUTPUT_A],
            currentDesktopForScreen: () => DESKTOP_A,
            clientArea: () => ({ x: 0, y: 0, width: 900, height: 600 }),
        };
        const sandbox = {
            globalThis: undefined,
            console: {
                log: (message: string): void => {
                    world.logs.push(String(message));
                },
            },
            workspace,
            QTimer: FakeQTimer,
            callDBus: (
                _service: unknown,
                _path: unknown,
                _iface: unknown,
                _method: unknown,
                payload: unknown,
                callback: (reply: unknown) => void,
            ): void => {
                world.dbus.push({ payload: String(payload), callback });
            },
        };
        const context = createContext(sandbox);
        runInContext(bundle, context, { filename: "poc3-command.js" });
        (world as { closed?: string[] }).closed = closed;
        return { world, context };
    }

    function fireTimers(world: BundleWorld, cap: number): void {
        for (let n = 0; n < cap; n += 1) {
            const next = world.timers.shift();
            if (next === undefined) {
                return;
            }
            next();
        }
    }

    it("builds a start bundle that reaches the real command route", () => {
        const bundle = buildCommand([
            "--command", "start",
            "--id", "id-a", "--id", "id-b", "--id", "id-c",
            "--owner", "owner-1", "--generation", "gen-1",
            "--nonce", "bundle-start-1",
        ]);
        // Separately bundled IIFE with an embedded validated config: no
        // handle, no shortcut, no evaluator with control arguments.
        assert.ok(!bundle.includes("__plasmaAutoTilerPoc3Manual"));
        assert.ok(!bundle.includes("registerShortcut"));
        assert.ok(!bundle.includes("loadScriptFromText"));
        assert.ok(bundle.includes("close-disposable"));
        const { world } = runBundle(bundle);
        assert.equal(world.dbus.length, 1);
        const payload = JSON.parse(world.dbus[0]?.payload ?? "{}") as Record<string, unknown>;
        assert.equal(payload["command"], "start");
        assert.equal(payload["cleanup"], "close-disposable");
        assert.equal(payload["owner"], "owner-1");
        assert.equal(payload["generation"], "gen-1");
        assert.equal((payload["windows"] as unknown[]).length, 3);
        (world.dbus[0] as { callback: (reply: unknown) => void }).callback(
            intentReply(payload, "start", 0, "id-a"),
        );
        assert.equal(world.dbus.length, 2);
        const complete = JSON.parse(world.dbus[1]?.payload ?? "{}") as Record<string, unknown>;
        assert.equal(complete["command"], "complete");
        assert.equal(complete["outcome"], "applied");
        (world.dbus[1] as { callback: (reply: unknown) => void }).callback(
            completeAppliedReply(complete, 1),
        );
        assert.ok(
            world.logs.some((line) => line.includes("poc3-command-done:bundle-start-1:poc3-applied:1")),
            `missing done diagnostic in ${String(world.logs)}`,
        );
    });

    it("builds focus and move bundles with direction binding", () => {
        for (const [command, direction] of [["focus", "right"], ["move", "down"]] as const) {
            const bundle = buildCommand([
                "--command", command,
                "--direction", direction,
                "--id", "id-a", "--id", "id-b", "--id", "id-c",
                "--owner", "owner-1", "--generation", "gen-1",
                "--revision", "3",
                "--nonce", `bundle-${command}-1`,
            ]);
            const { world } = runBundle(bundle);
            assert.equal(world.dbus.length, 1);
            const payload = JSON.parse(world.dbus[0]?.payload ?? "{}") as Record<string, unknown>;
            assert.equal(payload["command"], command);
            assert.equal(payload["direction"], direction);
            assert.equal(payload["expected_revision"], 3);
            (world.dbus[0] as { callback: (reply: unknown) => void }).callback(
                intentReply(payload, command, 3, "id-b"),
            );
            assert.equal(world.dbus.length, 2);
            assert.equal(
                (JSON.parse(world.dbus[1]?.payload ?? "{}") as Record<string, unknown>)["outcome"],
                "applied",
            );
        }
    });

    it("builds a status bundle that reports revision state", () => {
        const bundle = buildCommand([
            "--command", "status",
            "--owner", "owner-1", "--generation", "gen-1",
            "--nonce", "bundle-status-1",
        ]);
        const { world } = runBundle(bundle);
        assert.equal(world.dbus.length, 1);
        const payload = JSON.parse(world.dbus[0]?.payload ?? "{}") as Record<string, unknown>;
        assert.equal(payload["command"], "status");
        (world.dbus[0] as { callback: (reply: unknown) => void }).callback(
            JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                correlation_id: payload["correlation_id"],
                command: "status",
                outcome: "ok",
                revision: 4,
                status: { state: "active", revision: 4, pending: false, divergent: false },
            }),
        );
        assert.ok(world.logs.some((line) => line.includes("poc3-status:active:4")));
        assert.ok(
            world.logs.some((line) => line.includes("poc3-command-done:bundle-status-1:poc3-status:active:4")),
        );
    });

    it("builds a stop bundle that closes exactly the three with observation", () => {
        const bundle = buildCommand([
            "--command", "stop",
            "--id", "id-a", "--id", "id-b", "--id", "id-c",
            "--owner", "owner-1", "--generation", "gen-1",
            "--revision", "2",
            "--nonce", "bundle-stop-1",
        ]);
        const { world } = runBundle(bundle);
        assert.equal(world.dbus.length, 1);
        const payload = JSON.parse(world.dbus[0]?.payload ?? "{}") as Record<string, unknown>;
        assert.equal(payload["command"], "stop");
        assert.equal(payload["confirm_restore"], false);
        (world.dbus[0] as { callback: (reply: unknown) => void }).callback(
            JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                correlation_id: payload["correlation_id"],
                command: "stop",
                outcome: "ok",
                revision: 2,
                cleanup: { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 2 },
            }),
        );
        // vm windows remove themselves on closeWindow; observation then
        // reports. Fire any scheduled close poll (usually already observed).
        fireTimers(world, 25);
        assert.ok(world.logs.some((line) => line.includes("poc3-stopped:close-disposable")));
        assert.ok(
            world.logs.some((line) =>
                line.includes("poc3-command-done:bundle-stop-1:poc3-stopped:close-disposable"),
            ),
        );
    });

    it("refuses injection and malformed helper input without a bundle", () => {
        const base = ["--owner", "owner-1", "--generation", "gen-1", "--nonce", "n-1"];
        buildCommandFails(["--command", "start", "--id", "id-a;rm -rf /", "--id", "id-b", "--id", "id-c", ...base]);
        buildCommandFails(["--command", "start", "--id", "id-a$(touch /tmp/x)", "--id", "id-b", "--id", "id-c", ...base]);
        buildCommandFails(["--command", "start", "--id", "id a", "--id", "id-b", "--id", "id-c", ...base]);
        buildCommandFails(["--command", "focus", "--id", "id-a", "--id", "id-b", "--id", "id-c", ...base]);
        buildCommandFails(["--command", "teleport", ...base]);
        buildCommandFails(["--command", "status", "--id", "id-a", ...base]);
        buildCommandFails(["--command", "start", "--id", "id-a", "--id", "id-b", "--id", "id-c", "--owner", "owner-1", "--generation", "gen-1"]);
        buildCommandFails(["--command", "start", "--id", "id-a", "--id", "id-b", "--id", "id-c", ...base, "--bogus", "1"]);
        buildCommandFails(["--command", "move", "--direction", "diagonal", "--id", "id-a", "--id", "id-b", "--id", "id-c", "--owner", "owner-1", "--generation", "gen-1", "--revision", "1", "--nonce", "n-1"]);
    });
});

describe("poc3 explicit cleanup model", () => {
    it("rejects a missing cleanup model before any transport", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"]);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-model")));
        assert.deepEqual(h.closedIds, []);
        assert.equal(h.adapter.getState().started, false);
    });

    it("rejects every non-literal cleanup value before any transport", () => {
        for (const bad of [undefined, null, "", "restore", "close", "close_disposable", "CLOSE-DISPOSABLE", true, 0]) {
            const h = harness3();
            h.adapter.start(["id-a", "id-b", "id-c"], { cleanup: bad });
            assert.equal(h.dbus.length, 0, `cleanup ${String(bad)} must not send`);
            assert.ok(
                h.logs.some((line) => line.includes("poc3-cleanup-model")),
                `missing poc3-cleanup-model for ${String(bad)}`,
            );
            assert.deepEqual(h.closedIds, []);
        }
    });

    it("carries the literal into the start request and never closes by default", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        assert.equal(h.dbus.length, 1);
        assert.equal(payloadOf(h.dbus[0] as DbusCall)["cleanup"], "close-disposable");
        assert.deepEqual(h.closedIds, []);
        // A timed-out start still closes nothing on its own.
        (h.timers[0] as TimerEntry).callback();
        assert.deepEqual(h.closedIds, []);
        assert.ok(h.logs.some((line) => line.includes("poc3-timeout:start")));
    });
});

describe("poc3 observed convergence", () => {
    function delayedGeometryHarness(): Harness {
        const h = harness3();
        // Windows stage writes but keep reporting stale geometry until the
        // test releases them: models delayed native convergence.
        for (const window of h.windows) {
            const live = window["frameGeometry"] as Record<string, unknown>;
            let reported: Record<string, unknown> = { ...live };
            let staged: Record<string, unknown> = { ...live };
            Object.defineProperty(window, "frameGeometry", {
                configurable: true,
                enumerable: true,
                get: () => ({ ...reported }),
                set: (value: unknown) => {
                    staged = { ...(value as Record<string, unknown>) };
                },
            });
            (window as Record<string, unknown>)["__release"] = () => {
                reported = { ...staged };
            };
        }
        return h;
    }

    it("waits for delayed geometry before claiming applied", () => {
        const h = delayedGeometryHarness();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        call.callback(intentReply(payloadOf(call), "start", 0, "id-a"));
        // Writes are staged but not yet observed: no completion may be sent.
        assert.equal(h.dbus.length, 1);
        assert.ok(pumpTimers(h, 1) >= 0);
        assert.equal(h.dbus.length, 1);
        assert.ok(!h.logs.some((line) => line.includes("poc3-applied")));
        // Release native convergence, then the next poll observes and reports.
        for (const window of h.windows) {
            ((window as Record<string, unknown>)["__release"] as () => void)();
        }
        pumpUntilDbus(h, 2, POC3_CONVERGE_CHECKS + 2);
        const complete = payloadOf(h.dbus[1] as DbusCall);
        assert.equal(complete["outcome"], "applied");
        finishCompleteApplied(h, 1);
        assert.equal(h.adapter.getState().revision, 1);
    });

    it("reports focus-unverified when focus never converges", () => {
        const h = harness3();
        // Native focus never follows the focus write: models an unresponsive
        // compositor while geometry converges.
        Object.defineProperty(h.workspace, "activeWindow", {
            configurable: true,
            enumerable: true,
            get: () => h.windows[2],
            set: (_value: unknown) => undefined,
        });
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        call.callback(intentReply(payloadOf(call), "start", 0, "id-a"));
        assert.equal(h.dbus.length, 1, "no early completion claim");
        pumpTimers(h, POC3_CONVERGE_CHECKS + 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-converge-expired")));
        const complete = payloadOf(h.dbus[h.dbus.length - 1] as DbusCall);
        assert.equal(complete["outcome"], "divergent");
        assert.equal(complete["reason"], "focus-unverified");
        assert.ok(!h.logs.some((line) => line.includes("poc3-applied")));
    });

    it("converges when focus arrives late within the budget", () => {
        const h = harness3();
        // Native focus stages the write and reports it late.
        let reported: unknown = h.windows[2];
        let staged: unknown = h.windows[2];
        Object.defineProperty(h.workspace, "activeWindow", {
            configurable: true,
            enumerable: true,
            get: () => reported,
            set: (value: unknown) => {
                staged = value;
            },
        });
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        call.callback(intentReply(payloadOf(call), "start", 0, "id-a"));
        assert.equal(h.dbus.length, 1, "focus not yet observed");
        pumpTimers(h, 1);
        assert.equal(h.dbus.length, 1, "still no early completion claim");
        reported = staged;
        pumpUntilDbus(h, 2, POC3_CONVERGE_CHECKS + 2);
        assert.equal(payloadOf(h.dbus[1] as DbusCall)["outcome"], "applied");
        finishCompleteApplied(h, 1);
        assert.equal(h.adapter.getState().revision, 1);
    });

    it("bounds the poll loop to a finite check budget", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const call = h.dbus[0] as DbusCall;
        const third = h.windows[2] as StubWindow;
        const frozen = third["frameGeometry"];
        Object.defineProperty(third, "frameGeometry", {
            configurable: true,
            enumerable: true,
            get: () => frozen,
            set: (_value: unknown) => undefined,
        });
        call.callback(intentReply(payloadOf(call), "start", 0, "id-a"));
        const polls = pumpTimers(h, POC3_CONVERGE_CHECKS + 5);
        assert.ok(polls <= POC3_CONVERGE_CHECKS + 1, `finite polls, got ${String(polls)}`);
        assert.ok(h.logs.some((line) => line.includes("poc3-converge-expired")));
        // Finite intervals only: convergence polls plus the transport timeout.
        // Zero signal subscriptions: all waiting is QTimer-timeout scheduling.
        for (const timer of h.timers) {
            assert.ok(timer.delayMs === 50 || timer.delayMs === 2000, `bounded interval, got ${String(timer.delayMs)}`);
        }
        const convergePolls = h.timers.filter((timer) => timer.delayMs === 50).length;
        assert.ok(convergePolls <= POC3_CONVERGE_CHECKS + 1, `finite polls, got ${String(convergePolls)}`);
    });
});

describe("poc3 delayed closure observation", () => {
    it("waits for delayed removal before reporting stopped", () => {
        const h = harness3();
        const pending: StubWindow[] = [];
        for (const window of h.windows) {
            (window as Record<string, unknown>)["closeWindow"] = () => {
                h.closedIds.push((window as StubWindow).internalId);
                pending.push(window as StubWindow);
            };
        }
        driveStarted(h);
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        // Close invoked on all three, but none has left the list yet.
        assert.deepEqual([...h.closedIds].sort(), ["id-a", "id-b", "id-c"]);
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped")));
        pumpTimers(h, 1);
        assert.ok(!h.logs.some((line) => line.includes("poc3-stopped")));
        // Native removal lands late; the next poll observes and reports.
        for (const window of pending.splice(0)) {
            const index = h.windows.indexOf(window);
            if (index >= 0) {
                h.windows.splice(index, 1);
            }
        }
        pumpTimers(h, POC3_CLOSE_CHECKS + 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-stopped:close-disposable")));
        assert.equal(h.adapter.getState().started, false);
    });
});

describe("poc3 abandoned pending stop", () => {
    function abandonedReply(
        stopPayload: Record<string, unknown>,
        revision: number,
    ): string {
        return JSON.stringify({
            v: POC3_CONTRACT_VERSION,
            correlation_id: stopPayload["correlation_id"],
            command: "stop",
            outcome: "ok",
            revision,
            cleanup: {
                action: "abandoned-pending-close",
                ids: ["id-a", "id-b", "id-c"],
                revision,
                abandoned_pending: true,
            },
        });
    }

    it("closes on the forced route and records the abandoned intent", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const startCall = h.dbus[0] as DbusCall;
        // Hold convergence open so the init intent is still pending while a
        // stop is requested: stop must not erase it silently.
        const third = h.windows[2] as StubWindow;
        const frozen = third["frameGeometry"];
        Object.defineProperty(third, "frameGeometry", {
            configurable: true,
            enumerable: true,
            get: () => frozen,
            set: (_value: unknown) => undefined,
        });
        startCall.callback(intentReply(payloadOf(startCall), "start", 0, "id-a"));
        h.adapter.stop();
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        assert.equal(payloadOf(call)["command"], "stop");
        call.callback(abandonedReply(payloadOf(call), 0));
        assert.ok(h.logs.some((line) => line.includes("poc3-abandoned-pending")));
        assert.deepEqual([...h.closedIds].sort(), ["id-a", "id-b", "id-c"]);
        assert.ok(h.logs.some((line) => line.includes("poc3-stopped:close-disposable")));
        assert.equal(h.adapter.getState().started, false);
    });

    it("stops during convergence without completing the abandoned intent", () => {
        const h = harness3();
        h.adapter.start(["id-a", "id-b", "id-c"], CLEANUP);
        const startCall = h.dbus[0] as DbusCall;
        const third = h.windows[2] as StubWindow;
        const frozen = third["frameGeometry"];
        Object.defineProperty(third, "frameGeometry", {
            configurable: true,
            enumerable: true,
            get: () => frozen,
            set: (_value: unknown) => undefined,
        });
        startCall.callback(intentReply(payloadOf(startCall), "start", 0, "id-a"));
        assert.equal(h.dbus.length, 1, "convergence pending, no completion yet");
        h.adapter.stop();
        assert.equal(h.dbus.length, 2);
        assert.equal(payloadOf(h.dbus[1] as DbusCall)["command"], "stop");
        const stopCall = h.dbus[1] as DbusCall;
        stopCall.callback(abandonedReply(payloadOf(stopCall), 0));
        // The abandoned init intent is never completed afterwards.
        assert.ok(
            !h.dbus.some((entry) => payloadOf(entry)["command"] === "complete"),
            "abandoned intent must never complete",
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-abandoned-pending")));
        assert.equal(h.adapter.getState().started, false);
    });
});

describe("poc3 window identity forms", () => {
    const BRA = "{11111111-1111-1111-1111-111111111111}";
    const BRB = "{22222222-2222-2222-2222-222222222222}";
    const BRC = "{33333333-3333-3333-3333-333333333333}";

    function braceHarness(): Harness {
        return harnessWith([stubWindow(BRA), stubWindow(BRB), stubWindow(BRC)]);
    }

    function braceDesired(): Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }> {
        return [
            { id: BRA, rect: { x: 0, y: 0, w: 446, h: 600 } },
            { id: BRB, rect: { x: 454, y: 0, w: 446, h: 296 } },
            { id: BRC, rect: { x: 454, y: 304, w: 446, h: 296 } },
        ];
    }

    it("enrolls QUuid brace-form identities end to end", () => {
        const h = braceHarness();
        h.adapter.start([BRA, BRB, BRC], CLEANUP);
        assert.equal(h.dbus.length, 1);
        const call = h.dbus[0] as DbusCall;
        call.callback(intentReplyWith(payloadOf(call), "start", 0, BRA, braceDesired()));
        assert.equal(h.dbus.length, 2);
        assert.equal(payloadOf(h.dbus[1] as DbusCall)["outcome"], "applied");
        finishCompleteApplied(h, 1);
        assert.equal(h.adapter.getState().revision, 1);
    });

    it("enrolls bare QUuid identities", () => {
        const bare = [
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
            "33333333-3333-3333-3333-333333333333",
        ];
        const h = harnessWith(bare.map((id) => stubWindow(id)));
        h.adapter.start(bare, CLEANUP);
        assert.equal(h.dbus.length, 1);
    });

    it("rejects malformed brace identities without transport", () => {
        for (const bad of [
            "{11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-111111111111}",
            "{not-a-uuid}",
            "{{11111111-1111-1111-1111-111111111111}}",
        ]) {
            const h = braceHarness();
            h.adapter.start([bad, BRB, BRC], CLEANUP);
            assert.equal(h.dbus.length, 0, `bad id ${bad} must not send`);
            assert.ok(h.logs.some((line) => line.includes("poc3-invalid-id")));
        }
    });

    it("fails closed with reference drift when a reference is replaced", () => {
        const h = harness3();
        driveStarted(h);
        const index = h.windows.findIndex((window) => window.internalId === "id-b");
        h.windows[index] = stubWindow("id-b");
        h.adapter.focus("right");
        const call = h.dbus[h.dbus.length - 1] as DbusCall;
        call.callback(intentReply(payloadOf(call), "focus", 1, "id-b"));
        assert.ok(h.logs.some((line) => line.includes("poc3-reference-drift")));
        const complete = payloadOf(h.dbus[h.dbus.length - 1] as DbusCall);
        assert.equal(complete["outcome"], "divergent");
        assert.ok(!h.logs.some((line) => line.includes("poc3-applied:2")));
    });
});

describe("poc3 one-shot command route", () => {
    const TOKEN = { owner: "owner-1", generation: "gen-1" };

    function startConfig(nonce: string): Record<string, unknown> {
        return {
            command: "start",
            ids: ["id-a", "id-b", "id-c"],
            direction: null,
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 0,
            gap: 8,
            usable: null,
            nonce,
        };
    }

    function driveOneShotStart(h: Harness, nonce: string): void {
        h.adapter.runCommand(startConfig(nonce));
        assert.equal(h.dbus.length, 1);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        assert.equal(payload["command"], "start");
        assert.equal(payload["cleanup"], "close-disposable");
        assert.equal(payload["owner"], TOKEN.owner);
        assert.equal(payload["generation"], TOKEN.generation);
        call.callback(intentReply(payload, "start", 0, "id-a"));
        assert.equal(h.dbus.length, 2);
        finishCompleteApplied(h, 1);
    }

    it("rejects malformed configs without transport", () => {
        for (const bad of [
            null,
            undefined,
            "start",
            { command: "teleport", ids: null, direction: null, owner: "o", generation: "gen-1", expected_revision: 0, gap: null, usable: null, nonce: "n-1" },
            { ...startConfig("n-1"), ids: ["id-a", "id-b"] },
            { ...startConfig("n-1"), ids: ["id-a", "id-b", "id-b"] },
            { ...startConfig("n-1"), ids: ["id-a;rm", "id-b", "id-c"] },
            { ...startConfig("n-1"), extra: true },
            { ...startConfig("n-1"), owner: "BAD OWNER" },
            { ...startConfig("n-1"), nonce: "BAD NONCE" },
        ]) {
            const h = harness3();
            h.adapter.runCommand(bad);
            assert.equal(h.dbus.length, 0);
            assert.ok(h.logs.some((line) => line.includes("poc3-invalid-command") || line.includes("poc3-invalid-identity")));
            assert.deepEqual(h.closedIds, []);
        }
    });

    it("runs start end to end with a done diagnostic", () => {
        const h = harness3();
        driveOneShotStart(h, "cmd-1");
        assert.equal(h.adapter.getState().revision, 1);
        assert.ok(
            h.logs.some((line) => line.includes("poc3-command-done:cmd-1:poc3-applied:1")),
            `missing done diagnostic in ${String(h.logs)}`,
        );
    });

    it("runs focus with token and revision binding plus done", () => {
        const h = harness3();
        // A separately loaded command revalidates the same three IDs and the
        // manually supplied session token from scratch.
        h.adapter.runCommand({
            command: "focus",
            ids: ["id-a", "id-b", "id-c"],
            direction: "right",
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 1,
            gap: null,
            usable: null,
            nonce: "cmd-2",
        });
        assert.equal(h.dbus.length, 1);
        const payload = payloadOf(h.dbus[0] as DbusCall);
        assert.equal(payload["command"], "focus");
        assert.equal(payload["expected_revision"], 1);
        assert.equal(payload["direction"], "right");
        assert.equal(payload["owner"], TOKEN.owner);
        assert.equal(payload["generation"], TOKEN.generation);
        (h.dbus[0] as DbusCall).callback(intentReply(payload, "focus", 1, "id-b"));
        assert.equal(h.dbus.length, 2);
        assert.equal(payloadOf(h.dbus[1] as DbusCall)["outcome"], "applied");
        finishCompleteApplied(h, 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-command-done:cmd-2:poc3-applied:2")));
    });

    it("runs move with structural reachability plus done", () => {
        const h = harness3();
        h.adapter.runCommand({
            command: "move",
            ids: ["id-a", "id-b", "id-c"],
            direction: "down",
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 1,
            gap: null,
            usable: null,
            nonce: "cmd-m",
        });
        assert.equal(h.dbus.length, 1);
        const payload = payloadOf(h.dbus[0] as DbusCall);
        assert.equal(payload["command"], "move");
        assert.equal(payload["direction"], "down");
        (h.dbus[0] as DbusCall).callback(intentReply(payload, "move", 1, "id-a"));
        assert.equal(h.dbus.length, 2);
        assert.equal(payloadOf(h.dbus[1] as DbusCall)["outcome"], "applied");
        finishCompleteApplied(h, 2);
        assert.ok(h.logs.some((line) => line.includes("poc3-command-done:cmd-m:poc3-applied:2")));
    });

    it("treats the one-shot adapter as single-use", () => {
        const h = harness3();
        driveOneShotStart(h, "cmd-1");
        const calls = h.dbus.length;
        h.adapter.runCommand({
            command: "status",
            ids: null,
            direction: null,
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 0,
            gap: null,
            usable: null,
            nonce: "cmd-2",
        });
        // Strictly single-use: the second command is refused with no new
        // transport, and no second done diagnostic (the first already settled).
        assert.ok(h.logs.some((line) => line.includes("poc3-busy")));
        assert.equal(h.dbus.length, calls);
        assert.ok(!h.logs.some((line) => line.includes("poc3-command-done:cmd-2")));
    });

    it("reports status with revision state plus done", () => {
        const h = harness3();
        h.adapter.runCommand({
            command: "status",
            ids: null,
            direction: null,
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 0,
            gap: null,
            usable: null,
            nonce: "cmd-s",
        });
        assert.equal(h.dbus.length, 1);
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        assert.equal(payload["command"], "status");
        call.callback(
            JSON.stringify({
                v: POC3_CONTRACT_VERSION,
                correlation_id: payload["correlation_id"],
                command: "status",
                outcome: "ok",
                revision: 2,
                status: { state: "active", revision: 2, pending: false, divergent: false },
            }),
        );
        assert.ok(h.logs.some((line) => line.includes("poc3-status:active:2")));
        assert.ok(h.logs.some((line) => line.includes("poc3-command-done:cmd-s:poc3-status:active:2")));
    });

    it("runs stop closure-only with done and never restores", () => {
        const h = harness3();
        const before = JSON.stringify((h.windows[0] as StubWindow)["frameGeometry"]);
        h.adapter.runCommand({
            command: "stop",
            ids: ["id-a", "id-b", "id-c"],
            direction: null,
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 1,
            gap: null,
            usable: null,
            nonce: "cmd-stop",
        });
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        assert.equal(payload["command"], "stop");
        assert.equal(payload["confirm_restore"], false);
        assert.equal(payload["expected_revision"], 1);
        call.callback(
            stopReply(payload, 1, { action: "restore-enrolled", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        // Spoofed restore directive against an unconfirmed stop: mismatch, no
        // geometry write, no close.
        assert.ok(h.logs.some((line) => line.includes("poc3-cleanup-mismatch")));
        assert.deepEqual(h.closedIds, []);
        assert.equal(JSON.stringify((h.windows[0] as StubWindow)["frameGeometry"]), before);
        assert.ok(h.logs.some((line) => line.includes("poc3-command-done:cmd-stop:poc3-cleanup-mismatch")));
    });

    it("runs stop to verified closure with done", () => {
        const h = harness3();
        h.adapter.runCommand({
            command: "stop",
            ids: ["id-a", "id-b", "id-c"],
            direction: null,
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 1,
            gap: null,
            usable: null,
            nonce: "cmd-stop-ok",
        });
        const call = h.dbus[0] as DbusCall;
        const payload = payloadOf(call);
        call.callback(
            stopReply(payload, 1, { action: "close-disposable", ids: ["id-a", "id-b", "id-c"], revision: 1 }),
        );
        assert.deepEqual([...h.closedIds].sort(), ["id-a", "id-b", "id-c"]);
        assert.ok(
            h.logs.some((line) => line.includes("poc3-command-done:cmd-stop-ok:poc3-stopped:close-disposable")),
        );
    });

    it("settles done when scope revalidation fails", () => {
        const h = harness3();
        h.adapter.runCommand({
            command: "focus",
            ids: ["id-a", "id-b", "id-x"],
            direction: "right",
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 1,
            gap: null,
            usable: null,
            nonce: "cmd-bad",
        });
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-unknown-id")));
        assert.ok(h.logs.some((line) => line.includes("poc3-command-done:cmd-bad:poc3-unknown-id")));
    });

    it("parses embedded configs strictly with unknown fields denied", () => {
        assert.ok(
            parseCommandConfig({
                command: "start",
                ids: ["id-a", "id-b", "id-c"],
                direction: null,
                owner: "owner-1",
                generation: "gen-1",
                expected_revision: 0,
                gap: 8,
                usable: null,
                nonce: "n-1",
            }) !== null,
        );
        assert.equal(
            parseCommandConfig({
                command: "status",
                ids: null,
                direction: null,
                owner: "owner-1",
                generation: "gen-1",
                expected_revision: 0,
                gap: null,
                usable: null,
                nonce: "n-1",
            })?.command,
            "status",
        );
        for (const bad of [
            { command: "start", ids: ["id-a", "id-b", "id-c"], direction: null, owner: "owner-1", generation: "gen-1", expected_revision: 0, gap: 8, usable: null, nonce: "n-1", extra: 1 },
            { command: "focus", ids: ["id-a", "id-b", "id-c"], direction: "right", owner: "owner-1", generation: "BAD", expected_revision: 1, gap: null, usable: null, nonce: "n-1" },
            { command: "stop", ids: ["id-a", "id-b", "id-c"], direction: null, owner: "owner-1", generation: "gen-1", expected_revision: 1000001, gap: null, usable: null, nonce: "n-1" },
        ]) {
            assert.equal(parseCommandConfig(bad), null);
        }
    });

    it("rejects an unparseable direction without a done diagnostic", () => {
        const h = harness3();
        h.adapter.runCommand({
            command: "focus",
            ids: ["id-a", "id-b", "id-c"],
            direction: "diagonal",
            owner: TOKEN.owner,
            generation: TOKEN.generation,
            expected_revision: 1,
            gap: null,
            usable: null,
            nonce: "cmd-bad",
        });
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((line) => line.includes("poc3-invalid-command")));
        assert.ok(!h.logs.some((line) => line.includes("poc3-command-done")));
    });
});
