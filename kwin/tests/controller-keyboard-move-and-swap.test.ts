import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    Harness,
    RECT,
    type TestTile,
    type TestWindow,
    attachTileWriter,
    configureThreeOccupantPreset,
    countEvent,
    currentScopeFor,
    invokeShortcut,
    moveSetup,
    presetSetup,
    setMaximized,
    setSticky,
    setup,
    swapSetup,
    tile,
    window,
} from "./controller-fixtures";
import { TileController } from "../src/controller";

describe("TileController keyboard move", () => {
    const moveActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-move-left", "Move window left", "Meta+Shift+H"],
        ["down", "plasma-auto-tiler-move-down", "Move window down", "Meta+Shift+J"],
        ["up", "plasma-auto-tiler-move-up", "Move window up", "Meta+Shift+K"],
        ["right", "plasma-auto-tiler-move-right", "Move window right", "Meta+Shift+L"],
    ];
    const moveArrowActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string, string, string]> = [
        ["left", "plasma-auto-tiler-move-left-arrow", "Move window left (arrow)", "Meta+Shift+Left"],
        ["down", "plasma-auto-tiler-move-down-arrow", "Move window down (arrow)", "Meta+Shift+Down"],
        ["up", "plasma-auto-tiler-move-up-arrow", "Move window up (arrow)", "Meta+Shift+Up"],
        ["right", "plasma-auto-tiler-move-right-arrow", "Move window right (arrow)", "Meta+Shift+Right"],
    ];

    it("maps every move guard to its first fixed private reason", () => {
        const cases: ReadonlyArray<{
            readonly reason: string;
            readonly configure: (state: ReturnType<typeof moveSetup>) => void;
        }> = [
            {
                reason: "move-rejected:no-active-window",
                configure: (state) => {
                    state.harness.active = null;
                },
            },
            {
                reason: "move-rejected:desktop-output-scope",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
            },
            {
                reason: "move-rejected:active-window-eligibility",
                configure: (state) => {
                    state.focused.resizeable = false;
                },
            },
            {
                reason: "move-rejected:root-lookup",
                configure: (state) => {
                    state.harness.root = null;
                },
            },
            {
                reason: "move-rejected:topology-decode",
                configure: (state) => {
                    state.root.tiles = { length: 1 };
                },
            },
            {
                reason: "move-rejected:active-tile-association",
                configure: (state) => {
                    state.focused.tile = null;
                },
            },
            {
                reason: "move-rejected:source-occupancy-validity",
                configure: (state) => {
                    state.focusedTile.windows = [];
                },
            },
            {
                reason: "move-rejected:source-occupancy-validity",
                configure: (state) => {
                    state.focusedTile.isLayout = true;
                },
            },
            {
                reason: "move-rejected:no-target",
                configure: (state) => {
                    state.root.tiles = [state.focusedTile];
                },
            },
            {
                reason: "move-rejected:no-target",
                configure: (state) => {
                    state.root.tiles = [state.focusedTile, tile({ x: 200, y: 0, width: 100, height: 100 }, true)];
                },
            },
        ];
        for (const testCase of cases) {
            const state = moveSetup("right");
            const baseline = state.harness.logs.length;
            testCase.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
            assert.deepEqual(
                state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
                ["plasma-auto-tiler:move-invoked", `plasma-auto-tiler:${testCase.reason}`],
            );
        }
    });

    it("moves the active window to the directional empty leaf with exactly one assignment", () => {
        for (const [direction, name] of [...moveActions, ...moveArrowActions]) {
            const state = moveSetup(direction);
            let manages = 0;
            state.target.manage = (value) => {
                manages += 1;
                assert.equal(value, state.focused);
                state.focusedTile.windows = [];
                state.focused.tile = state.target;
                state.target.windows = [value];
                return true;
            };
            invokeShortcut(state.harness, name);
            assert.equal(manages, 1);
            assert.equal(state.focused.tile, state.target);
            assert.deepEqual(state.focusedTile.windows, []);
            assert.deepEqual(state.target.windows, [state.focused]);
            assert.deepEqual(
                state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
                ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-completed"],
            );
        }
    });

    it("selects the nearest empty non-layout leaf and breaks equal distances deterministically", () => {
        const state = moveSetup("right");
        const farther = tile({ x: 400, y: 0, width: 100, height: 100 });
        const tied = tile({ x: 200, y: -10, width: 100, height: 100 });
        state.root.tiles = [state.focusedTile, farther, tied, state.target];
        const managed: TestTile[] = [];
        const track = (tile: TestTile) => () => {
            managed.push(tile);
            return true;
        };
        state.target.manage = track(state.target);
        tied.manage = track(tied);
        farther.manage = () => false;
        for (let index = 0; index < 3; index += 1) {
            invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        }
        assert.deepEqual(managed, [tied, tied, tied]);
    });

    it("skips nearer empty-ineligible layout leaves for a farther empty target", () => {
        const state = moveSetup("right");
        const layout = tile({ x: 150, y: 0, width: 100, height: 100 }, true);
        state.root.tiles = [state.focusedTile, layout, state.target];
        let manages = 0;
        state.target.manage = () => {
            manages += 1;
            return true;
        };
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(manages, 1);
    });

    it("rejects stale source, target, or scope immediately before the assignment", () => {
        const state = moveSetup("right");
        let rootReads = 0;
        const originalRoot = state.root;
        const decoyRoot = tile(RECT, true);
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                rootReads += 1;
                return rootReads === 1 ? originalRoot : decoyRoot;
            },
        });
        let manages = 0;
        state.target.manage = () => {
            manages += 1;
            return true;
        };
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(manages, 0);
        assert.equal(state.focused.tile, state.focusedTile);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:assignment-stale"],
        );
    });

    it("rejects a source that would remain occupied after the move", () => {
        const state = moveSetup("right");
        state.focusedTile.windows = [state.focused, window({ tile: state.focusedTile })];
        let manages = 0;
        state.target.manage = () => {
            manages += 1;
            return true;
        };
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(manages, 0);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:source-occupancy-validity"],
        );
    });

    it("rejects a target that loses nearest directional eligibility before the assignment", () => {
        const state = moveSetup("right");
        let rootReads = 0;
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                rootReads += 1;
                if (rootReads === 2) {
                    state.target.absoluteGeometry = { x: -200, y: 0, width: 100, height: 100 };
                }
                return state.root;
            },
        });
        let manages = 0;
        state.target.manage = () => {
            manages += 1;
            return true;
        };
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(manages, 0);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:assignment-stale"],
        );
    });

    it("rejects a target that becomes occupied before the assignment", () => {
        const state = moveSetup("right");
        let rootReads = 0;
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                rootReads += 1;
                if (rootReads === 2) {
                    state.target.windows = [window({ tile: state.target })];
                }
                return state.root;
            },
        });
        let manages = 0;
        state.target.manage = () => {
            manages += 1;
            return true;
        };
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(manages, 0);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:assignment-stale"],
        );
    });

    it("rejects when the active window changes before the assignment", () => {
        const state = moveSetup("right");
        let activeReads = 0;
        const replacement = window({ tile: state.focusedTile });
        Object.defineProperty(state.harness, "active", {
            configurable: true,
            get: () => {
                activeReads += 1;
                return activeReads === 1 ? state.focused : replacement;
            },
        });
        let manages = 0;
        state.target.manage = () => {
            manages += 1;
            return true;
        };
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(manages, 0);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:assignment-stale"],
        );
    });

    it("writes nothing and keeps the controller enabled when the assignment reports failure", () => {
        const state = moveSetup("right");
        state.target.manage = () => false;
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(state.focused.tile, state.focusedTile);
        assert.deepEqual(state.focusedTile.windows, [state.focused]);
        assert.deepEqual(state.target.windows, []);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:assignment-failed"],
        );
    });

    it("contains an assignment throw with a fixed diagnostic and no write", () => {
        const state = moveSetup("right");
        state.target.manage = () => {
            throw new Error("private-window-title");
        };
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(state.focused.tile, state.focusedTile);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:assignment-failed"],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("reconciles occupancy so later automatic placement sees the source empty and target occupied", () => {
        const state = moveSetup("right");
        state.target.manage = (value) => {
            state.focusedTile.windows = [];
            state.focused.tile = state.target;
            state.target.windows = [value];
            return true;
        };
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        const managed: unknown[] = [];
        state.focusedTile.manage = (value) => {
            managed.push(value);
            return true;
        };
        const incoming = window();
        state.harness.emitAdded(incoming);
        assert.deepEqual(managed, [incoming]);
        assert.equal(countEvent(state.harness.logs, "automatic-placement-managed"), 1);
    });

    it("contains move diagnostic sink failures without changing the move result", () => {
        const state = moveSetup("right");
        let manages = 0;
        state.target.manage = () => {
            manages += 1;
            return true;
        };
        state.harness.throwOnLog = true;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(manages, 1);
    });

    it("bails move with the specific reason for sticky and maximized active windows", () => {
        const gates: ReadonlyArray<{ readonly label: string; readonly configure: (state: ReturnType<typeof moveSetup>) => void }> = [
            { label: "move-rejected:sticky", configure: (state) => setSticky(state.focused, true) },
            { label: "move-rejected:maximized", configure: (state) => setMaximized(state.focused, 3) },
        ];
        for (const gate of gates) {
            const state = moveSetup("right");
            const baseline = state.harness.logs.length;
            gate.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
            assert.deepEqual(state.target.windows, []);
            assert.deepEqual(
                state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
                ["plasma-auto-tiler:move-invoked", `plasma-auto-tiler:${gate.label}`],
            );
        }
    });
});

