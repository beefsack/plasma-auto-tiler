import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

import {
    NormalizedShadowBundle,
    PLANNER_CONTRACT_VERSION,
    PLANNER_INTERFACE,
    PLANNER_MAX_REPLY_BYTES,
    PLANNER_MAX_REQUEST_BYTES,
    PLANNER_METHOD,
    PLANNER_OBJECT,
    PLANNER_SERVICE,
    PLANNER_TIMEOUT_MS,
    PlannerShadowProbe,
    SHADOW_CAPABILITIES,
    SHADOW_PROBE_DIRECTION,
    ShadowNormalizeInput,
    createShadowSession,
    normalizeShadowRequest,
    readShadowNativeSnapshot,
    sameShadowTopology,
    validateShadowReply,
} from "../src/planner-shadow";

function tile(): object {
    return {};
}

function win(): object {
    return {};
}

function baseInput(overrides: Partial<ShadowNormalizeInput> = {}): ShadowNormalizeInput {
    const first = tile();
    const second = tile();
    const firstWindow = win();
    const secondWindow = win();
    return {
        leaves: [
            { tile: first, window: firstWindow },
            { tile: second, window: secondWindow },
        ],
        focusedTile: first,
        focusedWindow: firstWindow,
        direction: "right",
        correlationId: "corr-1",
        generation: "gen-1",
        revision: 0,
        root: {},
        output: {},
        workspace: {},
        desktop: {},
        ...overrides,
    };
}

function normalizeOrThrow(input: ShadowNormalizeInput): NormalizedShadowBundle {
    const result = normalizeShadowRequest(input);
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error("expected normalize ok");
    }
    return result.bundle;
}

function plannedReply(bundle: NormalizedShadowBundle): string {
    return JSON.stringify({
        v: 1,
        correlation_id: bundle.correlationId,
        generation: bundle.generation,
        revision: bundle.revision,
        outcome: "planned",
        rule: "R2a",
        capability: "swap-neighbor",
        preconditions: ["adapter-must-verify-postconditions"],
        operation: {
            kind: "swap-neighbor",
            rule: "R2a",
            container: "root",
            neighbor: "leaf-b",
        },
    });
}

