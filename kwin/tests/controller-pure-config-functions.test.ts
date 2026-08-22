import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    Harness,
    RECT,
    tile,
    type TestTile,
    type TestWindow,
    window,
} from "./controller-fixtures";
import {
    attachTileWriter,
    assertPresetShape,
    countEvent,
    installDwindleSplitter,
    installReversedOrderSplitter,
    invokeShortcut,
} from "./controller-fixture-scenarios";
import {
    AUTOMATIC_SPLIT_TARGET_CONFIG_KEY,
    AUTOMATIC_SPLIT_TARGETS,
    DEFAULT_AUTOMATIC_SPLIT_TARGET,
    DEFAULT_DROP_OUTLINE_PREVIEW,
    DEFAULT_TILING_ALGORITHM,
    DROP_OUTLINE_PREVIEW_CONFIG_KEY,
    TILING_ALGORITHMS,
    TileController,
    ensureTrailingEmptyDesktop,
    parseAutomaticSplitTarget,
    parseDropOutlinePreview,
    parseTilingAlgorithm,
    selectAutomaticSplitTarget,
    type AutomaticSplitCandidate,
    type AutomaticSplitSelectionContext,
    type TrailingEmptyDomainRequest,
} from "../src/controller";
import { type Rect } from "../src/logic";
import { PRESET_KINDS, presetBlueprint } from "../src/preset-catalog";

// Startup takeover reconstruction harness: a layout root holding one empty leaf
// and every window but the last occupying its own leaf, so the last window is
// floating and the occupancy bijection fails, forcing the two-phase
// collapse/rebuild adoption. `preset` is written into the config before start.
function takeoverTilingSetup(
    preset: string | undefined,
    windowCount: number,
): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly removed: { count: number };
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const leaves = Array.from({ length: windowCount }, () => tile());
    const windows = Array.from({ length: windowCount }, () => window());
    for (let index = 0; index < windowCount; index += 1) {
        const leaf = leaves[index];
        const subject = windows[index];
        if (leaf === undefined || subject === undefined) {
            break;
        }
        if (index < windowCount - 1) {
            leaf.windows = [subject];
            subject.tile = leaf;
        }
    }
    root.tiles = leaves;
    harness.root = root;
    harness.active = windows[0] as TestWindow;
    harness.windows = windows;
    if (preset !== undefined) {
        harness.configValues.set("tilingAlgorithm", preset);
    }
    const removed = { count: 0 };
    for (const leaf of leaves) {
        leaf.remove = () => {
            removed.count += 1;
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
            return true;
        };
    }
    installDwindleSplitter(root);
    for (const subject of windows) {
        attachTileWriter(subject);
    }
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, removed };
}

// Same takeover reconstruction shape as `takeoverTilingSetup`, but the
// installed splitter reports its two children in `tiles` in the array order
// opposite their geometric position, and each window carries a distinct
// caption so the final leaf assignment can be verified by geometry rather
// than by raw `tiles[]` array index.
function takeoverTilingSetupReversed(
    preset: string,
    windowCount: number,
): {
    readonly harness: Harness;
    readonly controller: TileController;
    readonly root: TestTile;
    readonly windows: readonly TestWindow[];
} {
    const harness = new Harness();
    const root = tile(RECT, true);
    const leaves = Array.from({ length: windowCount }, () => tile());
    const windows = Array.from({ length: windowCount }, (_, index) => window({ caption: `w${index}` }));
    for (let index = 0; index < windowCount; index += 1) {
        const leaf = leaves[index];
        const subject = windows[index];
        if (leaf === undefined || subject === undefined) {
            break;
        }
        if (index < windowCount - 1) {
            leaf.windows = [subject];
            subject.tile = leaf;
        }
    }
    root.tiles = leaves;
    harness.root = root;
    harness.active = windows[0] as TestWindow;
    harness.windows = windows;
    harness.configValues.set("tilingAlgorithm", preset);
    for (const leaf of leaves) {
        leaf.remove = () => {
            root.tiles = (root.tiles as TestTile[]).filter((entry) => entry !== leaf);
            return true;
        };
    }
    installReversedOrderSplitter(root);
    for (const subject of windows) {
        attachTileWriter(subject);
    }
    const controller = new TileController(harness.environment());
    controller.start();
    return { harness, controller, root, windows };
}