describe("TileController occupied-target move swap", () => {
    const swapActions: ReadonlyArray<readonly ["left" | "down" | "up" | "right", string]> = [
        ["left", "plasma-auto-tiler-move-left"],
        ["down", "plasma-auto-tiler-move-down"],
        ["up", "plasma-auto-tiler-move-up"],
        ["right", "plasma-auto-tiler-move-right"],
        ["left", "plasma-auto-tiler-move-left-arrow"],
        ["down", "plasma-auto-tiler-move-down-arrow"],
        ["up", "plasma-auto-tiler-move-up-arrow"],
        ["right", "plasma-auto-tiler-move-right-arrow"],
    ];

    it("swaps the active window with the occupied directional target in each direction", () => {
        for (const [direction, name] of swapActions) {
            const state = swapSetup(direction);
            invokeShortcut(state.harness, name);
            assert.equal(state.active.tile, state.target);
            assert.equal(state.occupant.tile, state.source);
            assert.deepEqual(state.source.windows, [state.occupant]);
            assert.deepEqual(state.target.windows, [state.active]);
            assert.deepEqual(state.writes, [
                { window: state.active, target: state.target },
                { window: state.occupant, target: state.source },
            ]);
            assert.deepEqual(
                state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
                [
                    "plasma-auto-tiler:move-invoked",
                    "plasma-auto-tiler:move-swap-invoked",
                    "plasma-auto-tiler:move-swap-completed",
                ],
            );
        }
    });

    it("swaps with a nearer occupied leaf even when a farther empty leaf exists", () => {
        const state = swapSetup("right");
        const fartherEmpty = tile({ x: 400, y: 0, width: 100, height: 100 });
        state.root.tiles = [state.source, state.target, fartherEmpty];
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.active.tile, state.target);
        assert.equal(state.occupant.tile, state.source);
        assert.deepEqual(state.writes, [
            { window: state.active, target: state.target },
            { window: state.occupant, target: state.source },
        ]);
        assert.deepEqual(
            state.harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-swap-completed",
            ],
        );
    });

    it("moves to a nearer empty leaf that outranks a farther occupied leaf", () => {
        const harness = new Harness();
        const root = tile(RECT, true);
        const source = tile();
        const nearerEmpty = tile({ x: 150, y: 0, width: 100, height: 100 });
        const farther = tile({ x: 300, y: 0, width: 100, height: 100 });
        const active = window({ tile: source });
        const occupant = window({ tile: farther });
        source.windows = [active];
        farther.windows = [occupant];
        root.tiles = [source, nearerEmpty, farther];
        harness.root = root;
        harness.active = active;
        harness.windows = [active, occupant];
        let manages = 0;
        nearerEmpty.manage = (value) => {
            manages += 1;
            assert.equal(value, active);
            source.windows = [];
            active.tile = nearerEmpty;
            nearerEmpty.windows = [value];
            return true;
        };
        const controller = new TileController(harness.environment());
        controller.start();
        invokeShortcut(harness, "plasma-auto-tiler-move-right");
        assert.equal(manages, 1);
        assert.equal(active.tile, nearerEmpty);
        assert.equal(occupant.tile, farther);
        assert.deepEqual(
            harness.logs.filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-completed"],
        );
    });

    it("does not write a restoration when the root or source leaf is stale", () => {
        const state = swapSetup("right");
        let rootReads = 0;
        const originalRoot = state.root;
        const decoyRoot = tile(RECT, true);
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                rootReads += 1;
                return rootReads >= 4 ? decoyRoot : originalRoot;
            },
        });
        Object.defineProperty(state.occupant, "tile", {
            configurable: true,
            get: () => state.target,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        // Only the first swap write happened; the failed second write and the
        // stale-root restoration gate leave the active stranded in the target
        // leaf with no restoration write.
        assert.deepEqual(state.writes, [{ window: state.active, target: state.target }]);
        assert.equal(state.active.tile, state.target);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-swap-failed:second-write",
                "plasma-auto-tiler:move-swap-restored:unverified",
            ],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("rejects with no-target when only a non-directional occupied leaf remains", () => {
        const state = swapSetup("right");
        // The only occupied leaf sits to the left of the source, so no empty
        // or occupied directional target exists in `right`.
        const wrongSide = tile({ x: -200, y: 0, width: 100, height: 100 });
        const wrongWindow = window({ tile: wrongSide });
        wrongSide.windows = [wrongWindow];
        state.root.tiles = [state.source, wrongSide];
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.deepEqual(state.writes, []);
        assert.equal(state.active.tile, state.source);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            ["plasma-auto-tiler:move-invoked", "plasma-auto-tiler:move-rejected:no-target"],
        );
    });

    it("rejects an ineligible occupant with no write", () => {
        const state = swapSetup("right");
        state.occupant.resizeable = false;
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.deepEqual(state.writes, []);
        assert.equal(state.active.tile, state.source);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-rejected:swap-occupant-ineligible",
            ],
        );
    });

    it("rejects an out-of-scope occupant with no write", () => {
        const state = swapSetup("right");
        state.occupant.desktops = [{ id: "desktop-2" }];
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.deepEqual(state.writes, []);
        assert.equal(state.active.tile, state.source);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-rejected:swap-occupant-ineligible",
            ],
        );
    });

    it("rejects a target occupied by more than one window with no write", () => {
        const state = swapSetup("right");
        const extra = window({ tile: state.target });
        state.target.windows = [state.occupant, extra];
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.deepEqual(state.writes, []);
        assert.equal(state.active.tile, state.source);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-rejected:swap-occupancy-validity",
            ],
        );
    });

    it("rejects stale source, target, or scope before the first write", () => {
        const state = swapSetup("right");
        let rootReads = 0;
        const originalRoot = state.root;
        const decoyRoot = tile(RECT, true);
        Object.defineProperty(state.harness, "root", {
            configurable: true,
            get: () => {
                rootReads += 1;
                return rootReads === 1 ? originalRoot : decoyRoot;
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.deepEqual(state.writes, []);
        assert.equal(state.active.tile, state.source);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-swap-rejected:stale",
            ],
        );
    });

    it("reports a first-write failure with no restoration claim", () => {
        const state = swapSetup("right");
        Object.defineProperty(state.active, "tile", {
            configurable: true,
            get: () => state.source,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.active.tile, state.source);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(state.writes, []);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-swap-failed:first-write",
            ],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("restores the source on a second-write failure and reports a verified restoration", () => {
        const state = swapSetup("right");
        Object.defineProperty(state.occupant, "tile", {
            configurable: true,
            get: () => state.target,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(state.active.tile, state.source);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(state.source.windows, [state.active]);
        assert.deepEqual(state.target.windows, [state.occupant]);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-swap-failed:second-write",
                "plasma-auto-tiler:move-swap-restored:verified",
            ],
        );
    });

    it("reports an unverified restoration when the restore write also fails", () => {
        const state = swapSetup("right");
        let activeSet = 0;
        let current: object | null = state.source;
        Object.defineProperty(state.active, "tile", {
            configurable: true,
            get: () => current,
            set: (next: object | null) => {
                activeSet += 1;
                if (activeSet === 2) {
                    throw new Error("private-window-title");
                }
                const previous = current;
                current = next;
                if (previous !== null && previous !== next) {
                    (previous as TestTile).windows = ((previous as TestTile).windows as TestWindow[]).filter(
                        (value) => value !== state.active,
                    );
                }
                if (next !== null) {
                    (next as TestTile).windows = [
                        ...((next as TestTile).windows as TestWindow[]).filter((value) => value !== state.active),
                        state.active,
                    ];
                }
            },
        });
        Object.defineProperty(state.occupant, "tile", {
            configurable: true,
            get: () => state.target,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        // The first write moved the active into the target leaf; the second
        // write and the restore both failed, so the active is stranded in the
        // target leaf with the occupant.
        assert.equal(state.active.tile, state.target);
        assert.equal(state.occupant.tile, state.target);
        assert.deepEqual(state.target.windows, [state.occupant, state.active]);
        assert.deepEqual(state.source.windows, []);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:move-")),
            [
                "plasma-auto-tiler:move-invoked",
                "plasma-auto-tiler:move-swap-invoked",
                "plasma-auto-tiler:move-swap-failed:second-write",
                "plasma-auto-tiler:move-swap-restored:unverified",
            ],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("private-window-title"), false);
        }
    });

    it("never calls a topology method during a swap", () => {
        const state = swapSetup("right");
        let splits = 0;
        let manages = 0;
        for (const value of [state.root, state.source, state.target]) {
            value.split = () => {
                splits += 1;
                return [];
            };
            const originalManage = value.manage;
            value.manage = (subject) => {
                manages += 1;
                return originalManage(subject);
            };
        }
        invokeShortcut(state.harness, "plasma-auto-tiler-move-right");
        assert.equal(splits, 0);
        assert.equal(manages, 0);
        assert.equal(state.active.tile, state.target);
        assert.equal(state.occupant.tile, state.source);
    });

    it("keeps the selected overlay ordinal leaves intact across a swap without a rebuild", () => {
        const state = presetSetup();
        const realized = configureThreeOccupantPreset(state);
        invokeShortcut(state.harness, "plasma-auto-tiler-apply-columns");
        const scope = currentScopeFor(state.active);
        const overlay = state.controller.readSelectedOverlay(scope);
        assert.ok(overlay !== null);
        const leavesBefore = overlay.leaves;
        const writes: Array<{ window: TestWindow; target: object | null }> = [];
        attachTileWriter(state.active, writes);
        attachTileWriter(state.lateWindow, writes);
        attachTileWriter(state.earlyWindow, writes);
        // `early`/`late` sit to the right, so no empty leaf lies left of the
        // active occupant in `realized.right`: the move becomes a swap.
        state.harness.active = state.earlyWindow;
        invokeShortcut(state.harness, "plasma-auto-tiler-move-left");
        assert.equal(state.earlyWindow.tile, realized.middle);
        assert.equal(state.lateWindow.tile, realized.right);
        assert.equal(writes.length, 2);
        const overlayAfter = state.controller.readSelectedOverlay(scope);
        assert.ok(overlayAfter !== null);
        assert.deepEqual(overlayAfter.leaves, leavesBefore);
        assert.equal(overlayAfter.preset, "columns");
        assert.equal(countEvent(state.harness.logs, "selected-overlay-invalidated"), 0);
        assert.equal(state.controller.isEnabled, true);
    });
});

describe("TileController tile detach", () => {
    it("invokes the registered callback and detaches the active window with one guarded write", () => {
        const { harness, controller, target, focused } = setup();
        const registered = harness.shortcuts.find((entry) => entry.name === "plasma-auto-tiler-detach");
        assert.notEqual(registered, undefined);
        const baseline = harness.logs.length;
        registered?.handler();
        assert.equal(controller.isEnabled, true);
        assert.equal(focused.tile, null);
        assert.deepEqual(target.windows, [focused]);
        assert.deepEqual(harness.activeWrites, []);
        assert.deepEqual(
            harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:detach")),
            ["plasma-auto-tiler:detach-invoked", "plasma-auto-tiler:detach-completed"],
        );
        for (const entry of harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("maps every detach guard to its first fixed private reason with no write", () => {
        const cases: ReadonlyArray<{
            readonly reason: string;
            readonly configure: (state: ReturnType<typeof setup>) => void;
        }> = [
            {
                reason: "detach-rejected:no-active-window",
                configure: (state) => {
                    state.harness.active = null;
                },
            },
            {
                reason: "detach-rejected:desktop-output-scope",
                configure: (state) => {
                    state.harness.currentDesktop = null;
                },
            },
            {
                reason: "detach-rejected:active-window-eligibility",
                configure: (state) => {
                    state.focused.resizeable = false;
                },
            },
            {
                reason: "detach-rejected:root-lookup",
                configure: (state) => {
                    state.harness.root = null;
                },
            },
            {
                reason: "detach-rejected:topology-decode",
                configure: (state) => {
                    state.root.tiles = { length: 1 };
                },
            },
            {
                reason: "detach-rejected:no-tile",
                configure: (state) => {
                    state.focused.tile = null;
                },
            },
            {
                reason: "detach-rejected:active-tile-association",
                configure: (state) => {
                    state.focused.tile = { ...state.target, split: undefined };
                },
            },
            {
                reason: "detach-rejected:layout-tile",
                configure: (state) => {
                    state.focused.tile = state.root;
                },
            },
            {
                reason: "detach-rejected:occupancy-validity",
                configure: (state) => {
                    state.target.windows = [];
                },
            },
        ];
        for (const testCase of cases) {
            const state = setup();
            const baseline = state.harness.logs.length;
            testCase.configure(state);
            invokeShortcut(state.harness, "plasma-auto-tiler-detach");
            assert.equal(countEvent(state.harness.logs, "detach-completed"), 0);
            assert.deepEqual(state.harness.activeWrites, []);
            assert.deepEqual(
                state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:detach")),
                ["plasma-auto-tiler:detach-invoked", `plasma-auto-tiler:${testCase.reason}`],
            );
        }
    });

    it("rejects a tile that leaves the topology immediately before the write", () => {
        const state = setup();
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
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");
        assert.equal(state.focused.tile, state.target);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:detach")),
            ["plasma-auto-tiler:detach-invoked", "plasma-auto-tiler:detach-rejected:assignment-stale"],
        );
    });

    it("rejects when the active window changes immediately before the write", () => {
        const state = setup();
        let activeReads = 0;
        const replacement = window();
        Object.defineProperty(state.harness, "active", {
            configurable: true,
            get: () => {
                activeReads += 1;
                return activeReads === 1 ? state.focused : replacement;
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");
        assert.equal(state.focused.tile, state.target);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:detach")),
            ["plasma-auto-tiler:detach-invoked", "plasma-auto-tiler:detach-rejected:assignment-stale"],
        );
    });

    it("reports a false detach write with no state change and keeps the controller enabled", () => {
        const state = setup();
        Object.defineProperty(state.focused, "tile", {
            configurable: true,
            value: state.target,
            writable: false,
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(state.focused.tile, state.target);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:detach")),
            ["plasma-auto-tiler:detach-invoked", "plasma-auto-tiler:detach-rejected:assignment-failed"],
        );
    });

    it("contains a throwing detach write with a fixed diagnostic and no leaked error", () => {
        const state = setup();
        Object.defineProperty(state.focused, "tile", {
            configurable: true,
            get: () => state.target,
            set: () => {
                throw new Error("private-window-title");
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");
        assert.equal(state.controller.isEnabled, true);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:detach")),
            ["plasma-auto-tiler:detach-invoked", "plasma-auto-tiler:detach-rejected:assignment-failed"],
        );
        for (const entry of state.harness.logs.slice(baseline)) {
            assert.equal(entry.startsWith("plasma-auto-tiler:"), true);
            assert.equal(entry.includes("private-window-title"), false);
            assert.equal(entry.includes("screen-1"), false);
            assert.equal(entry.includes("desktop-1"), false);
        }
    });

    it("reports a postcondition failure when the write succeeds but the association persists", () => {
        const state = setup();
        Object.defineProperty(state.focused, "tile", {
            configurable: true,
            get: () => state.target,
            set: () => {
                // Setter runs without error but the association is unchanged.
            },
        });
        const baseline = state.harness.logs.length;
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");
        assert.equal(state.controller.isEnabled, true);
        assert.deepEqual(
            state.harness.logs.slice(baseline).filter((entry) => entry.startsWith("plasma-auto-tiler:detach")),
            ["plasma-auto-tiler:detach-invoked", "plasma-auto-tiler:detach-failed:postcondition"],
        );
    });

    it("contains detach diagnostic sink failures without changing the detach result", () => {
        const state = setup();
        state.harness.throwOnLog = true;
        invokeShortcut(state.harness, "plasma-auto-tiler-detach");
        assert.equal(state.controller.isEnabled, true);
        assert.equal(state.focused.tile, null);
    });
});