interface ProbeMocks {
    readonly dbusCalls: Array<{ service: string; path: string; iface: string; method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    readonly timers: Array<{ delayMs: number; callback: () => void; cancelled: boolean }>;
    readonly logs: string[];
    readonly env: {
        callDbus: (
            service: string,
            path: string,
            iface: string,
            method: string,
            payload: string,
            callback: (reply: unknown) => void,
        ) => void;
        scheduleOnce: (delayMs: number, callback: () => void) => () => void;
        log: (message: string) => void;
        readFresh: () => ShadowNormalizeInput | null;
    };
}

function mockEnv(fresh: () => ShadowNormalizeInput | null): ProbeMocks {
    const mocks: Omit<ProbeMocks, "env"> = {
        dbusCalls: [],
        callbacks: [],
        timers: [],
        logs: [],
    };
    const env: ProbeMocks["env"] = {
        callDbus: (service, path, iface, method, payload, callback): void => {
            mocks.dbusCalls.push({ service, path, iface, method, payload });
            mocks.callbacks.push(callback);
        },
        scheduleOnce: (delayMs, callback): (() => void) => {
            const entry = { delayMs, callback, cancelled: false };
            mocks.timers.push(entry);
            return () => {
                entry.cancelled = true;
            };
        },
        log: (message): void => {
            mocks.logs.push(message);
        },
        readFresh: (): ShadowNormalizeInput | null => fresh(),
    };
    return { ...mocks, env };
}

function armedProbe(
    input: ShadowNormalizeInput,
    fresh?: () => ShadowNormalizeInput | null,
): { probe: PlannerShadowProbe; bundle: NormalizedShadowBundle; env: ProbeMocks } {
    const bundle = normalizeOrThrow(input);
    const freshFn = fresh ?? ((): ShadowNormalizeInput | null => input);
    const holder = mockEnv(freshFn);
    const probe = new PlannerShadowProbe(holder.env);
    probe.enableOnce();
    probe.runOnce(bundle);
    return { probe, bundle, env: holder };
}

interface NativeRig {
    readonly workspace: unknown;
    readonly output: Record<string, unknown>;
    readonly desktop: Record<string, unknown>;
    readonly root: Record<string, unknown>;
    readonly firstTile: Record<string, unknown>;
    readonly secondTile: Record<string, unknown>;
    readonly firstWindow: Record<string, unknown>;
    readonly secondWindow: Record<string, unknown>;
}

function twoLeafRig(): NativeRig {
    const output: Record<string, unknown> = {};
    const desktop: Record<string, unknown> = { id: "desktop-1" };
    const firstWindow: Record<string, unknown> = {};
    const secondWindow: Record<string, unknown> = {};
    const firstTile: Record<string, unknown> = { isLayout: false, tiles: [], windows: [firstWindow] };
    const secondTile: Record<string, unknown> = { isLayout: false, tiles: [], windows: [secondWindow] };
    const root: Record<string, unknown> = {
        isLayout: true,
        layoutDirection: 1,
        tiles: [firstTile, secondTile],
        windows: [],
    };
    firstWindow["output"] = output;
    firstWindow["tile"] = firstTile;
    secondWindow["output"] = output;
    secondWindow["tile"] = secondTile;
    const workspace: unknown = {
        activeWindow: firstWindow,
        activeScreen: output,
        currentDesktopForScreen: (_output: unknown): unknown => desktop,
        rootTile: (_output: unknown, _desktop: unknown): unknown => root,
    };
    return { workspace, output, desktop, root, firstTile, secondTile, firstWindow, secondWindow };
}

describe("planner shadow contract constants", () => {
    it("uses the exact service identity and bounded sizes", () => {
        assert.equal(PLANNER_SERVICE, "org.plasmaautotiler.Planner");
        assert.equal(PLANNER_OBJECT, "/org/plasmaautotiler/Planner");
        assert.equal(PLANNER_INTERFACE, "org.plasmaautotiler.Planner1");
        assert.equal(PLANNER_METHOD, "EvaluateMove");
        assert.equal(PLANNER_CONTRACT_VERSION, 1);
        assert.equal(PLANNER_MAX_REQUEST_BYTES, 64 * 1024);
        assert.equal(PLANNER_MAX_REPLY_BYTES, 64 * 1024);
        assert.equal(PLANNER_TIMEOUT_MS, 2000);
        assert.equal(SHADOW_PROBE_DIRECTION, "right");
        assert.deepEqual(SHADOW_CAPABILITIES, {
            swap_neighbor: true,
            wrap_perpendicular: false,
            wrap_siblings: false,
            insert_child: false,
            split_group_child: false,
            reparent_leaf: false,
            cross_output_transfer: false,
        });
    });

    it("asserts the shared R2a golden fixture and its exact contract", () => {
        const golden = JSON.parse(
            readFileSync("../test-fixtures/planner-r2a-golden-v1.json", "utf8"),
        ) as Record<string, unknown>;
        assert.equal(golden["v"], 1);
        const request = golden["request"] as Record<string, unknown>;
        const expected = golden["expected"] as Record<string, unknown>;
        assert.equal(request["v"], PLANNER_CONTRACT_VERSION);
        assert.equal(request["correlation_id"], "planner-golden-r2a-1");
        assert.equal(request["correlation_id"], expected["correlation_id"]);
        assert.equal(request["generation"], "golden-gen-1");
        assert.equal(request["generation"], expected["generation"]);
        assert.equal(request["revision"], 0);
        assert.equal(request["revision"], expected["revision"]);
        assert.equal(expected["v"], PLANNER_CONTRACT_VERSION);
        assert.equal(expected["outcome"], "planned");
        assert.equal(expected["rule"], "R2a");
        assert.equal(expected["capability"], "swap-neighbor");
        const expectedOperation = expected["operation"] as Record<string, unknown>;
        assert.equal(expectedOperation["kind"], "swap-neighbor");
        assert.equal(expectedOperation["rule"], "R2a");
        assert.equal(expectedOperation["container"], "root");
        assert.equal(expectedOperation["neighbor"], "leaf-b");

        const mirror = normalizeOrThrow(
            baseInput({
                correlationId: request["correlation_id"] as string,
                generation: request["generation"] as string,
                revision: request["revision"] as number,
                direction: "right",
            }),
        );
        // POC2 shadow declares precisely swap-neighbor only; the shared
        // golden request still declares the full matrix, so the mirror must
        // match on every field except capabilities and must pin swap-only.
        const mirrorRequest = JSON.parse(mirror.requestJson) as Record<string, unknown>;
        const { capabilities: _ignoredGoldenCaps, ...goldenRest } = request as Record<string, unknown>;
        const { capabilities: _ignoredMirrorCaps, ...mirrorRest } = mirrorRequest;
        void _ignoredGoldenCaps;
        void _ignoredMirrorCaps;
        assert.deepEqual(mirrorRest, goldenRest);
        assert.deepEqual(mirrorRequest["capabilities"], {
            swap_neighbor: true,
            wrap_perpendicular: false,
            wrap_siblings: false,
            insert_child: false,
            split_group_child: false,
            reparent_leaf: false,
            cross_output_transfer: false,
        });
        const goldenReply = JSON.stringify({
            v: expected["v"],
            correlation_id: expected["correlation_id"],
            generation: expected["generation"],
            revision: expected["revision"],
            outcome: expected["outcome"],
            rule: expected["rule"],
            capability: expected["capability"],
            preconditions: ["adapter-must-verify-postconditions"],
            operation: expected["operation"],
        });
        const validated = validateShadowReply(goldenReply, mirror);
        assert.equal(validated.ok, true);
        if (validated.ok && validated.reply.outcome === "planned") {
            assert.equal(validated.reply.rule, "R2a");
            assert.equal(validated.reply.capability, "swap-neighbor");
        } else {
            assert.fail("expected planned golden reply");
        }
    });
});

describe("planner shadow normalizer", () => {
    it("builds the exact EvaluateMove shape with opaque logical ids", () => {
        const bundle = normalizeOrThrow(baseInput());
        const request = JSON.parse(bundle.requestJson) as Record<string, unknown>;
        assert.deepEqual(Object.keys(request).sort(), [
            "capabilities",
            "correlation_id",
            "generation",
            "intent",
            "revision",
            "snapshot",
            "v",
        ]);
        assert.equal(request["v"], 1);
        assert.equal(bundle.focusedLeafId, "leaf-a");
        assert.equal(bundle.focusedWindowId, "window-a");
        assert.ok(bundle.requestJson.length <= PLANNER_MAX_REQUEST_BYTES);
        assert.deepEqual(bundle.snapshotIds, ["source", "root", "leaf-a", "leaf-b"]);
    });

    it("anchors native object identities for drift detection", () => {
        const input = baseInput();
        const bundle = normalizeOrThrow(input);
        const firstLeaf = input.leaves[0];
        const secondLeaf = input.leaves[1];
        assert.ok(firstLeaf !== undefined && secondLeaf !== undefined);
        assert.equal(bundle.tileIdentities.length, 2);
        assert.equal(bundle.tileIdentities[0], firstLeaf.tile);
        assert.equal(bundle.tileIdentities[1], secondLeaf.tile);
        assert.equal(bundle.focusedTileRef, input.focusedTile);
        assert.equal(bundle.focusedWindowRef, input.focusedWindow);
        assert.equal(bundle.rootRef, input.root);
        assert.equal(bundle.outputRef, input.output);
        assert.equal(bundle.workspaceRef, input.workspace);
        assert.equal(bundle.desktopRef, input.desktop);
        assert.equal(sameShadowTopology(bundle, bundle), true);
    });

    it("declares precisely swap-neighbor and rejects any other capability set", () => {
        const bundle = normalizeOrThrow(baseInput());
        assert.deepEqual(bundle.capabilities, {
            swap_neighbor: true,
            wrap_perpendicular: false,
            wrap_siblings: false,
            insert_child: false,
            split_group_child: false,
            reparent_leaf: false,
            cross_output_transfer: false,
        });
        const input = baseInput();
        assert.equal(normalizeShadowRequest({ ...input, capabilities: { swap_neighbor: false } }).ok, false);
        assert.equal(
            normalizeShadowRequest({ ...input, capabilities: { swap_neighbor: true } }).ok,
            true,
        );
        assert.equal(
            normalizeShadowRequest({ ...input, capabilities: { wrap_perpendicular: true } }).ok,
            false,
        );
        assert.equal(
            normalizeShadowRequest({ ...input, capabilities: { insert_child: true } }).ok,
            false,
        );
    });

    it("fails closed when root, output, workspace, or desktop anchors are missing", () => {
        const input = baseInput();
        for (const mutate of [
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, root: null as never }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, output: null as never }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({
                ...fresh,
                workspace: null as never,
            }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, desktop: null as never }),
        ]) {
            const result = normalizeShadowRequest(mutate(input));
            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.reason, "shadow-unsupported-topology");
            }
        }
    });

    it("supports a single direct leaf and redacts native values", () => {
        const secretTile = tile();
        (secretTile as Record<string, unknown>)["caption"] = "SECRET-CAPTION-XYZ";
        (secretTile as Record<string, unknown>)["geometry"] = { x: 1, y: 2, width: 3, height: 4 };
        (secretTile as Record<string, unknown>)["handle"] = "SECRET-HANDLE-9";
        (secretTile as Record<string, unknown>)["layoutDirection"] = "SECRET-TILE-TYPE";
        const secretWindow = win();
        (secretWindow as Record<string, unknown>)["caption"] = "SECRET-WIN-CAPTION";
        const input = baseInput({
            leaves: [{ tile: secretTile, window: secretWindow }],
            focusedTile: secretTile,
            focusedWindow: secretWindow,
        });
        const bundle = normalizeOrThrow(input);
        assert.deepEqual(bundle.snapshotIds, ["source", "leaf-a"]);
        for (const secret of [
            "SECRET-CAPTION-XYZ",
            "SECRET-HANDLE-9",
            "SECRET-WIN-CAPTION",
            "SECRET-TILE-TYPE",
        ]) {
            assert.ok(!bundle.requestJson.includes(secret), `leaked ${secret}`);
        }
        for (const forbidden of ["caption", "geometry", "handle", "KWin", "tileChanged"]) {
            assert.ok(!bundle.requestJson.includes(forbidden), `transmits ${forbidden}`);
        }
    });

    it("refuses out-of-shape topologies without echo", () => {
        const three = baseInput({
            leaves: [
                { tile: tile(), window: win() },
                { tile: tile(), window: win() },
                { tile: tile(), window: win() },
            ],
            focusedTile: {},
            focusedWindow: {},
        });
        assert.equal(normalizeShadowRequest(three).ok, false);

        const empty = baseInput({ leaves: [] });
        const emptyResult = normalizeShadowRequest(empty);
        assert.equal(emptyResult.ok, false);
        if (!emptyResult.ok) {
            assert.equal(emptyResult.reason, "shadow-unsupported-topology");
        }

        const dupTile = tile();
        const dup = baseInput({
            leaves: [
                { tile: dupTile, window: win() },
                { tile: dupTile, window: win() },
            ],
            focusedTile: dupTile,
            focusedWindow: (baseInput().leaves[0] as { window: object }).window as object,
        });
        assert.equal(normalizeShadowRequest(dup).ok, false);
    });

    it("refuses intent and identity violations", () => {
        const input = baseInput();
        const other = tile();
        assert.equal(normalizeShadowRequest({ ...input, focusedTile: other }).ok, false);
        assert.equal(normalizeShadowRequest({ ...input, correlationId: "" }).ok, false);
        assert.equal(normalizeShadowRequest({ ...input, correlationId: "BAD ID!" }).ok, false);
        assert.equal(normalizeShadowRequest({ ...input, generation: "UPPERCASE" }).ok, false);
        assert.equal(normalizeShadowRequest({ ...input, revision: -1 }).ok, false);
        assert.equal(
            normalizeShadowRequest({ ...input, direction: "diagonal" as never }).ok,
            false,
        );
    });
});

