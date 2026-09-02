import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    DESKTOP,
    OUTPUT,
    RECT,
    type TestTile,
    type TestWindow,
    tile,
    window,
} from "./controller-fixtures";
import {
    attachSetup,
    attachTileWriter,
    configureThreeOccupantPreset,
    countEvent,
    currentScopeFor,
    fillSetup,
    invokeShortcut,
    presetSetup,
} from "./controller-fixture-scenarios";

describe("TileController tile attach", () => {
    it("invokes the controller action and attaches the active window with one guarded write", () => {
        const state = attachSetup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(state.active.tile, state.empty);
        assert.deepEqual(state.empty.windows, [state.active]);
        assert.deepEqual(writes, [{ window: state.active, target: state.empty }]);
        assert.deepEqual(state.harness.activeWrites, []);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-completed"],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("maps every attach precondition guard to its first fixed private reason with no write", () => {
        const cases: ReadonlyArray<{
            readonly reason: string;
            readonly configure: (state: ReturnType<typeof attachSetup>) => void;
        }> = [
            {
                reason: "attach-rejected:no-active-window",
                configure: (state) => {
                    state.harness.active = null;
                },
            },
            {
                reason: "attach-rejected:desktop-output-scope",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
            },
            {
                reason: "attach-rejected:active-window-eligibility",
                configure: (state) => {
                    state.active.resizeable = false;
                },
            },
            {
                reason: "attach-rejected:already-assigned",
                configure: (state) => {
                    state.active.tile = state.occupied;
                },
            },
            {
                reason: "attach-rejected:root-lookup",
                configure: (state) => {
                    state.harness.root = null;
                },
            },
            {
                reason: "attach-rejected:topology-decode",
                configure: (state) => {
                    state.root.tiles = { length: 1 };
                },
            },
            {
                reason: "attach-rejected:no-available-tile",
                configure: (state) => {
                    state.empty.windows = [window({ tile: state.empty })];
                },
            },
        ];
        for (const testCase of cases) {
            const state = attachSetup();
            const baseline = state.harness.logs.length;
            testCase.configure(state);
            const beforeTile = state.active.tile;
            invokeShortcut(state.harness, "plasma-auto-tiler-attach");
            assert.equal(countEvent(state.harness.logs, "attach-completed"), 0);
            assert.equal(state.active.tile, beforeTile);
            assert.deepEqual(state.harness.activeWrites, []);
            assert.deepEqual(
                state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
                ["plasma-auto-tiler:attach-invoked", `plasma-auto-tiler:${testCase.reason}`],
            );
        }
    });

    it("selects the deterministic first empty non-layout leaf, skipping layout and occupied leaves", () => {
        const state = attachSetup();
        const secondEmpty = tile();
        // LIFO decoded traversal order: layout (skipped), occupied (skipped),
        // empty (selected), secondEmpty (not reached). Proves deterministic
        // first-empty selection skipping layout and occupied leaves.
        state.root.tiles = [secondEmpty, state.empty, state.occupied, state.layout];
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.active.tile, state.empty);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-completed"],
        );
    });

    it("skips an empty non-Custom Tile leaf", () => {
        const state = attachSetup();
        const foreign = tile();
        const { layoutDirection: ignoredDirection, split: ignoredSplit, ...nonCustom } = foreign;
        void ignoredDirection;
        void ignoredSplit;
        // LIFO traversal reaches the generic Tile first, but attach must use
        // only an authored Custom Tile leaf.
        state.root.tiles = [state.empty, nonCustom];
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.active.tile, state.empty);
    });

    it("rejects when the target leaf leaves the topology immediately before the write", () => {
        const state = attachSetup();
        let rootReads = 0;
        const decoyRoot = tile(RECT, true);
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                rootReads += 1;
                return rootReads === 1 ? state.root : decoyRoot;
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.active.tile, null);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-rejected:assignment-stale"],
        );
    });

    it("rejects when the active window changes immediately before the write", () => {
        const state = attachSetup();
        let activeReads = 0;
        const replacement = window();
        Object.defineProperty(state.harness, "active", {
            configurable: true,
            get: () => {
                activeReads += 1;
                return activeReads === 1 ? state.active : replacement;
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.active.tile, null);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-rejected:assignment-stale"],
        );
    });

    it("rejects when the exact scope changes immediately before the write", () => {
        const state = attachSetup();
        let desktopReads = 0;
        Object.defineProperty(state.harness, "currentDesktop", {
            configurable: true,
            get: () => {
                desktopReads += 1;
                return desktopReads === 1 ? DESKTOP : { id: "desktop-2" };
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.active.tile, null);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-rejected:assignment-stale"],
        );
    });

    it("rejects when the source becomes assigned immediately before the write", () => {
        const state = attachSetup();
        let activeReads = 0;
        let sourceAssigned = false;
        Object.defineProperty(state.harness, "active", {
            configurable: true,
            get: () => {
                activeReads += 1;
                // The revalidation re-reads the active window identity; from
                // that point the source tile is treated as newly assigned, so
                // the direct tile guard immediately before the write rejects.
                if (activeReads >= 2) {
                    sourceAssigned = true;
                }
                return state.active;
            },
            set: (next) => {
                void next;
            },
        });
        Object.defineProperty(state.active, "tile", {
            configurable: true,
            get: () => (sourceAssigned ? state.empty : null),
            set: (next: object | null) => {
                void next;
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-rejected:assignment-stale"],
        );
    });

    it("reports a false attach write with no state change and keeps the controller enabled", () => {
        const state = attachSetup();
        Object.defineProperty(state.active, "tile", {
            configurable: true,
            value: null,
            writable: false,
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(state.active.tile, null);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-rejected:assignment-failed"],
        );
    });

    it("contains a throwing attach write with a fixed diagnostic and no leaked error", () => {
        const state = attachSetup();
        Object.defineProperty(state.active, "tile", {
            configurable: true,
            get: () => null,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.controller.isEnabled, true);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-rejected:assignment-failed"],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("reports a postcondition failure when the write succeeds but the association is absent", () => {
        const state = attachSetup();
        Object.defineProperty(state.active, "tile", {
            configurable: true,
            get: () => null,
            set: () => {
                // Setter runs without error but the association is unchanged.
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.controller.isEnabled, true);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:attach")),
            ["plasma-auto-tiler:attach-invoked", "plasma-auto-tiler:attach-failed:postcondition"],
        );
    });

    it("makes no structural topology call and never manages another occupant", () => {
        const state = attachSetup();
        let splits = 0;
        let unmanages = 0;
        let manages = 0;
        state.empty.split = () => {
            splits += 1;
            return [];
        };
        state.occupied.split = () => {
            splits += 1;
            return [];
        };
        state.layout.split = () => {
            splits += 1;
            return [];
        };
        const structural = (leaf: TestTile, kind: "manage" | "unmanage") => {
            const original = leaf[kind];
            leaf[kind] = (value: unknown) => {
                if (kind === "manage") {
                    manages += 1;
                } else {
                    unmanages += 1;
                }
                return original(value);
            };
        };
        structural(state.empty, "manage");
        structural(state.empty, "unmanage");
        structural(state.occupied, "manage");
        structural(state.occupied, "unmanage");
        structural(state.layout, "manage");
        structural(state.layout, "unmanage");
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(splits, 0);
        assert.equal(unmanages, 0);
        assert.equal(manages, 0);
    });

    it("never compacts or invalidates a valid selected overlay for the same scope", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        assert.ok(state.controller.readSelectedOverlay(currentScopeFor(state.active)) !== null);
        const floating = window();
        state.harness.active = floating;
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(countEvent(state.harness.logs, "attach-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        assert.ok(state.controller.readSelectedOverlay(currentScopeFor(state.active)) !== null);
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("contains attach diagnostic sink failures without changing the attach result", () => {
        const state = attachSetup();
        state.harness.throwOnLog = true;
        invokeShortcut(state.harness, "plasma-auto-tiler-attach");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(state.active.tile, state.empty);
    });
});

describe("TileController scope fill", () => {
    it("fills through the controller action with anchor-first guarded writes", () => {
        const state = fillSetup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        attachTileWriter(state.otherA, writes);
        attachTileWriter(state.otherB, writes);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(state.controller.isEnabled, true);
        assert.deepEqual(writes, [
            { window: state.active, target: state.first },
            { window: state.otherA, target: state.second },
            { window: state.otherB, target: state.third },
        ]);
        assert.deepEqual(state.harness.activeWrites, []);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:fill-")),
            ["plasma-auto-tiler:fill-invoked", "plasma-auto-tiler:fill-completed"],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("fills only the deterministic min(candidates, leaves), skipping layout, occupied, and generic leaves in decode order", () => {
        const fewer = fillSetup();
        fewer.harness.windows = [fewer.otherA, fewer.active];
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(fewer.active, writes);
        attachTileWriter(fewer.otherA, writes);
        invokeShortcut(fewer.harness, "plasma-auto-tiler-fill-scope");
        // Two candidates against three empty leaves: only the first two leaves are filled.
        assert.deepEqual(writes, [
            { window: fewer.active, target: fewer.first },
            { window: fewer.otherA, target: fewer.second },
        ]);
        assert.equal(fewer.otherB.tile, null);
        assert.deepEqual(fewer.third.windows, []);
        assert.equal(countEvent(fewer.harness.logs, "fill-completed"), 1);

        const more = fillSetup();
        const extra = window();
        more.harness.windows = [more.otherA, more.active, more.otherB, extra];
        const moreWrites: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(more.active, moreWrites);
        attachTileWriter(more.otherA, moreWrites);
        attachTileWriter(more.otherB, moreWrites);
        invokeShortcut(more.harness, "plasma-auto-tiler-fill-scope");
        // Four candidates against three empty leaves: capacity bounds the plan at three.
        assert.equal(moreWrites.length, 3);
        assert.equal(extra.tile, null);
        assert.equal(countEvent(more.harness.logs, "fill-completed"), 1);
    });

    it("maps every fill guard to its first fixed private reason with no write", () => {
        const cases: ReadonlyArray<{
            readonly reason: string;
            readonly configure: (state: ReturnType<typeof fillSetup>) => void;
        }> = [
            {
                reason: "fill-rejected:no-active-window",
                configure: (state) => {
                    state.harness.active = null;
                },
            },
            {
                reason: "fill-rejected:desktop-output-scope",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
            },
            {
                reason: "fill-rejected:active-window-eligibility",
                configure: (state) => {
                    state.active.resizeable = false;
                },
            },
            {
                reason: "fill-rejected:root-lookup",
                configure: (state) => {
                    state.harness.root = null;
                },
            },
            {
                reason: "fill-rejected:topology-decode",
                configure: (state) => {
                    state.root.tiles = { length: 1 };
                },
            },
            {
                reason: "fill-rejected:window-list-decode",
                configure: (state) => {
                    state.harness.windows = { length: 1 };
                },
            },
            {
                reason: "fill-inert:no-leaves",
                configure: (state) => {
                    state.first.windows = [window({ tile: state.first })];
                    state.second.windows = [window({ tile: state.second })];
                    state.third.windows = [window({ tile: state.third })];
                },
            },
            {
                reason: "fill-inert:no-candidates",
                configure: (state) => {
                    state.harness.windows = [];
                },
            },
        ];
        for (const testCase of cases) {
            const state = fillSetup();
            const baseline = state.harness.logs.length;
            testCase.configure(state);
            const beforeTiles = [state.active.tile, state.otherA.tile, state.otherB.tile];
            invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
            assert.equal(countEvent(state.harness.logs, "fill-completed"), 0);
            assert.deepEqual([state.active.tile, state.otherA.tile, state.otherB.tile], beforeTiles);
            assert.deepEqual(state.harness.activeWrites, []);
            assert.deepEqual(
                state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:fill")),
                ["plasma-auto-tiler:fill-invoked", `plasma-auto-tiler:${testCase.reason}`],
            );
            assert.equal(state.controller.isEnabled, true);
        }
    });

    it("excludes already-tiled, cross-output, cross-desktop, and ineligible candidates while preserving collection order", () => {
        const state = fillSetup();
        state.otherA.tile = state.occupied;
        state.occupied.windows = [state.otherA];
        state.otherB.output = { ...OUTPUT, name: "screen-2" };
        const crossDesktop = window({ desktops: [{ id: "desktop-2" }] });
        const ineligible = window({ normalWindow: false });
        state.harness.windows = [state.otherA, ineligible, state.otherB, state.active, crossDesktop];
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        // Only the anchor remains eligible and unassigned in scope.
        assert.deepEqual(writes, [{ window: state.active, target: state.first }]);
        assert.equal(state.otherA.tile, state.occupied);
        assert.equal(state.otherB.tile, null);
        assert.equal(ineligible.tile, null);
        assert.equal(crossDesktop.tile, null);
        assert.equal(countEvent(state.harness.logs, "fill-completed"), 1);
    });

    it("lets an already-tiled active window anchor the scope while other windows fill", () => {
        const state = fillSetup();
        state.active.tile = state.occupied;
        state.occupied.windows = [state.active];
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.otherA, writes);
        attachTileWriter(state.otherB, writes);
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        assert.deepEqual(writes, [
            { window: state.otherA, target: state.first },
            { window: state.otherB, target: state.second },
        ]);
        assert.equal(state.active.tile, state.occupied);
        assert.equal(countEvent(state.harness.logs, "fill-completed"), 1);
    });

    it("decodes a KWin array-like window list in the same collection order", () => {
        const state = fillSetup();
        state.harness.windows = { 0: state.otherA, 1: state.active, length: 2 };
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        attachTileWriter(state.otherA, writes);
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        assert.deepEqual(writes, [
            { window: state.active, target: state.first },
            { window: state.otherA, target: state.second },
        ]);
        assert.equal(countEvent(state.harness.logs, "fill-completed"), 1);
    });

    it("rejects a stale anchor, target, or root immediately before the first write with zero writes", () => {
        const staleActive = fillSetup();
        let activeReads = 0;
        const replacement = window();
        Object.defineProperty(staleActive.harness, "active", {
            configurable: true,
            get: () => {
                activeReads += 1;
                return activeReads === 1 ? staleActive.active : replacement;
            },
        });
        const baseline = staleActive.harness.logs.length;
        invokeShortcut(staleActive.harness, "plasma-auto-tiler-fill-scope");
        assert.deepEqual(
            staleActive.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:fill")),
            ["plasma-auto-tiler:fill-invoked", "plasma-auto-tiler:fill-rejected:assignment-stale"],
        );
        assert.equal(staleActive.active.tile, null);
        assert.equal(staleActive.otherA.tile, null);

        const staleRoot = fillSetup();
        let rootReads = 0;
        const decoyRoot = tile(RECT, true);
        Object.defineProperty(staleRoot.harness, "root", {
            configurable: true,
            get: () => {
                rootReads += 1;
                return rootReads === 1 ? staleRoot.root : decoyRoot;
            },
        });
        invokeShortcut(staleRoot.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(staleRoot.harness.logs, "fill-rejected:assignment-stale"), 1);
        assert.equal(staleRoot.active.tile, null);
        assert.equal(staleRoot.otherA.tile, null);

        const staleTarget = fillSetup();
        let targetReads = 0;
        Object.defineProperty(staleTarget.harness, "root", {
            configurable: true,
            get: () => {
                targetReads += 1;
                if (targetReads === 2) {
                    staleTarget.first.windows = [window({ tile: staleTarget.first })];
                }
                return staleTarget.root;
            },
        });
        invokeShortcut(staleTarget.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(staleTarget.harness.logs, "fill-rejected:assignment-stale"), 1);
        assert.equal(staleTarget.active.tile, null);
        assert.equal(staleTarget.otherA.tile, null);
    });

    it("stops partial with a private diagnostic after a mid-write staleness without claiming rollback", () => {
        const state = fillSetup();
        let activeReads = 0;
        const replacement = window();
        Object.defineProperty(state.harness, "active", {
            configurable: true,
            get: () => {
                activeReads += 1;
                // Entry and the first-write revalidation keep the real anchor;
                // the second-write revalidation sees a different active window.
                return activeReads <= 2 ? state.active : replacement;
            },
        });
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:fill")),
            ["plasma-auto-tiler:fill-invoked", "plasma-auto-tiler:fill-partial:assignment-stale"],
        );
        assert.deepEqual(writes, [{ window: state.active, target: state.first }]);
        assert.equal(state.active.tile, state.first);
        assert.equal(state.otherA.tile, null);
        assert.equal(state.otherB.tile, null);
        assert.equal(state.controller.isEnabled, true);
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.includes("rollback"), false);
        }
    });

    it("reports fixed first and mid assignment-failed diagnostics with the correct partiality", () => {
        const first = fillSetup();
        Object.defineProperty(first.active, "tile", {
            configurable: true,
            get: () => null,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        invokeShortcut(first.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(first.harness.logs, "fill-rejected:assignment-failed"), 1);
        assert.equal(first.otherA.tile, null);
        assert.equal(first.otherB.tile, null);

        const mid = fillSetup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(mid.active, writes);
        Object.defineProperty(mid.otherA, "tile", {
            configurable: true,
            get: () => null,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        invokeShortcut(mid.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(mid.harness.logs, "fill-partial:assignment-failed"), 1);
        assert.deepEqual(writes, [{ window: mid.active, target: mid.first }]);
        assert.equal(mid.active.tile, mid.first);
        assert.equal(mid.otherA.tile, null);
        assert.equal(mid.otherB.tile, null);
        assert.equal(mid.controller.isEnabled, true);
        for (const entry of mid.harness.logs) {
            assert.equal(entry.includes("private-window-title"), false);
        }
    });

    it("reports fixed first and mid postcondition failures when the association does not land", () => {
        const first = fillSetup();
        Object.defineProperty(first.active, "tile", {
            configurable: true,
            get: () => null,
            set: () => {
                // Setter runs without error but the association is unchanged.
            },
        });
        invokeShortcut(first.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(first.harness.logs, "fill-failed:postcondition"), 1);
        assert.equal(first.otherA.tile, null);

        const mid = fillSetup();
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(mid.active, writes);
        Object.defineProperty(mid.otherA, "tile", {
            configurable: true,
            get: () => null,
            set: () => {
                // Setter runs without error but the association is unchanged.
            },
        });
        invokeShortcut(mid.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(mid.harness.logs, "fill-partial:postcondition"), 1);
        assert.deepEqual(writes, [{ window: mid.active, target: mid.first }]);
        assert.equal(mid.active.tile, mid.first);
        assert.equal(mid.otherA.tile, null);
        assert.equal(mid.controller.isEnabled, true);
        for (const entry of mid.harness.logs) {
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("makes no structural topology call and never touches selected-overlay state", () => {
        const state = fillSetup();
        let splits = 0;
        let manages = 0;
        let unmanages = 0;
        const structural = (leaf: TestTile) => {
            leaf.split = () => {
                splits += 1;
                throw new Error("private-window-title");
            };
            const originalManage = leaf.manage;
            leaf.manage = (value: unknown) => {
                manages += 1;
                return originalManage(value);
            };
            const originalUnmanage = leaf.unmanage;
            leaf.unmanage = (value: unknown) => {
                unmanages += 1;
                return originalUnmanage(value);
            };
        };
        for (const leaf of [state.first, state.second, state.third, state.occupied, state.layout, state.root]) {
            structural(leaf);
        }
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(splits, 0);
        assert.equal(manages, 0);
        assert.equal(unmanages, 0);
        assert.equal(countEvent(state.harness.logs, "fill-completed"), 1);
        assert.equal(countEvent(state.harness.logs, "reflow-completed"), 0);
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        assert.equal(countEvent(state.harness.logs, "preset-applied:"), 0);
        for (const entry of state.harness.logs) {
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("stays deterministic across identical states and is inert on the same state after success", () => {
        const run = (): string => {
            const state = fillSetup();
            state.harness.windows = [state.otherA, state.active];
            const writes: Array<{ window: TestWindow; target: object | null }> = [];
            attachTileWriter(state.active, writes);
            attachTileWriter(state.otherA, writes);
            invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
            return writes
                .map(
                    (entry) =>
                        `${entry.window === state.active ? "active" : entry.window === state.otherA ? "otherA" : "?"}:${entry.target === state.first ? "first" : entry.target === state.second ? "second" : entry.target === state.third ? "third" : "?"}`,
                )
                .join(";");
        };
        assert.equal(run(), run());
        assert.equal(run(), "active:first;otherA:second");

        // A repeat against the already-filled same state is inert: every
        // candidate is now assigned, so no window is written again.
        const state = fillSetup();
        state.harness.windows = [state.otherA, state.active];
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        attachTileWriter(state.otherA, writes);
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(state.harness.logs, "fill-completed"), 1);
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-fill-scope");
        assert.equal(countEvent(state.harness.logs, "fill-inert:no-candidates"), 1);
        assert.deepEqual(writes, [
            { window: state.active, target: state.first },
            { window: state.otherA, target: state.second },
        ]);
        assert.equal(state.harness.logs.length, baseline + 2);

    });
});

describe("TileController focused-leaf presets", () => {
    const presetActions: ReadonlyArray<readonly [string, readonly number[]]> = [
        ["plasma-auto-tiler-apply-columns", [1, 1]],
        ["plasma-auto-tiler-apply-rows", [2, 2]],
        ["plasma-auto-tiler-apply-balanced-grid", [1, 2]],
        ["plasma-auto-tiler-apply-dwindle", [1, 2]],
    ];

    it("uses each selected preset only inside the focused leaf and assigns ordinal leaves active first", () => {
        for (const [action, directions] of presetActions) {
            const state = presetSetup();
            const realized = configureThreeOccupantPreset(state);
            let rootSplits = 0;
            state.root.split = () => {
                rootSplits += 1;
                return [];
            };
            const outside = state.root.tiles;

            invokeShortcut(state.harness, action);

            assert.deepEqual(realized.directions, directions);
            assert.deepEqual(realized.managed, [state.active, state.lateWindow, state.earlyWindow]);
            assert.equal(rootSplits, 0);
            assert.equal(state.root.tiles, outside);
            assert.equal((state.root.tiles as TestTile[])[0], state.early);
            assert.equal((state.root.tiles as TestTile[])[2], state.late);
            assert.equal(state.active.tile, realized.left);
            assert.equal(state.lateWindow.tile, realized.middle);
            assert.equal(state.earlyWindow.tile, realized.right);
            assert.deepEqual(
                state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:preset-")),
                [`plasma-auto-tiler:preset-invoked:${action.replace("plasma-auto-tiler-apply-", "")}`, `plasma-auto-tiler:preset-applied:${action.replace("plasma-auto-tiler-apply-", "")}`],
            );
        }
    });

    it("accepts a singleton preset without splitting and still uses the guarded assignment seam", () => {
        const state = presetSetup();
        state.root.tiles = [state.source];
        let splits = 0;
        let manages = 0;
        state.source.split = () => {
            splits += 1;
            return [];
        };
        state.source.manage = (value) => {
            manages += 1;
            assert.equal(value, state.active);
            return true;
        };

        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        assert.equal(splits, 0);
        assert.equal(manages, 1);
        assert.equal(countEvent(state.harness.logs, "preset-applied:columns"), 1);
    });

    it("does not cache occupancy after application, so automatic placement sees vacated surrounding leaves", () => {
        const state = presetSetup();
        configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const managed: unknown[] = [];
        state.early.manage = (value) => {
            managed.push(value);
            return true;
        };

        const incoming = window();
        state.harness.emitAdded(incoming);

        assert.deepEqual(managed, [incoming]);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 1);
    });

    it("rejects malformed source, duplicate or ineligible occupants, and preflight scope drift before splitting", () => {
        const cases: ReadonlyArray<(state: ReturnType<typeof presetSetup>) => void> = [
            (state) => {
                state.source.windows = [state.active, window({ tile: state.source })];
            },
            (state) => {
                state.late.windows = [state.active];
            },
            (state) => {
                state.lateWindow.normalWindow = false;
            },
            (state) => {
                Object.defineProperty(state.harness, "root", {
                    configurable: true,
                    get: () => {
                        state.active.output = null;
                        return state.root;
                    },
                });
            },
        ];
        for (const configure of cases) {
            const state = presetSetup();
            let splits = 0;
            state.source.split = () => {
                splits += 1;
                return [];
            };
            configure(state);

            invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");

            assert.equal(splits, 0);
            assert.equal(countEvent(state.harness.logs, "preset-applied:dwindle"), 0);
        }
    });

    it("stops after a possibly-mutated split failure without assigning occupants", () => {
        const state = presetSetup();
        let manages = 0;
        state.source.split = () => {
            state.source.isLayout = true;
            return [null, null];
        };
        state.early.manage = () => {
            manages += 1;
            return true;
        };
        state.late.manage = () => {
            manages += 1;
            return true;
        };

        invokeShortcut(state.harness, "plasma-auto-tiler-apply-dwindle");

        assert.equal(manages, 0);
        assert.equal(countEvent(state.harness.logs, "preset-failed:split-mutation-possible"), 1);
        assert.equal(countEvent(state.harness.logs, "preset-applied:columns"), 0);
    });

    it("stops later assignments after a fixed private assignment failure", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        let laterManages = 0;
        realized.middle.manage = () => {
            throw new Error("private-window-title");
        };
        realized.right.manage = () => {
            laterManages += 1;
            return true;
        };

        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");

        assert.equal(laterManages, 0);
        assert.equal(countEvent(state.harness.logs, "preset-failed:assignment-failed:later"), 1);
        assert.equal(countEvent(state.harness.logs, "preset-applied:columns"), 0);
        for (const entry of state.harness.logs) {
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });
});