describe("parseTilingAlgorithm", () => {
    it("defaults to dwindle for a missing, null, or empty value without a diagnostic", () => {
        for (const value of [undefined, null, ""]) {
            const parsed = parseTilingAlgorithm(value);
            assert.equal(parsed.algorithm, DEFAULT_TILING_ALGORITHM);
            assert.equal(parsed.algorithm, "dwindle");
            assert.deepEqual(parsed.diagnostics, []);
        }
    });

    it("passes through every valid preset unchanged without a diagnostic", () => {
        for (const value of TILING_ALGORITHMS) {
            const parsed = parseTilingAlgorithm(value);
            assert.equal(parsed.algorithm, value);
            assert.deepEqual(parsed.diagnostics, []);
        }
    });

    it("falls back to dwindle with a diagnostic for an invalid value", () => {
        for (const value of ["bogus", "dwindle-mirror", 42, { algorithm: "dwindle" }]) {
            const parsed = parseTilingAlgorithm(value);
            assert.equal(parsed.algorithm, "dwindle");
            assert.deepEqual(parsed.diagnostics, ["tiling-algorithm-invalid:fallback-dwindle"]);
        }
    });
});

describe("parseAutomaticSplitTarget", () => {
    it("defaults to dwindle for a missing, null, or empty value without a diagnostic", () => {
        for (const value of [undefined, null, ""]) {
            const parsed = parseAutomaticSplitTarget(value);
            assert.equal(parsed.target, DEFAULT_AUTOMATIC_SPLIT_TARGET);
            assert.equal(parsed.target, "dwindle");
            assert.deepEqual(parsed.diagnostics, []);
        }
    });

    it("passes through every valid target unchanged without a diagnostic", () => {
        assert.deepEqual(AUTOMATIC_SPLIT_TARGETS, ["dwindle", "largest", "active"]);
        for (const value of AUTOMATIC_SPLIT_TARGETS) {
            const parsed = parseAutomaticSplitTarget(value);
            assert.equal(parsed.target, value);
            assert.deepEqual(parsed.diagnostics, []);
        }
    });

    it("falls back to dwindle with a diagnostic for an invalid value", () => {
        for (const value of ["bogus", "LARGEST", " largest", 42, { target: "dwindle" }]) {
            const parsed = parseAutomaticSplitTarget(value);
            assert.equal(parsed.target, "dwindle");
            assert.deepEqual(parsed.diagnostics, ["automatic-split-target-invalid:fallback-dwindle"]);
        }
    });

    it("selects automaticSplitTarget from readConfig at startup with default and diagnostic fallback", () => {
        const harness = new Harness();
        harness.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "largest");
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.automaticSplitTargetSnapshot(), "largest");
        assert.equal(countEvent(harness.logs, "automatic-split-target-invalid:fallback-dwindle"), 0);

        const missing = new Harness();
        const missingController = new TileController(missing.environment());
        missingController.start();
        assert.equal(missingController.automaticSplitTargetSnapshot(), "dwindle");
        assert.equal(countEvent(missing.logs, "automatic-split-target-invalid:fallback-dwindle"), 0);

        const empty = new Harness();
        empty.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "");
        const emptyController = new TileController(empty.environment());
        emptyController.start();
        assert.equal(emptyController.automaticSplitTargetSnapshot(), "dwindle");
        assert.equal(countEvent(empty.logs, "automatic-split-target-invalid:fallback-dwindle"), 0);

        const invalid = new Harness();
        invalid.configValues.set(AUTOMATIC_SPLIT_TARGET_CONFIG_KEY, "bogus");
        const invalidController = new TileController(invalid.environment());
        invalidController.start();
        assert.equal(invalidController.automaticSplitTargetSnapshot(), "dwindle");
        assert.equal(countEvent(invalid.logs, "automatic-split-target-invalid:fallback-dwindle"), 1);
    });
});

describe("parseDropOutlinePreview", () => {
    it("defaults missing values to false and preserves false and true without diagnostics", () => {
        for (const [value, expected] of [
            [undefined, false],
            [false, false],
            [true, true],
        ] as const) {
            const parsed = parseDropOutlinePreview(value);
            assert.equal(parsed.enabled, expected);
            assert.deepEqual(parsed.diagnostics, []);
        }
        assert.equal(DEFAULT_DROP_OUTLINE_PREVIEW, false);
    });

    it("falls back to false with a diagnostic for invalid values", () => {
        for (const value of ["true", 1, {}]) {
            const parsed = parseDropOutlinePreview(value);
            assert.equal(parsed.enabled, false);
            assert.deepEqual(parsed.diagnostics, ["drop-outline-preview-invalid:fallback-false"]);
        }
    });

    it("selects dropOutlinePreview from readConfig at startup", () => {
        const enabled = new Harness();
        enabled.configValues.set(DROP_OUTLINE_PREVIEW_CONFIG_KEY, true);
        const enabledController = new TileController(enabled.environment());
        enabledController.start();
        assert.equal(enabledController.dropOutlinePreviewSnapshot(), true);

        const disabled = new Harness();
        disabled.configValues.set(DROP_OUTLINE_PREVIEW_CONFIG_KEY, false);
        const disabledController = new TileController(disabled.environment());
        disabledController.start();
        assert.equal(disabledController.dropOutlinePreviewSnapshot(), false);

        const missing = new Harness();
        const missingController = new TileController(missing.environment());
        missingController.start();
        assert.equal(missingController.dropOutlinePreviewSnapshot(), false);
    });
});