describe("planner shadow native reader", () => {
    it("reads the actual live two-leaf topology with fixed R2a direction", () => {
        const rig = twoLeafRig();
        const live = readShadowNativeSnapshot(rig.workspace);
        assert.equal(live.ok, true);
        if (!live.ok) {
            throw new Error("expected live snapshot ok");
        }
        assert.equal(live.snapshot.direction, SHADOW_PROBE_DIRECTION);
        assert.equal(live.snapshot.direction, "right");
        assert.equal(live.snapshot.focusedTile, rig.firstTile);
        assert.equal(live.snapshot.focusedWindow, rig.firstWindow);
        assert.equal(live.snapshot.root, rig.root);
        assert.equal(live.snapshot.output, rig.output);
        assert.equal(live.snapshot.desktop, rig.desktop);
        const session = createShadowSession("probe-native-gen");
        const identity = session.nextIdentity();
        const bundle = normalizeOrThrow({
            leaves: live.snapshot.leaves,
            focusedTile: live.snapshot.focusedTile,
            focusedWindow: live.snapshot.focusedWindow,
            direction: live.snapshot.direction,
            correlationId: identity.correlationId,
            generation: identity.generation,
            revision: identity.revision,
            root: live.snapshot.root,
            output: live.snapshot.output,
            workspace: live.snapshot.workspace,
            desktop: live.snapshot.desktop,
        });
        assert.equal(bundle.focusedLeafId, "leaf-a");
        assert.equal(bundle.focusedWindowId, "window-a");
        assert.deepEqual(bundle.snapshotIds, ["source", "root", "leaf-a", "leaf-b"]);
    });

    it("reads a single-leaf root and redacts secrets end to end", () => {
        const output: Record<string, unknown> = {};
        const desktop: Record<string, unknown> = {};
        const singleWindow: Record<string, unknown> = { caption: "SECRET-NATIVE-CAPTION" };
        const singleRoot: Record<string, unknown> = {
            isLayout: false,
            tiles: [],
            windows: [singleWindow],
            geometry: "SECRET-NATIVE-GEOMETRY",
        };
        singleWindow["output"] = output;
        singleWindow["tile"] = singleRoot;
        const workspace: unknown = {
            activeWindow: singleWindow,
            activeScreen: output,
            currentDesktopForScreen: (): unknown => desktop,
            rootTile: (): unknown => singleRoot,
        };
        const live = readShadowNativeSnapshot(workspace);
        assert.equal(live.ok, true);
        if (!live.ok) {
            throw new Error("expected single-leaf snapshot ok");
        }
        const bundle = normalizeOrThrow({
            ...baseInput(),
            leaves: live.snapshot.leaves,
            focusedTile: live.snapshot.focusedTile,
            focusedWindow: live.snapshot.focusedWindow,
            direction: live.snapshot.direction,
            root: live.snapshot.root,
            output: live.snapshot.output,
            workspace: live.snapshot.workspace,
            desktop: live.snapshot.desktop,
        });
        assert.deepEqual(bundle.snapshotIds, ["source", "leaf-a"]);
        assert.ok(!bundle.requestJson.includes("SECRET-NATIVE-CAPTION"));
        assert.ok(!bundle.requestJson.includes("SECRET-NATIVE-GEOMETRY"));
        for (const forbidden of ["caption", "geometry", "layoutDirection"]) {
            assert.ok(!bundle.requestJson.includes(forbidden), `transmits ${forbidden}`);
        }
    });

    it("constrains the two-leaf group to exactly horizontal and never serializes platform terms", () => {
        const rig = twoLeafRig();
        const withDirection = (layoutDirection: unknown): unknown => ({
            activeWindow: rig.firstWindow,
            activeScreen: rig.output,
            currentDesktopForScreen: (): unknown => rig.desktop,
            rootTile: (): unknown => ({
                isLayout: true,
                layoutDirection,
                tiles: [rig.firstTile, rig.secondTile],
                windows: [],
            }),
        });
        const horizontal = readShadowNativeSnapshot(withDirection(1));
        assert.equal(horizontal.ok, true);
        for (const bad of [2, 0, "horizontal", null, undefined]) {
            const result = readShadowNativeSnapshot(withDirection(bad));
            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.reason, "shadow-unsupported-topology");
            }
        }
        if (!horizontal.ok) {
            throw new Error("expected horizontal snapshot ok");
        }
        const session = createShadowSession("probe-axis-gen");
        const identity = session.nextIdentity();
        const bundle = normalizeOrThrow({
            leaves: horizontal.snapshot.leaves,
            focusedTile: horizontal.snapshot.focusedTile,
            focusedWindow: horizontal.snapshot.focusedWindow,
            direction: horizontal.snapshot.direction,
            correlationId: identity.correlationId,
            generation: identity.generation,
            revision: identity.revision,
            root: horizontal.snapshot.root,
            output: horizontal.snapshot.output,
            workspace: horizontal.snapshot.workspace,
            desktop: horizontal.snapshot.desktop,
        });
        const request = JSON.parse(bundle.requestJson) as Record<string, unknown>;
        const outputs = (request["snapshot"] as Record<string, unknown>)["outputs"] as Array<
            Record<string, unknown>
        >;
        assert.equal((outputs[0]?.["tree"] as Record<string, unknown>)["axis"], "horizontal");
        assert.ok(!bundle.requestJson.includes("layoutDirection"));
        assert.ok(!bundle.requestJson.includes("vertical"));
    });

    it("fails closed on unsupported roots, trees, and occupancy", () => {
        const rig = twoLeafRig();
        const withRoot = (root: unknown): unknown => ({
            activeWindow: rig.firstWindow,
            activeScreen: rig.output,
            currentDesktopForScreen: (): unknown => rig.desktop,
            rootTile: (): unknown => root,
        });

        const threeChildren = {
            isLayout: true,
            layoutDirection: 1,
            tiles: [rig.firstTile, rig.secondTile, {}],
            windows: [],
        };
        assert.equal(readShadowNativeSnapshot(withRoot(threeChildren)).ok, false);

        const nestedChild = { isLayout: true, tiles: [], windows: [] };
        const nestedRoot = {
            isLayout: true,
            layoutDirection: 1,
            tiles: [nestedChild, rig.secondTile],
            windows: [],
        };
        assert.equal(readShadowNativeSnapshot(withRoot(nestedRoot)).ok, false);

        const emptyLeaf = { isLayout: false, tiles: [], windows: [] };
        const emptyRoot = {
            isLayout: true,
            layoutDirection: 1,
            tiles: [emptyLeaf, rig.secondTile],
            windows: [],
        };
        assert.equal(readShadowNativeSnapshot(withRoot(emptyRoot)).ok, false);

        const crowdedLeaf = { isLayout: false, tiles: [], windows: [rig.firstWindow, rig.secondWindow] };
        const crowdedRoot = {
            isLayout: true,
            layoutDirection: 1,
            tiles: [crowdedLeaf, rig.secondTile],
            windows: [],
        };
        assert.equal(readShadowNativeSnapshot(withRoot(crowdedRoot)).ok, false);

        const occupiedRoot = {
            isLayout: true,
            layoutDirection: 1,
            tiles: [rig.firstTile, rig.secondTile],
            windows: [rig.firstWindow],
        };
        assert.equal(readShadowNativeSnapshot(withRoot(occupiedRoot)).ok, false);

        const singleChildGroup = { isLayout: true, layoutDirection: 1, tiles: [rig.firstTile], windows: [] };
        assert.equal(readShadowNativeSnapshot(withRoot(singleChildGroup)).ok, false);

        const noFocus: unknown = {
            activeWindow: null,
            activeScreen: rig.output,
            currentDesktopForScreen: (): unknown => rig.desktop,
            rootTile: (): unknown => rig.root,
        };
        const noFocusResult = readShadowNativeSnapshot(noFocus);
        assert.equal(noFocusResult.ok, false);
        if (!noFocusResult.ok) {
            assert.equal(noFocusResult.reason, "shadow-invalid-intent");
        }

        const nullRoot: unknown = {
            activeWindow: rig.firstWindow,
            activeScreen: rig.output,
            currentDesktopForScreen: (): unknown => rig.desktop,
            rootTile: (): unknown => null,
        };
        assert.equal(readShadowNativeSnapshot(nullRoot).ok, false);

        const foreignTile = {};
        const foreignWindow = { output: rig.output, tile: foreignTile };
        const foreign: unknown = {
            activeWindow: foreignWindow,
            activeScreen: rig.output,
            currentDesktopForScreen: (): unknown => rig.desktop,
            rootTile: (): unknown => rig.root,
        };
        assert.equal(readShadowNativeSnapshot(foreign).ok, false);
    });
});

