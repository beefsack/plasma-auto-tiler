import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
    POINTER_RESIZE_CONTRACT_VERSION,
    POINTER_RESIZE_DBUS_INTERFACE,
    POINTER_RESIZE_DBUS_OBJECT,
    POINTER_RESIZE_DBUS_SERVICE,
    POINTER_RESIZE_GET_OWNER_METHOD,
    POINTER_RESIZE_INTERFACE,
    POINTER_RESIZE_METHOD,
    POINTER_RESIZE_OBJECT,
    POINTER_RESIZE_SERVICE,
    POINTER_RESIZE_START_ALREADY,
    POINTER_RESIZE_START_FLAGS,
    POINTER_RESIZE_START_METHOD,
    POINTER_RESIZE_START_PRIMARY,
    PointerResizeAdapter,
    PointerResizeEnv,
    PointerResizeObserved,
    PointerResizeRect,
    derivePointerEdge,
    normalizePointerRect,
    orderPointerWrites,
    pointerResizeFingerprint,
} from "../src/pointer-resize-adapter";
import { startPointerResizeAdapterEntry } from "../src/pointer-resize-adapter-entry";
import { resizeFingerprint } from "../src/resize-adapter";

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

interface WinState {
    readonly id: string;
    readonly ref: object;
    rect: PointerResizeRect;
    readonly output: string;
    readonly workspace: string;
    move: boolean;
    resize: boolean;
}

interface Mocks {
    readonly dbusCalls: Array<{ service: string; path: string; iface: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly geometryWrites: Array<{ id: string; rect: PointerResizeRect }>;
    focusWrites: number;
    wins: WinState[];
    activeId: string;
    domainOutput: string;
    domainWorkspace: string;
    domainBounds: PointerResizeRect;
    authorityImpl: () => boolean;
    revalidateImpl: () => boolean;
    failGeometry: boolean;
    throwDbus: boolean;
    afterWrite: (() => void) | null;
    env: PointerResizeEnv;
}

function buildObserved(mocks: Mocks): PointerResizeObserved {
    const sorted = [...mocks.wins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const activeRef = sorted.find((w) => w.id === mocks.activeId)?.ref ?? null;
    const snap = sorted.map((w) => ({ id: w.id, ref: w.ref, rect: { ...w.rect } }));
    const fingerprint = String(
        pointerResizeFingerprint(
            mocks.domainOutput,
            mocks.domainWorkspace,
            mocks.activeId,
            sorted.map((w) => w.id),
        ),
    );
    const windows = Object.freeze(
        sorted.map((w) =>
            Object.freeze({ id: w.id, ref: w.ref, rect: Object.freeze({ ...w.rect }), output: w.output, workspace: w.workspace }),
        ),
    );
    return {
        domainOutput: mocks.domainOutput,
        domainWorkspace: mocks.domainWorkspace,
        domainBounds: Object.freeze({ ...mocks.domainBounds }),
        domainGap: 0,
        domainOuterGap: 0,
        focusedId: mocks.activeId,
        windows,
        activeRef,
        fingerprint,
        revalidate: (sourceId: string): boolean => {
            if (!mocks.revalidateImpl()) {
                return false;
            }
            const live = [...mocks.wins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            const liveFp = String(
                pointerResizeFingerprint(
                    mocks.domainOutput,
                    mocks.domainWorkspace,
                    mocks.activeId,
                    live.map((w) => w.id),
                ),
            );
            if (liveFp !== fingerprint) {
                return false;
            }
            if ((live.find((w) => w.id === mocks.activeId)?.ref ?? null) !== activeRef) {
                return false;
            }
            if (live.length !== snap.length) {
                return false;
            }
            for (const entry of snap) {
                const current = live.find((w) => w.id === entry.id);
                if (current === undefined || current.ref !== entry.ref) {
                    return false;
                }
                if (entry.id === sourceId) {
                    continue;
                }
                if (
                    current.rect.x !== entry.rect.x ||
                    current.rect.y !== entry.rect.y ||
                    current.rect.w !== entry.rect.w ||
                    current.rect.h !== entry.rect.h
                ) {
                    return false;
                }
            }
            return true;
        },
    };
}

function mockEnvTwoWindow(): Mocks {
    const a: object = {};
    const b: object = {};
    const state = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
        geometryWrites: [],
        focusWrites: 0,
        wins: [
            { id: "win-a", ref: a, rect: { x: 0, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1", move: false, resize: false },
            { id: "win-b", ref: b, rect: { x: 960, y: 0, w: 960, h: 1080 }, output: "out-1", workspace: "ws-1", move: false, resize: false },
        ] as WinState[],
        activeId: "win-a",
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1920, h: 1080 },
        authorityImpl: () => true,
        revalidateImpl: () => true,
        failGeometry: false,
        throwDbus: false,
        afterWrite: null,
    } as unknown as Mocks;
    const env: PointerResizeEnv = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            if (state.throwDbus) {
                throw new Error("dbus down");
            }
            state.dbusCalls.push({ service, path, iface, method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            void delayMs;
            const entry = { callback, cancelled: false };
            state.timers.push(entry);
            return (): void => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            state.logs.push(message);
        },
        observe: (): PointerResizeObserved | null => buildObserved(state),
        setGeometry: (target, rect): boolean => {
            if (state.failGeometry) {
                return false;
            }
            const hit = state.wins.find((w) => w.ref === target);
            if (hit === undefined) {
                return false;
            }
            hit.rect = { ...rect };
            state.geometryWrites.push({ id: hit.id, rect: { ...rect } });
            const hook = state.afterWrite;
            state.afterWrite = null;
            if (hook !== null) {
                hook();
            }
            return true;
        },
        active: (): object | null => state.wins.find((w) => w.id === state.activeId)?.ref ?? null,
        hasExclusiveResizeAuthority: (): boolean => state.authorityImpl(),
        readLiveState: (target): { move: boolean; resize: boolean } | null => {
            const hit = state.wins.find((w) => w.ref === target);
            if (hit === undefined) {
                return null;
            }
            return { move: hit.move, resize: hit.resize };
        },
    };
    (state as { env: PointerResizeEnv }).env = env;
    return state;
}

function refOf(mocks: Mocks, id: string): object {
    const hit = mocks.wins.find((w) => w.id === id);
    assert.ok(hit !== undefined);
    return hit.ref;
}

function setFlags(mocks: Mocks, id: string, move: boolean, resize: boolean): void {
    const hit = mocks.wins.find((w) => w.id === id);
    assert.ok(hit !== undefined);
    hit.move = move;
    hit.resize = resize;
}

function enableAdapter(mocks: Mocks): PointerResizeAdapter {
    const adapter = new PointerResizeAdapter(mocks.env);
    assert.equal(adapter.isEnabled, false);
    assert.equal(adapter.hasGesture, false);
    const ok = adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
    assert.equal(ok, true);
    return adapter;
}

function beginResize(mocks: Mocks, adapter: PointerResizeAdapter, id = "win-a"): void {
    setFlags(mocks, id, false, true);
    adapter.windowStarted(refOf(mocks, id));
}

function payloadOf(mocks: Mocks, index: number): Record<string, unknown> {
    const call = mocks.dbusCalls[index] as { payload: string };
    assert.ok(call !== undefined);
    return JSON.parse(call.payload) as Record<string, unknown>;
}

function requestPayloads(mocks: Mocks): Array<Record<string, unknown>> {
    return mocks.dbusCalls
        .filter((call) => call.method === POINTER_RESIZE_METHOD)
        .map((call) => JSON.parse(call.payload) as Record<string, unknown>)
        .filter((payload) => payload["action"] === "request-pointer");
}

const PINNED_OWNER = ":1.42";

// Drives the initial GetNameOwner phase with a present unique owner, so the
// next D-Bus call is the pinned planner request with no service activation.
function driveOwnerPresent(mocks: Mocks, owner: string = PINNED_OWNER): void {
    assert.ok(mocks.callbacks[0] !== undefined);
    mocks.callbacks[0]?.(owner);
}

// Drives the latest pending GetNameOwner phase (for flights after the first).
function driveLatestOwner(mocks: Mocks, owner: string = PINNED_OWNER): void {
    const index = mocks.callbacks.length - 1;
    assert.ok(mocks.callbacks[index] !== undefined);
    mocks.callbacks[index]?.(owner);
}

function stepPayload(rect: PointerResizeRect): Record<string, unknown> {
    return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
}

function nativeApplySource(mocks: Mocks, id: string, rect: PointerResizeRect): void {
    const hit = mocks.wins.find((w) => w.id === id);
    assert.ok(hit !== undefined);
    hit.rect = { ...rect };
}

function resizedGeometry(boundary = 1000): Array<Record<string, unknown>> {
    return [
        { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: boundary, h: 1080 } },
        { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: boundary, y: 0, w: 1920 - boundary, h: 1080 } },
    ];
}

function pointerOperation(direction = "right", mode = "outwards"): Record<string, unknown> {
    return {
        kind: "ResizeSplitShare",
        domain_output: "out-1",
        domain_workspace: "ws-1",
        focused_leaf: "leaf-a",
        focused_window: "win-a",
        direction,
        mode,
        target_group: "group-1",
        focused_child: "leaf-a",
        neighbor_child: "leaf-b",
        focused_index: 0,
        neighbor_index: 1,
        old_shares: [8, 8],
        new_shares: [9, 7],
    };
}

function plannedReply(
    correlation: string,
    baseRevision: number,
    geometry: Array<Record<string, unknown>> = resizedGeometry(),
    direction = "right",
): string {
    return JSON.stringify({
        v: POINTER_RESIZE_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: baseRevision,
        capability: "pointer-resize",
        preconditions: [
            "focused-leaf-occupied-by-focused-window",
            "target-boundary-valid",
            "resize-targets-same-domain",
            "adapter-must-verify-postconditions",
        ],
        operation: pointerOperation(direction),
        desired_geometry: geometry,
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-a" },
    });
}

function ackReply(correlation: string, baseRevision: number): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "acknowledged", base_revision: baseRevision });
}