describe("selectAutomaticSplitTarget", () => {
    const tileA = { name: "a" };
    const tileB = { name: "b" };
    const tileC = { name: "c" };
    const tileD = { name: "d" };

    function candidate(
        tile: object,
        id: string,
        geometry: Rect,
        depth: number,
        occupied = true,
    ): AutomaticSplitCandidate {
        return { tile, depth, leaf: { id, isLayout: false, geometry, windows: [] }, occupied };
    }

    function selectionContext(
        dwindle: AutomaticSplitCandidate,
        candidates: readonly AutomaticSplitCandidate[],
        active: AutomaticSplitCandidate | null,
    ): AutomaticSplitSelectionContext {
        return { dwindle, candidates, active };
    }

    it("dwindle preserves the deepest-right-spine intent unchanged", () => {
        const deepest = candidate(tileD, "tile-d", { x: 0, y: 300, width: 50, height: 50 }, 3);
        const first = candidate(tileA, "tile-a", { x: 0, y: 0, width: 100, height: 100 }, 1);
        const selected = selectAutomaticSplitTarget("dwindle", selectionContext(deepest, [first, deepest], null));
        assert.equal(selected, deepest);
        assert.equal(selected?.depth, 3);
    });

    it("largest selects the eligible occupied leaf with the greatest area", () => {
        const small = candidate(tileA, "tile-a", { x: 0, y: 0, width: 100, height: 100 }, 1);
        const biggest = candidate(tileC, "tile-c", { x: 0, y: 110, width: 120, height: 120 }, 2);
        const selected = selectAutomaticSplitTarget("largest", selectionContext(small, [small, biggest], null));
        assert.equal(selected, biggest);
        assert.equal(selected?.depth, 2);
    });

    it("largest resolves an equal-area tie to the earlier compareLeaves ordinal", () => {
        const first = candidate(tileA, "tile-a", { x: 0, y: 0, width: 100, height: 100 }, 1);
        const second = candidate(tileB, "tile-b", { x: 150, y: 0, width: 100, height: 100 }, 2);
        const selected = selectAutomaticSplitTarget("largest", selectionContext(first, [first, second], null));
        assert.equal(selected, first);
    });

    it("largest ignores unoccupied candidates and returns null when none is occupied", () => {
        const occupied = candidate(tileA, "tile-a", { x: 0, y: 0, width: 100, height: 100 }, 1);
        const unoccupiedHuge = candidate(tileB, "tile-b", { x: 150, y: 0, width: 1000, height: 1000 }, 2, false);
        const selected = selectAutomaticSplitTarget("largest", selectionContext(occupied, [occupied, unoccupiedHuge], null));
        assert.equal(selected, occupied);

        const none = selectAutomaticSplitTarget("largest", selectionContext(occupied, [unoccupiedHuge], null));
        assert.equal(none, null);
    });

    it("active selects the eligible in-scope active occupied leaf", () => {
        const deepest = candidate(tileD, "tile-d", { x: 0, y: 300, width: 50, height: 50 }, 3);
        const active = candidate(tileC, "tile-c", { x: 0, y: 110, width: 120, height: 120 }, 2);
        const selected = selectAutomaticSplitTarget("active", selectionContext(deepest, [deepest, active], active));
        assert.equal(selected, active);
    });

    it("active falls back to the dwindle intent when no active leaf is available", () => {
        const deepest = candidate(tileD, "tile-d", { x: 0, y: 300, width: 50, height: 50 }, 3);
        const selected = selectAutomaticSplitTarget("active", selectionContext(deepest, [deepest], null));
        assert.equal(selected, deepest);
    });

    it("active falls back to the dwindle intent when the active leaf is ineligible", () => {
        const deepest = candidate(tileD, "tile-d", { x: 0, y: 300, width: 50, height: 50 }, 3);
        const ineligibleActive = candidate(tileC, "tile-c", { x: 0, y: 110, width: 120, height: 120 }, 2, false);
        const selected = selectAutomaticSplitTarget("active", selectionContext(deepest, [deepest, ineligibleActive], ineligibleActive));
        assert.equal(selected, deepest);
    });

    it("active falls back to the dwindle intent when the active leaf is in a foreign scope", () => {
        const deepest = candidate(tileD, "tile-d", { x: 0, y: 300, width: 50, height: 50 }, 3);
        const foreignActive = candidate(tileC, "tile-c", { x: 0, y: 110, width: 120, height: 120 }, 2);
        const selected = selectAutomaticSplitTarget("active", selectionContext(deepest, [deepest], foreignActive));
        assert.equal(selected, deepest);
    });
});

