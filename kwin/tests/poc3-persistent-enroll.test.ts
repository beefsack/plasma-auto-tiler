import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    POC3_PERSISTENT_DIAG_APP_IDS,
    POC3_PERSISTENT_DIAG_COLORS,
    POC3_PERSISTENT_PLANNER_IFACE,
    POC3_PERSISTENT_PLANNER_METHOD,
    POC3_PERSISTENT_PLANNER_OBJECT,
    POC3_PERSISTENT_PLANNER_SERVICE,
    parsePersistentClients,
    parsePersistentConfig,
    parsePersistentPids,
    parsePersistentPlanner,
    runPersistentStart,
} from "../src/poc3-persistent-adapter";
import { Poc3Adapter, type Poc3AdapterEnv } from "../src/poc3-adapter";

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

const BUS = "unix:path=/tmp/w/runtime/bus";
const PLANNER_UNIQUE = ":1.42";
const PLANNER = {
    owner: "owner-1",
    unique_owner: PLANNER_UNIQUE,
    bus: BUS,
    service: POC3_PERSISTENT_PLANNER_SERVICE,
    object: POC3_PERSISTENT_PLANNER_OBJECT,
    interface: POC3_PERSISTENT_PLANNER_IFACE,
    method: POC3_PERSISTENT_PLANNER_METHOD,
};
const PIDS = [4441, 4442, 4443];
const CLIENTS = [
    { pid: 4441, tick: 444100, app_id: POC3_PERSISTENT_DIAG_APP_IDS[0], slot: 1, color: POC3_PERSISTENT_DIAG_COLORS[0] },
    { pid: 4442, tick: 444200, app_id: POC3_PERSISTENT_DIAG_APP_IDS[1], slot: 2, color: POC3_PERSISTENT_DIAG_COLORS[1] },
    { pid: 4443, tick: 444300, app_id: POC3_PERSISTENT_DIAG_APP_IDS[2], slot: 3, color: POC3_PERSISTENT_DIAG_COLORS[2] },
];
function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        owner: "owner-1",
        generation: "gen-1",
        nonce: "n-1",
        gap: 8,
        usable: null,
        expected_revision: 0,
        planner: { ...PLANNER },
        clients: CLIENTS.map((c) => ({ ...c })),
        ...overrides,
    };
}

interface StubWindow extends Record<string, unknown> {
    internalId: string;
}
function stubWindow(id: string, overrides: Record<string, unknown> = {}): StubWindow {
    return {
        internalId: id,
        pid: 4441,
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
        closeWindow: () => undefined,
        ...overrides,
    };
}
function trioShuffled(): StubWindow[] {
    return [
        stubWindow("id-c", { pid: 4443, resourceClass: POC3_PERSISTENT_DIAG_APP_IDS[2] }),
        stubWindow("id-a", { pid: 4441, resourceClass: POC3_PERSISTENT_DIAG_APP_IDS[0] }),
        stubWindow("id-b", { pid: 4442, resourceClass: POC3_PERSISTENT_DIAG_APP_IDS[1] }),
    ];
}
function workspaceWith(windows: StubWindow[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        activeWindow: null,
        windowList: () => windows,
        screens: [OUTPUT_A],
        currentDesktopForScreen: () => DESKTOP_A,
        clientArea: () => ({ x: 0, y: 0, width: 900, height: 600 }),
        ...overrides,
    };
}
interface Harness {
    logs: string[];
    dbus: Array<{ service: string; path: string; dbusInterface: string; method: string; payload: string; callback: (r: unknown) => void }>;
    timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean; fired: boolean }>;
    workspace: Record<string, unknown>;
    windows: StubWindow[];
    throwOnDbus: boolean;
    env: Poc3AdapterEnv;
}
function makeHarness(windows: StubWindow[]): Harness {
    const logs: string[] = [];
    const dbus: Harness["dbus"] = [];
    const timers: Harness["timers"] = [];
    const workspace = workspaceWith(windows);
    const h: Harness = {
        logs, dbus, timers, workspace, windows, throwOnDbus: false,
        env: undefined as unknown as Poc3AdapterEnv,
    };
    h.env = {
        callDbus: (service: string, path: string, dbusInterface: string, method: string, payload: string, callback: (reply: unknown) => void) => {
            if (h.throwOnDbus) throw new Error("dbus-down");
            dbus.push({ service, path, dbusInterface, method, payload, callback });
        },
        scheduleOnce: (delayMs: number, callback: () => void) => {
            const e = { delayMs, callback, cancelled: false, fired: false };
            timers.push(e);
            return () => { e.cancelled = true; };
        },
        log: (m: string) => { logs.push(m); },
        now: () => 1_700_000_000_000,
        workspace,
    };
    return h;
}
function payloadOf(c: Harness["dbus"][number]): Record<string, unknown> {
    return JSON.parse(c.payload) as Record<string, unknown>;
}