function committedReply(correlation: string, revision: number): string {
    return JSON.stringify({ v: 1, correlation_id: correlation, outcome: "committed", revision });
}

function driveFullCycle(mocks: Mocks, callIndex: number, boundary = 1000): string {
    const payload = payloadOf(mocks, callIndex);
    const correlation = payload["correlation_id"] as string;
    const revision = payload["revision"] as number;
    const onRequest = mocks.callbacks[callIndex] as (reply: unknown) => void;
    onRequest(plannedReply(correlation, revision, resizedGeometry(boundary)));
    const onAck = mocks.callbacks[callIndex + 1] as (reply: unknown) => void;
    onAck(ackReply(correlation, revision));
    const onVerify = mocks.callbacks[callIndex + 2] as (reply: unknown) => void;
    onVerify(committedReply(correlation, revision + 1));
    return correlation;
}

describe("pointer resize adapter", () => {
    it("is disabled by default and rejects gestures while disabled", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = new PointerResizeAdapter(mocks.env);
        assert.equal(adapter.isEnabled, false);
        assert.equal(adapter.isInFlight, false);
        adapter.windowStarted(refOf(mocks, "win-a"));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-disabled")));
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("enable requires owner/generation/revision auth", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = new PointerResizeAdapter(mocks.env);
        assert.equal(adapter.enable({ owner: "", generation: "gen-1" }), false);
        assert.ok(mocks.logs.some((line) => line.includes("pointer-invalid-auth")));
        assert.equal(adapter.enable({ owner: "owner-1", generation: "BAD GEN" }), false);
        assert.equal(adapter.isEnabled, false);
    });

    it("captures a resize gesture from public move/resize state", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        assert.equal(adapter.hasGesture, true);
        assert.ok(mocks.logs.some((line) => line.endsWith(":started")));
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("ignores pure interactive moves without requests or writes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        setFlags(mocks, "win-a", true, false);
        adapter.windowStarted(refOf(mocks, "win-a"));
        assert.ok(mocks.logs.some((line) => line.endsWith(":move-ignored")));
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 100, y: 100, w: 960, h: 1080 }));
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 200, y: 200, w: 960, h: 1080 }));
        adapter.windowFinished(refOf(mocks, "win-a"));
        assert.ok(mocks.logs.some((line) => line.endsWith(":move-finished")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.deepEqual(mocks.wins.map((w) => w.rect), [
            { x: 0, y: 0, w: 960, h: 1080 },
            { x: 960, y: 0, w: 960, h: 1080 },
        ]);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.hasGesture, false);
    });

    it("fails closed on mixed, idle, and unknown start identity", () => {
        for (const flags of [{ move: true, resize: true }, { move: false, resize: false }]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            setFlags(mocks, "win-a", flags.move, flags.resize);
            adapter.windowStarted(refOf(mocks, "win-a"));
            assert.ok(mocks.logs.some((line) => line.includes("pointer-mixed-gesture")));
            assert.equal(adapter.isEnabled, false);
        }
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        adapter.windowStarted({});
        assert.ok(mocks.logs.some((line) => line.includes("pointer-unknown-window")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on a second concurrent start", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        setFlags(mocks, "win-b", false, true);
        adapter.windowStarted(refOf(mocks, "win-b"));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-gesture-conflict")));
        assert.equal(adapter.isEnabled, false);
    });

    it("rejects exclusive-authority loss at start before dispatch", () => {
        const mocks = mockEnvTwoWindow();
        mocks.authorityImpl = () => false;
        const adapter = enableAdapter(mocks);
        setFlags(mocks, "win-a", false, true);
        adapter.windowStarted(refOf(mocks, "win-a"));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-exclusive-conflict")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("derives single edges, boundaries, and rejects mixed motion", () => {
        const start: PointerResizeRect = { x: 0, y: 0, w: 960, h: 1080 };
        assert.deepEqual(derivePointerEdge(start, { x: 0, y: 0, w: 960, h: 1080 }), null);
        assert.deepEqual(derivePointerEdge(start, { x: -40, y: 0, w: 1000, h: 1080 }), { direction: "left", boundary: -40 });
        assert.deepEqual(derivePointerEdge(start, { x: 0, y: 0, w: 1000, h: 1080 }), { direction: "right", boundary: 1000 });
        assert.deepEqual(derivePointerEdge(start, { x: 0, y: -20, w: 960, h: 1100 }), { direction: "up", boundary: -20 });
        assert.deepEqual(derivePointerEdge(start, { x: 0, y: 0, w: 960, h: 900 }), { direction: "down", boundary: 900 });
        assert.deepEqual(derivePointerEdge(start, { x: 100, y: 0, w: 860, h: 1080 }), { direction: "left", boundary: 100 });
        assert.equal(derivePointerEdge(start, { x: 100, y: 0, w: 960, h: 1080 }), "mixed");
        assert.equal(derivePointerEdge(start, { x: -10, y: -10, w: 1000, h: 1100 }), "mixed");
        assert.deepEqual(normalizePointerRect({ x: 0.4, y: 0, width: 999.6, height: 1080 }), { x: 0, y: 0, w: 1000, h: 1080 });
        assert.deepEqual(normalizePointerRect({ x: 0, y: 0, w: 1000, h: 1080 }), { x: 0, y: 0, w: 1000, h: 1080 });
        assert.equal(normalizePointerRect(null), null);
        assert.equal(normalizePointerRect({ x: 0, y: 0, w: 0, h: 1080 }), null);
    });

    it("sends request-pointer with proposed boundary only over DescribePointerResize", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        // Live frame geometry lags the proposal: the request still carries
        // the payload-derived boundary.
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.equal(adapter.isInFlight, true);
        assert.equal(mocks.dbusCalls.length, 1);
        const ownerCall = mocks.dbusCalls[0] as { service: string; method: string; payload: string };
        assert.equal(ownerCall.service, POINTER_RESIZE_DBUS_SERVICE);
        assert.equal(ownerCall.method, POINTER_RESIZE_GET_OWNER_METHOD);
        assert.equal(ownerCall.payload, POINTER_RESIZE_SERVICE);
        driveOwnerPresent(mocks);
        assert.equal(mocks.dbusCalls.length, 2);
        const call = mocks.dbusCalls[1] as { service: string; path: string; iface: string; method: string };
        assert.equal(call.service, PINNED_OWNER);
        assert.equal(call.path, POINTER_RESIZE_OBJECT);
        assert.equal(call.iface, POINTER_RESIZE_INTERFACE);
        assert.equal(call.method, POINTER_RESIZE_METHOD);
        const payload = payloadOf(mocks, 1);
        assert.equal(payload["v"], 1);
        assert.equal(payload["action"], "request-pointer");
        assert.equal(payload["direction"], "right");
        assert.equal(payload["proposed_boundary"], 1000);
        assert.ok(!("old_shares" in payload));
        assert.ok(!("new_shares" in payload));
        // Pointer behavior is boundary-driven: it must not invent a keyboard
        // step. No press_index is carried; the neutral/unused mode "outwards"
        // plus press_index 0 live only in Rust's internal seeding RequestDto
        // (src/resize_service.rs), never on this wire.
        assert.ok(!("press_index" in payload));
        assert.ok(!("mode" in payload));
        assert.deepEqual(payload["capabilities"], { keyboard_resize: false, pointer_resize: true });
        assert.equal(payload["focused_window"], "win-a");
        assert.equal(payload["revision"], 2);
        assert.equal(
            payload["fingerprint"],
            pointerResizeFingerprint("out-1", "ws-1", "win-a", ["win-a", "win-b"]),
        );
        assert.deepEqual(payload["domain"], {
            output: "out-1",
            workspace: "ws-1",
            bounds: { x: 0, y: 0, w: 1920, h: 1080 },
            gap: 0,
            outer_gap: 0,
        });
        // The native-driven source is never written by the adapter.
        assert.equal(mocks.geometryWrites.length, 0);
    });

    it("requires mode in the shared planned operation payload", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const correlation = payload["correlation_id"] as string;
        const revision = payload["revision"] as number;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        // Shared operation DTO now carries required mode; pointer accepts it
        // while still driving behavior from the proposed boundary only.
        onRequest(plannedReply(correlation, revision, resizedGeometry(1000)));
        assert.deepEqual(mocks.geometryWrites.map((w) => w.id), ["win-b"]);
        assert.equal(adapter.isEnabled, true);
        // Missing mode in the operation rejects before any neighbour write.
        const bad = mockEnvTwoWindow();
        const adapter2 = enableAdapter(bad);
        beginResize(bad, adapter2);
        adapter2.windowStepped(refOf(bad, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(bad, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(bad);
        const badPayload = payloadOf(bad, 1);
        const badCorrelation = badPayload["correlation_id"] as string;
        const badRevision = badPayload["revision"] as number;
        const badOnRequest = bad.callbacks[1] as (reply: unknown) => void;
        const operation = pointerOperation("right", "outwards") as Record<string, unknown>;
        assert.equal(operation["mode"], "outwards");
        delete operation["mode"];
        badOnRequest(
            JSON.stringify({
                v: POINTER_RESIZE_CONTRACT_VERSION,
                correlation_id: badCorrelation,
                outcome: "planned",
                base_revision: badRevision,
                capability: "pointer-resize",
                preconditions: [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                operation,
                desired_geometry: resizedGeometry(1000),
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-a" },
            }),
        );
        assert.ok(bad.logs.some((line) => line.includes("pointer-precondition-mismatch")));
        assert.equal(bad.geometryWrites.length, 0);
        assert.equal(adapter2.isEnabled, false);
    });

    it("orders start, step, finish with a single final commit", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        adapter.windowFinished(refOf(mocks, "win-a"));
        // A stale step after finish cannot open a new flight.
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1010, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-stale-step")));
        assert.equal(requestPayloads(mocks).length, 0);
        driveOwnerPresent(mocks);
        assert.equal(requestPayloads(mocks).length, 1);
        driveFullCycle(mocks, 1, 1000);
        assert.deepEqual(
            mocks.geometryWrites.map((w) => w.id),
            ["win-b"],
        );
        assert.deepEqual(mocks.geometryWrites[0]?.rect, { x: 1000, y: 0, w: 920, h: 1080 });
        const actions = mocks.dbusCalls
            .filter((call) => call.method === POINTER_RESIZE_METHOD)
            .map((call) => (JSON.parse(call.payload) as Record<string, unknown>)["action"]);
        assert.deepEqual(actions, ["request-pointer", "acknowledge", "verify"]);
        const ack = payloadOf(mocks, 2);
        assert.equal(ack["outcome"], "accepted");
        const verify = payloadOf(mocks, 3);
        assert.equal(verify["verified"], true);
        assert.deepEqual(verify["verified_geometry"], resizedGeometry(1000));
        const appliedAt = mocks.logs.findIndex((line) => line.endsWith(":applied"));
        const finishedAt = mocks.logs.findIndex((line) => line.endsWith(":finished"));
        assert.ok(appliedAt >= 0 && finishedAt >= 0 && appliedAt < finishedAt);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.hasGesture, false);
    });

    it("applies neighbour-only writes then acks, verifies, and commits revision", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        driveFullCycle(mocks, 1, 1000);
        assert.ok(mocks.logs.some((line) => line.endsWith(":applied")));
        // Latest accepted revision commits; the next gesture binds it.
        adapter.windowFinished(refOf(mocks, "win-a"));
        beginResize(mocks, adapter);
        setFlags(mocks, "win-a", false, true);
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 960, h: 1080 });
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 990, h: 1080 }));
        driveLatestOwner(mocks, ":1.43");
        const second = requestPayloads(mocks)[1] as Record<string, unknown>;
        assert.equal(second["revision"], 3);
    });

    it("classifies from the stepped proposal while frame geometry lags", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(mocks);
        assert.equal(requestPayloads(mocks).length, 1);
        assert.equal(payloadOf(mocks, 1)["proposed_boundary"], 1000);
        // Native catches up after the proposal; the pending flight commits.
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveFullCycle(mocks, 1, 1000);
        assert.ok(mocks.logs.some((line) => line.endsWith(":applied")));
        assert.equal(adapter.isEnabled, true);
    });

    it("keeps one flight and sends only the latest coalesced step", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(mocks);
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1040, h: 1080 }));
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1080, h: 1080 }));
        assert.equal(requestPayloads(mocks).length, 1);
        assert.ok(mocks.logs.some((line) => line.endsWith(":coalesced")));
        driveFullCycle(mocks, 1, 1000);
        // Stale intermediate 1040 is never replayed; latest 1080 follows.
        driveLatestOwner(mocks, ":1.43");
        const requests = requestPayloads(mocks);
        assert.equal(requests.length, 2);
        assert.equal(requests[1]?.["proposed_boundary"], 1080);
        assert.ok(!requests.some((payload) => payload["proposed_boundary"] === 1040));
        assert.equal(requests[1]?.["revision"], 3);
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1080, h: 1080 });
        const second = payloadOf(mocks, 5);
        const correlation = second["correlation_id"] as string;
        const onRequest = mocks.callbacks[5] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, 3, resizedGeometry(1080)));
        const onAck = mocks.callbacks[6] as (reply: unknown) => void;
        onAck(ackReply(correlation, 3));
        const verify = payloadOf(mocks, 7);
        assert.deepEqual(verify["verified_geometry"], resizedGeometry(1080));
        const onVerify = mocks.callbacks[7] as (reply: unknown) => void;
        onVerify(committedReply(correlation, 4));
        assert.equal(mocks.logs.filter((line) => line.endsWith(":applied")).length, 2);
    });

    it("dedups equivalent boundaries without new flights", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 960, h: 1080 }));
        assert.equal(mocks.dbusCalls.length, 0);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(mocks);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-dedup")));
        assert.equal(requestPayloads(mocks).length, 1);
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveFullCycle(mocks, 1, 1000);
        adapter.windowFinished(refOf(mocks, "win-a"));
        assert.equal(requestPayloads(mocks).length, 1);
        assert.ok(mocks.logs.some((line) => line.endsWith(":finished")));
    });

    it("supersedes a retained step when returning to the in-flight boundary", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(mocks);
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        assert.equal(requestPayloads(mocks).length, 1);
        // 1040 is retained while 1000 is in flight.
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1040, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.endsWith(":coalesced")));
        // Stepping back to the in-flight boundary dedups and clears the
        // retained 1040 so no stale second request occurs.
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-dedup")));
        driveFullCycle(mocks, 1, 1000);
        const requests = requestPayloads(mocks);
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.["proposed_boundary"], 1000);
        assert.ok(!requests.some((payload) => payload["proposed_boundary"] === 1040));
        // No second flight means no second revision or write.
        assert.equal(mocks.dbusCalls.filter((call) => {
            if (call.method !== POINTER_RESIZE_METHOD) {
                return false;
            }
            const action = (JSON.parse(call.payload) as Record<string, unknown>)["action"];
            return action === "request-pointer";
        }).length, 1);
        assert.deepEqual(mocks.geometryWrites.map((w) => w.id), ["win-b"]);
        assert.equal(adapter.isEnabled, true);
    });

    it("rejects non-adjacent and direction-inconsistent planned operations before writes", () => {
        for (const operation of [
            // Non-adjacent pair: focused 0, neighbor 2.
            { ...pointerOperation("right"), focused_index: 0, neighbor_index: 2, old_shares: [8, 8, 8], new_shares: [9, 8, 7] },
            // Direction-inconsistent: right requires neighbor = focused + 1,
            // but focused 1 neighbor 0 steps left.
            { ...pointerOperation("right"), focused_index: 1, neighbor_index: 0, old_shares: [8, 8], new_shares: [7, 9] },
            // Direction-inconsistent: left requires neighbor = focused - 1,
            // but focused 0 neighbor 1 steps right.
            { ...pointerOperation("left"), focused_index: 0, neighbor_index: 1, old_shares: [8, 8], new_shares: [9, 7] },
        ]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const correlation = payload["correlation_id"] as string;
        const revision = payload["revision"] as number;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
            const badGeometry = [
                { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1000, h: 1080 } },
                { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 1000, y: 0, w: 920, h: 1080 } },
            ];
            onRequest(JSON.stringify({
                v: POINTER_RESIZE_CONTRACT_VERSION,
                correlation_id: correlation,
                outcome: "planned",
                base_revision: revision,
                capability: "pointer-resize",
                preconditions: [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                operation,
                desired_geometry: badGeometry,
                desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-a" },
            }));
            assert.ok(mocks.logs.some((line) => line.includes("pointer-precondition-mismatch")));
            assert.equal(mocks.geometryWrites.length, 0);
            assert.equal(adapter.isEnabled, false);
        }
    });

    it("binds post-observation exactly without writing the source", () => {
        // Exact case: proposal 1000 plans 1000; native source shows 1000, so
        // post-observation binds and commits with the source never written.
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        driveFullCycle(mocks, 1, 1000);
        assert.ok(mocks.logs.some((line) => line.endsWith(":applied")));
        assert.deepEqual(mocks.geometryWrites.map((w) => w.id), ["win-b"]);
        assert.ok(!mocks.geometryWrites.some((w) => w.id === "win-a"));

        // Fault case mimicking the 200px Rust quantization bug (proposal 80
        // planned as 81): native shows the proposal (80) but the plan says
        // 81, so post-observation must fail closed rather than lying in
        // verify. The source still stays native-owned (never written).
        const buggy = mockEnvTwoWindow();
        const adapter2 = enableAdapter(buggy);
        beginResize(buggy, adapter2);
        adapter2.windowStepped(refOf(buggy, "win-a"), stepPayload({ x: 0, y: 0, w: 80, h: 1080 }));
        nativeApplySource(buggy, "win-a", { x: 0, y: 0, w: 80, h: 1080 });
        driveOwnerPresent(buggy);
        const payload = payloadOf(buggy, 1);
        const correlation = payload["correlation_id"] as string;
        const revision = payload["revision"] as number;
        const onRequest = buggy.callbacks[1] as (reply: unknown) => void;
        // Buggy plan: boundary 81 while the proposal and native show 80.
        onRequest(plannedReply(correlation, revision, resizedGeometry(81)));
        const onAck = buggy.callbacks[2] as (reply: unknown) => void;
        onAck(ackReply(correlation, revision));
        assert.ok(buggy.logs.some((line) => line.includes("pointer-post-mismatch")));
        assert.equal(adapter2.isEnabled, false);
        assert.ok(!buggy.geometryWrites.some((w) => w.id === "win-a"));
    });

    it("suppresses own-neighbour geometry events but invalidates unrelated drift", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const correlation = payload["correlation_id"] as string;
        const revision = payload["revision"] as number;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, revision, resizedGeometry(1000)));
        // Own-neighbour event showing the desired rect is suppressed: the
        // flight survives and the adapter stays enabled.
        adapter.windowGeometryChanged(refOf(mocks, "win-b"));
        assert.equal(adapter.isEnabled, true);
        assert.equal(mocks.dbusCalls.length, 3);
        const onAck = mocks.callbacks[2] as (reply: unknown) => void;
        onAck(ackReply(correlation, revision));
        // Expected native source progression never invalidates.
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1005, h: 1080 });
        adapter.windowGeometryChanged(refOf(mocks, "win-a"));
        assert.equal(adapter.isEnabled, true);
        const onVerify = mocks.callbacks[2] as (reply: unknown) => void;
        // Unrelated neighbour drift after the source progression still binds
        // only when it matches; force drift then signal.
        nativeApplySource(mocks, "win-b", { x: 1000, y: 0, w: 100, h: 100 });
        adapter.windowGeometryChanged(refOf(mocks, "win-b"));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-signal-invalid")));
        assert.equal(adapter.isEnabled, false);
        void onVerify;
    });

    it("writes only changed neighbours and never the source", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const correlation = payload["correlation_id"] as string;
        // Planned neighbour geometry already matches live: no writes, yet the
        // flight still acknowledges, verifies, and commits.
        const geometry = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1000, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 960, y: 0, w: 960, h: 1080 } },
        ];
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, 2, geometry));
        assert.equal(mocks.geometryWrites.length, 0);
        const onAck = mocks.callbacks[2] as (reply: unknown) => void;
        onAck(ackReply(correlation, 2));
        const verify = payloadOf(mocks, 3);
        assert.deepEqual(verify["verified_geometry"], geometry);
        const onVerify = mocks.callbacks[3] as (reply: unknown) => void;
        onVerify(committedReply(correlation, 3));
        assert.ok(mocks.logs.some((line) => line.endsWith(":applied")));
    });

    it("suppresses synchronous reentrant steps during own writes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        mocks.afterWrite = (): void => {
            adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1200, h: 1080 }));
        };
        driveOwnerPresent(mocks);
        driveFullCycle(mocks, 1, 1000);
        assert.ok(mocks.logs.some((line) => line.endsWith(":applied")));
        assert.equal(adapter.isEnabled, true);
        assert.equal(requestPayloads(mocks).length, 1);
        assert.ok(!mocks.logs.some((line) => line.endsWith(":coalesced")));
    });

    it("fails closed on foreign stepped signals mid-gesture", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-b"), stepPayload({ x: 960, y: 0, w: 900, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-foreign-signal")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("fails closed on foreign finish signals mid-gesture", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        adapter.windowFinished(refOf(mocks, "win-b"));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-foreign-signal")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed when membership drifts before apply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        mocks.wins.push({
            id: "win-c",
            ref: {},
            rect: { x: 0, y: 0, w: 100, h: 100 },
            output: "out-1",
            workspace: "ws-1",
            move: false,
            resize: false,
        });
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(payload["correlation_id"] as string, 2));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-stale-revalidate")));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed when gesture state transitions mid-gesture", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        setFlags(mocks, "win-a", true, false);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 100, y: 0, w: 960, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-gesture-transition")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("fails closed on direction drift within a gesture", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 960, h: 900 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-direction-drift")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on multi-edge stepped proposals", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 50, y: 50, w: 960, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-mixed-edge")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 0);
    });

    it("finalizes an empty resize gesture without D-Bus", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowFinished(refOf(mocks, "win-a"));
        assert.ok(mocks.logs.some((line) => line.endsWith(":finished")));
        assert.equal(mocks.dbusCalls.length, 0);
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.hasGesture, false);
        // The adapter stays reusable for the next gesture.
        beginResize(mocks, adapter);
        assert.equal(adapter.hasGesture, true);
    });

    it("handles noop replies without writes", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "noop" }));
        assert.ok(mocks.logs.some((line) => line.endsWith(":noop")));
        assert.equal(mocks.geometryWrites.length, 0);
        assert.equal(adapter.isEnabled, true);
        adapter.windowFinished(refOf(mocks, "win-a"));
        assert.ok(mocks.logs.some((line) => line.endsWith(":finished")));
    });

    it("fails closed when D-Bus dispatch throws", () => {
        const mocks = mockEnvTwoWindow();
        mocks.throwDbus = true;
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-dbus-failed")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on the one-shot service timeout", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.equal(mocks.timers.length, 1);
        const timer = mocks.timers[0] as { callback: () => void };
        timer.callback();
        assert.ok(mocks.logs.some((line) => line.includes("pointer-timeout-request")));
        assert.equal(adapter.isEnabled, false);
    });

    it("fails closed on malformed and refused service replies", () => {
        const malformed = mockEnvTwoWindow();
        const adapter = enableAdapter(malformed);
        beginResize(malformed, adapter);
        adapter.windowStepped(refOf(malformed, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(malformed);
        const onRequest = malformed.callbacks[1] as (reply: unknown) => void;
        onRequest(42);
        assert.ok(malformed.logs.some((line) => line.includes("pointer-service-fault")));
        assert.equal(adapter.isEnabled, false);

        const refused = mockEnvTwoWindow();
        const adapter2 = new PointerResizeAdapter(refused.env);
        adapter2.enable({ owner: "owner-1", generation: "gen-1", revision: 0 });
        beginResize(refused, adapter2);
        adapter2.windowStepped(refOf(refused, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(refused);
        const payload = payloadOf(refused, 1);
        const onRequest2 = refused.callbacks[1] as (reply: unknown) => void;
        onRequest2(JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "rejected" }));
        assert.ok(refused.logs.some((line) => line.includes("pointer-rejected")));
        assert.equal(refused.geometryWrites.length, 0);
        assert.equal(adapter2.isEnabled, false);
    });

    it("recovers on window-count-mismatch and dispatches a later step", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const correlation = payload["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(
            JSON.stringify({
                v: 1,
                correlation_id: correlation,
                outcome: "rejected",
                kind: "snapshot-invalid",
                detail: "window-count-mismatch",
                message: "gate",
            }),
        );
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((line) => line.includes("pointer-rejected")));
        // Group E: route-diag removed; recovery is proven by the bounded
        // reject token with the adapter staying enabled (zero :result: lines).
        assert.ok(!mocks.logs.some((line) => line.includes(":result:")));
        assert.equal(adapter.isEnabled, true);
        assert.equal(adapter.isInFlight, false);
        const requestsBefore = requestPayloads(mocks).length;
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1100, h: 1080 }));
        driveLatestOwner(mocks, ":1.43");
        assert.equal(requestPayloads(mocks).length, requestsBefore + 1);
        assert.equal(adapter.isEnabled, true);
    });

    it("still disables on structural rejected details", () => {
        const cases: Array<Record<string, unknown>> = [
            { kind: "snapshot-invalid", message: "bad" },
            { kind: "unauthorized", message: "bad" },
            { kind: "unauthorized", detail: "window-count-mismatch", message: "bad" },
            { kind: "snapshot-invalid", detail: "unknown-detail", message: "bad" },
            { kind: "snapshot-invalid", detail: "domain-output-invalid", message: "bad" },
        ];
        for (const extra of cases) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            beginResize(mocks, adapter);
            adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
            driveOwnerPresent(mocks);
            const payload = payloadOf(mocks, 1);
            const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
            onRequest(JSON.stringify({ v: 1, correlation_id: payload["correlation_id"], outcome: "rejected", ...extra }));
            assert.equal(mocks.geometryWrites.length, 0);
            assert.ok(mocks.logs.some((line) => line.includes("pointer-rejected")));
            assert.equal(adapter.isEnabled, false);
        }
    });

    it("disables on unbound window-count-mismatch replies", () => {
        const cases: Array<{ extra: (correlation: string) => Record<string, unknown>; token: string }> = [
            {
                extra: (correlation) => ({
                    v: 999,
                    correlation_id: correlation,
                    kind: "snapshot-invalid",
                    detail: "window-count-mismatch",
                }),
                token: "pointer-service-fault",
            },
            {
                extra: () => ({
                    v: 1,
                    correlation_id: "wrong-correlation",
                    kind: "snapshot-invalid",
                    detail: "window-count-mismatch",
                }),
                token: "pointer-correlation-mismatch",
            },
            {
                extra: (correlation) => ({
                    v: 1,
                    correlation_id: correlation,
                    kind: "stale-snapshot",
                    detail: "window-count-mismatch",
                }),
                token: "pointer-rejected",
            },
        ];
        for (const entry of cases) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            beginResize(mocks, adapter);
            adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
            driveOwnerPresent(mocks);
            const correlation = payloadOf(mocks, 1)["correlation_id"] as string;
            const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
            onRequest(JSON.stringify({ outcome: "rejected", message: "gate", ...entry.extra(correlation) }));
            assert.equal(mocks.geometryWrites.length, 0);
            assert.ok(mocks.logs.some((line) => line.includes(entry.token)));
            assert.equal(adapter.isEnabled, false);
            assert.equal(adapter.isInFlight, false);
        }
    });

    it("fails closed on partial neighbour writes with adapter-lost", () => {
        const mocks = mockEnvTwoWindow();
        mocks.failGeometry = true;
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(payload["correlation_id"] as string, 2));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-partial-apply")));
        assert.equal(adapter.isEnabled, false);
        const actions = mocks.dbusCalls
            .filter((call) => call.method === POINTER_RESIZE_METHOD)
            .map((call) => (JSON.parse(call.payload) as Record<string, unknown>)["action"]);
        assert.deepEqual(actions, ["request-pointer", "acknowledge"]);
        const loss = payloadOf(mocks, 2);
        assert.equal(loss["outcome"], "adapter-lost");
    });

    it("fails closed when a concurrent change lands during apply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        mocks.afterWrite = (): void => {
            nativeApplySource(mocks, "win-b", { x: 1000, y: 0, w: 100, h: 100 });
        };
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(payload["correlation_id"] as string, 2));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-signal-invalid")));
        assert.equal(adapter.isEnabled, false);
        const actions = mocks.dbusCalls
            .filter((call) => call.method === POINTER_RESIZE_METHOD)
            .map((call) => (JSON.parse(call.payload) as Record<string, unknown>)["action"]);
        assert.deepEqual(actions, ["request-pointer", "acknowledge"]);
    });

    it("fails closed when post-observation diverges from the plan", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        // Native never applies the proposal: post-observation cannot bind.
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const correlation = payload["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, 2));
        const onAck = mocks.callbacks[2] as (reply: unknown) => void;
        onAck(ackReply(correlation, 2));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-post-mismatch")));
        assert.equal(adapter.isEnabled, false);
        const actions = mocks.dbusCalls
            .filter((call) => call.method === POINTER_RESIZE_METHOD)
            .map((call) => (JSON.parse(call.payload) as Record<string, unknown>)["action"]);
        assert.deepEqual(actions, ["request-pointer", "acknowledge", "acknowledge"]);
        const loss = payloadOf(mocks, 3);
        assert.equal(loss["outcome"], "adapter-lost");
    });

    it("fails closed when the service diverges at verify", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        const payload = payloadOf(mocks, 1);
        const correlation = payload["correlation_id"] as string;
        const onRequest = mocks.callbacks[1] as (reply: unknown) => void;
        onRequest(plannedReply(correlation, 2));
        const onAck = mocks.callbacks[2] as (reply: unknown) => void;
        onAck(ackReply(correlation, 2));
        const onVerify = mocks.callbacks[3] as (reply: unknown) => void;
        onVerify(JSON.stringify({ v: 1, correlation_id: correlation, outcome: "diverged" }));
        assert.ok(mocks.logs.some((line) => line.includes("pointer-service-fault")));
        assert.equal(adapter.isEnabled, false);
    });

    it("orderPointerWrites is changed-only, grow-first, lexically stable", () => {
        const oldById = new Map<string, PointerResizeRect>([
            ["win-a", { x: 0, y: 0, w: 960, h: 1080 }],
            ["win-b", { x: 960, y: 0, w: 960, h: 1080 }],
            ["win-c", { x: 0, y: 0, w: 100, h: 100 }],
        ]);
        const desired = [
            { window: "win-a", leaf: "leaf-a", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 1080, h: 1080 } },
            { window: "win-b", leaf: "leaf-b", output: "out-1", workspace: "ws-1", rect: { x: 1080, y: 0, w: 840, h: 1080 } },
            { window: "win-c", leaf: "leaf-c", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 100, h: 100 } },
        ];
        const ordered = orderPointerWrites(oldById, desired);
        assert.deepEqual(
            ordered.map((entry) => entry.window),
            ["win-a", "win-b"],
        );
    });

    it("uses the DescribePointerResize route identity", () => {
        assert.equal(POINTER_RESIZE_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(POINTER_RESIZE_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(POINTER_RESIZE_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(POINTER_RESIZE_METHOD, "DescribePointerResize");
        assert.equal(POINTER_RESIZE_CONTRACT_VERSION, 1);
    });

    it("matches the shared observation fingerprint binding", () => {
        assert.equal(
            pointerResizeFingerprint("out-1", "ws-1", "win-a", ["win-a", "win-b"]),
            resizeFingerprint("out-1", "ws-1", "win-a", ["win-a", "win-b"]),
        );
    });

    it("bounds D-Bus timeouts to one-shot timers with no repeating loop", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveOwnerPresent(mocks);
        driveFullCycle(mocks, 1, 1000);
        // One one-shot timer per D-Bus stage, all settled afterwards.
        assert.equal(mocks.timers.length, 3);
        assert.ok(mocks.timers.every((timer) => timer.cancelled));
        const src = readFileSync(join(kwinSrcDir(), "pointer-resize-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "pointer-resize-adapter-entry.ts"), "utf8");
        for (const body of [src, entry]) {
            assert.ok(!body.includes("setInterval"));
            assert.ok(!body.includes("setTimeout"));
            assert.ok(!body.includes("requestAnimationFrame"));
            assert.ok(!body.includes("pollFor"));
            assert.ok(!body.includes("configureBarrier"));
            assert.ok(!body.includes("frameGeometryChanged"));
        }
        assert.ok(src.includes("POINTER_RESIZE_TIMEOUT_MS"));
        assert.ok(src.includes("scheduleOnce"));
    });

    it("source performs no forbidden tiling, shortcut, config, or focus access", () => {
        const src = readFileSync(join(kwinSrcDir(), "pointer-resize-adapter.ts"), "utf8");
        const entry = readFileSync(join(kwinSrcDir(), "pointer-resize-adapter-entry.ts"), "utf8");
        for (const body of [src, entry]) {
            assert.ok(!body.includes("rootTile"));
            assert.ok(!body.includes("relativeGeometry"));
            assert.ok(!body.includes("registerShortcut"));
            assert.ok(!body.includes("registerSessionShortcut"));
            assert.ok(!body.includes("readConfig"));
            assert.ok(!body.includes("writeConfig"));
            assert.ok(!body.includes("createDesktop"));
            assert.ok(!body.includes("removeDesktop"));
            assert.ok(!body.includes("showOutline"));
            assert.ok(!body.includes("fallback"));
            assert.ok(!body.includes("setActive"));
            assert.ok(!body.includes("activeWindow ="));
            assert.ok(!body.includes("waitFor"));
        }
        assert.ok(!src.includes('from "./resize-adapter"'));
        assert.ok(!src.includes('from "./entry"'));
        assert.ok(!src.includes('from "./controller'));
        assert.ok(!entry.includes('from "./entry"'));
        assert.ok(!entry.includes('from "./controller'));
        assert.ok(entry.includes('from "./pointer-resize-adapter"'));
        assert.ok(src.includes('from "./geometry-order"'));
    });

    it("production startup keeps the pointer adapter out of the single-engine entry", () => {
        const entry = readFileSync(join(kwinSrcDir(), "entry.ts"), "utf8");
        assert.ok(!entry.includes("pointer-resize-adapter"));
        assert.ok(!entry.includes("PointerResizeAdapter"));
        assert.ok(!entry.includes("startPointerResizeAdapterEntry"));
        assert.ok(!entry.includes("DescribePointerResize"));
    });

    it("keeps the pointer slice out of the single-engine controller", () => {
        const dir = kwinSrcDir();
        for (const name of ["controller.ts", "controller-input-actions.ts", "controller-interactive-drag.ts"]) {
            assert.equal(existsSync(join(dir, name)), false, `${name} must stay removed`);
        }
    });
});

describe("pointer resize adapter session D-Bus activation", () => {
    it("pins a present owner with no service activation and routes planner calls to the unique name", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(POINTER_RESIZE_DBUS_SERVICE, "org.freedesktop.DBus");
        assert.equal(POINTER_RESIZE_DBUS_OBJECT, "/org/freedesktop/DBus");
        assert.equal(POINTER_RESIZE_DBUS_INTERFACE, "org.freedesktop.DBus");
        assert.equal(POINTER_RESIZE_GET_OWNER_METHOD, "GetNameOwner");
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.equal(mocks.dbusCalls.length, 1);
        assert.deepEqual(
            [mocks.dbusCalls[0]?.service, mocks.dbusCalls[0]?.method, mocks.dbusCalls[0]?.payload],
            [POINTER_RESIZE_DBUS_SERVICE, POINTER_RESIZE_GET_OWNER_METHOD, POINTER_RESIZE_SERVICE],
        );
        driveOwnerPresent(mocks, ":1.42");
        assert.equal(mocks.dbusCalls.length, 2);
        assert.equal(mocks.dbusCalls[1]?.service, ":1.42");
        assert.equal(mocks.dbusCalls[1]?.method, POINTER_RESIZE_METHOD);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === POINTER_RESIZE_SERVICE));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        driveFullCycle(mocks, 1, 1000);
        assert.equal(mocks.dbusCalls[2]?.service, ":1.42");
        assert.equal(mocks.dbusCalls[3]?.service, ":1.42");
        assert.ok(mocks.logs.some((l) => l.includes("pointer-resize:applied")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === POINTER_RESIZE_SERVICE));
    });

    it("activates an absent name with exactly one StartServiceByName(1) then pins", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        assert.equal(POINTER_RESIZE_START_METHOD, "StartServiceByName");
        assert.equal(POINTER_RESIZE_START_FLAGS, 0);
        assert.equal(POINTER_RESIZE_START_PRIMARY, 1);
        assert.equal(POINTER_RESIZE_START_ALREADY, 2);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        mocks.callbacks[0]?.("");
        assert.equal(mocks.dbusCalls.length, 2);
        const start = mocks.dbusCalls[1];
        assert.deepEqual(
            [start?.service, start?.method, start?.payload],
            [POINTER_RESIZE_DBUS_SERVICE, POINTER_RESIZE_START_METHOD, POINTER_RESIZE_SERVICE],
        );
        mocks.callbacks[1]?.(POINTER_RESIZE_START_PRIMARY);
        assert.equal(mocks.dbusCalls.length, 3);
        assert.deepEqual(
            [mocks.dbusCalls[2]?.service, mocks.dbusCalls[2]?.method],
            [POINTER_RESIZE_DBUS_SERVICE, POINTER_RESIZE_GET_OWNER_METHOD],
        );
        mocks.callbacks[2]?.(":1.77");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.77");
        assert.equal(mocks.dbusCalls[3]?.method, POINTER_RESIZE_METHOD);
        assert.equal(mocks.dbusCalls.filter((call) => call.method === POINTER_RESIZE_START_METHOD).length, 1);
        assert.ok(!mocks.dbusCalls.some((call) => call.service === POINTER_RESIZE_SERVICE));
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        const payload = payloadOf(mocks, 3);
        (mocks.callbacks[3] as (reply: unknown) => void)(plannedReply(payload["correlation_id"] as string, payload["revision"] as number));
        assert.deepEqual(mocks.geometryWrites.map((w) => w.id), ["win-b"]);
        assert.equal(adapter.isEnabled, true);
    });

    it("accepts AlreadyOwner(2) as already-running then resolves and pins", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        mocks.callbacks[0]?.(null);
        mocks.callbacks[1]?.(POINTER_RESIZE_START_ALREADY);
        mocks.callbacks[2]?.(":1.78");
        assert.equal(mocks.dbusCalls.length, 4);
        assert.equal(mocks.dbusCalls[3]?.service, ":1.78");
        nativeApplySource(mocks, "win-a", { x: 0, y: 0, w: 1000, h: 1080 });
        const payload = payloadOf(mocks, 3);
        (mocks.callbacks[3] as (reply: unknown) => void)(plannedReply(payload["correlation_id"] as string, payload["revision"] as number));
        assert.deepEqual(mocks.geometryWrites.map((w) => w.id), ["win-b"]);
        assert.equal(adapter.isEnabled, true);
    });

    it("rejects malformed or unknown activation results with no planner call and disables", () => {
        for (const bad of [0, 3, 4, 99, "1", "ok", null, undefined, {}, []]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            beginResize(mocks, adapter);
            adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(bad);
            assert.ok(mocks.logs.some((l) => l.includes("pointer-activation-failed")));
            assert.equal(adapter.isEnabled, false);
            assert.equal(mocks.geometryWrites.length, 0);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === POINTER_RESIZE_METHOD));
            assert.ok(!mocks.dbusCalls.some((call) => call.service === POINTER_RESIZE_SERVICE));
            assert.equal(mocks.dbusCalls.filter((call) => call.method === POINTER_RESIZE_START_METHOD).length, 1);
            assert.equal(mocks.dbusCalls.length, 2);
        }
    });

    it("fails closed when the post-start owner is missing with no planner call", () => {
        for (const badOwner of ["", "not-a-unique-name", null, POINTER_RESIZE_SERVICE]) {
            const mocks = mockEnvTwoWindow();
            const adapter = enableAdapter(mocks);
            beginResize(mocks, adapter);
            adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
            mocks.callbacks[0]?.("");
            mocks.callbacks[1]?.(POINTER_RESIZE_START_PRIMARY);
            mocks.callbacks[2]?.(badOwner);
            assert.ok(mocks.logs.some((l) => l.includes("pointer-owner-missing")));
            assert.equal(adapter.isEnabled, false);
            assert.ok(!mocks.dbusCalls.some((call) => call.method === POINTER_RESIZE_METHOD));
            assert.equal(mocks.geometryWrites.length, 0);
        }
    });

    it("coalesces steps during activation with no duplicate service request", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.equal(mocks.dbusCalls.length, 1);
        // A second differing step while activation is pending coalesces.
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1040, h: 1080 }));
        assert.ok(mocks.logs.some((l) => l.includes("pointer-resize:coalesced")));
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.("");
        assert.equal(mocks.dbusCalls.filter((call) => call.method === POINTER_RESIZE_START_METHOD).length, 1);
        assert.equal(mocks.dbusCalls.length, 2);
    });

    it("times out during activation with no retry and ignores the late reply", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        assert.equal(mocks.timers.length, 1);
        mocks.timers[0]?.callback();
        assert.ok(mocks.logs.some((l) => l.includes("pointer-timeout-request")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.dbusCalls.length, 1);
        mocks.callbacks[0]?.(":1.42");
        assert.equal(mocks.dbusCalls.length, 1);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(!mocks.logs.some((l) => l.includes("pointer-resize:applied")));
    });

    it("refuses the Rust command with no Legacy fallback on activation failure", () => {
        const mocks = mockEnvTwoWindow();
        const adapter = enableAdapter(mocks);
        beginResize(mocks, adapter);
        adapter.windowStepped(refOf(mocks, "win-a"), stepPayload({ x: 0, y: 0, w: 1000, h: 1080 }));
        mocks.callbacks[0]?.("");
        mocks.callbacks[1]?.(0);
        assert.ok(mocks.logs.some((l) => l.includes("pointer-activation-failed")));
        assert.equal(adapter.isEnabled, false);
        assert.equal(mocks.geometryWrites.length, 0);
        assert.ok(mocks.logs.some((l) => l.includes("pointer-resize:disabled")));
        assert.ok(!mocks.dbusCalls.some((call) => call.service === POINTER_RESIZE_SERVICE));
        const src = readFileSync(join(kwinSrcDir(), "pointer-resize-adapter.ts"), "utf8");
        assert.ok(!src.includes("fallback"));
    });
});