describe("ensureTrailingEmptyDesktop", () => {
    // Minimal fake domain: a mutable ordered id list plus per-id empty flags,
    // with a fixed visibility set (a desktop is "visible" iff its id is in
    // `visibleIds`), matching what a real caller would compose from the
    // existing occupied/visible id sets. No mode wiring - this exercises the
    // helper directly.
    interface FakeDomain {
        ids: string[];
        empty: Set<string>;
        visibleIds: Set<string>;
        removed: string[];
        created: string[];
        nextId: number;
    }

    function makeDomain(ids: string[], emptyIds: string[], visibleIds: string[] = []): FakeDomain {
        return {
            ids: [...ids],
            empty: new Set(emptyIds),
            visibleIds: new Set(visibleIds),
            removed: [],
            created: [],
            nextId: 0,
        };
    }

    function requestFor(domain: FakeDomain): TrailingEmptyDomainRequest {
        return {
            orderedIds: domain.ids,
            isEmpty: (id) => domain.empty.has(id),
            isVisible: (id) => domain.visibleIds.has(id),
            removeDesktop: (id) => {
                const position = domain.ids.indexOf(id);
                if (position < 0) {
                    return false;
                }
                domain.ids.splice(position, 1);
                domain.empty.delete(id);
                domain.removed.push(id);
                return true;
            },
            createDesktop: () => {
                const id = `created-${domain.nextId}`;
                domain.nextId += 1;
                domain.ids.push(id);
                domain.empty.add(id);
                domain.created.push(id);
                return id;
            },
        };
    }

    it("no-ops when the trailing desktop is already empty", () => {
        const domain = makeDomain(["a", "b", "c"], ["c"]);
        const result = ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(result, { removedIds: [], appendedId: null });
        assert.deepEqual(domain.ids, ["a", "b", "c"]);
    });

    it("appends exactly one desktop when the trailing desktop is occupied and no other is empty", () => {
        const domain = makeDomain(["a", "b", "c"], []);
        const result = ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(result.removedIds, []);
        assert.equal(result.appendedId, "created-0");
        assert.deepEqual(domain.ids, ["a", "b", "c", "created-0"]);
        assert.equal(domain.created.length, 1);
    });

    it("removes a non-trailing empty-and-invisible desktop and leaves the trailing empty untouched", () => {
        const domain = makeDomain(["a", "b", "c"], ["b", "c"]);
        const result = ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(result.removedIds, ["b"]);
        assert.equal(result.appendedId, null);
        assert.deepEqual(domain.ids, ["a", "c"]);
    });

    it("removes a non-trailing invisible empty and appends a trailing replacement in one pass", () => {
        // "b" is empty and invisible (not trailing, since "c" is the last id
        // and is occupied) -> removed. After removal the new trailing id is
        // "c", which is occupied -> exactly one append, no second dispatch.
        const domain = makeDomain(["a", "b", "c"], ["b"]);
        const result = ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(result.removedIds, ["b"]);
        assert.equal(result.appendedId, "created-0");
        assert.deepEqual(domain.ids, ["a", "c", "created-0"]);
    });

    it("is idempotent: repeated calls against settled state produce zero net creates or removes", () => {
        const domain = makeDomain(["a", "b", "c"], ["b"]);
        ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(domain.ids, ["a", "c", "created-0"]);

        const second = ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(second, { removedIds: [], appendedId: null });
        const third = ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(third, { removedIds: [], appendedId: null });
        assert.deepEqual(domain.ids, ["a", "c", "created-0"]);
        assert.equal(domain.removed.length, 1);
        assert.equal(domain.created.length, 1);
    });

    it("never removes a visible-but-empty desktop", () => {
        const domain = makeDomain(["a", "b", "c"], ["b", "c"], ["b"]);
        const result = ensureTrailingEmptyDesktop(requestFor(domain));
        assert.deepEqual(result.removedIds, []);
        assert.equal(result.appendedId, null);
        assert.deepEqual(domain.ids, ["a", "b", "c"]);
    });
});