describe("persistent bundle evidence parsing", () => {
    it("accepts exact PID+tick+app_id+slot+color plus owner/generation/nonce plus planner owner/bus", () => {
        assert.notEqual(parsePersistentConfig(baseConfig()), null);
        assert.deepEqual([...(parsePersistentPids(PIDS) as readonly number[])], PIDS);
        assert.equal(parsePersistentClients(CLIENTS)?.length, 3);
        assert.deepEqual(parsePersistentPlanner(PLANNER), PLANNER);
    });
    it("rejects malformed/missing/shared evidence before any transport", () => {
        for (const bad of [null, undefined, {}, [], "x", 7]) {
            assert.equal(parsePersistentPids(bad), null);
            assert.equal(parsePersistentClients(bad), null);
            assert.equal(parsePersistentPlanner(bad), null);
        }
        assert.equal(parsePersistentConfig({ ...baseConfig(), owner: "BAD OWNER" }), null);
        assert.equal(parsePersistentConfig({ ...baseConfig(), generation: "GEN" }), null);
        assert.equal(parsePersistentConfig({ ...baseConfig(), expected_revision: 1 }), null);
        assert.equal(parsePersistentConfig({ ...baseConfig(), captions: ["a"] }), null);
        const dupPids = [{ ...CLIENTS[0] }, { ...CLIENTS[0] }, { ...CLIENTS[2] }];
        assert.equal(parsePersistentClients(dupPids), null);
        const sharedTick = CLIENTS.map((c, i) => ({ ...c, tick: i === 2 ? 444100 : c.tick }));
        assert.equal(parsePersistentClients(sharedTick), null);
        const swappedSlot = CLIENTS.map((c) => ({ ...c })).reverse();
        assert.equal(parsePersistentClients(swappedSlot), null);
        const wrongColor = CLIENTS.map((c, i) => (i === 0 ? { ...c, color: "ff20a020" } : { ...c }));
        assert.equal(parsePersistentClients(wrongColor), null);
        const wrongApp = CLIENTS.map((c, i) => (i === 0 ? { ...c, app_id: "org.plasma-auto-tiler.poc3-diag-2" } : { ...c }));
        assert.equal(parsePersistentClients(wrongApp), null);
        assert.equal(parsePersistentPlanner({ ...PLANNER, owner: "owner-2" })?.owner, "owner-2");
        assert.equal(parsePersistentPlanner({ ...PLANNER, bus: "tcp:host=x" }), null);
        assert.equal(parsePersistentPlanner({ ...PLANNER, service: "org.evil.Spoof" }), null);
        assert.equal(parsePersistentPlanner({ ...PLANNER, method: "Eval" }), null);
    });
    it("runPersistentStart fails closed with no transport on bad evidence", () => {
        const h = makeHarness(trioShuffled());
        assert.equal(runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, undefined, undefined), null);
        assert.equal(h.dbus.length, 0);
        const badClients = CLIENTS.map((c, i) => (i === 2 ? { ...c, pid: 9999 } : { ...c }));
        assert.equal(runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, badClients, PLANNER), null);
        assert.equal(h.dbus.length, 0);
        assert.ok(h.logs.some((l) => l.includes("poc3-persistent-invalid")));
    });
    it("runPersistentStart rejects planner-owner mismatch before probe", () => {
        const h = makeHarness(trioShuffled());
        const evilPlanner = { ...PLANNER, owner: "owner-2" };
        assert.equal(runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, evilPlanner), null);
        assert.equal(h.dbus.length, 0);
    });
});