interface FakeSignal {
    handlers: Array<(payload?: unknown) => void>;
    connect: (handler: (payload?: unknown) => void) => void;
    disconnect: (handler: (payload?: unknown) => void) => void;
}

function fakeSignal(): FakeSignal {
    const handlers: Array<(payload?: unknown) => void> = [];
    return {
        handlers,
        connect: (handler): void => {
            handlers.push(handler);
        },
        disconnect: (handler): void => {
            const index = handlers.indexOf(handler);
            if (index >= 0) {
                handlers.splice(index, 1);
            }
        },
    };
}

interface FakeWindow {
    [key: string]: unknown;
    internalId: string;
    frameGeometry: { x: number; y: number; width: number; height: number };
    move: boolean;
    resize: boolean;
    interactiveMoveResizeStarted: FakeSignal;
    interactiveMoveResizeStepped: FakeSignal;
    interactiveMoveResizeFinished: FakeSignal;
    moveResizedChanged: FakeSignal;
}

function fakeWindow(id: string, rect: { x: number; y: number; width: number; height: number }, output: object, desktop: object): FakeWindow {
    return {
        internalId: id,
        output,
        desktops: [desktop],
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        move: false,
        resize: false,
        frameGeometry: { ...rect },
        interactiveMoveResizeStarted: fakeSignal(),
        interactiveMoveResizeStepped: fakeSignal(),
        interactiveMoveResizeFinished: fakeSignal(),
        moveResizedChanged: fakeSignal(),
    };
}