describe("planner shadow session identity", () => {
    it("generates a per-load valid generation with monotonic revisions", () => {
        const session = createShadowSession("probe-test-gen");
        assert.equal(session.generation, "probe-test-gen");
        const first = session.nextIdentity();
        const second = session.nextIdentity();
        const third = session.nextIdentity();
        assert.deepEqual(
            [first.revision, second.revision, third.revision],
            [0, 1, 2],
        );
        assert.ok(first.correlationId !== second.correlationId);
        assert.ok(second.correlationId !== third.correlationId);
        for (const identity of [first, second, third]) {
            const bundle = normalizeShadowRequest({ ...baseInput(), ...identity });
            assert.equal(bundle.ok, true);
        }
    });

    it("falls back to a valid generation for invalid input", () => {
        const session = createShadowSession("UPPERCASE-INVALID?");
        const identity = session.nextIdentity();
        assert.equal(normalizeShadowRequest({ ...baseInput(), ...identity }).ok, true);
        const implicit = createShadowSession();
        const implicitIdentity = implicit.nextIdentity();
        assert.equal(
            normalizeShadowRequest({ ...baseInput(), ...implicitIdentity }).ok,
            true,
        );
    });
});

describe("planner shadow reply validation", () => {
    it("accepts the positive R2a advisory shape", () => {
        const bundle = normalizeOrThrow(baseInput());
        const result = validateShadowReply(plannedReply(bundle), bundle);
        assert.equal(result.ok, true);
    });

    it("accepts noop and structural refusal shapes", () => {
        const bundle = normalizeOrThrow(baseInput());
        const noop = validateShadowReply(
            JSON.stringify({
                v: 1,
                correlation_id: bundle.correlationId,
                generation: bundle.generation,
                revision: bundle.revision,
                outcome: "noop",
                reason: "single-root-leaf",
            }),
            bundle,
        );
        assert.equal(noop.ok, true);
        const refused = validateShadowReply(
            JSON.stringify({
                v: 1,
                correlation_id: bundle.correlationId,
                generation: bundle.generation,
                revision: bundle.revision,
                outcome: "rejected",
                kind: "unsupported-topology",
                message: "operation needs an undeclared capability",
            }),
            bundle,
        );
        assert.equal(refused.ok, true);
    });

    it("rejects malformed and oversized replies", () => {
        const bundle = normalizeOrThrow(baseInput());
        assert.equal(validateShadowReply("{not json", bundle).ok, false);
        assert.equal(validateShadowReply(42 as never, bundle).ok, false);
        assert.equal(validateShadowReply(JSON.stringify({ v: 1 }), bundle).ok, false);
        const oversized = `{"v":1${" ".repeat(PLANNER_MAX_REPLY_BYTES)}}`;
        const oversizedResult = validateShadowReply(oversized, bundle);
        assert.equal(oversizedResult.ok, false);
        if (!oversizedResult.ok) {
            assert.equal(oversizedResult.reason, "shadow-reply-oversized");
        }
    });

    it("rejects stale identity across version, correlation, generation, and revision", () => {
        const bundle = normalizeOrThrow(baseInput());
        for (const mutate of [
            (reply: Record<string, unknown>): void => {
                reply["v"] = 2;
            },
            (reply: Record<string, unknown>): void => {
                reply["correlation_id"] = "corr-other";
            },
            (reply: Record<string, unknown>): void => {
                reply["generation"] = "gen-other";
            },
            (reply: Record<string, unknown>): void => {
                reply["revision"] = 1;
            },
        ]) {
            const stale = JSON.parse(plannedReply(bundle)) as Record<string, unknown>;
            mutate(stale);
            const result = validateShadowReply(JSON.stringify(stale), bundle);
            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.reason, "shadow-identity-mismatch");
            }
        }
    });

    it("rejects capability and precondition mismatches", () => {
        const bundle = normalizeOrThrow(baseInput());
        // Declaring anything except precisely swap-neighbor-only fails at
        // normalize time, so an R2a reply can never be framed as supported.
        const disabled = normalizeShadowRequest(baseInput({ capabilities: { swap_neighbor: false } }));
        assert.equal(disabled.ok, false);
        if (!disabled.ok) {
            assert.equal(disabled.reason, "shadow-invalid-intent");
        }
        assert.equal(
            normalizeShadowRequest(baseInput({ capabilities: { wrap_perpendicular: true } })).ok,
            false,
        );

        const unknownCapability = JSON.parse(plannedReply(bundle)) as Record<string, unknown>;
        unknownCapability["capability"] = "tile-spin";
        assert.equal(validateShadowReply(JSON.stringify(unknownCapability), bundle).ok, false);

        const badPrecondition = JSON.parse(plannedReply(bundle)) as Record<string, unknown>;
        badPrecondition["preconditions"] = ["native-caption-check"];
        const preconditionResult = validateShadowReply(JSON.stringify(badPrecondition), bundle);
        assert.equal(preconditionResult.ok, false);
        if (!preconditionResult.ok) {
            assert.equal(preconditionResult.reason, "shadow-precondition-mismatch");
        }
    });

    it("rejects R2b and structural replies before could-execute", () => {
        const bundle = normalizeOrThrow(baseInput());
        const structuralCases: Array<{
            name: string;
            mutate: (reply: Record<string, unknown>) => void;
        }> = [
            {
                name: "R2b rule",
                mutate: (reply) => {
                    reply["rule"] = "R2b";
                    (reply["operation"] as Record<string, unknown>)["rule"] = "R2b";
                    reply["capability"] = "insert-child";
                    reply["operation"] = {
                        kind: "insert-into-group",
                        rule: "R2b",
                        container: "root",
                        target_group: "root",
                        insertion_index: 0,
                        insertion: "midpoint",
                    };
                },
            },
            {
                name: "R2a wrap capability",
                mutate: (reply) => {
                    reply["capability"] = "wrap-perpendicular";
                    reply["operation"] = {
                        kind: "wrap-perpendicular",
                        rule: "R2a",
                        container: "root",
                        axis: "horizontal",
                    };
                },
            },
            {
                name: "split structural kind",
                mutate: (reply) => {
                    reply["rule"] = "R2b";
                    (reply["operation"] as Record<string, unknown>)["rule"] = "R2b";
                    reply["capability"] = "split-group-child";
                    reply["operation"] = {
                        kind: "split-group-child",
                        rule: "R2b",
                        container: "root",
                        target_group: "root",
                        target_child: "leaf-a",
                        target_child_index: 0,
                        focused_side: "first",
                        axis: "horizontal",
                    };
                },
            },
        ];
        for (const { name, mutate } of structuralCases) {
            const candidate = JSON.parse(plannedReply(bundle)) as Record<string, unknown>;
            mutate(candidate);
            const result = validateShadowReply(JSON.stringify(candidate), bundle);
            assert.equal(result.ok, false, `structural reply accepted: ${name}`);
            if (!result.ok) {
                assert.equal(result.reason, "shadow-capability-mismatch");
            }
        }
    });

    it("rejects operations that escape the snapshot or break the rule shape", () => {
        const bundle = normalizeOrThrow(baseInput());
        const badOp = JSON.parse(plannedReply(bundle)) as Record<string, unknown>;
        (badOp["operation"] as Record<string, unknown>)["neighbor"] = "leaf-unknown";
        const escaped = validateShadowReply(JSON.stringify(badOp), bundle);
        assert.equal(escaped.ok, false);
        if (!escaped.ok) {
            assert.equal(escaped.reason, "shadow-operation-mismatch");
        }

        const ruleMismatch = JSON.parse(plannedReply(bundle)) as Record<string, unknown>;
        (ruleMismatch["operation"] as Record<string, unknown>)["rule"] = "R1";
        assert.equal(validateShadowReply(JSON.stringify(ruleMismatch), bundle).ok, false);
    });
});