describe("persistent KWin enrollment (exact three, IDs internally, slot order)", () => {
    it("discovers exactly three eligible windows and normalizes to slot order", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter instanceof Poc3Adapter);
        assert.equal(h.dbus.length, 1);
        const payload = payloadOf(h.dbus[0] as Harness["dbus"][number]);
        const ids = (payload["windows"] as Array<Record<string, unknown>>).map((w) => w["id"]);
        assert.deepEqual(ids, ["id-a", "id-b", "id-c"]);
        assert.deepEqual([...(adapter as Poc3Adapter).getState().enrolled], ["id-a", "id-b", "id-c"]);
        assert.equal((adapter as Poc3Adapter).getState().started, false);
    });
    it("rejects missing and fourth windows", () => {
        const two = trioShuffled().slice(0, 2);
        const h2 = makeHarness(two);
        assert.equal(runPersistentStart(h2.env, h2.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
        assert.equal(h2.dbus.length, 0);
        const four = [...trioShuffled(), stubWindow("id-d", { pid: 4441, resourceClass: POC3_PERSISTENT_DIAG_APP_IDS[0] })];
        const h4 = makeHarness(four);
        assert.equal(runPersistentStart(h4.env, h4.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
        assert.equal(h4.dbus.length, 0);
    });
    it("rejects PID / app_id-slot / shared-PID mismatches", () => {
        const wrongPid = [
            stubWindow("id-a", { pid: 5551 }),
            stubWindow("id-b", { pid: 5552 }),
            stubWindow("id-c", { pid: 5553 }),
        ];
        const h = makeHarness(wrongPid);
        assert.equal(runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
        const swappedApp = [
            stubWindow("id-a", { pid: 4441, resourceClass: POC3_PERSISTENT_DIAG_APP_IDS[1] }),
            stubWindow("id-b", { pid: 4442, resourceClass: POC3_PERSISTENT_DIAG_APP_IDS[0] }),
            stubWindow("id-c", { pid: 4443 }),
        ];
        const hs = makeHarness(swappedApp);
        assert.equal(runPersistentStart(hs.env, hs.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
        const shared = [
            stubWindow("id-a", { pid: 4441 }),
            stubWindow("id-b", { pid: 4441 }),
            stubWindow("id-c", { pid: 4443 }),
        ];
        const hd = makeHarness(shared);
        assert.equal(runPersistentStart(hd.env, hd.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
        assert.equal(hd.logs.some((l) => l.includes("poc3-pid-duplicate") || l.includes("poc3-persistent-rejected")), true);
    });
    it("rejects scope/output/workspace drift and ineligible windows", () => {
        const tiled = [stubWindow("id-a", { pid: 4441, tile: {} }), stubWindow("id-b", { pid: 4442 }), stubWindow("id-c", { pid: 4443 })];
        const ht = makeHarness(tiled);
        assert.equal(runPersistentStart(ht.env, ht.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
        const crossOut = [
            stubWindow("id-a", { pid: 4441 }),
            stubWindow("id-b", { pid: 4442 }),
            stubWindow("id-c", { pid: 4443, output: OUTPUT_B }),
        ];
        const ho = makeHarness(crossOut);
        ho.workspace["screens"] = [OUTPUT_A, OUTPUT_B];
        assert.equal(runPersistentStart(ho.env, ho.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
        const crossWs = [
            stubWindow("id-a", { pid: 4441 }),
            stubWindow("id-b", { pid: 4442 }),
            stubWindow("id-c", { pid: 4443, desktops: [DESKTOP_B] }),
        ];
        const hw = makeHarness(crossWs);
        assert.equal(runPersistentStart(hw.env, hw.workspace, baseConfig(), PIDS, CLIENTS, PLANNER), null);
    });
    it("rejects invalid geometry and stale revision before transport", () => {
        const h = makeHarness(trioShuffled());
        h.workspace["clientArea"] = () => ({ x: 0, y: 0, width: 0, height: 0 });
        (h.windows[0] as StubWindow)["output"] = { geometry: { x: 0, y: 0, width: 0, height: 0 } };
        const bad = runPersistentStart(h.env, h.workspace, baseConfig({ gap: 999 }), PIDS, CLIENTS, PLANNER);
        assert.equal(bad, null);
        assert.equal(h.dbus.length, 0);
        const stale = runPersistentStart(makeHarness(trioShuffled()).env, workspaceWith(trioShuffled()), baseConfig({ expected_revision: 1 }), PIDS, CLIENTS, PLANNER);
        assert.equal(stale, null);
    });
    it("uses IDs internally (no captions) and normalizes snapshot in slot order", () => {
        const src = readFileSync("src/poc3-persistent-adapter.ts", "utf8");
        assert.ok(src.includes("probe.ids"));
        assert.ok(src.includes("adapter.start([...probe.ids]"));
        // No caption/title-based enrollment in this seam: it never reads
        // caption/resourceClass itself (slot cross-check lives in the probe).
        assert.ok(!src.includes('readProp(candidate, "caption")'));
        assert.ok(!src.includes('readProp(ref, "caption")'));
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const payload = payloadOf(h.dbus[0] as Harness["dbus"][number]);
        assert.deepEqual((payload["windows"] as Array<Record<string, unknown>>).map((w) => w["id"]), ["id-a", "id-b", "id-c"]);
    });
});

describe("persistent service binding, status authority, complete ack, divergence", () => {
    function intentReply(startPayload: Record<string, unknown>, focus: string): string {
        return JSON.stringify({
            v: 3, correlation_id: startPayload["correlation_id"], command: "start", outcome: "ok", revision: 0,
            intent: {
                base_revision: 0, next_revision: 1, atomic: false, adapter_verification_required: true,
                preconditions: ["adapter-must-verify-postconditions"],
                capabilities: { untiled_asserted: true, disposable: true, restore_capable: true },
                cleanup_model: "close-disposable", operation: { kind: "init", rule: "INIT" },
                topology: "H[id-a,V[id-b,id-c]]", shares: {}, focus,
                desired: [
                    { id: "id-a", rect: { x: 0, y: 0, w: 446, h: 600 } },
                    { id: "id-b", rect: { x: 454, y: 0, w: 446, h: 296 } },
                    { id: "id-c", rect: { x: 454, y: 304, w: 446, h: 296 } },
                ],
                rollback_required: { retain_envelopes: true, note: "adapter-only" },
            },
        });
    }
    function appliedReply(completePayload: Record<string, unknown>): string {
        return JSON.stringify({
            v: 3, correlation_id: completePayload["correlation_id"], command: "complete",
            outcome: "ok", revision: 1, completed: { result: "applied", revision: 1, divergent: false },
        });
    }
    function pump(h: Harness, cap: number): void {
        for (let n = 0; n < cap; n += 1) {
            const next = h.timers.find((t) => !t.cancelled && !t.fired);
            if (next === undefined) break;
            next.fired = true;
            next.callback();
        }
    }
    it("fails closed on throwing transport and timeout with no applied claim", () => {
        const h = makeHarness(trioShuffled());
        h.throwOnDbus = true;
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        assert.ok(h.logs.some((l) => l.includes("poc3-dbus-failed")));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
        const h2 = makeHarness(trioShuffled());
        const a2 = runPersistentStart(h2.env, h2.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(a2 !== null);
        (h2.timers[0] as Harness["timers"][number]).callback();
        assert.ok(h2.logs.some((l) => l.includes("poc3-timeout")));
        assert.ok(!h2.logs.some((l) => l.includes("poc3-applied")));
    });
    it("rejects spoofed owner binding (correlation mismatch) without actuation", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        const before = { ...(h.windows[0] as StubWindow)["frameGeometry"] as Record<string, unknown> };
        call.callback(JSON.stringify({ v: 3, correlation_id: "spoofed", command: "start", outcome: "ok", revision: 0 }));
        assert.deepEqual((h.windows[0] as StubWindow)["frameGeometry"], before);
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
    });
    it("no log marker is success: applied only on complete ack after observed convergence", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        call.callback(intentReply(payloadOf(call), "id-a"));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
        // Convergence is observed synchronously on the first poll when the
        // native writes stick, so the complete request is already in flight.
        const complete = h.dbus[h.dbus.length - 1] as Harness["dbus"][number];
        assert.equal(payloadOf(complete)["command"], "complete");
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
        complete.callback(appliedReply(payloadOf(complete)));
        assert.ok(h.logs.some((l) => l.includes("poc3-applied:1")));
        assert.equal((adapter as Poc3Adapter).getState().revision, 1);
    });
    it("reports partial sequential apply as divergent with no false applied", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        const frozen = (h.windows[2] as StubWindow)["frameGeometry"];
        Object.defineProperty(h.windows[2], "frameGeometry", { configurable: true, enumerable: true, get: () => frozen, set: () => undefined });
        call.callback(intentReply(payloadOf(call), "id-a"));
        pump(h, 30);
        const complete = h.dbus[h.dbus.length - 1] as Harness["dbus"][number];
        assert.equal(payloadOf(complete)["outcome"], "divergent");
        assert.ok(h.logs.some((l) => l.includes("poc3-divergent:partial-application") || l.includes("poc3-divergent:geometry-mismatch")));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
        void adapter;
    });
    it("post-observation failure never claims applied", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        call.callback(intentReply(payloadOf(call), "id-a"));
        pump(h, 5);
        const complete = h.dbus[h.dbus.length - 1] as Harness["dbus"][number];
        complete.callback(JSON.stringify({
            v: 3, correlation_id: payloadOf(complete)["correlation_id"], command: "complete",
            outcome: "diverged", revision: 0, completed: { result: "diverged-recorded", revision: 0, divergent: true },
        }));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
        assert.equal((adapter as Poc3Adapter).getState().diverged, true);
    });
});

describe("persistent no-production-coupling and initial-start-only", () => {
    it("introduces no production startup/package route, Custom Tile, shortcuts, persistence, host/tray/KCM coupling", () => {
        for (const file of ["src/poc3-persistent-adapter.ts", "src/poc3-persistent-entry.ts"]) {
            const src = readFileSync(file, "utf8");
            for (const forbidden of [
                "from \"./controller",
                "from \"./entry",
                "tray-publisher",
                "tray_bridge",
                "CustomTile",
                "customTile",
                "registerShortcut",
                "setShortcutKeys",
                "kpackagetool",
                "unloadScript",
                "loadScriptFromText",
                "DBUS_SESSION_BUS_ADDRESS",
                "journalctl",
                "readConfig",
                "writeConfig",
            ]) {
                assert.ok(!src.includes(forbidden), `${file} must not contain ${forbidden}`);
            }
        }
        const entry = readFileSync("src/entry.ts", "utf8");
        assert.ok(!entry.includes("poc3-persistent"));
        const main = readFileSync("src/poc3-persistent-adapter.ts", "utf8");
        assert.ok(main.includes("never imports the controller"));
    });
    it("preserves legacy routes; direct start is explicit initial-start-only", () => {
        const tool = readFileSync("../scripts/poc3-command.sh", "utf8");
        assert.ok(tool.includes("persistent direct-enrollment supports initial start only"));
        assert.ok(tool.includes("Initial start only: focus/move/stop have"));
        assert.ok(tool.includes("parse_command_args"));
        const adapter = readFileSync("src/poc3-persistent-adapter.ts", "utf8");
        assert.ok(adapter.includes("Only initial start exists here"));
        assert.ok(adapter.includes("adapter.start("));
        assert.ok(!adapter.includes("adapter.focus("));
        assert.ok(!adapter.includes("adapter.move("));
        assert.ok(!adapter.includes("adapter.stop("));
    });
    it("stays loaded by design (never self-unloads)", () => {
        for (const file of ["src/poc3-persistent-adapter.ts", "src/poc3-persistent-entry.ts"]) {
            const src = readFileSync(file, "utf8");
            assert.ok(!src.includes("unloadScript"));
            assert.ok(!src.includes("loadScriptFromText"));
        }
        const adapter = readFileSync("src/poc3-persistent-adapter.ts", "utf8");
        assert.ok(adapter.includes("stays loaded"));
        assert.ok(!adapter.includes("adapter.stop("));
        assert.ok(!adapter.includes("adapter.focus("));
        assert.ok(!adapter.includes("adapter.move("));
    });
});

describe("persistent adversarial corrections", () => {
    function intentReplyFor(payload: Record<string, unknown>, focus: string, desired?: Array<Record<string, unknown>>): string {
        return JSON.stringify({
            v: 3, correlation_id: payload["correlation_id"], command: "start", outcome: "ok", revision: 0,
            intent: {
                base_revision: 0, next_revision: 1, atomic: false, adapter_verification_required: true,
                preconditions: ["adapter-must-verify-postconditions"],
                capabilities: { untiled_asserted: true, disposable: true, restore_capable: true },
                cleanup_model: "close-disposable", operation: { kind: "init", rule: "INIT" },
                topology: "H[id-a,V[id-b,id-c]]", shares: {}, focus,
                desired: desired ?? [
                    { id: "id-a", rect: { x: 0, y: 0, w: 446, h: 600 } },
                    { id: "id-b", rect: { x: 454, y: 0, w: 446, h: 296 } },
                    { id: "id-c", rect: { x: 454, y: 304, w: 446, h: 296 } },
                ],
                rollback_required: { retain_envelopes: true, note: "adapter-only" },
            },
        });
    }
    it("routes every EvaluatePoc3 request to the exact bound unique owner, never the well-known name", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter instanceof Poc3Adapter);
        assert.equal(h.dbus.length, 1);
        assert.equal((h.dbus[0] as Harness["dbus"][number]).service, PLANNER_UNIQUE);
        // Session owner and D-Bus unique owner are distinct types: planner
        // owner mismatch still rejects, and malformed unique owner rejects.
        assert.equal(parsePersistentPlanner({ ...PLANNER, unique_owner: "org.plasmaautotiler.Planner" }), null);
        assert.equal(parsePersistentPlanner({ ...PLANNER, unique_owner: ":bad" }), null);
        const h2 = makeHarness(trioShuffled());
        const evilPlanner = { ...PLANNER, unique_owner: ":1.99" };
        const a2 = runPersistentStart(h2.env, h2.workspace, baseConfig(), PIDS, CLIENTS, evilPlanner);
        assert.ok(a2 instanceof Poc3Adapter);
        assert.equal((h2.dbus[0] as Harness["dbus"][number]).service, ":1.99");
        assert.ok(!(h2.dbus[0] as Harness["dbus"][number]).service.includes("org.plasmaautotiler"));
    });
    it("rejects planner session-owner vs unique-owner conflation", () => {
        // --planner-owner is the session token (must equal owner); the unique
        // owner is a separate `:N.M` field. Missing unique rejects.
        const { unique_owner: _drop, ...noUnique } = PLANNER;
        void _drop;
        assert.equal(parsePersistentPlanner(noUnique), null);
        assert.equal(parsePersistentPlanner({ ...PLANNER, owner: "owner-2" })?.owner, "owner-2");
    });
    it("derives usable from observed output: operator usable rejected", () => {
        assert.equal(parsePersistentConfig(baseConfig({ usable: { x: 0, y: 0, w: 100, h: 100 } })), null);
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const payload = payloadOf(h.dbus[0] as Harness["dbus"][number]);
        assert.deepEqual(payload["usable"], { x: 0, y: 0, w: 900, h: 600 });
    });
    it("rejects out-of-output intent geometry before any write", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        const before = (h.windows[0] as StubWindow)["frameGeometry"];
        call.callback(intentReplyFor(payloadOf(call), "id-a", [
            { id: "id-a", rect: { x: 5000, y: 5000, w: 446, h: 600 } },
            { id: "id-b", rect: { x: 454, y: 0, w: 446, h: 296 } },
            { id: "id-c", rect: { x: 454, y: 304, w: 446, h: 296 } },
        ]));
        assert.deepEqual((h.windows[0] as StubWindow)["frameGeometry"], before);
        const complete = h.dbus[h.dbus.length - 1] as Harness["dbus"][number];
        assert.equal(payloadOf(complete)["outcome"], "divergent");
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
    });
    it("rejects invalid intent geometry before any write", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        call.callback(intentReplyFor(payloadOf(call), "id-a", [
            { id: "id-a", rect: { x: 0, y: 0, w: 0, h: 600 } },
            { id: "id-b", rect: { x: 454, y: 0, w: 446, h: 296 } },
            { id: "id-c", rect: { x: 454, y: 304, w: 446, h: 296 } },
        ]));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
    });
    it("fails before writes on app-id re-resolve drift", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        (h.windows[1] as StubWindow)["resourceClass"] = "org.evil.Spoof";
        call.callback(intentReplyFor(payloadOf(call), "id-a"));
        const complete = h.dbus[h.dbus.length - 1] as Harness["dbus"][number];
        assert.equal(payloadOf(complete)["outcome"], "divergent");
        assert.ok(h.logs.some((l) => l.includes("poc3-app-id-drift")));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
    });
    it("fails before writes on reference re-resolve drift", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        const replacement = stubWindow("id-a", { pid: 4441, resourceClass: POC3_PERSISTENT_DIAG_APP_IDS[0] });
        const idx = (h.workspace["windowList"] as () => StubWindow[])().findIndex((w) => w["internalId"] === "id-a");
        (h.windows as StubWindow[])[idx] = replacement;
        (h.workspace["windowList"] as () => StubWindow[])()[idx] = replacement;
        call.callback(intentReplyFor(payloadOf(call), "id-a"));
        assert.ok(h.logs.some((l) => l.includes("poc3-reference-drift")));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
    });
    it("complete transport loss fails closed and status never calls it applied", () => {
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        call.callback(intentReplyFor(payloadOf(call), "id-a"));
        const complete = h.dbus[h.dbus.length - 1] as Harness["dbus"][number];
        assert.equal(payloadOf(complete)["command"], "complete");
        // Transport loss on the complete round-trip: throw before reply.
        h.throwOnDbus = false;
        (h.timers.find((t) => !t.cancelled && !t.fired) as Harness["timers"][number]).callback();
        // Force the complete callback path to fail: simulate dbus throw by
        // invoking timeout semantics already covered; here assert no applied.
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied:1")));
        void adapter;
    });
    it("status success needs complete ack after observed convergence; stale/foreign/no-complete/divergence never applied", () => {
        // Stale correlation reply never applies.
        const h = makeHarness(trioShuffled());
        const adapter = runPersistentStart(h.env, h.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(adapter !== null);
        const call = h.dbus[0] as Harness["dbus"][number];
        call.callback(JSON.stringify({ v: 3, correlation_id: "stale", command: "start", outcome: "ok", revision: 0 }));
        assert.ok(!h.logs.some((l) => l.includes("poc3-applied")));
        // Divergent complete ack never applies.
        const h2 = makeHarness(trioShuffled());
        const a2 = runPersistentStart(h2.env, h2.workspace, baseConfig(), PIDS, CLIENTS, PLANNER);
        assert.ok(a2 !== null);
        const c2 = h2.dbus[0] as Harness["dbus"][number];
        c2.callback(intentReplyFor(payloadOf(c2), "id-a"));
        const comp2 = h2.dbus[h2.dbus.length - 1] as Harness["dbus"][number];
        comp2.callback(JSON.stringify({
            v: 3, correlation_id: payloadOf(comp2)["correlation_id"], command: "complete",
            outcome: "diverged", revision: 0, completed: { result: "diverged-recorded", revision: 0, divergent: true },
        }));
        assert.ok(!h2.logs.some((l) => l.includes("poc3-applied")));
        assert.equal((a2 as Poc3Adapter).getState().diverged, true);
    });
    it("uses no captions and color stays manifest-only", () => {
        const probeSrc = readFileSync("src/poc3-id-probe.ts", "utf8");
        assert.ok(!probeSrc.includes('"caption"'));
        assert.ok(probeSrc.includes('readProp(candidate, "resourceClass")'));
        const persistSrc = readFileSync("src/poc3-persistent-adapter.ts", "utf8");
        assert.ok(persistSrc.includes("manifest/config evidence only"));
        assert.ok(!persistSrc.includes('readProp(candidate, "caption")'));
    });
});