describe("pointer resize entry", () => {
    it("attaches per-window interactive signals and routes gestures", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const winA = fakeWindow("win-a", { x: 0, y: 0, width: 960, height: 1080 }, output, desktop);
        const winB = fakeWindow("win-b", { x: 960, y: 0, width: 960, height: 1080 }, output, desktop);
        const dbusCalls: Array<{ payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const logs: string[] = [];
        const fakeWorkspace = {
            activeWindow: winA as unknown,
            windowList: (): unknown[] => [winA, winB],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        };
        const handle = startPointerResizeAdapterEntry({
            workspace: fakeWorkspace,
            callDbus: (_s, _p, _i, _m, payload, callback): void => {
                dbusCalls.push({ payload });
                callbacks.push(callback);
            },
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(handle !== null);
        assert.ok(logs.some((line) => line.endsWith(":ready")));
        assert.equal(winA.interactiveMoveResizeStarted.handlers.length, 1);
        assert.equal(winA.interactiveMoveResizeStepped.handlers.length, 1);
        assert.equal(winA.interactiveMoveResizeFinished.handlers.length, 1);
        assert.equal(winB.interactiveMoveResizeStarted.handlers.length, 1);
        // A foreign start while a gesture is active fails the gesture closed.
        winA.resize = true;
        winA.interactiveMoveResizeStarted.handlers[0]?.();
        winB.resize = true;
        winB.interactiveMoveResizeStarted.handlers[0]?.();
        assert.ok(logs.some((line) => line.includes("pointer-gesture-conflict")));
        handle.stop();
        assert.equal(winA.interactiveMoveResizeStarted.handlers.length, 0);
        assert.equal(winA.interactiveMoveResizeStepped.handlers.length, 0);
        assert.equal(winA.interactiveMoveResizeFinished.handlers.length, 0);
        assert.equal(winB.interactiveMoveResizeStarted.handlers.length, 0);
    });

    it("routes stepped proposals to request-pointer through the entry", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const winA = fakeWindow("win-a", { x: 0, y: 0, width: 960, height: 1080 }, output, desktop);
        const winB = fakeWindow("win-b", { x: 960, y: 0, width: 960, height: 1080 }, output, desktop);
        const dbusCalls: Array<{ service: string; method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const fakeWorkspace = {
            activeWindow: winA as unknown,
            windowList: (): unknown[] => [winA, winB],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        };
        const handle = startPointerResizeAdapterEntry({
            workspace: fakeWorkspace,
            callDbus: (service, _p, _i, method, payload, callback): void => {
                dbusCalls.push({ service, method, payload });
                callbacks.push(callback);
            },
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(handle !== null);
        winA.resize = true;
        winA.interactiveMoveResizeStarted.handlers[0]?.();
        // Stepped proposal carries the boundary even though the fake live
        // frame geometry still shows the start rect.
        winA.interactiveMoveResizeStepped.handlers[0]?.({ x: 0, y: 0, width: 1000, height: 1080 });
        // Activation first resolves the Planner name; reply present so the
        // planner request follows with no service activation.
        assert.equal(dbusCalls.length, 1);
        assert.equal(dbusCalls[0]?.method, POINTER_RESIZE_GET_OWNER_METHOD);
        callbacks[0]?.(":1.42");
        assert.equal(dbusCalls.length, 2);
        const planner = dbusCalls[1] as { service: string; payload: string };
        assert.equal(planner.service, ":1.42");
        const payload = JSON.parse(planner.payload) as Record<string, unknown>;
        assert.equal(payload["action"], "request-pointer");
        assert.equal(payload["proposed_boundary"], 1000);
        handle.stop();
    });

    it("explicit entry requires exclusive authority and fails closed", () => {
        const handle = startPointerResizeAdapterEntry({
            workspace: {},
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
        });
        assert.equal(handle, null);
    });

    it("explicit entry rejects a non-function authority", () => {
        const handle = startPointerResizeAdapterEntry({
            workspace: {},
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: true as unknown as () => boolean,
        });
        assert.equal(handle, null);
    });

    it("explicit entry fails closed with no interactive subscriptions", () => {
        const logs: string[] = [];
        const handle = startPointerResizeAdapterEntry({
            workspace: { windowList: (): unknown[] => [{}] },
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.equal(handle, null);
        assert.ok(logs.some((line) => line.includes("pointer-entry-invalid")));
    });

    it("connects public geometry signals for the recursion guard without classifying gestures", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const winA = fakeWindow("win-a", { x: 0, y: 0, width: 960, height: 1080 }, output, desktop);
        const winB = fakeWindow("win-b", { x: 960, y: 0, width: 960, height: 1080 }, output, desktop);
        const dbusCalls: Array<{ service: string; method: string; payload: string }> = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const fakeWorkspace = {
            activeWindow: winA as unknown,
            windowList: (): unknown[] => [winA, winB],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        };
        const handle = startPointerResizeAdapterEntry({
            workspace: fakeWorkspace,
            callDbus: (service, _p, _i, method, payload, callback): void => {
                dbusCalls.push({ service, method, payload });
                callbacks.push(callback);
            },
            scheduleOnce: () => () => {},
            log: () => {},
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(handle !== null);
        // Public geometry notification is connected per window alongside the
        // three interactive signals, using only public signals.
        assert.equal(winA.moveResizedChanged.handlers.length, 1);
        assert.equal(winB.moveResizedChanged.handlers.length, 1);
        // Geometry alone never classifies a gesture or sends a request.
        winA.moveResizedChanged.handlers[0]?.();
        winB.moveResizedChanged.handlers[0]?.();
        assert.equal(dbusCalls.length, 0);
        // Source geometry progression through the public signal stays
        // expected: a subsequent stepped proposal still sends exactly one
        // planner request after activation.
        winA.resize = true;
        winA.interactiveMoveResizeStarted.handlers[0]?.();
        winA.moveResizedChanged.handlers[0]?.();
        assert.equal(dbusCalls.length, 0);
        winA.interactiveMoveResizeStepped.handlers[0]?.({ x: 0, y: 0, width: 1000, height: 1080 });
        assert.equal(dbusCalls.length, 1);
        callbacks[0]?.(":1.42");
        assert.equal(dbusCalls.length, 2);
        assert.equal(dbusCalls[1]?.service, ":1.42");
        handle.stop();
        assert.equal(winA.moveResizedChanged.handlers.length, 0);
        assert.equal(winB.moveResizedChanged.handlers.length, 0);
    });
});

interface Qv4PointerSignal {
    readonly fire: (payload?: unknown) => void;
    readonly count: () => number;
}

function makeQv4PointerSignal(throwOnConnect = false): Qv4PointerSignal & ((...args: readonly unknown[]) => void) {
    const handlers = new Set<(payload?: unknown) => void>();
    const fn = function (): void {};
    Object.setPrototypeOf(fn, {
        connect: (handler: (payload?: unknown) => void): void => {
            if (throwOnConnect) {
                throw new Error("qv4-connect-failed");
            }
            handlers.add(handler);
        },
        disconnect: (handler: (payload?: unknown) => void): void => {
            handlers.delete(handler);
        },
    });
    const callable = fn as unknown as Qv4PointerSignal & ((...args: readonly unknown[]) => void);
    (callable as unknown as Record<string, unknown>)["fire"] = (payload?: unknown): void => {
        for (const handler of [...handlers]) {
            handler(payload);
        }
    };
    (callable as unknown as Record<string, unknown>)["count"] = (): number => handlers.size;
    return callable;
}

interface Qv4PointerWindow {
    [key: string]: unknown;
    internalId: string;
    frameGeometry: { x: number; y: number; width: number; height: number };
    move: boolean;
    resize: boolean;
}

function makeQv4PointerWindow(
    id: string,
    rect: { x: number; y: number; width: number; height: number },
    output: object,
    desktop: object,
    options: { readonly omitGeometry?: boolean; readonly omitStepped?: boolean; readonly throwOnSteppedConnect?: boolean } = {},
): { readonly win: Qv4PointerWindow; readonly signals: Record<string, Qv4PointerSignal & ((...args: readonly unknown[]) => void)> } {
    const signals: Record<string, Qv4PointerSignal & ((...args: readonly unknown[]) => void)> = {
        interactiveMoveResizeStarted: makeQv4PointerSignal(),
        interactiveMoveResizeStepped: makeQv4PointerSignal(options.throwOnSteppedConnect),
        interactiveMoveResizeFinished: makeQv4PointerSignal(),
        moveResizedChanged: makeQv4PointerSignal(),
    };
    const win: Qv4PointerWindow = {
        internalId: id,
        output,
        desktops: [desktop],
        normalWindow: true,
        managed: true,
        minimized: false,
        fullScreen: false,
        maximizeMode: 0,
        onAllDesktops: false,
        resizeable: true,
        move: false,
        resize: false,
        frameGeometry: { ...rect },
        interactiveMoveResizeStarted: signals["interactiveMoveResizeStarted"],
        interactiveMoveResizeStepped: signals["interactiveMoveResizeStepped"],
        interactiveMoveResizeFinished: signals["interactiveMoveResizeFinished"],
        moveResizedChanged: signals["moveResizedChanged"],
    };
    if (options.omitGeometry) {
        delete win["moveResizedChanged"];
        delete signals["moveResizedChanged"];
    }
    if (options.omitStepped) {
        delete win["interactiveMoveResizeStepped"];
        delete signals["interactiveMoveResizeStepped"];
    }
    return { win, signals };
}

describe("pointer entry QV4 callable signal startup", () => {
    it("attaches exact callable interactive signals and detaches idempotently", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const a = makeQv4PointerWindow("win-a", { x: 0, y: 0, width: 960, height: 1080 }, output, desktop);
        const b = makeQv4PointerWindow("win-b", { x: 960, y: 0, width: 960, height: 1080 }, output, desktop);
        const logs: string[] = [];
        for (const signal of [...Object.values(a.signals), ...Object.values(b.signals)]) {
            assert.equal(typeof signal, "function");
        }
        const handle = startPointerResizeAdapterEntry({
            workspace: {
                activeWindow: a.win as unknown,
                windowList: (): unknown[] => [a.win, b.win],
                currentDesktopForScreen: (): unknown => desktop,
                clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            },
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(handle !== null);
        assert.ok(logs.some((line) => line.endsWith(":ready")));
        for (const signal of [...Object.values(a.signals), ...Object.values(b.signals)]) {
            assert.equal(signal.count(), 1);
        }
        handle.stop();
        for (const signal of [...Object.values(a.signals), ...Object.values(b.signals)]) {
            assert.equal(signal.count(), 0);
        }
        handle.stop();
        for (const signal of [...Object.values(a.signals), ...Object.values(b.signals)]) {
            assert.equal(signal.count(), 0);
        }
    });

    it("keeps optional geometry omission safe while required absence blocks startup", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const a = makeQv4PointerWindow("win-a", { x: 0, y: 0, width: 960, height: 1080 }, output, desktop, { omitGeometry: true });
        const b = makeQv4PointerWindow("win-b", { x: 960, y: 0, width: 960, height: 1080 }, output, desktop, { omitGeometry: true });
        const logs: string[] = [];
        const ok = startPointerResizeAdapterEntry({
            workspace: {
                activeWindow: a.win as unknown,
                windowList: (): unknown[] => [a.win, b.win],
                currentDesktopForScreen: (): unknown => desktop,
                clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            },
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(ok !== null);
        assert.ok(logs.some((line) => line.endsWith(":ready")));
        ok.stop();
        const c = makeQv4PointerWindow("win-a", { x: 0, y: 0, width: 960, height: 1080 }, output, desktop, { omitStepped: true });
        const d = makeQv4PointerWindow("win-b", { x: 960, y: 0, width: 960, height: 1080 }, output, desktop, { omitStepped: true });
        const blockedLogs: string[] = [];
        const blocked = startPointerResizeAdapterEntry({
            workspace: {
                activeWindow: c.win as unknown,
                windowList: (): unknown[] => [c.win, d.win],
                currentDesktopForScreen: (): unknown => desktop,
                clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            },
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                blockedLogs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.equal(blocked, null);
        for (const signal of [...Object.values(c.signals), ...Object.values(d.signals)]) {
            assert.equal(signal.count(), 0);
        }
    });

    it("rolls back exactly with no duplicates when a required connect fails", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const a = makeQv4PointerWindow("win-a", { x: 0, y: 0, width: 960, height: 1080 }, output, desktop);
        const b = makeQv4PointerWindow("win-b", { x: 960, y: 0, width: 960, height: 1080 }, output, desktop, { throwOnSteppedConnect: true });
        const logs: string[] = [];
        const handle = startPointerResizeAdapterEntry({
            workspace: {
                activeWindow: a.win as unknown,
                windowList: (): unknown[] => [a.win, b.win],
                currentDesktopForScreen: (): unknown => desktop,
                clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            },
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message): void => {
                logs.push(message);
            },
            owner: "owner-1",
            generation: "gen-1",
            hasExclusiveResizeAuthority: () => true,
        });
        assert.equal(handle, null);
        for (const signal of [...Object.values(a.signals), ...Object.values(b.signals)]) {
            assert.equal(signal.count(), 0);
        }
    });
});