describe("planner shadow probe", () => {
    it("is disabled at startup and never auto-sends", () => {
        const bundle = normalizeOrThrow(baseInput());
        const holder = mockEnv(() => baseInput());
        const probe = new PlannerShadowProbe(holder.env);
        assert.equal(probe.isArmed, false);
        assert.equal(probe.isInFlight, false);
        probe.runOnce(bundle);
        assert.equal(holder.dbusCalls.length, 0);
        assert.ok(holder.logs.some((line) => line.includes("shadow-disabled")));
    });

    it("wires the exact destination, object, interface, and method", () => {
        const input = baseInput();
        const { env } = armedProbe(input);
        assert.equal(env.dbusCalls.length, 1);
        const call = env.dbusCalls[0];
        assert.equal(call?.service, PLANNER_SERVICE);
        assert.equal(call?.path, PLANNER_OBJECT);
        assert.equal(call?.iface, PLANNER_INTERFACE);
        assert.equal(call?.method, PLANNER_METHOD);
        assert.equal(call?.payload, normalizeOrThrow(input).requestJson);
        assert.equal(env.timers.length, 1);
        assert.equal(env.timers[0]?.delayMs, PLANNER_TIMEOUT_MS);
    });

    it("allows one in-flight request and reports could-execute for R2a", () => {
        const input = baseInput();
        const { probe, bundle, env } = armedProbe(input);
        probe.runOnce(bundle);
        assert.ok(env.logs.some((line) => line.includes("shadow-busy")));
        assert.equal(env.dbusCalls.length, 1);
        const callback = env.callbacks[0];
        assert.ok(callback !== undefined);
        callback?.(plannedReply(bundle));
        assert.ok(
            env.logs.some((line) => line === "plasma-auto-tiler:planner-shadow:could-execute:R2a:swap-neighbor"),
        );
        assert.equal(probe.isInFlight, false);
    });

    it("reports structural refusal without native writes", () => {
        const input = baseInput();
        const { bundle, env } = armedProbe(input);
        const callback = env.callbacks[0];
        callback?.(
            JSON.stringify({
                v: 1,
                correlation_id: bundle.correlationId,
                generation: bundle.generation,
                revision: bundle.revision,
                outcome: "rejected",
                kind: "unsupported-topology",
                message: "operation needs an undeclared capability",
            }),
        );
        assert.ok(env.logs.some((line) => line.includes("shadow-rejected-unsupported-topology")));
        assert.ok(!env.logs.some((line) => line.includes("could-execute")));
    });

    it("reports noop outcomes with a redacted token", () => {
        const input = baseInput();
        const { bundle, env } = armedProbe(input);
        env.callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: bundle.correlationId,
                generation: bundle.generation,
                revision: bundle.revision,
                outcome: "noop",
                reason: "single-root-leaf",
            }),
        );
        assert.ok(env.logs.some((line) => line.includes("shadow-noop-single-root-leaf")));
        assert.ok(!env.logs.some((line) => line.includes("could-execute")));
    });

    it("fails closed on stale topology, swapped identities, and capability mismatch", () => {
        const input = baseInput();
        const drifted = armedProbe(input, () => null);
        drifted.env.callbacks[0]?.(plannedReply(drifted.bundle));
        assert.ok(drifted.env.logs.some((line) => line.includes("shadow-topology-drift")));

        const staleShape = armedProbe(input, () => ({
            ...input,
            direction: "left" as const,
        }));
        staleShape.env.callbacks[0]?.(plannedReply(staleShape.bundle));
        assert.ok(staleShape.env.logs.some((line) => line.includes("shadow-topology-drift")));

        const swapped = armedProbe(input, () => {
            const first = input.leaves[0] as { tile: object; window: object };
            const second = input.leaves[1] as { tile: object; window: object };
            return {
                ...input,
                leaves: [
                    { tile: second.tile, window: second.window },
                    { tile: first.tile, window: first.window },
                ],
                focusedTile: second.tile,
                focusedWindow: second.window,
            };
        });
        swapped.env.callbacks[0]?.(plannedReply(swapped.bundle));
        assert.ok(swapped.env.logs.some((line) => line.includes("shadow-topology-drift")));
        assert.ok(!swapped.env.logs.some((line) => line.includes("could-execute")));

        const replacementTile = tile();
        const replaced = armedProbe(input, () => ({
            ...input,
            leaves: [
                { tile: replacementTile, window: (input.leaves[0] as { window: object }).window as object },
                input.leaves[1] as { tile: object; window: object },
            ],
            focusedTile: replacementTile,
        }));
        replaced.env.callbacks[0]?.(plannedReply(replaced.bundle));
        assert.ok(replaced.env.logs.some((line) => line.includes("shadow-topology-drift")));

        // Declaring anything except swap-only never normalizes, so the probe
        // cannot even arm a mismatched-capability flight.
        const limited = normalizeShadowRequest(baseInput({ capabilities: { swap_neighbor: false } }));
        assert.equal(limited.ok, false);
    });

    it("fails closed on root, output, workspace, and desktop replacement with identical leaves", () => {
        const input = baseInput();
        for (const mutate of [
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, root: {} }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, output: {} }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, workspace: {} }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, desktop: {} }),
        ]) {
            const drifted = armedProbe(input, () => mutate(input));
            drifted.env.callbacks[0]?.(plannedReply(drifted.bundle));
            assert.ok(
                drifted.env.logs.some((line) => line.includes("shadow-topology-drift")),
                "expected topology drift on anchor replacement",
            );
            assert.ok(!drifted.env.logs.some((line) => line.includes("could-execute")));
        }
    });

    it("never reports could-execute for an R2b structural reply", () => {
        const input = baseInput();
        const { bundle, env } = armedProbe(input);
        env.callbacks[0]?.(
            JSON.stringify({
                v: 1,
                correlation_id: bundle.correlationId,
                generation: bundle.generation,
                revision: bundle.revision,
                outcome: "planned",
                rule: "R2b",
                capability: "insert-child",
                preconditions: ["adapter-must-verify-postconditions"],
                operation: {
                    kind: "insert-into-group",
                    rule: "R2b",
                    container: "root",
                    target_group: "root",
                    insertion_index: 0,
                    insertion: "midpoint",
                },
            }),
        );
        assert.ok(!env.logs.some((line) => line.includes("could-execute")));
        assert.ok(env.logs.some((line) => line.includes("shadow-capability-mismatch")));
    });

    it("fails closed on fresh correlation, generation, and revision drift", () => {
        const input = baseInput();
        for (const mutate of [
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, correlationId: "corr-drift" }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, generation: "gen-drift" }),
            (fresh: ShadowNormalizeInput): ShadowNormalizeInput => ({ ...fresh, revision: fresh.revision + 1 }),
        ]) {
            const drifted = armedProbe(input, () => mutate(input));
            drifted.env.callbacks[0]?.(plannedReply(drifted.bundle));
            assert.ok(
                drifted.env.logs.some((line) => line.includes("shadow-identity-mismatch")),
                "expected identity mismatch",
            );
            assert.ok(!drifted.env.logs.some((line) => line.includes("could-execute")));
        }
    });

    it("times out once with no retry and ignores the late reply", () => {
        const input = baseInput();
        const { probe, bundle, env } = armedProbe(input);
        const timer = env.timers[0];
        assert.ok(timer !== undefined);
        timer?.callback();
        assert.ok(env.logs.some((line) => line.includes("shadow-timeout")));
        assert.equal(env.dbusCalls.length, 1);
        assert.equal(probe.isInFlight, false);
        env.callbacks[0]?.(plannedReply(bundle));
        assert.ok(!env.logs.some((line) => line.includes("could-execute")));
        assert.equal(env.dbusCalls.length, 1);
    });

    it("treats an absent service as a timeout without fake owner events", () => {
        const input = baseInput();
        const bundle = normalizeOrThrow(input);
        const holder = mockEnv(() => input);
        const probe = new PlannerShadowProbe(holder.env);
        assert.equal(
            typeof (probe as unknown as Record<string, unknown>)["notifyOwnerLost"],
            "undefined",
        );
        assert.equal(
            typeof (probe as unknown as Record<string, unknown>)["notifyUnloaded"],
            "undefined",
        );
        probe.enableOnce();
        probe.runOnce(bundle);
        assert.equal(holder.dbusCalls.length, 1);
        holder.timers[0]?.callback();
        assert.ok(holder.logs.some((line) => line.includes("shadow-timeout")));
        assert.equal(holder.dbusCalls.length, 1);
        assert.ok(!holder.logs.some((line) => line.includes("could-execute")));
    });

    it("ignores duplicate callbacks", () => {
        const first = armedProbe(baseInput());
        first.env.callbacks[0]?.(plannedReply(first.bundle));
        first.env.callbacks[0]?.(plannedReply(first.bundle));
        assert.equal(
            first.env.logs.filter((line) => line.includes("could-execute")).length,
            1,
        );
    });

    it("fails closed when the timer or D-Bus arm throws", () => {
        const bundle = normalizeOrThrow(baseInput());
        const timerHolder = mockEnv(() => baseInput());
        timerHolder.env.scheduleOnce = (): (() => void) => {
            throw new Error("no timer");
        };
        const timerProbe = new PlannerShadowProbe(timerHolder.env);
        timerProbe.enableOnce();
        timerProbe.runOnce(bundle);
        assert.ok(timerHolder.logs.some((line) => line.includes("shadow-timer-failed")));
        assert.equal(timerHolder.dbusCalls.length, 0);

        const dbusHolder = mockEnv(() => baseInput());
        dbusHolder.env.callDbus = (): void => {
            throw new Error("no dbus");
        };
        const dbusProbe = new PlannerShadowProbe(dbusHolder.env);
        dbusProbe.enableOnce();
        dbusProbe.runOnce(bundle);
        assert.ok(dbusHolder.logs.some((line) => line.includes("shadow-dbus-failed")));
    });

    it("detects changed fresh topology through the pure comparator", () => {
        const left = normalizeOrThrow(baseInput());
        const right = normalizeOrThrow(baseInput({ direction: "left" }));
        assert.equal(sameShadowTopology(left, left), true);
        assert.equal(sameShadowTopology(left, right), false);
    });

    it("has no native mutation routes and stays out of production paths", () => {
        for (const file of ["src/planner-shadow.ts", "src/planner-shadow-probe-entry.ts"]) {
            const source = readFileSync(file, "utf8");
            for (const forbidden of [
                "manageTile",
                "unmanageTile",
                "splitCustomTile",
                "removeCustomTile",
                "assignWindowToTile",
                "detachWindowFromTile",
                "writeWindow",
                "setTileRelativeGeometry",
                'from "./controller',
                'from "./boundary',
                'from "./tray',
                "TrayPublisher",
                "TileController",
                "registerShortcut",
                "trayTimers",
            ]) {
                assert.ok(!source.includes(forbidden), `${file} mutation coupling: ${forbidden}`);
            }
        }
        const entry = readFileSync("src/entry.ts", "utf8");
        assert.ok(!entry.includes("planner-shadow"));
        assert.ok(!entry.includes("PlannerShadowProbe"));
        assert.ok(!entry.includes("__plasmaAutoTiler"));
        const probeEntry = readFileSync("src/planner-shadow-probe-entry.ts", "utf8");
        assert.ok(probeEntry.includes("__plasmaAutoTilerRunPlannerShadowProbeOnce"));
        assert.ok(probeEntry.includes("new QTimer()"));
        assert.ok(!/plannerShadowProbe\.(runOnce|enableOnce)/.test(entry));
        for (const production of ["src/controller.ts", "src/controller-input-actions.ts", "src/controller-window-actions.ts"]) {
            const text = readFileSync(production, "utf8");
            assert.ok(!text.includes("planner-shadow"), `production coupling: ${production}`);
        }
    });

    it("keeps the ordinary production bundle free of the manual probe", () => {
        const bundle = readFileSync("contents/code/main.js", "utf8");
        assert.ok(!bundle.includes("planner-shadow"));
        assert.ok(!bundle.includes("__plasmaAutoTilerRunPlannerShadowProbeOnce"));
        assert.ok(!bundle.includes("could-execute"));
    });

    it("installs the manual trigger on the script global when globalThis is absent", () => {
        const source = readFileSync("src/planner-shadow-probe-entry.ts", "utf8");
        assert.ok(source.includes("__plasmaAutoTilerRunPlannerShadowProbeOnce"));
        assert.ok(source.includes('Function("return this")'));
        const outFile = join(
            tmpdir(),
            `planner-shadow-probe-kwin-global-${String(process.pid)}-${String(Date.now())}.js`,
        );
        try {
            execFileSync(
                "node_modules/.bin/esbuild",
                [
                    "src/planner-shadow-probe-entry.ts",
                    "--bundle",
                    "--format=iife",
                    "--target=es2017",
                    `--outfile=${outFile}`,
                ],
                { stdio: "pipe" },
            );
            const bundle = readFileSync(outFile, "utf8");
            assert.ok(bundle.includes("__plasmaAutoTilerRunPlannerShadowProbeOnce"));
            assert.ok(bundle.includes('Function("return this")'));
            const logs: string[] = [];
            const dbusCalls: unknown[] = [];
            const sandbox = {
                globalThis: undefined,
                console: {
                    log: (message: string): void => {
                        logs.push(String(message));
                    },
                },
                workspace: {},
                QTimer: function QTimer(): void {},
                callDBus: (...args: readonly unknown[]): void => {
                    dbusCalls.push(args);
                },
            };
            const context = createContext(sandbox);
            runInContext(bundle, context, { filename: outFile });
            assert.ok(logs.includes("plasma-auto-tiler:planner-shadow-probe-ready"));
            assert.equal(dbusCalls.length, 0);
            assert.equal(
                runInContext("typeof __plasmaAutoTilerRunPlannerShadowProbeOnce", context),
                "function",
            );
            assert.equal(
                runInContext("typeof this.__plasmaAutoTilerRunPlannerShadowProbeOnce", context),
                "function",
            );
            runInContext("__plasmaAutoTilerRunPlannerShadowProbeOnce()", context);
            assert.ok(logs.includes("plasma-auto-tiler:planner-shadow:reject:shadow-invalid-intent"));
            assert.equal(dbusCalls.length, 0);
        } finally {
            try {
                unlinkSync(outFile);
            } catch (error) {
                void error;
            }
        }
    });

    it("does not report ready when no script global can be resolved", () => {
        const outFile = join(
            tmpdir(),
            `planner-shadow-probe-no-global-${String(process.pid)}-${String(Date.now())}.js`,
        );
        try {
            execFileSync(
                "node_modules/.bin/esbuild",
                [
                    "src/planner-shadow-probe-entry.ts",
                    "--bundle",
                    "--format=iife",
                    "--target=es2017",
                    `--outfile=${outFile}`,
                ],
                { stdio: "pipe" },
            );
            const logs: string[] = [];
            const context = createContext({
                globalThis: undefined,
                Function: undefined,
                console: {
                    log: (message: string): void => {
                        logs.push(String(message));
                    },
                },
                workspace: {},
                QTimer: function QTimer(): void {},
                callDBus: (): void => {},
            });
            runInContext(readFileSync(outFile, "utf8"), context, { filename: outFile });
            assert.ok(logs.includes("plasma-auto-tiler:planner-shadow:trigger-unavailable"));
            assert.ok(!logs.includes("plasma-auto-tiler:planner-shadow-probe-ready"));
            assert.equal(
                runInContext("typeof __plasmaAutoTilerRunPlannerShadowProbeOnce", context),
                "undefined",
            );
        } finally {
            try {
                unlinkSync(outFile);
            } catch (error) {
                void error;
            }
        }
    });
});