describe("TileController tiling algorithm takeover", () => {
    it("rebuilds an adopted scope with the configured preset shape for every valid preset", () => {
        for (const preset of PRESET_KINDS) {
            const state = takeoverTilingSetup(preset, 4);
            assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
            assert.equal(state.harness.flushNextYield(), true);
            assert.equal(countEvent(state.harness.logs, "ownership-collapsed"), 1);
            assert.equal(state.harness.flushNextYield(), true);
            assert.equal(countEvent(state.harness.logs, "ownership-taken"), 1);
            assert.equal(state.controller.tilingAlgorithmSnapshot(), preset);
            const blueprint = presetBlueprint(preset, 4);
            assert.equal(blueprint.ok, true);
            if (blueprint.ok) {
                assertPresetShape(state.root, blueprint.value);
            }
        }
    });

    it("defaults the takeover to the dwindle preset when tilingAlgorithm is absent", () => {
        const state = takeoverTilingSetup(undefined, 3);
        assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-collapsed"), 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 1);
        assert.equal(state.controller.tilingAlgorithmSnapshot(), "dwindle");
        const blueprint = presetBlueprint("dwindle", 3);
        assert.equal(blueprint.ok, true);
        if (blueprint.ok) {
            assertPresetShape(state.root, blueprint.value);
        }
    });

    it("falls back to the dwindle preset with a diagnostic for an invalid tilingAlgorithm", () => {
        const state = takeoverTilingSetup("bogus", 3);
        assert.equal(countEvent(state.harness.logs, "tiling-algorithm-invalid:fallback-dwindle"), 1);
        assert.equal(state.controller.tilingAlgorithmSnapshot(), "dwindle");
        assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-collapsed"), 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 1);
        const blueprint = presetBlueprint("dwindle", 3);
        assert.equal(blueprint.ok, true);
        if (blueprint.ok) {
            assertPresetShape(state.root, blueprint.value);
        }
    });

    it("does not change the manual apply-dwindle shortcut when tilingAlgorithm is configured", () => {
        const harness = new Harness();
        harness.configValues.set("tilingAlgorithm", "columns");
        const root = tile(RECT, true);
        const source = tile();
        const early = tile({ x: 200, y: 0, width: 100, height: 100 });
        const late = tile({ x: 300, y: 0, width: 100, height: 100 });
        const active = window({ tile: source });
        const earlyWindow = window({ tile: early });
        const lateWindow = window({ tile: late });
        source.windows = [active];
        early.windows = [earlyWindow];
        late.windows = [lateWindow];
        root.tiles = [early, source, late];
        harness.root = root;
        harness.active = active;
        harness.windows = [active, earlyWindow, lateWindow];
        const controller = new TileController(harness.environment());
        controller.start();
        assert.equal(controller.tilingAlgorithmSnapshot(), "columns");
        invokeShortcut(harness, "plasma-auto-tiler-apply-dwindle");
        assert.equal(countEvent(harness.logs, "preset-invoked:dwindle"), 1);
        assert.equal(countEvent(harness.logs, "preset-invoked:columns"), 0);
    });

    it("resolves preset split targets and leaves by geometry order, not by raw tiles[] array index", () => {
        const state = takeoverTilingSetupReversed("dwindle", 2);
        assert.equal(countEvent(state.harness.logs, "ownership-pending"), 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-collapsed"), 1);
        assert.equal(state.harness.flushNextYield(), true);
        assert.equal(countEvent(state.harness.logs, "ownership-taken"), 1);
        assert.equal(state.root.isLayout, true);
        const children = state.root.tiles as TestTile[];
        assert.equal(children.length, 2);
        const [first, second] = children;
        assert.ok(first !== undefined && second !== undefined);
        // The splitter reports children reversed in `tiles[]` relative to
        // geometry, so a raw-index reader would see the geometrically-right
        // child first; confirm the fixture is exercising that inversion.
        assert.ok(first.relativeGeometry.x > second.relativeGeometry.x);
        const leftLeaf = first.relativeGeometry.x < second.relativeGeometry.x ? first : second;
        const rightLeaf = leftLeaf === first ? second : first;
        assert.deepEqual((leftLeaf.windows as TestWindow[]).map((w) => w.caption), ["w0"]);
        assert.deepEqual((rightLeaf.windows as TestWindow[]).map((w) => w.caption), ["w1"]);
    });
});
